/**
 * Receive Items / partial receiving / inventory valuation regression suite (Feature 06).
 *   npm run test:receiving -w @nexuserp/api
 *
 * Verifies partial receipts (60/40), signed movements, stock 0→60→100, goods-receipt
 * GL (Dr Inventory / Cr GRNI), no AP from a receipt alone, idempotency, guards
 * (negative, over-receipt, draft, wrong warehouse, cross-company) and warehouse valuation.
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
  console.log('Receiving regression suite');
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

  const stamp = Date.now();
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'Receive Vendor', code: `RCV-${stamp}` } });
  const items: string[] = [];
  const pos: string[] = [];
  const bills: string[] = [];
  const grns: string[] = [];

  const acctNet = async (code: string) => {
    const a = await prisma.ledgerAccount.findFirst({ where: { companyId, code } });
    if (!a) return 0;
    const rows = await prisma.journalLine.findMany({ where: { accountId: a.id, journal: { companyId } } });
    return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  };
  const grniId = (await prisma.ledgerAccount.findFirst({ where: { companyId, code: '2050' } }))?.id;
  const apId = accounts.find((a) => a.code === '2000')?.id;

  const inv = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `RCV-INV-${stamp}`, name: 'Receiving Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, inventoryAssetAccountId: assetId } });
  if (inv.json?.id) items.push(inv.json.id);

  const po = await req('/procurement/purchase-orders', { method: 'POST', ...auth, body: { supplierId: supplier.id, warehouseId: warehouse?.id, lines: [{ itemId: inv.json.id, description: 'Receiving Widget', quantity: 100, unitPrice: 20, taxRate: 0 }] } });
  if (po.json?.id) pos.push(po.json.id);
  await req(`/procurement/purchase-orders/${po.json.id}/status`, { method: 'PATCH', ...auth, body: { status: 'APPROVED' } });

  // Guards before receiving
  const neg = await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: -5 }] } });
  check('negative receipt rejected', neg.status === 400, `status=${neg.status}`);
  const wrongWh = await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { warehouseId: '00000000-0000-0000-0000-000000000000', lines: [{ quantity: 1 }] } });
  check('wrong warehouse rejected', wrongWh.status === 400, `status=${wrongWh.status}`);

  const before = { asset: await acctNet('1200'), grni: await acctNet('2050'), ap: await acctNet('2000') };

  // Preview
  const preview = await req(`/procurement/purchase-orders/${po.json.id}/receiving`, auth);
  check('receiving preview: ordered 100, remaining 100', preview.json?.lines?.[0]?.ordered === 100 && preview.json?.lines?.[0]?.remaining === 100);

  // Receive 60
  const r1 = await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: 60 }] } });
  check('first receipt 60 accepted', r1.status === 201 || r1.status === 200, `status=${r1.status}`);
  const onHand = async () => (await prisma.stockMovement.findMany({ where: { itemId: inv.json.id }, select: { signedQuantity: true } })).reduce((s, r) => s + Number(r.signedQuantity || 0), 0);
  check('stock = 60 after first receipt', Math.abs((await onHand()) - 60) < 0.001, `onHand=${await onHand()}`);
  check('goods receipt: Inventory +1200', Math.abs((await acctNet('1200')) - before.asset - 1200) < 0.01);
  check('goods receipt: GRNI credited 1200', Math.abs((await acctNet('2050')) - before.grni + 1200) < 0.01);
  check('NO AP from a receipt alone', Math.abs((await acctNet('2000')) - before.ap) < 0.01);
  const preview2 = await req(`/procurement/purchase-orders/${po.json.id}/receiving`, auth);
  check('preview: previouslyReceived 60, remaining 40', preview2.json?.lines?.[0]?.previouslyReceived === 60 && preview2.json?.lines?.[0]?.remaining === 40);

  // Duplicate receipt idempotency: re-confirm the same GRN
  const grnId = r1.json?.id;
  if (grnId) grns.push(grnId);
  if (grnId) {
    await req(`/procurement/grns/${grnId}/confirm`, { method: 'POST', ...auth });
    check('re-confirm same GRN does not double stock', Math.abs((await onHand()) - 60) < 0.001, `onHand=${await onHand()}`);
    check('re-confirm same GRN does not double Inventory', Math.abs((await acctNet('1200')) - before.asset - 1200) < 0.01);
  }

  // Receive remaining 40
  const r2 = await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: 40 }] } });
  if (r2.json?.id) grns.push(r2.json.id);
  check('second receipt 40 accepted', r2.status === 201 || r2.status === 200, `status=${r2.status}`);
  check('stock = 100 after full receipt', Math.abs((await onHand()) - 100) < 0.001, `onHand=${await onHand()}`);
  check('Inventory capitalised 2000 total', Math.abs((await acctNet('1200')) - before.asset - 2000) < 0.01);
  check('GRNI credited 2000 total', Math.abs((await acctNet('2050')) - before.grni + 2000) < 0.01);

  // Over-receipt
  const over = await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: 1 }] } });
  check('over-receipt rejected', over.status === 400, `status=${over.status}`);

  // Warehouse-scoped valuation
  const detail = await req(`/inventory/items/${inv.json.id}`, auth);
  check('valuation: on-hand 100 @ avgCost 20', Number(detail.json?.total?.onHand) === 100 && Number(detail.json?.total?.avgCost) === 20, JSON.stringify(detail.json?.total));
  const whMoves = await prisma.stockMovement.count({ where: { itemId: inv.json.id, warehouseId: warehouse?.id } });
  check('all movements booked to the receiving warehouse', whMoves === 2, `warehouseMovements=${whMoves}`);

  // Receiving against a DRAFT PO is blocked
  const poDraft = await req('/procurement/purchase-orders', { method: 'POST', ...auth, body: { supplierId: supplier.id, lines: [{ itemId: inv.json.id, description: 'x', quantity: 5, unitPrice: 20, taxRate: 0 }] } });
  if (poDraft.json?.id) pos.push(poDraft.json.id);
  const draftRecv = await req(`/procurement/purchase-orders/${poDraft.json.id}/receive`, { method: 'POST', ...auth, body: {} });
  check('cannot receive against DRAFT PO', draftRecv.status === 400, `status=${draftRecv.status}`);

  // Bill against PO clears GRNI → AP
  const bill = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, purchaseOrderId: po.json.id, invoiceNo: `RCVB-${stamp}`, lines: [{ itemId: inv.json.id, description: 'Receiving Widget', quantity: 100, unitPrice: 20, taxRate: 0 }] } });
  if (bill.json?.id) bills.push(bill.json.id);
  if (bill.json?.id) {
    await req(`/procurement/supplier-invoices/${bill.json.id}/post`, { method: 'POST', ...auth });
    check('bill clears GRNI to zero', Math.abs((await acctNet('2050')) - before.grni) < 0.01, `grni delta=${(await acctNet('2050')) - before.grni}`);
    check('bill creates AP 2000', Math.abs((await acctNet('2000')) - before.ap + 2000) < 0.01);
    check('no second Inventory debit from the bill', Math.abs((await acctNet('1200')) - before.asset - 2000) < 0.01);
  }

  // Cross-company
  const companyA = await prisma.company.findUnique({ where: { id: companyId } });
  if (companyA) {
    const companyB = await prisma.company.create({ data: { tenantId: companyA.tenantId, legalName: 'Receiving Isolation Co', code: `RISO-${stamp}`, baseCurrency: 'USD' } });
    const supB = await prisma.supplier.create({ data: { companyId: companyB.id, name: 'B Vendor', code: 'B1' } });
    const poB = await prisma.purchaseOrder.create({ data: { companyId: companyB.id, supplierId: supB.id, poNo: `RB-${stamp}`, total: 0, status: 'APPROVED' } });
    const cross = await req(`/procurement/purchase-orders/${poB.id}/receive`, { method: 'POST', ...auth, body: {} });
    check('company A cannot receive company B PO', cross.status === 400 || cross.status === 404, `status=${cross.status}`);
    await prisma.purchaseOrder.delete({ where: { id: poB.id } });
    await prisma.supplier.delete({ where: { id: supB.id } });
    await prisma.company.delete({ where: { id: companyB.id } });
  }

  // Cleanup
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'SUPPLIER_INVOICE', sourceId: { in: bills } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'GOODS_RECEIPT' } });
  await prisma.stockMovement.deleteMany({ where: { itemId: { in: items } } });
  await prisma.goodsReceivedNoteLine.deleteMany({ where: { grn: { companyId, purchaseOrderId: { in: pos } } } });
  await prisma.goodsReceivedNote.deleteMany({ where: { companyId, purchaseOrderId: { in: pos } } });
  await prisma.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: { in: bills } } });
  await prisma.supplierInvoice.deleteMany({ where: { id: { in: bills } } });
  await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: pos } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: pos } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: items } } });
  await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
