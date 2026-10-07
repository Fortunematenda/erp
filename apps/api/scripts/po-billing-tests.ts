/**
 * PO -> bill autofill + partial billing regression suite (Feature 07).
 *   npm run test:po-billing -w @nexuserp/api
 *
 * Scenario: PO 100 @ $20 -> receive 60 -> bill 60 -> receive 40 -> bill 40.
 * Verifies eligible POs, per-line prefill, line-level source links, partial billing,
 * GRNI clearing (no second Inventory debit), AP totals, duplicate protection.
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
  console.log('PO billing regression suite');
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
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'Billing Vendor', code: `BIL-${stamp}` } });
  const items: string[] = [];
  const pos: string[] = [];
  const bills: string[] = [];

  const acctNet = async (code: string) => {
    const a = await prisma.ledgerAccount.findFirst({ where: { companyId, code } });
    if (!a) return 0;
    const rows = await prisma.journalLine.findMany({ where: { accountId: a.id, journal: { companyId } } });
    return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  };
  const onHand = async (itemId: string) => (await prisma.stockMovement.findMany({ where: { itemId }, select: { signedQuantity: true } })).reduce((s, r) => s + Number(r.signedQuantity || 0), 0);

  const inv = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `BIL-INV-${stamp}`, name: 'Billing Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, inventoryAssetAccountId: assetId } });
  if (inv.json?.id) items.push(inv.json.id);

  const po = await req('/procurement/purchase-orders', { method: 'POST', ...auth, body: { supplierId: supplier.id, warehouseId: warehouse?.id, lines: [{ itemId: inv.json.id, description: 'Billing Widget', quantity: 100, unitPrice: 20, taxRate: 0 }] } });
  if (po.json?.id) pos.push(po.json.id);
  const poLineId = (await prisma.purchaseOrderLine.findFirst({ where: { purchaseOrderId: po.json.id } }))?.id;
  await req(`/procurement/purchase-orders/${po.json.id}/status`, { method: 'PATCH', ...auth, body: { status: 'APPROVED' } });

  const before = { ap: await acctNet('2000'), grni: await acctNet('2050'), inv: await acctNet('1200') };

  // Receive 60
  const recv60 = await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: 60 }] } });
  check('receive 60', recv60.status < 400, `status=${recv60.status}`);
  check('stock 60', Math.abs((await onHand(inv.json.id)) - 60) < 0.001);

  // Eligible POs (Add from PO)
  const eligible = await req(`/procurement/purchase-orders/eligible?supplierId=${supplier.id}`, auth);
  const elig = (eligible.json || []).find((p: any) => p.id === po.json.id);
  check('eligible PO lists remainingToBill 60', !!elig && elig.progress.remainingToBill === 60, JSON.stringify(elig?.progress));

  // Bill-lines prefill
  const prefill = await req(`/procurement/purchase-orders/${po.json.id}/bill-lines`, auth);
  const pl = prefill.json?.lines?.[0];
  check('bill-lines prefill qty/cost/unit', pl?.remainingToBill === 60 && pl?.unitPrice === 20 && !!pl?.unit, JSON.stringify(pl));
  check('bill-lines prefill item account mapping', pl?.accountCode === '1200' && pl?.purchaseOrderLineId === poLineId);

  // Bill 60 (line-level link)
  const bill1 = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, purchaseOrderId: po.json.id, invoiceNo: `BIL1-${stamp}`, lines: [{ purchaseOrderLineId: poLineId, itemId: inv.json.id, description: 'Billing Widget', quantity: 60, unitPrice: 20, taxRate: 0 }] } });
  if (bill1.json?.id) bills.push(bill1.json.id);
  check('bill 1 created', bill1.status === 201, `status=${bill1.status}`);
  const bill1Line = await prisma.supplierInvoiceLine.findFirst({ where: { supplierInvoiceId: bill1.json.id } });
  check('bill line links to PO line', bill1Line?.purchaseOrderLineId === poLineId);
  await req(`/procurement/supplier-invoices/${bill1.json.id}/post`, { method: 'POST', ...auth });
  check('after bill 60: AP +1200', Math.abs((await acctNet('2000')) - before.ap + 1200) < 0.01, `ap delta=` + ((await acctNet('2000')) - before.ap));
  check('after bill 60: GRNI net 0 (receipt 1200 cleared)', Math.abs((await acctNet('2050')) - before.grni) < 0.01, `grni delta=` + ((await acctNet('2050')) - before.grni));
  check('after bill 60: Inventory +1200 (no second debit)', Math.abs((await acctNet('1200')) - before.inv - 1200) < 0.01, `inv delta=` + ((await acctNet('1200')) - before.inv));

  // Receive remaining 40
  const recv40 = await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: 40 }] } });
  check('receive 40', recv40.status < 400, `status=${recv40.status}`);
  check('stock 100', Math.abs((await onHand(inv.json.id)) - 100) < 0.001);
  check('after receive 40: Inventory +2000', Math.abs((await acctNet('1200')) - before.inv - 2000) < 0.01);
  check('after receive 40: GRNI +800 (40x20)', Math.abs((await acctNet('2050')) - before.grni + 800) < 0.01, `grni delta=` + ((await acctNet('2050')) - before.grni));

  // Bill 40
  const bill2 = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, purchaseOrderId: po.json.id, invoiceNo: `BIL2-${stamp}`, lines: [{ purchaseOrderLineId: poLineId, itemId: inv.json.id, description: 'Billing Widget', quantity: 40, unitPrice: 20, taxRate: 0 }] } });
  if (bill2.json?.id) bills.push(bill2.json.id);
  await req(`/procurement/supplier-invoices/${bill2.json.id}/post`, { method: 'POST', ...auth });
  check('after bill 40: AP +2000 total', Math.abs((await acctNet('2000')) - before.ap + 2000) < 0.01, `ap delta=` + ((await acctNet('2000')) - before.ap));
  check('after bill 40: GRNI back to 0', Math.abs((await acctNet('2050')) - before.grni) < 0.01, `grni delta=` + ((await acctNet('2050')) - before.grni));
  check('after bill 40: Inventory +2000 (once)', Math.abs((await acctNet('1200')) - before.inv - 2000) < 0.01);

  // PO quantities + two bills
  const poLine = await prisma.purchaseOrderLine.findUnique({ where: { id: poLineId } });
  check('PO invoicedQty 100', Number(poLine?.invoicedQty) === 100, `invoiced=${poLine?.invoicedQty}`);
  const billCount = await prisma.supplierInvoice.count({ where: { purchaseOrderId: po.json.id, status: { not: 'VOID' } } });
  check('two bills against the PO', billCount === 2, `bills=${billCount}`);
  const detail = await req(`/procurement/purchase-orders/${po.json.id}`, auth);
  check('PO remainingToBill 0', detail.json?.progress?.remainingToBill === 0, JSON.stringify(detail.json?.progress));

  // Duplicate protection
  const over = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, purchaseOrderId: po.json.id, invoiceNo: `BIL3-${stamp}`, lines: [{ purchaseOrderLineId: poLineId, itemId: inv.json.id, description: 'Billing Widget', quantity: 1, unitPrice: 20, taxRate: 0 }] } });
  check('over-billing beyond received rejected', over.status === 400, `status=${over.status}`);

  // Balanced journals
  const journals = await prisma.journalEntry.findMany({ where: { companyId, sourceType: 'SUPPLIER_INVOICE', sourceId: { in: bills } }, include: { lines: true } });
  const balanced = journals.every((j) => Math.abs(j.lines.reduce((s, l) => s + Number(l.debit), 0) - j.lines.reduce((s, l) => s + Number(l.credit), 0)) < 0.01);
  check('all bill journals balanced', journals.length === 2 && balanced);

  // Cleanup
  const grns = await prisma.goodsReceivedNote.findMany({ where: { companyId, purchaseOrderId: po.json.id }, select: { id: true } });
  const grnIds = grns.map((g) => g.id);
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'SUPPLIER_INVOICE', sourceId: { in: bills } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'GOODS_RECEIPT', sourceId: { in: grnIds } } });
  await prisma.stockMovement.deleteMany({ where: { itemId: { in: items } } });
  await prisma.goodsReceivedNoteLine.deleteMany({ where: { grnId: { in: grnIds } } });
  await prisma.goodsReceivedNote.deleteMany({ where: { id: { in: grnIds } } });
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
