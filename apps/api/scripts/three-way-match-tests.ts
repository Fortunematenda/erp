/**
 * Three-way matching + bill-before-receipt regression suite (Feature 08).
 *   npm run test:match -w @nexuserp/api
 *
 * Verifies matching states (MATCHED, PRICE_VARIANCE, MISSING_RECEIPT), purchase
 * price variance accounting, the configurable missing-receipt policy (WARN confirm
 * vs BLOCK), over-ordered billing rejection, no phantom stock and reconciliation.
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
  console.log('Three-way matching regression suite');
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
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'Match Vendor', code: `MCH-${stamp}` } });
  const items: string[] = [];
  const pos: string[] = [];
  const bills: string[] = [];

  const acctNet = async (code: string) => {
    const a = await prisma.ledgerAccount.findFirst({ where: { companyId, code } });
    if (!a) return 0;
    const rows = await prisma.journalLine.findMany({ where: { accountId: a.id, journal: { companyId } } });
    return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  };
  const snap = async () => ({ inv: await acctNet('1200'), grni: await acctNet('2050'), ap: await acctNet('2000'), ppv: await acctNet('5100') });
  const onHand = async (itemId: string) => (await prisma.stockMovement.findMany({ where: { itemId }, select: { signedQuantity: true } })).reduce((s, r) => s + Number(r.signedQuantity || 0), 0);

  const inv = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `MCH-INV-${stamp}`, name: 'Match Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, inventoryAssetAccountId: assetId } });
  if (inv.json?.id) items.push(inv.json.id);

  async function mkPo(qty: number, price = 20) {
    const po = await req('/procurement/purchase-orders', { method: 'POST', ...auth, body: { supplierId: supplier.id, warehouseId: warehouse?.id, lines: [{ itemId: inv.json.id, description: 'Match Widget', quantity: qty, unitPrice: price, taxRate: 0 }] } });
    pos.push(po.json.id);
    const lineId = ((await prisma.purchaseOrderLine.findFirst({ where: { purchaseOrderId: po.json.id } }))?.id) as string;
    await req(`/procurement/purchase-orders/${po.json.id}/status`, { method: 'PATCH', ...auth, body: { status: 'APPROVED' } });
    return { id: po.json.id, lineId };
  }
  const receive = (poId: string, qty: number) => req(`/procurement/purchase-orders/${poId}/receive`, { method: 'POST', ...auth, body: { lines: [{ quantity: qty }] } });
  async function mkBill(poId: string, lineId: string, qty: number, price = 20) {
    const b = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, purchaseOrderId: poId, invoiceNo: `MCH-${stamp}-${bills.length}`, lines: [{ purchaseOrderLineId: lineId, itemId: inv.json.id, description: 'Match Widget', quantity: qty, unitPrice: price, taxRate: 0 }] } });
    if (b.json?.id) bills.push(b.json.id);
    return b;
  }

  // ---- MATCHED ----
  const A = await mkPo(100);
  await receive(A.id, 60);
  const bA = await mkBill(A.id, A.lineId, 60);
  const mA = await req(`/procurement/supplier-invoices/${bA.json.id}/match`, auth);
  check('matched state for received+billed', mA.json?.state === 'MATCHED', `state=${mA.json?.state}`);
  const postA = await req(`/procurement/supplier-invoices/${bA.json.id}/post`, { method: 'POST', ...auth, body: {} });
  check('matched bill posts', postA.status < 400 && postA.json?.matchStatus === 'MATCHED', `status=${postA.status}`);

  // ---- PRICE VARIANCE (receipt cost 20, bill price 25) ----
  const B = await mkPo(10, 20);
  const beforeB = await snap();
  await receive(B.id, 10);
  const bB = await mkBill(B.id, B.lineId, 10, 25);
  const mB = await req(`/procurement/supplier-invoices/${bB.json.id}/match`, auth);
  check('price variance detected', mB.json?.state === 'PRICE_VARIANCE', `state=${mB.json?.state}`);
  check('price variance shows numbers + reason', mB.json?.lines?.[0]?.poPrice === 20 && mB.json?.lines?.[0]?.billPrice === 25 && /variance/i.test(mB.json?.lines?.[0]?.reason || ''));
  await req(`/procurement/supplier-invoices/${bB.json.id}/post`, { method: 'POST', ...auth, body: {} });
  const afterB = await snap();
  check('price variance: GRNI clears to zero', Math.abs(afterB.grni - beforeB.grni) < 0.01, `grni delta=${afterB.grni - beforeB.grni}`);
  check('price variance: 50 recognised in PPV', Math.abs(afterB.ppv - beforeB.ppv - 50) < 0.01, `ppv delta=${afterB.ppv - beforeB.ppv}`);
  check('price variance: AP = 250', Math.abs(afterB.ap - beforeB.ap + 250) < 0.01);
  check('price variance: Inventory = receipt value (200, no second debit)', Math.abs(afterB.inv - beforeB.inv - 200) < 0.01, `inv delta=${afterB.inv - beforeB.inv}`);

  // ---- EXCESS BILLED (beyond ordered) rejected ----
  const E = await mkPo(10);
  await receive(E.id, 10);
  const excess = await mkBill(E.id, E.lineId, 11);
  check('excess bill beyond ordered rejected', excess.status === 400, `status=${excess.status}`);

  // ---- MISSING_RECEIPT (WARN): bill 10 with only 5 received ----
  const C = await mkPo(10);
  const beforeC = await snap();
  const ohC0 = await onHand(inv.json.id);
  await receive(C.id, 5);
  const bC = await mkBill(C.id, C.lineId, 10);
  check('bill ahead of receipt allowed at creation (bounded by ordered)', bC.status === 201, `status=${bC.status}`);
  const mC = await req(`/procurement/supplier-invoices/${bC.json.id}/match`, auth);
  check('missing receipt state when billing ahead of receipt', mC.json?.state === 'MISSING_RECEIPT', `state=${mC.json?.state}`);
  check('missing receipt reason cites ordered/received/billed', /Ordered 10, received 5, billed 10/.test(mC.json?.lines?.[0]?.reason || ''), mC.json?.lines?.[0]?.reason);
  const noConfirm = await req(`/procurement/supplier-invoices/${bC.json.id}/post`, { method: 'POST', ...auth, body: {} });
  check('missing receipt requires explicit confirmation (WARN)', noConfirm.status === 400 && noConfirm.json?.error === 'MISSING_RECEIPT_CONFIRMATION', `status=${noConfirm.status}`);
  const confirm = await req(`/procurement/supplier-invoices/${bC.json.id}/post`, { method: 'POST', ...auth, body: { confirmMissingReceipt: true, overrideReason: 'supplier shipped early' } });
  check('missing receipt posts with confirmation', confirm.status < 400 && confirm.json?.matchStatus === 'MISSING_RECEIPT', `status=${confirm.status}`);
  check('no phantom stock (on-hand +5, not +10)', Math.abs((await onHand(inv.json.id)) - ohC0 - 5) < 0.001, `onHand delta=${(await onHand(inv.json.id)) - ohC0}`);

  // Subsequent receipt reconciliation
  await receive(C.id, 5);
  const afterC = await snap();
  check('after remaining receipt: on-hand +10', Math.abs((await onHand(inv.json.id)) - ohC0 - 10) < 0.001, `onHand delta=${(await onHand(inv.json.id)) - ohC0}`);
  check('C: Inventory +200 (receipt value)', Math.abs(afterC.inv - beforeC.inv - 200) < 0.01, `inv delta=${afterC.inv - beforeC.inv}`);
  check('C: GRNI reconciles to zero', Math.abs(afterC.grni - beforeC.grni) < 0.01, `grni delta=${afterC.grni - beforeC.grni}`);
  check('C: no purchase price variance', Math.abs(afterC.ppv - beforeC.ppv) < 0.01);

  // ---- BLOCK policy ----
  await prisma.systemConfig.deleteMany({ where: { companyId, key: 'cfg.procurement.matching' } });
  await prisma.systemConfig.create({ data: { companyId, key: 'cfg.procurement.matching', value: { missingReceiptPolicy: 'BLOCK', qtyTolerancePct: 0, priceTolerancePct: 2 } } });
  const D = await mkPo(10);
  const bD = await mkBill(D.id, D.lineId, 5);
  const blocked = await req(`/procurement/supplier-invoices/${bD.json.id}/post`, { method: 'POST', ...auth, body: { confirmMissingReceipt: true } });
  check('BLOCK policy rejects bill-before-receipt', blocked.status === 400 && blocked.json?.error === 'MISSING_RECEIPT', `status=${blocked.status}`);
  await prisma.systemConfig.deleteMany({ where: { companyId, key: 'cfg.procurement.matching' } });

  // Cleanup
  const grns = await prisma.goodsReceivedNote.findMany({ where: { companyId, purchaseOrderId: { in: pos } }, select: { id: true } });
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
