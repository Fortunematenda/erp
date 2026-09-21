import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { isStockTracked } from './item-type';

export const INBOUND_TYPES = ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'] as const;
export const OUTBOUND_TYPES = ['ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT_OUT', 'RETURN_OUT'] as const;
export const MOVEMENT_TYPES = [...INBOUND_TYPES, ...OUTBOUND_TYPES] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export type MovementClient = Prisma.TransactionClient | PrismaService;

export type CreateMovementInput = {
  warehouseId: string;
  itemId: string;
  type: string;
  quantity: number;
  unitCost?: number;
  reference?: string;
  notes?: string;
  occurredAt?: Date;
  batchNo?: string;
  serialNo?: string;
};

/**
 * Authoritative inventory movement semantics.
 * Quantity is always stored as a positive magnitude.
 * signedQuantity is +qty for inbound types and -qty for outbound types.
 * Stock on hand is derived exclusively from this ledger — never edited in place.
 */
@Injectable()
export class InventoryMovementService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  normalizeType(raw: string): MovementType {
    const t = String(raw || '').toUpperCase().replace(/[\s-]+/g, '_');
    const aliases: Record<string, MovementType> = {
      SALE_DELIVERY: 'ISSUE',
      SALES_ISSUE: 'ISSUE',
      PURCHASE_RECEIPT: 'RECEIPT',
      RETURN: 'RETURN_IN',
      OPENING_BALANCE: 'RECEIPT',
    };
    const mapped = (aliases[t] || t) as MovementType;
    if (!(MOVEMENT_TYPES as readonly string[]).includes(mapped)) {
      throw new BadRequestException(`Unsupported stock movement type "${raw}"`);
    }
    return mapped;
  }

  sign(type: string): 1 | -1 {
    return (INBOUND_TYPES as readonly string[]).includes(this.normalizeType(type)) ? 1 : -1;
  }

  signedQuantity(type: string, quantity: number): number {
    const qty = Number(quantity);
    if (!(qty > 0)) throw new BadRequestException('Movement quantity must be greater than zero');
    return Number((this.sign(type) * qty).toFixed(4));
  }

  async allowNegativeStock(companyId: string): Promise<boolean> {
    const cfg = await this.prisma.systemConfig.findFirst({ where: { companyId, key: 'cfg.finance.allowNegativeStock' } });
    const v = (cfg?.value as any)?.value ?? cfg?.value;
    return v === true || v === 'true';
  }

  /** Chronological weighted-average cost (authoritative costing method). */
  wac(movements: { type: string; quantity: any; unitCost?: any; occurredAt?: any }[]): { onHand: number; avgCost: number; value: number } {
    let qty = 0;
    let value = 0;
    const sorted = [...movements].sort((a, b) => new Date(a.occurredAt || 0).getTime() - new Date(b.occurredAt || 0).getTime());
    for (const m of sorted) {
      const q = Number(m.quantity || 0);
      const inbound = (INBOUND_TYPES as readonly string[]).includes(String(m.type).toUpperCase() as MovementType)
        || (INBOUND_TYPES as readonly string[]).includes(this.normalizeType(m.type));
      if (inbound) {
        qty += q;
        value += q * Number(m.unitCost || 0);
      } else {
        const avg = qty > 0 ? value / qty : 0;
        const out = Math.min(q, qty);
        value -= out * avg;
        qty -= out;
      }
    }
    const avgCost = qty > 0.0001 ? value / qty : 0;
    return { onHand: Number(qty.toFixed(4)), avgCost: Number(avgCost.toFixed(4)), value: Number(value.toFixed(2)) };
  }

  async balance(companyId: string, itemId: string, warehouseId?: string | null, client?: MovementClient) {
    const db = client || this.prisma;
    const where: any = { itemId, warehouse: { companyId } };
    if (warehouseId) where.warehouseId = warehouseId;
    const movements = await db.stockMovement.findMany({ where });
    const onHand = Number(movements.reduce((s, m) => s + (Number(m.signedQuantity) || this.sign(m.type) * Number(m.quantity)), 0).toFixed(4));
    const reservedAgg = await db.stockReservation.aggregate({
      where: { itemId, status: 'ACTIVE', companyId, ...(warehouseId ? { OR: [{ warehouseId }, { warehouseId: null }] } : {}) },
      _sum: { qty: true },
    });
    const reserved = Number((reservedAgg._sum.qty || 0).toFixed(4));
    const cost = this.wac(movements);
    return { onHand, reserved, available: Number((onHand - reserved).toFixed(4)), avgCost: cost.avgCost, value: cost.value };
  }

  async assertPeriodOpen(companyId: string, date: Date, client?: MovementClient) {
    const db = client || this.prisma;
    const period = await db.fiscalPeriod.findFirst({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } } });
    if (!period) return;
    if (period.status === 'CLOSED' || period.status === 'SOFT_CLOSED' || period.status === 'LOCKED') {
      throw new BadRequestException(`This transaction belongs to a locked accounting period (${period.name}) and cannot be modified.`);
    }
    if (period.status === 'FUTURE') {
      throw new BadRequestException(`Posting blocked: ${period.name} is a future period and is not yet open.`);
    }
  }

  async create(companyId: string, input: CreateMovementInput, userId?: string, client?: MovementClient) {
    const db = client || this.prisma;
    const type = this.normalizeType(input.type);
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw new BadRequestException('Movement quantity must be greater than zero');
    const warehouse = await db.warehouse.findFirst({ where: { id: input.warehouseId, companyId } });
    if (!warehouse) throw new BadRequestException('Warehouse not found');
    const item = await db.inventoryItem.findFirst({ where: { id: input.itemId, companyId } });
    if (!item) throw new BadRequestException('Product not found');
    if (!isStockTracked(item.type)) {
      throw new BadRequestException('Only Inventory Products can create stock movements. Services and Non-Inventory Products do not affect stock.');
    }

    const occurredAt = input.occurredAt || new Date();
    await this.assertPeriodOpen(companyId, occurredAt, db);

    const signedQuantity = this.signedQuantity(type, qty);
    const current = await this.balance(companyId, item.id, warehouse.id, db);
    if (signedQuantity < 0 && !(await this.allowNegativeStock(companyId))) {
      if (current.onHand + signedQuantity < -0.0001) {
        throw new BadRequestException(`Insufficient stock for ${item.sku || item.name}: on hand ${current.onHand}, requested ${qty}`);
      }
    }

    // Accounting: outbound / transfer / found-stock adjustments carry WAC when cost omitted or zeroed.
    let unitCost = input.unitCost === undefined || input.unitCost === null ? NaN : Number(input.unitCost);
    const outbound = (OUTBOUND_TYPES as readonly string[]).includes(type);
    const needsWac = Number.isNaN(unitCost) || (unitCost === 0 && (outbound || type === 'TRANSFER_IN' || type === 'ADJUSTMENT_IN'));
    if (needsWac) unitCost = current.avgCost;
    if (Number.isNaN(unitCost)) unitCost = 0;

    const movement = await db.stockMovement.create({
      data: {
        warehouseId: warehouse.id,
        itemId: item.id,
        type,
        quantity: qty,
        signedQuantity,
        unitCost,
        reference: input.reference,
        notes: input.notes,
        batchNo: input.batchNo,
        serialNo: input.serialNo,
        occurredAt,
      },
    });
    if (userId) {
      await this.audit.log(companyId, userId, 'STOCK_MOVEMENT', 'StockMovement', movement.id, {
        module: 'inventory',
        result: 'SUCCESS',
        metadata: { type, quantity: qty, signedQuantity, unitCost, itemId: item.id, warehouseId: warehouse.id, reference: input.reference, notes: input.notes },
      });
    }
    return movement;
  }

  async consumeReservation(companyId: string, salesOrderId: string, itemId: string, qty: number, client?: MovementClient) {
    const db = client || this.prisma;
    let remaining = Number(qty);
    const reservations = await db.stockReservation.findMany({
      where: { companyId, salesOrderId, itemId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of reservations) {
      if (remaining <= 0.0001) break;
      const have = Number(r.qty);
      const take = Math.min(have, remaining);
      const left = Number((have - take).toFixed(4));
      remaining = Number((remaining - take).toFixed(4));
      if (left <= 0.0001) {
        await db.stockReservation.update({ where: { id: r.id }, data: { qty: 0, status: 'FULFILLED', releasedAt: new Date() } });
      } else {
        await db.stockReservation.update({ where: { id: r.id }, data: { qty: left } });
      }
    }
  }
}
