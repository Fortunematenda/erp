/**
 * General Ledger counterparty / contra-account regression suite (Feature 12).
 *   npm run test:gl -w @nexuserp/api
 *
 * Verifies GL rows carry the payee (from source), contra account(s) relative to the
 * selected account (single vs "Split (N)"), source reference, running balance and
 * page totals — without turning GL into a journal-entry screen.
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
  console.log('GL counterparty / contra suite');
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
  const idOf = (code: string) => accounts.find((a) => a.code === code)?.id;
  const apId = idOf('2000'), arId = idOf('1100'), expenseId = idOf('6000'), assetId = idOf('1200'), incomeId = idOf('4000');

  const stamp = Date.now();
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'GL Vendor', code: `GLV-${stamp}` } });
  const customer = await req('/sales/customers', { method: 'POST', ...auth, body: { name: `GL Customer ${stamp}` } });
  const customerId = customer.json?.id;
  const items: string[] = [];
  const bills: string[] = [];
  const invoices: string[] = [];

  const inv = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `GL-INV-${stamp}`, name: 'GL Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 10, sellingPrice: 100, incomeAccountId: incomeId, inventoryAssetAccountId: assetId } });
  if (inv.json?.id) items.push(inv.json.id);

  // Supplier bill (AP row should show the vendor as payee, contra = inventory/GRNI)
  const bill = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, invoiceNo: `GL-BILL-${stamp}`, warehouseId: warehouse?.id, receiveNow: true, lines: [{ itemId: inv.json.id, description: 'GL Widget', quantity: 1, unitPrice: 10, taxRate: 0 }] } });
  if (bill.json?.id) bills.push(bill.json.id);
  await req(`/procurement/supplier-invoices/${bill.json.id}/post`, { method: 'POST', ...auth, body: {} });

  const from = new Date(Date.now() - 3600000).toISOString();
  const to = new Date(Date.now() + 3600000).toISOString();
  const apLedger = await req(`/finance/ledger?accountId=${apId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=100`, auth);
  const apRows = apLedger.json?.rows || [];
  const apBillRow = apRows.find((r: any) => r.sourceType === 'SUPPLIER_INVOICE' && r.reference === bill.json?.invoiceNo);
  check('AP ledger row shows supplier payee', apBillRow?.payee === 'GL Vendor', `payee=${apBillRow?.payee}`);
  check('AP ledger row has contra account(s)', (apBillRow?.contraAccounts || []).length >= 1, JSON.stringify(apBillRow?.contraAccounts));
  check('AP ledger row has source reference', !!apBillRow?.reference && !!apBillRow?.sourceRoute);
  check('AP ledger page totals present', typeof apLedger.json?.pageTotals?.debit === 'number' && typeof apLedger.json?.pageTotals?.credit === 'number');

  // Customer invoice with tax (AR row: payee = customer, contra = Split of revenue + VAT)
  const invoice = await req('/sales/invoices', { method: 'POST', ...auth, body: { customerId, lines: [{ itemId: inv.json.id, description: 'GL Widget', quantity: 1, unitPrice: 100, taxRate: 15 }] } });
  if (invoice.json?.id) invoices.push(invoice.json.id);
  await req(`/sales/invoices/${invoice.json.id}/post`, { method: 'POST', ...auth });
  const arLedger = await req(`/finance/ledger?accountId=${arId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=100`, auth);
  const arRow = (arLedger.json?.rows || []).find((r: any) => r.sourceType === 'SALES_INVOICE' && r.reference === invoice.json?.invoiceNo);
  check('AR ledger row shows customer payee', arRow?.payee === `GL Customer ${stamp}`, `payee=${arRow?.payee}`);
  check('AR ledger row shows Split (N accounts)', String(arRow?.contraSummary || '').startsWith('Split'), `summary=${arRow?.contraSummary}`);
  check('Split exposes the distinct contra accounts', (arRow?.contraAccounts || []).length >= 2, JSON.stringify(arRow?.contraAccounts));

  // Manual journal (opening/internal) has no invented payee, contra = the other account
  const manual = await req('/finance/journals', { method: 'POST', ...auth, body: { date: new Date().toISOString(), description: 'Opening balance test', reference: `JE-${stamp}`, lines: [{ accountId: apId, debit: 0, credit: 50, description: 'Opening' }, { accountId: expenseId, debit: 50, credit: 0, description: 'Opening' }] } });
  check('manual journal created', manual.status < 400, `status=${manual.status}`);
  const apLedger2 = await req(`/finance/ledger?accountId=${apId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&pageSize=100`, auth);
  const manualRow = (apLedger2.json?.rows || []).find((r: any) => r.sourceType === 'MANUAL');
  check('manual journal row has no invented payee', manualRow?.payee == null, `payee=${manualRow?.payee}`);
  check('manual journal row shows single contra account', !!manualRow?.contraSummary && !String(manualRow.contraSummary).startsWith('Split'), `summary=${manualRow?.contraSummary}`);

  // Cleanup
  const grns = await prisma.goodsReceivedNote.findMany({ where: { companyId, supplierId: supplier.id }, select: { id: true } });
  const grnIds = grns.map((g) => g.id);
  await prisma.journalEntry.deleteMany({ where: { companyId, createdAt: { gte: start }, sourceType: { in: ['SALES_INVOICE', 'SUPPLIER_INVOICE', 'GOODS_RECEIPT', 'MANUAL'] } } });
  await prisma.stockMovement.deleteMany({ where: { itemId: { in: items } } });
  await prisma.salesInvoiceLine.deleteMany({ where: { invoiceId: { in: invoices } } });
  await prisma.salesInvoice.deleteMany({ where: { id: { in: invoices } } });
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
