/**
 * Purchase Order lifecycle regression suite (Feature 05).
 *   npm run test:po -w @nexuserp/api
 *
 * Verifies: full header persistence, no AP/stock from a PO alone, independent
 * receipt/billing progress, approval transitions and guards, edit/cancel/delete
 * guards once receipts/bills exist, non-stock receiving skip and company scope.
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
  console.log('Purchase order lifecycle suite');
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
  const revenue = accounts.find((a) => a.code === '4000');
  const expense = accounts.find((a) => a.type === 'EXPENSE' && !/vat|tax/i.test(a.name || ''));
  const asset = accounts.find((a) => a.code === '1200');

  const stamp = Date.now();
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'PO Vendor', code: `POV-${stamp}` } });
  const items: string[] = [];
  const pos: string[] = [];
  const bills: string[] = [];

  async function mkItem(body: any) { const r = await req('/inventory/items', { method: 'POST', ...auth, body }); if (r.json?.id) items.push(r.json.id); return r; }
  async function mkPo(body: any) { const r = await req('/procurement/purchase-orders', { method: 'POST', ...auth, body }); if (r.json?.id) pos.push(r.json.id); return r; }
  const acctId = async (code: string) => (await prisma.ledgerAccount.findFirst({ where: { companyId, code } }))?.id;
  const onHand = async (itemId: string) => (await prisma.stockMovement.findMany({ where: { itemId }, select: { signedQuantity: true } })).reduce((s, r) => s + Number(r.signedQuantity || 0), 0);

  const inv = await mkItem({ sku: `PO-INV-${stamp}`, name: 'PO Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, incomeAccountId: revenue?.id, cogsAccountId: expense?.id, inventoryAssetAccountId: asset?.id });
  const svc = await mkItem({ sku: `PO-SVC-${stamp}`, name: 'PO Service', type: 'SERVICE', sellingPrice: 100, expenseAccountId: expense?.id });

  // ---- Create PO with full header ----
  const po = await mkPo({ supplierId: supplier.id, expectedDate: '2026-10-15', paymentTerms: 'Net 30', supplierReference: 'SUPP-REF-1', shipTo: 'Main Warehouse', memo: 'Urgent order', warehouseId: warehouse?.id, currency: 'USD', lines: [{ itemId: inv.json?.id, description: 'PO Widget', quantity: 10, unitPrice: 20, taxRate: 0 }] });
  check('PO created', po.status === 201 && !!po.json?.id, `status=${po.status}`);
  check('PO header persisted', po.json?.expectedDate && po.json?.paymentTerms === 'Net 30' && po.json?.supplierReference === 'SUPP-REF-1' && po.json?.shipTo === 'Main Warehouse' && po.json?.memo === 'Urgent order' && po.json?.warehouseId === warehouse?.id);
  check('PO totals computed', Number(po.json?.total) === 200 && Number(po.json?.subtotal) === 200);
  check('PO starts DRAFT, no AP/stock', po.json?.status === 'DRAFT' && (await onHand(inv.json.id)) === 0);

  if (po.json?.id) {
    // ---- Invalid transition ----
    const bad = await req(`/procurement/purchase-orders/${po.json.id}/status`, { method: 'PATCH', ...auth, body: { status: 'RECEIVED' } });
    check('invalid transition DRAFT→RECEIVED rejected', bad.status === 400, `status=${bad.status}`);

    // ---- Approve ----
    const appr = await req(`/procurement/purchase-orders/${po.json.id}/status`, { method: 'PATCH', ...auth, body: { status: 'APPROVED' } });
    check('PO approved', appr.status === 200 && appr.json?.status === 'APPROVED', `status=${appr.status}`);

    // ---- Edit while approved (no receipts) ----
    const edit = await req(`/procurement/purchase-orders/${po.json.id}`, { method: 'PATCH', ...auth, body: { memo: 'Updated memo', expectedDate: '2026-11-01' } });
    check('PO editable before receipts', edit.status === 200 && edit.json?.memo === 'Updated memo');

    // ---- Receive partial 3 ----
    const recv = await req(`/procurement/purchase-orders/${po.json.id}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: 3 }] } });
    check('partial receipt accepted', recv.status === 201 || recv.status === 200, `status=${recv.status}`);
    check('stock after partial receipt = 3', Math.abs((await onHand(inv.json.id)) - 3) < 0.001, `onHand=${await onHand(inv.json.id)}`);
    const detail = await req(`/procurement/purchase-orders/${po.json.id}`, auth);
    check('progress: received 3, remainingToReceive 7', detail.json?.progress?.received === 3 && detail.json?.progress?.remainingToReceive === 7, JSON.stringify(detail.json?.progress));

    // ---- Guard: cancel/delete with posted receipt ----
    const cancel = await req(`/procurement/purchase-orders/${po.json.id}/status`, { method: 'PATCH', ...auth, body: { status: 'CANCELLED' } });
    check('cannot cancel PO with posted receipt', cancel.status === 400, `status=${cancel.status}`);
    const del = await req(`/procurement/purchase-orders/${po.json.id}`, { method: 'DELETE', ...auth });
    check('cannot delete PO with posted receipt', del.status === 400, `status=${del.status}`);
    const edit2 = await req(`/procurement/purchase-orders/${po.json.id}`, { method: 'PATCH', ...auth, body: { memo: 'x' } });
    check('cannot edit PO with posted receipt', edit2.status === 400, `status=${edit2.status}`);

    // ---- Bill against PO ----
    const bill = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, purchaseOrderId: po.json.id, invoiceNo: `POB-${stamp}`, lines: [{ itemId: inv.json.id, description: 'PO Widget', quantity: 3, unitPrice: 20, taxRate: 0 }] } });
    if (bill.json?.id) bills.push(bill.json.id);
    check('bill against PO created', !!bill.json?.id, `status=${bill.status}`);
    const detail2 = await req(`/procurement/purchase-orders/${po.json.id}`, auth);
    check('progress: billed 3, remainingToBill 0', detail2.json?.progress?.billed === 3 && detail2.json?.progress?.remainingToBill === 0, JSON.stringify(detail2.json?.progress));
    const del2 = await req(`/procurement/purchase-orders/${po.json.id}`, { method: 'DELETE', ...auth });
    check('cannot delete PO with bill', del2.status === 400, `status=${del2.status}`);
  }

  // ---- Non-stock PO skips receiving ----
  const poSvc = await mkPo({ supplierId: supplier.id, lines: [{ itemId: svc.json?.id, description: 'PO Service', quantity: 2, unitPrice: 100, taxRate: 0 }] });
  if (poSvc.json?.id) {
    const d = await req(`/procurement/purchase-orders/${poSvc.json.id}`, auth);
    check('service PO: receiving not required', d.json?.progress?.receivingRequired === false);
    check('service PO: billable without receipt', d.json?.progress?.remainingToBill === 2);
  }

  // ---- Company scope ----
  const companyA = await prisma.company.findUnique({ where: { id: companyId } });
  if (companyA && po.json?.id) {
    const companyB = await prisma.company.create({ data: { tenantId: companyA.tenantId, legalName: 'PO Isolation Co', code: `PISO-${stamp}`, baseCurrency: 'USD' } });
    const supplierB = await prisma.supplier.create({ data: { companyId: companyB.id, name: 'B Vendor', code: 'B1' } });
    const poB = await prisma.purchaseOrder.create({ data: { companyId: companyB.id, supplierId: supplierB.id, poNo: `B-${stamp}`, total: 0 } });
    const cross = await req(`/procurement/purchase-orders/${poB.id}`, { method: 'PATCH', ...auth, body: { memo: 'hack' } });
    check('company A cannot edit company B PO', cross.status === 400 || cross.status === 404, `status=${cross.status}`);
    await prisma.purchaseOrder.delete({ where: { id: poB.id } });
    await prisma.supplier.delete({ where: { id: supplierB.id } });
    await prisma.company.delete({ where: { id: companyB.id } });
  }

  // ---- Cleanup ----
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'SUPPLIER_INVOICE', sourceId: { in: bills } } });
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
