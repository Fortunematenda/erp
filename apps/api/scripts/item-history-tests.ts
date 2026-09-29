/**
 * Product / inventory history regression suite (Feature 11).
 *   npm run test:history -w @nexuserp/api
 *
 * Opening 100 -> purchase +200 -> invoice -24 -> invoice -12 -> damage -4 gives
 * running balances 100, 300, 276, 264, 260. Verifies signed in/out, running balance,
 * summary, carried-forward opening under a date filter and clickable source links.
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
  console.log('Inventory history suite');
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
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'Hist Vendor', code: `HSV-${stamp}` } });
  const customer = await req('/sales/customers', { method: 'POST', ...auth, body: { name: `Hist Customer ${stamp}` } });
  const customerId = customer.json?.id;
  const items: string[] = [];
  const bills: string[] = [];
  const invoices: string[] = [];

  const inv = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `HS-INV-${stamp}`, name: 'History Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 10, sellingPrice: 15, incomeAccountId: incomeId, inventoryAssetAccountId: assetId } });
  if (inv.json?.id) items.push(inv.json.id);
  const svc = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `HS-SVC-${stamp}`, name: 'History Service', type: 'SERVICE', sellingPrice: 50, incomeAccountId: incomeId } });
  if (svc.json?.id) items.push(svc.json.id);

  // Opening 100 @ 10
  await req('/inventory/adjustments', { method: 'POST', ...auth, body: { warehouseId: warehouse.id, itemId: inv.json.id, mode: 'delta', quantity: 100, reason: 'OPENING_BALANCE', unitCost: 10 } });
  // Purchase +200 @ 10
  const bill = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, invoiceNo: `HS-BILL-${stamp}`, warehouseId: warehouse.id, receiveNow: true, lines: [{ itemId: inv.json.id, description: 'History Widget', quantity: 200, unitPrice: 10, taxRate: 0 }] } });
  if (bill.json?.id) bills.push(bill.json.id);
  await req(`/procurement/supplier-invoices/${bill.json.id}/post`, { method: 'POST', ...auth, body: {} });
  // Invoice -24, then -12
  for (const qty of [24, 12]) {
    const sale = await req('/sales/invoices', { method: 'POST', ...auth, body: { customerId, lines: [{ itemId: inv.json.id, description: 'History Widget', quantity: qty, unitPrice: 15, taxRate: 0 }] } });
    if (sale.json?.id) invoices.push(sale.json.id);
    await req(`/sales/invoices/${sale.json.id}/post`, { method: 'POST', ...auth });
  }
  // Damage -4
  await req('/inventory/adjustments', { method: 'POST', ...auth, body: { warehouseId: warehouse.id, itemId: inv.json.id, mode: 'delta', quantity: -4, reason: 'DAMAGED' } });

  const hist = await req(`/inventory/items/${inv.json.id}/history`, auth);
  const rows = hist.json?.rows || [];
  const balances = rows.map((r: any) => r.runningBalance);
  check('history returns 5 movements', rows.length === 5, `rows=${rows.length}`);
  check('running balances 100,300,276,264,260', JSON.stringify(balances) === JSON.stringify([100, 300, 276, 264, 260]), JSON.stringify(balances));
  check('signed qty in/out present', rows[0]?.qtyIn === 100 && rows[2]?.qtyOut === 24, `in=${rows[0]?.qtyIn} out=${rows[2]?.qtyOut}`);
  check('summary currentStock 260', Number(hist.json?.summary?.currentStock) === 260, `stock=${hist.json?.summary?.currentStock}`);
  check('summary received 300 (opening+purchase)', Number(hist.json?.summary?.received) === 300, `received=${hist.json?.summary?.received}`);
  check('summary issued 36', Number(hist.json?.summary?.issued) === 36, `issued=${hist.json?.summary?.issued}`);
  check('summary netAdjustments -4', Number(hist.json?.summary?.netAdjustments) === -4, `adj=${hist.json?.summary?.netAdjustments}`);
  const invoiceRow = rows.find((r: any) => r.sourceLabel === 'Invoice');
  check('invoice movement has clickable source link', !!invoiceRow && String(invoiceRow.sourceRoute).includes('/sales/invoices'));

  // Date filter carries forward the prior balance (not reset to zero)
  const future = new Date(Date.now() + 86400000).toISOString();
  const filtered = await req(`/inventory/items/${inv.json.id}/history?from=${encodeURIComponent(future)}`, auth);
  check('date filter carries forward period opening (260)', Number(filtered.json?.summary?.periodOpening) === 260 && (filtered.json?.rows || []).length === 0, `opening=${filtered.json?.summary?.periodOpening} rows=${(filtered.json?.rows || []).length}`);

  // Service item: no stock movements
  const svcHist = await req(`/inventory/items/${svc.json.id}/history`, auth);
  check('service history has no stock rows', (svcHist.json?.rows || []).length === 0 && svcHist.json?.item?.stockTracked === false);

  // Cleanup
  const grns = await prisma.goodsReceivedNote.findMany({ where: { companyId, supplierId: supplier.id }, select: { id: true } });
  const grnIds = grns.map((g) => g.id);
  await prisma.journalEntry.deleteMany({ where: { companyId, createdAt: { gte: start }, sourceType: { in: ['SALES_INVOICE', 'COGS_DIRECT_INVOICE', 'SUPPLIER_INVOICE', 'GOODS_RECEIPT', 'STOCK_ADJUSTMENT'] } } });
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
