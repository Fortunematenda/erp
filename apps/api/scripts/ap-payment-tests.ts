/**
 * Accounts payable payments + vendor credits regression suite (Feature 09).
 *   npm run test:ap-payment -w @nexuserp/api
 *
 * Verifies partial/full payment, payment GL, duplicate (idempotency) protection,
 * overpayment rejection, vendor credit application reducing the payable balance,
 * credits not creating stock, vendor-360/PO related links and company isolation.
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
  console.log('AP payment + vendor credit suite');
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
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'AP Vendor', code: `APV-${stamp}` } });
  const items: string[] = [];
  const bills: string[] = [];
  const credits: string[] = [];

  const acctNet = async (code: string) => {
    const a = await prisma.ledgerAccount.findFirst({ where: { companyId, code } });
    if (!a) return 0;
    const rows = await prisma.journalLine.findMany({ where: { accountId: a.id, journal: { companyId } } });
    return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  };

  const inv = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `AP-INV-${stamp}`, name: 'AP Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, inventoryAssetAccountId: assetId } });
  if (inv.json?.id) items.push(inv.json.id);

  async function mkBill(total: number, opts: { receiveNow?: boolean; withItem?: boolean } = {}) {
    const qty = opts.withItem ? total / 20 : 1;
    const line = opts.withItem
      ? { itemId: inv.json.id, description: 'AP Widget', quantity: qty, unitPrice: 20, taxRate: 0 }
      : { description: 'Consulting services', quantity: 1, unitPrice: total, taxRate: 0 };
    const b = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, invoiceNo: `AP-${stamp}-${bills.length}`, warehouseId: warehouse?.id, receiveNow: opts.receiveNow ?? false, lines: [line] } });
    if (b.json?.id) bills.push(b.json.id);
    await req(`/procurement/supplier-invoices/${b.json.id}/post`, { method: 'POST', ...auth, body: { confirmMissingReceipt: true } });
    return b.json.id;
  }

  const before = { ap: await acctNet('2000'), bank: await acctNet('1000') };

  // ---- Partial then full payment ----
  const bill1 = await mkBill(2000, { receiveNow: true, withItem: true });
  check('bill 2000 posted', !!bill1);
  const pay1 = await req('/procurement/supplier-payments', { method: 'POST', ...auth, body: { supplierId: supplier.id, amount: 1000, method: 'BANK', idempotencyKey: `pay-${stamp}-1`, allocations: [{ supplierInvoiceId: bill1, amount: 1000 }] } });
  check('partial payment accepted', pay1.status === 201 || pay1.status === 200, `status=${pay1.status}`);
  let b1 = await prisma.supplierInvoice.findUnique({ where: { id: bill1 } });
  check('bill PARTIALLY_PAID balance 1000', Number(b1?.balanceDue) === 1000 && b1?.paymentStatus === 'PARTIALLY_PAID', `bal=${b1?.balanceDue} ps=${b1?.paymentStatus}`);
  check('payment GL: AP debited 1000', Math.abs((await acctNet('2000')) - before.ap + 1000) < 0.01);
  check('payment GL: bank credited 1000', Math.abs((await acctNet('1000')) - before.bank + 1000) < 0.01);

  // Duplicate idempotency
  await req('/procurement/supplier-payments', { method: 'POST', ...auth, body: { supplierId: supplier.id, amount: 1000, method: 'BANK', idempotencyKey: `pay-${stamp}-1`, allocations: [{ supplierInvoiceId: bill1, amount: 1000 }] } });
  const payCount = await prisma.supplierPayment.count({ where: { companyId, idempotencyKey: `pay-${stamp}-1` } });
  check('duplicate payment idempotency (1 payment)', payCount === 1, `count=${payCount}`);

  // Overpayment rejected
  const over = await req('/procurement/supplier-payments', { method: 'POST', ...auth, body: { supplierId: supplier.id, amount: 5000, method: 'BANK', allocations: [{ supplierInvoiceId: bill1, amount: 5000 }] } });
  check('overpayment rejected', over.status === 400, `status=${over.status}`);

  // Full payment
  await req('/procurement/supplier-payments', { method: 'POST', ...auth, body: { supplierId: supplier.id, amount: 1000, method: 'BANK', allocations: [{ supplierInvoiceId: bill1, amount: 1000 }] } });
  b1 = await prisma.supplierInvoice.findUnique({ where: { id: bill1 } });
  check('bill PAID balance 0', Number(b1?.balanceDue) === 0 && b1?.paymentStatus === 'PAID', `bal=${b1?.balanceDue} ps=${b1?.paymentStatus}`);

  // ---- Vendor credit reduces payable, no stock ----
  const bill2 = await mkBill(1000, { withItem: false });
  const stockBefore = await prisma.stockMovement.count({ where: { itemId: { in: items } } });
  const vc = await req('/finance/vendor-credits', { method: 'POST', ...auth, body: { supplierId: supplier.id, reason: 'price adjustment', lines: [{ description: 'Price adjustment', quantity: 1, unitPrice: 200, taxRate: 0 }] } });
  if (vc.json?.id) credits.push(vc.json.id);
  await req(`/finance/vendor-credits/${vc.json.id}/post`, { method: 'POST', ...auth });
  const apply = await req(`/finance/vendor-credits/${vc.json.id}/apply`, { method: 'POST', ...auth, body: { supplierInvoiceId: bill2, amount: 200 } });
  check('vendor credit applied', apply.status === 201 || apply.status === 200, `status=${apply.status}`);
  let b2 = await prisma.supplierInvoice.findUnique({ where: { id: bill2 } });
  check('bill balance reduced to 800 by credit', Number(b2?.balanceDue) === 800 && Number(b2?.creditsApplied) === 200, `bal=${b2?.balanceDue} credits=${b2?.creditsApplied}`);
  const stockAfter = await prisma.stockMovement.count({ where: { itemId: { in: items } } });
  check('price-only vendor credit creates NO stock movement', stockAfter === stockBefore, `before=${stockBefore} after=${stockAfter}`);

  await req('/procurement/supplier-payments', { method: 'POST', ...auth, body: { supplierId: supplier.id, amount: 800, method: 'BANK', allocations: [{ supplierInvoiceId: bill2, amount: 800 }] } });
  b2 = await prisma.supplierInvoice.findUnique({ where: { id: bill2 } });
  check('bill PAID after credit + payment', Number(b2?.balanceDue) === 0 && b2?.paymentStatus === 'PAID', `bal=${b2?.balanceDue} ps=${b2?.paymentStatus}`);

  // ---- Vendor 360 includes credits; payment journals balanced ----
  const v360 = await req(`/procurement/suppliers/${supplier.id}`, auth);
  check('vendor 360 includes vendor credits', Array.isArray(v360.json?.vendorCredits) && v360.json.vendorCredits.length >= 1);
  const payJournals = await prisma.journalEntry.findMany({ where: { companyId, sourceType: 'SUPPLIER_PAYMENT' }, include: { lines: true } });
  check('payment journals balanced', payJournals.every((j) => Math.abs(j.lines.reduce((s, l) => s + Number(l.debit), 0) - j.lines.reduce((s, l) => s + Number(l.credit), 0)) < 0.01));

  // ---- Cross-company denial ----
  const companyA = await prisma.company.findUnique({ where: { id: companyId } });
  if (companyA) {
    const companyB = await prisma.company.create({ data: { tenantId: companyA.tenantId, legalName: 'AP Isolation Co', code: `APISO-${stamp}`, baseCurrency: 'USD' } });
    const supB = await prisma.supplier.create({ data: { companyId: companyB.id, name: 'B Vendor', code: 'B1' } });
    const billB = await prisma.supplierInvoice.create({ data: { companyId: companyB.id, supplierId: supB.id, invoiceNo: `BB-${stamp}`, total: 100, balanceDue: 100, status: 'POSTED' } });
    const cross = await req('/procurement/supplier-payments', { method: 'POST', ...auth, body: { supplierId: supB.id, amount: 10, allocations: [{ supplierInvoiceId: billB.id, amount: 10 }] } });
    check('company A cannot pay company B bill', cross.status === 400 || cross.status === 404, `status=${cross.status}`);
    await prisma.supplierInvoice.delete({ where: { id: billB.id } });
    await prisma.supplier.delete({ where: { id: supB.id } });
    await prisma.company.delete({ where: { id: companyB.id } });
  }

  // Cleanup
  const grns = await prisma.goodsReceivedNote.findMany({ where: { companyId, supplierId: supplier.id }, select: { id: true } });
  const grnIds = grns.map((g) => g.id);
  const paymentIds = (await prisma.supplierPayment.findMany({ where: { companyId, supplierId: supplier.id }, select: { id: true } })).map((p) => p.id);
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'SUPPLIER_INVOICE', sourceId: { in: bills } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'VENDOR_CREDIT', sourceId: { in: credits } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'SUPPLIER_PAYMENT', sourceId: { in: paymentIds } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, sourceType: 'GOODS_RECEIPT', sourceId: { in: grnIds } } });
  await prisma.stockMovement.deleteMany({ where: { itemId: { in: items } } });
  await prisma.goodsReceivedNoteLine.deleteMany({ where: { grnId: { in: grnIds } } });
  await prisma.goodsReceivedNote.deleteMany({ where: { id: { in: grnIds } } });
  await prisma.supplierPaymentAllocation.deleteMany({ where: { supplierInvoiceId: { in: bills } } });
  await prisma.supplierPayment.deleteMany({ where: { supplierId: supplier.id } });
  await prisma.vendorCreditApplication.deleteMany({ where: { vendorCreditId: { in: credits } } });
  await prisma.vendorCreditLine.deleteMany({ where: { vendorCreditId: { in: credits } } });
  await prisma.vendorCredit.deleteMany({ where: { id: { in: credits } } });
  await prisma.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: { in: bills } } });
  await prisma.supplierInvoice.deleteMany({ where: { id: { in: bills } } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: items } } });
  await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
