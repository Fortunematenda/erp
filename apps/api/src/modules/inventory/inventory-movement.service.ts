import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';

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
  occurredAt?: Date;
  batchNo?: string;
  serialNo?: string;
};

/**
 * Authoritative inventory movement semantics.
 * Quantity is always stored as a positive magnitude.
 * signedQuantity is +qty for inbound types and -qty for outbound types (ISSUE = sale delivery).
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
    return { onHand, reserved, available: Number((onHand - reserved).toFixed(4)) };
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
    if (item.type === 'SERVICE') throw new BadRequestException('Service items do not move stock');

    const signedQuantity = this.signedQuantity(type, qty);
    if (signedQuantity < 0 && !(await this.allowNegativeStock(companyId))) {
      const current = await this.balance(companyId, item.id, warehouse.id, db);
      if (current.onHand + signedQuantity < -0.0001) {
        throw new BadRequestException(`Insufficient stock for ${item.sku || item.name}: on hand ${current.onHand}, requested ${qty}`);
      }
    }

    const movement = await db.stockMovement.create({
      data: {
        warehouseId: warehouse.id,
        itemId: item.id,
        type,
        quantity: qty,
        signedQuantity,
        unitCost: Number(input.unitCost || 0),
        reference: input.reference,
        batchNo: input.batchNo,
        serialNo: input.serialNo,
        occurredAt: input.occurredAt || new Date(),
      },
    });
    if (userId) {
      await this.audit.log(companyId, userId, 'STOCK_MOVEMENT', 'StockMovement', movement.id, {
        module: 'inventory',
        result: 'SUCCESS',
        metadata: { type, quantity: qty, signedQuantity, itemId: item.id, warehouseId: warehouse.id, reference: input.reference },
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
