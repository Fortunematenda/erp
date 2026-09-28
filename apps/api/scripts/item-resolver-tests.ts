/**
 * Central item accounting resolver regression suite (Feature 03).
 *   npm run test:resolver -w @nexuserp/api
 *
 * Verifies the shared resolver returns correct purchase/sale defaults, validates
 * account types/company scope, and that bill creation snapshots item account
 * mappings (direct + PO-linked share one path). Requires a running API + seeded DB.
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
  console.log('Item resolver regression suite');
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
  const asset = accounts.find((a) => a.code === '1200') || accounts.find((a) => a.type === 'ASSET' && !/cash|bank|receivable/i.test(a.name || ''));
  const revenue = accounts.find((a) => a.code === '4000') || accounts.find((a) => a.type === 'REVENUE');
  const expense = accounts.find((a) => a.type === 'EXPENSE' && !/vat|tax/i.test(a.name || ''));

  const stamp = Date.now();
  const createdItems: string[] = [];
  async function mkItem(body: any) { const r = await req('/inventory/items', { method: 'POST', ...auth, body }); if (r.json?.id) createdItems.push(r.json.id); return r; }

  // Inventory product with full mappings
  const inv = await mkItem({ sku: `R-INV-${stamp}`, name: 'Resolver Widget', type: 'INVENTORY_PRODUCT', purchaseCost: 20, sellingPrice: 35, purchaseUnit: 'Box', salesUnit: 'EA', purchaseTaxCode: 'VAT15', salesTaxCode: 'VAT15', incomeAccountId: revenue?.id, cogsAccountId: expense?.id, inventoryAssetAccountId: asset?.id });
  check('inventory item created', !!inv.json?.id, `status=${inv.status}`);
  if (inv.json?.id) {
    const pur = await req(`/inventory/items/${inv.json.id}/resolve?purpose=purchase`, auth);
    check('purchase resolver: cost + unit + tax', pur.json?.unitCost === 20 && pur.json?.unit === 'Box' && pur.json?.taxCode === 'VAT15');
    check('purchase resolver: debits Inventory Asset (not COGS)', pur.json?.accountId === asset?.id && pur.json?.accountCode === asset?.code && pur.json?.inventoryAssetAccountId === asset?.id);
    check('purchase resolver: COGS exposed for later sale', pur.json?.cogsAccountId === expense?.id);

    const sale = await req(`/inventory/items/${inv.json.id}/resolve?purpose=sale`, auth);
    check('sale resolver: selling price (never cost)', sale.json?.unitPrice === 35 && sale.json?.priceSource === 'DEFAULT_SALES_PRICE');
    check('sale resolver: income account + unit + tax', sale.json?.incomeAccountId === revenue?.id && sale.json?.unit === 'EA' && sale.json?.taxCode === 'VAT15');
  }

  // Non-inventory product → expense account, no inventory asset
  const non = await mkItem({ sku: `R-NON-${stamp}`, name: 'Resolver Consumable', type: 'NON_INVENTORY_PRODUCT', purchaseCost: 5, sellingPrice: 9, expenseAccountId: expense?.id, incomeAccountId: revenue?.id });
  if (non.json?.id) {
    const pur = await req(`/inventory/items/${non.json.id}/resolve?purpose=purchase`, auth);
    check('non-inventory purchase debits Expense, no inventory asset', pur.json?.accountId === expense?.id && pur.json?.inventoryAssetAccountId === null);
  }

  // Bill creation snapshots item account mapping (direct bill path)
  const supplier = await prisma.supplier.create({ data: { companyId, name: 'Resolver Vendor', code: `RV-${stamp}` } });
  if (inv.json?.id) {
    const bill = await req('/procurement/supplier-invoices', { method: 'POST', ...auth, body: { supplierId: supplier.id, invoiceNo: `RVBILL-${stamp}`, lines: [{ itemId: inv.json.id, description: 'Resolver Widget', quantity: 2, unitPrice: 20, taxRate: 0 }] } });
    check('bill created for resolver test', bill.status === 201 && !!bill.json?.id, `status=${bill.status}`);
    if (bill.json?.id) {
      const line = await prisma.supplierInvoiceLine.findFirst({ where: { supplierInvoiceId: bill.json.id } });
      check('bill line snapshots Inventory Asset account from item', line?.accountId === asset?.id && !!line?.accountCode, `accountId=${line?.accountId}`);
      await req(`/procurement/supplier-invoices/${bill.json.id}`, { method: 'DELETE', ...auth });
    }
  }

  // Cross-company denial
  const companyA = await prisma.company.findUnique({ where: { id: companyId } });
  if (companyA && inv.json?.id) {
    const companyB = await prisma.company.create({ data: { tenantId: companyA.tenantId, legalName: 'Resolver Isolation Co', code: `RISO-${stamp}`, baseCurrency: 'USD' } });
    const itemB = await prisma.inventoryItem.create({ data: { companyId: companyB.id, sku: 'RB-1', name: 'B Item', type: 'SERVICE' } });
    const cross = await req(`/inventory/items/${itemB.id}/resolve?purpose=purchase`, auth);
    check('company A cannot resolve company B item', cross.status === 400, `status=${cross.status}`);
    await prisma.inventoryItem.delete({ where: { id: itemB.id } });
    await prisma.company.delete({ where: { id: companyB.id } });
  }

  await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => {});
  for (const id of createdItems) await prisma.inventoryItem.delete({ where: { id } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
