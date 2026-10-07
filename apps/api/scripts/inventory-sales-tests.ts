/**
 * Sales of inventory -> stock issue + COGS + profit regression suite (Feature 10).
 *   npm run test:inventory-sales -w @nexuserp/api
 *
 * Purchase 10 @ $20 then sell 1 @ $35: income 35, COGS 20 (weighted-average), inventory
 * value 180, stock 9, gross profit 15. Also verifies direct-invoice COGS, service sales
 * (no stock), and that delivery -> invoice does not issue stock twice.
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
  console.log('Inventory sales + COGS suite');
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
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'Sell Vendor', code: `SLV-${stamp}` } });
  const customer = await req('/sales/customers', { method: 'POST', ...auth, body: { name: `Sell Customer ${stamp}`, email: `sell${stamp}@test.local` } });
  const customerId = customer.json?.id;
  const items: string[] = [];
  const bills: string[] = [];
  const invoices: string[] = [];
  const orders: string[] = [];
  const deliveries: string[] = [];

  const acctNet = async (code: string) => {
    const a = await prisma.ledgerAccount.findFirst({ where: { companyId, code } });
    if (!a) return 0;
    const rows = await prisma.journalLine.findMany({ where: { accountId: a.id, journal: { companyId } } });
    return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  };
  const onHand = async (itemId: string) => (await prisma.stockMovement.findMany({ where: { itemId }, select: { signedQuantity: true } })).reduce((s, r) => s + Number(r.signedQuantity || 0), 0);
  const itemValue = async (itemId: string) => {
    const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    const rows = await prisma.stockMovement.findMany({ where: { itemId } });
    let qty = 0, val = 0;
    for (const m of rows.sort((a, b) => +new Date(a.occurredAt) - +new Date(b.occurredAt))) {
      const q = Number(m.quantity); const inbound = ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'RETURN_IN'].includes(m.type);
      if (inbound) { val += q * Number(m.unitCost); qty += q; } else { const avg = qty > 0 ? val / qty : 0; val -= Math.min(q, qty) * avg; qty -= Math.min(q, qty); }
    }
    return Number(val.toFixed(2));
  };

  const inv = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `SL-INV-${stamp}`, name: 'Sell Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, incomeAccountId: incomeId, inventoryAssetAccountId: assetId } });
  if (inv.json?.id) items.push(inv.json.id);
  const svc = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `SL-SVC-${stamp}`, name: 'Sell Service', type: 'SERVICE', sellingPrice: 100, incomeAccountId: incomeId } });
  if (svc.json?.id) items.push(svc.json.id);

  const before = { asset: await acctNet('1200'), cogs: await acctNet('5000'), income: await acctNet('4000'), ap: await acctNet('2000') };

  // ---- Purchase 10 @ 20 (direct receive-now bill) ----
  const bill = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, invoiceNo: `SL-BILL-${stamp}`, warehouseId: warehouse?.id, receiveNow: true, lines: [{ itemId: inv.json.id, description: 'Sell Widget', quantity: 10, unitPrice: 20, taxRate: 0 }] } });
  if (bill.json?.id) bills.push(bill.json.id);
  await req(`/procurement/supplier-invoices/${bill.json.id}/post`, { method: 'POST', ...auth, body: {} });
  check('purchase: stock 10, inventory +200, AP -200', Math.abs((await onHand(inv.json.id)) - 10) < 0.001 && Math.abs((await acctNet('1200')) - before.asset - 200) < 0.01 && Math.abs((await acctNet('2000')) - before.ap + 200) < 0.01);

  // ---- Sell 1 @ 35 (direct invoice post -> ISSUE + COGS at WAC) ----
  const sell = await req('/sales/invoices', { method: 'POST', ...auth, body: { customerId, lines: [{ itemId: inv.json.id, description: 'Sell Widget', quantity: 1, unitPrice: 35, taxRate: 0 }] } });
  if (sell.json?.id) invoices.push(sell.json.id);
  check('invoice created', sell.status === 201 && !!sell.json?.id, `status=${sell.status}`);
  const postSell = await req(`/sales/invoices/${sell.json.id}/post`, { method: 'POST', ...auth });
  check('invoice posted', postSell.status < 400, `status=${postSell.status}`);
  check('stock 9 after sale', Math.abs((await onHand(inv.json.id)) - 9) < 0.001, `onHand=${await onHand(inv.json.id)}`);
  check('inventory value 180 after sale', Math.abs((await itemValue(inv.json.id)) - 180) < 0.01, `value=${await itemValue(inv.json.id)}`);
  check('inventory GL +180', Math.abs((await acctNet('1200')) - before.asset - 180) < 0.01, `delta=${(await acctNet('1200')) - before.asset}`);
  check('COGS 20 recognised', Math.abs((await acctNet('5000')) - before.cogs - 20) < 0.01, `delta=${(await acctNet('5000')) - before.cogs}`);
  check('sales income credited 35', Math.abs((await acctNet('4000')) - before.income + 35) < 0.01, `delta=${(await acctNet('4000')) - before.income}`);
  const cogsJournal = await prisma.journalEntry.findFirst({ where: { companyId, sourceType: 'COGS_DIRECT_INVOICE', sourceId: sell.json.id }, include: { lines: true } });
  check('COGS journal balanced', !!cogsJournal && Math.abs(cogsJournal.lines.reduce((s, l) => s + Number(l.debit), 0) - cogsJournal.lines.reduce((s, l) => s + Number(l.credit), 0)) < 0.01);

  // ---- Service sale: no stock movement ----
  const svcMovesBefore = await prisma.stockMovement.count({ where: { itemId: svc.json.id } });
  const sellSvc = await req('/sales/invoices', { method: 'POST', ...auth, body: { customerId, lines: [{ itemId: svc.json.id, description: 'Sell Service', quantity: 1, unitPrice: 100, taxRate: 0 }] } });
  if (sellSvc.json?.id) invoices.push(sellSvc.json.id);
  await req(`/sales/invoices/${sellSvc.json.id}/post`, { method: 'POST', ...auth });
  check('service sale creates NO stock movement', (await prisma.stockMovement.count({ where: { itemId: svc.json.id } })) === svcMovesBefore);

  // ---- Delivery -> invoice must not issue twice ----
  const so = await req('/sales/sales-orders', { method: 'POST', ...auth, body: { customerId, lines: [{ itemId: inv.json.id, description: 'Sell Widget', quantity: 2, unitPrice: 35, taxRate: 0 }] } });
  if (so.json?.id) orders.push(so.json.id);
  await req(`/sales/sales-orders/${so.json.id}/confirm`, { method: 'POST', ...auth });
  const dn = await req('/sales/deliveries', { method: 'POST', ...auth, body: { salesOrderId: so.json.id, warehouseId: warehouse?.id } });
  if (dn.json?.id) deliveries.push(dn.json.id);
  const dispatch = await req(`/sales/deliveries/${dn.json.id}/dispatch`, { method: 'POST', ...auth });
  check('delivery dispatched (issues stock)', dispatch.status < 400, `status=${dispatch.status}`);
  const movesAfterDispatch = await prisma.stockMovement.count({ where: { itemId: inv.json.id } });
  const cogsAfterDispatch = await acctNet('5000');
  check('dispatch issued stock (movement added)', movesAfterDispatch >= 2, `moves=${movesAfterDispatch}`);
  const invFromDelivery = await req(`/sales/deliveries/${dn.json.id}/invoice`, { method: 'POST', ...auth });
  if (invFromDelivery.json?.id) invoices.push(invFromDelivery.json.id);
  await req(`/sales/invoices/${invFromDelivery.json?.id}/post`, { method: 'POST', ...auth });
  check('delivery->invoice does NOT issue stock again', (await prisma.stockMovement.count({ where: { itemId: inv.json.id } })) === movesAfterDispatch, `moves=${await prisma.stockMovement.count({ where: { itemId: inv.json.id } })}`);
  check('delivery->invoice does NOT double COGS', Math.abs((await acctNet('5000')) - cogsAfterDispatch) < 0.01, `delta=${(await acctNet('5000')) - cogsAfterDispatch}`);

  // ---- Cleanup ----
  const grns = await prisma.goodsReceivedNote.findMany({ where: { companyId, supplierId: supplier.id }, select: { id: true } });
  const grnIds = grns.map((g) => g.id);
  const paymentIds: string[] = [];
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: { in: ['SALES_INVOICE', 'COGS', 'COGS_DIRECT_INVOICE'] }, sourceId: { in: [...invoices, ...deliveries] } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'SUPPLIER_INVOICE', sourceId: { in: bills } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'GOODS_RECEIPT', sourceId: { in: grnIds } } });
  await prisma.stockMovement.deleteMany({ where: { itemId: { in: items } } });
  await prisma.deliveryLine.deleteMany({ where: { deliveryNoteId: { in: deliveries } } });
  await prisma.deliveryNote.deleteMany({ where: { id: { in: deliveries } } });
  await prisma.salesInvoiceLine.deleteMany({ where: { invoiceId: { in: invoices } } });
  await prisma.salesInvoice.deleteMany({ where: { id: { in: invoices } } });
  await prisma.salesOrderLine.deleteMany({ where: { salesOrderId: { in: orders } } });
  await prisma.salesOrder.deleteMany({ where: { id: { in: orders } } });
  await prisma.goodsReceivedNoteLine.deleteMany({ where: { grnId: { in: grnIds } } });
  await prisma.goodsReceivedNote.deleteMany({ where: { id: { in: grnIds } } });
  await prisma.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: { in: bills } } });
  await prisma.supplierInvoice.deleteMany({ where: { id: { in: bills } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: items } } });
  await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => {});
  if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
