/**
 * Cross-flow regression + read-only reconciliation suite (Feature 13).
 *   npm run test:e2e -w @nexuserp/api
 *
 * End-to-end: PO 100 @ $20 -> receive 60 -> bill 60 -> receive 40 -> bill 40 -> pay 2000
 * -> sell 1 @ $35. Asserts AP, stock, GRNI clearing, COGS and that the read-only
 * reconciliation reports no inventory/GL/AP differences and no unbalanced journals.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const p = resolve(__dirname, '../.env');
  try {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch { /* use existing env */ }
}
loadEnv();

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const prisma = new PrismaClient();

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  [ok] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' - ' + detail : ''}`); }
}
async function req(path: string, opts: { method?: string; token?: string; body?: any } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}

async function main() {
  console.log('Cross-flow end-to-end suite');
  const start = new Date();
  const login = await req('/auth/login', { method: 'POST', body: { email: 'admin@demo.local', password: 'Password123!' } });
  if (!login.json?.token) throw new Error('Login failed: ' + login.text);
  let token: string = login.json.token;
  const companyId: string = login.json.companies?.[0]?.id;
  if (companyId) {
    const sw = await req('/auth/switch-company', { method: 'POST', token, body: { companyId } });
    if (sw.json?.token) token = sw.json.token;
  }
  const auth = { token };
  const meta = await req('/companies/meta', auth);
  const accounts: any[] = meta.json?.accounts || [];
  const warehouse = (meta.json?.warehouses || [])[0];
  const assetId = accounts.find((a) => a.code === '1200')?.id;
  const incomeId = accounts.find((a) => a.code === '4000')?.id;

  const stamp = Date.now();
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'E2E Vendor', code: `E2E-${stamp}` } });
  const customer = await req('/sales/customers', { method: 'POST', ...auth, body: { name: `E2E Customer ${stamp}` } });
  const customerId = customer.json?.id;
  const items: string[] = [];
  const pos: string[] = [];
  const bills: string[] = [];
  const invoices: string[] = [];

  const acctNet = async (code: string) => {
    const a = await prisma.ledgerAccount.findFirst({ where: { companyId, code } });
    if (!a) return 0;
    const rows = await prisma.journalLine.findMany({ where: { accountId: a.id, journal: { companyId } } });
    return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  };
  const onHand = async (itemId: string) => (await prisma.stockMovement.findMany({ where: { itemId }, select: { signedQuantity: true } })).reduce((s, r) => s + Number(r.signedQuantity || 0), 0);

  const inv = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `E2E-INV-${stamp}`, name: 'E2E Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, incomeAccountId: incomeId, inventoryAssetAccountId: assetId } });
  if (inv.json?.id) items.push(inv.json.id);

  const before = { asset: await acctNet('1200'), ap: await acctNet('2000'), grni: await acctNet('2050'), cogs: await acctNet('5000') };
  const recBefore = (await req('/inventory/reconciliation', auth)).json;

  // Scenario A: PO -> receive -> bill -> pay
  const po = await req('/procurement/purchase-orders', { method: 'POST', ...auth, body: { supplierId: supplier.id, warehouseId: warehouse?.id, lines: [{ itemId: inv.json.id, description: 'E2E Widget', quantity: 100, unitPrice: 20, taxRate: 0 }] } });
  if (po.json?.id) pos.push(po.json.id);
  const poLineId = (await prisma.purchaseOrderLine.findFirst({ where: { purchaseOrderId: po.json.id } }))?.id as string;
  await req(`/procurement/purchase-orders/${po.json.id}/status`, { method: 'PATCH', ...auth, body: { status: 'APPROVED' } });
  check('PO alone creates no AP and no stock', Math.abs(await acctNet('2000') - before.ap) < 0.01 && (await onHand(inv.json.id)) === 0);

  await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: 60 }] } });
  const b1 = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, purchaseOrderId: po.json.id, invoiceNo: `E2E-B1-${stamp}`, lines: [{ purchaseOrderLineId: poLineId, itemId: inv.json.id, description: 'E2E Widget', quantity: 60, unitPrice: 20, taxRate: 0 }] } });
  if (b1.json?.id) bills.push(b1.json.id);
  await req(`/procurement/supplier-invoices/${b1.json.id}/post`, { method: 'POST', ...auth, body: {} });
  check('after 60 received + billed: stock 60, AP -1200, GRNI 0', Math.abs((await onHand(inv.json.id)) - 60) < 0.001 && Math.abs((await acctNet('2000')) - before.ap + 1200) < 0.01 && Math.abs((await acctNet('2050')) - before.grni) < 0.01);

  await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: 40 }] } });
  const b2 = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, purchaseOrderId: po.json.id, invoiceNo: `E2E-B2-${stamp}`, lines: [{ purchaseOrderLineId: poLineId, itemId: inv.json.id, description: 'E2E Widget', quantity: 40, unitPrice: 20, taxRate: 0 }] } });
  if (b2.json?.id) bills.push(b2.json.id);
  await req(`/procurement/supplier-invoices/${b2.json.id}/post`, { method: 'POST', ...auth, body: {} });
  check('after full receipt + bill: stock 100, Inventory +2000, AP -2000, GRNI 0', Math.abs((await onHand(inv.json.id)) - 100) < 0.001 && Math.abs((await acctNet('1200')) - before.asset - 2000) < 0.01 && Math.abs((await acctNet('2000')) - before.ap + 2000) < 0.01 && Math.abs((await acctNet('2050')) - before.grni) < 0.01);

  const pay = await req('/procurement/supplier-payments', { method: 'POST', ...auth, body: { supplierId: supplier.id, amount: 2000, method: 'BANK', idempotencyKey: `e2e-pay-${stamp}`, allocations: [{ supplierInvoiceId: b1.json.id, amount: 1200 }, { supplierInvoiceId: b2.json.id, amount: 800 }] } });
  check('payment 2000 settles both bills', pay.status < 400 && Math.abs((await acctNet('2000')) - before.ap) < 0.01, `status=${pay.status} ap=${await acctNet('2000')}`);

  // Scenario C: sell 1 @ 35 -> COGS 20, income 35
  const sale = await req('/sales/invoices', { method: 'POST', ...auth, body: { customerId, lines: [{ itemId: inv.json.id, description: 'E2E Widget', quantity: 1, unitPrice: 35, taxRate: 0 }] } });
  if (sale.json?.id) invoices.push(sale.json.id);
  await req(`/sales/invoices/${sale.json.id}/post`, { method: 'POST', ...auth });
  check('sale: stock 99, COGS +20, Inventory +1980', Math.abs((await onHand(inv.json.id)) - 99) < 0.001 && Math.abs((await acctNet('5000')) - before.cogs - 20) < 0.01 && Math.abs((await acctNet('1200')) - before.asset - 1980) < 0.01);

  // Read-only reconciliation: this flow must not introduce new drift (dev DB may
  // already contain historical drift from other data — the report surfaces it).
  const rec = await req('/inventory/reconciliation', auth);
  check('reconciliation: on-hand ledger equals displayed', (rec.json?.inventory?.items || []).every((i: any) => i.onHandDifference === 0));
  check('reconciliation: inventory value difference unchanged by this flow', Math.abs(Number(rec.json?.inventory?.valueDifference) - Number(recBefore?.inventory?.valueDifference)) < 0.05, `before=${recBefore?.inventory?.valueDifference} after=${rec.json?.inventory?.valueDifference}`);
  check('reconciliation: AP difference unchanged by this flow', Math.abs(Number(rec.json?.ap?.difference) - Number(recBefore?.ap?.difference)) < 0.05, `before=${recBefore?.ap?.difference} after=${rec.json?.ap?.difference}`);
  check('reconciliation: GRNI cleared to zero', Math.abs(Number(rec.json?.grni?.glBalance)) < 0.05, `grni=${rec.json?.grni?.glBalance}`);
  check('reconciliation: no unbalanced journals', Number(rec.json?.journals?.unbalanced) === 0, `unbalanced=${rec.json?.journals?.unbalanced}`);
  check('reconciliation: no new duplicate source movements', Number(rec.json?.stockMovements?.duplicateSourceGroups) <= Number(recBefore?.stockMovements?.duplicateSourceGroups), `before=${recBefore?.stockMovements?.duplicateSourceGroups} after=${rec.json?.stockMovements?.duplicateSourceGroups}`);

  // Cleanup
  const grns = await prisma.goodsReceivedNote.findMany({ where: { companyId, purchaseOrderId: { in: pos } }, select: { id: true } });
  const grnIds = grns.map((g) => g.id);
  const paymentIds = (await prisma.supplierPayment.findMany({ where: { companyId, supplierId: supplier.id }, select: { id: true } })).map((p) => p.id);
  await prisma.journalEntry.deleteMany({ where: { companyId, createdAt: { gte: start }, sourceType: { in: ['SALES_INVOICE', 'COGS_DIRECT_INVOICE', 'SUPPLIER_INVOICE', 'GOODS_RECEIPT', 'SUPPLIER_PAYMENT'] } } });
  await prisma.stockMovement.deleteMany({ where: { itemId: { in: items } } });
  await prisma.salesInvoiceLine.deleteMany({ where: { invoiceId: { in: invoices } } });
  await prisma.salesInvoice.deleteMany({ where: { id: { in: invoices } } });
  await prisma.goodsReceivedNoteLine.deleteMany({ where: { grnId: { in: grnIds } } });
  await prisma.goodsReceivedNote.deleteMany({ where: { id: { in: grnIds } } });
  await prisma.supplierPaymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.supplierPayment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: { in: bills } } });
  await prisma.supplierInvoice.deleteMany({ where: { id: { in: bills } } });
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: pos } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: pos } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: items } } });
  await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => {});
  if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
