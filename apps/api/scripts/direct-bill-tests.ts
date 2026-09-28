/**
 * Direct Enter Bill without Purchase Order regression suite (Feature 04, GRNI model).
 *   npm run test:direct-bill -w @nexuserp/api
 *
 * GRNI accrual: the goods receipt capitalises Inventory (Dr Inventory / Cr GRNI);
 * the supplier bill clears GRNI (Dr GRNI / Cr AP). Net for received goods is
 * Dr Inventory / Cr AP, capitalised exactly once, with no COGS on purchase.
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
  console.log('Direct bill regression suite (GRNI)');
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
  const expense = accounts.find((a) => a.type === 'EXPENSE' && !/vat|tax/i.test(a.name || ''));

  const stamp = Date.now();
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'Direct Bill Vendor', code: `DBV-${stamp}` } });
  const items: string[] = [];
  const bills: string[] = [];
  const grns: string[] = [];

  async function mkItem(body: any) { const r = await req('/inventory/items', { method: 'POST', ...auth, body }); if (r.json?.id) items.push(r.json.id); return r; }
  async function mkBill(body: any) { const r = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body }); if (r.json?.id) bills.push(r.json.id); return r; }
  const acctId = async (code: string) => (await prisma.ledgerAccount.findFirst({ where: { companyId, code } }))?.id;
  const acctNet = async (accountId?: string) => {
    if (!accountId) return 0;
    const rows = await prisma.journalLine.findMany({ where: { accountId, journal: { companyId } } });
    return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  };
  const onHand = async (itemId: string) => (await prisma.stockMovement.findMany({ where: { itemId }, select: { signedQuantity: true } })).reduce((s, r) => s + Number(r.signedQuantity || 0), 0);

  const assetId = await acctId('1200');
  const apId = await acctId('2000');
  const grniId = await acctId('2050');

  // ---- A. Direct inventory bill, goods received now ----
  const inv = await mkItem({ sku: `DB-INV-${stamp}`, name: 'Direct Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, incomeAccountId: accounts.find((a) => a.code === '4000')?.id, cogsAccountId: expense?.id, inventoryAssetAccountId: assetId });
  const before = { asset: await acctNet(assetId), ap: await acctNet(apId), grni: await acctNet(grniId), cogs: await acctNet(expense?.id) };
  const billA = await mkBill({ supplierId: supplier.id, invoiceNo: `DBA-${stamp}`, warehouseId: warehouse?.id, receiveNow: true, lines: [{ itemId: inv.json?.id, description: 'Direct Widget', quantity: 10, unitPrice: 20, taxRate: 0 }] });
  check('direct inventory bill created (receive now)', billA.status === 201 && billA.json?.receiveNow === true, `status=${billA.status}`);
  if (billA.json?.id) {
    const post = await req(`/procurement/supplier-invoices/${billA.json.id}/post`, { method: 'POST', ...auth });
    check('bill posted', post.status === 201 || post.status === 200, `status=${post.status}`);
    check('stock on hand = 10', Math.abs((await onHand(inv.json.id)) - 10) < 0.001, `onHand=${await onHand(inv.json.id)}`);
    check('Inventory Asset capitalised 200 once', Math.abs((await acctNet(assetId)) - before.asset - 200) < 0.01, `delta=${(await acctNet(assetId)) - before.asset}`);
    check('Accounts Payable credited 200', Math.abs((await acctNet(apId)) - before.ap + 200) < 0.01, `delta=${(await acctNet(apId)) - before.ap}`);
    check('GRNI clears to zero', Math.abs((await acctNet(grniId)) - before.grni) < 0.01, `delta=${(await acctNet(grniId)) - before.grni}`);
    check('NO COGS posted on purchase', Math.abs((await acctNet(expense?.id)) - before.cogs) < 0.01);

    await req(`/procurement/supplier-invoices/${billA.json.id}/post`, { method: 'POST', ...auth });
    check('duplicate post does not double stock', (await prisma.stockMovement.count({ where: { itemId: inv.json.id } })) === 1);
    check('duplicate post does not double Inventory', Math.abs((await acctNet(assetId)) - before.asset - 200) < 0.01);

    const pay = await req('/procurement/supplier-payments', { method: 'POST', ...auth, body: { supplierId: supplier.id, amount: 100, method: 'BANK', allocations: [{ supplierInvoiceId: billA.json.id, amount: 100 }] } });
    check('partial payment accepted', pay.status === 201 || pay.status === 200, `status=${pay.status}`);
    const afterPay = await prisma.supplierInvoice.findUnique({ where: { id: billA.json.id } });
    check('bill balance 100 PARTIALLY_PAID', Number(afterPay?.balanceDue) === 100 && afterPay?.paymentStatus === 'PARTIALLY_PAID');
  }

  // ---- C. Direct service bill (expense/AP, no stock) ----
  const svc = await mkItem({ sku: `DB-SVC-${stamp}`, name: 'Direct Service', type: 'SERVICE', sellingPrice: 100, expenseAccountId: expense?.id });
  const svcBefore = await acctNet(expense?.id);
  const billC = await mkBill({ supplierId: supplier.id, invoiceNo: `DBC-${stamp}`, lines: [{ itemId: svc.json?.id, description: 'Direct Service', quantity: 1, unitPrice: 150, taxRate: 0 }] });
  if (billC.json?.id) {
    await req(`/procurement/supplier-invoices/${billC.json.id}/post`, { method: 'POST', ...auth });
    check('service bill debits Expense 150', Math.abs((await acctNet(expense?.id)) - svcBefore - 150) < 0.01);
    check('service bill creates NO stock movement', (await prisma.stockMovement.count({ where: { itemId: svc.json.id } })) === 0);
  }

  // ---- D. Bill before goods (no receiveNow) → GRNI accrual, no phantom stock ----
  const inv2 = await mkItem({ sku: `DB-INV2-${stamp}`, name: 'Bill-First Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, inventoryAssetAccountId: assetId });
  const dBefore = { grni: await acctNet(grniId), asset: await acctNet(assetId) };
  const billD = await mkBill({ supplierId: supplier.id, invoiceNo: `DBD-${stamp}`, lines: [{ itemId: inv2.json?.id, description: 'Bill-First Widget', quantity: 5, unitPrice: 20, taxRate: 0 }] });
  if (billD.json?.id) {
    await req(`/procurement/supplier-invoices/${billD.json.id}/post`, { method: 'POST', ...auth, body: { confirmMissingReceipt: true, overrideReason: 'bill-first test' } });
    check('bill-first debits GRNI 100', Math.abs((await acctNet(grniId)) - dBefore.grni - 100) < 0.01);
    check('bill-first does NOT capitalise Inventory', Math.abs((await acctNet(assetId)) - dBefore.asset) < 0.01);
    check('bill-first creates no stock (no phantom on-hand)', (await onHand(inv2.json.id)) === 0);
    const d = await prisma.supplierInvoice.findUnique({ where: { id: billD.json.id } });
    check('unreceived quantity tracked', Number(d?.unreceivedQty) === 5);
  }

  // ---- Cleanup ----
  const grnRows = await prisma.goodsReceivedNote.findMany({ where: { companyId, supplierId: supplier.id } });
  for (const g of grnRows) grns.push(g.id);
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'SUPPLIER_INVOICE', sourceId: { in: bills } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'GOODS_RECEIPT', sourceId: { in: grns } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'SUPPLIER_PAYMENT' } });
  await prisma.stockMovement.deleteMany({ where: { itemId: { in: items } } });
  await prisma.goodsReceivedNoteLine.deleteMany({ where: { grnId: { in: grns } } });
  await prisma.goodsReceivedNote.deleteMany({ where: { id: { in: grns } } });
  await prisma.supplierPaymentAllocation.deleteMany({ where: { supplierInvoiceId: { in: bills } } });
  await prisma.supplierPayment.deleteMany({ where: { supplierId: supplier.id } });
  await prisma.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: { in: bills } } });
  await prisma.supplierInvoice.deleteMany({ where: { id: { in: bills } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: items } } });
  await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
