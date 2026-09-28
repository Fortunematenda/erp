/**
 * Item types & data-model regression suite (Feature 01).
 *   npm run test:items -w @nexuserp/api
 *
 * Verifies: three item types, conditional account/stock behaviour, company-scoped
 * account validation, company-unique SKU, forbidden on-hand edits and multi-company
 * isolation. Requires a running API + seeded DB.
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
  console.log('Item types regression suite');
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
  const asset = accounts.find((a) => a.type === 'ASSET');
  const revenue = accounts.find((a) => a.type === 'REVENUE');
  const expense = accounts.find((a) => a.type === 'EXPENSE');
  check('chart of accounts available', !!asset && !!revenue && !!expense, `asset=${!!asset} revenue=${!!revenue} expense=${!!expense}`);

  const stamp = Date.now();
  const created: string[] = [];
  async function mk(body: any) {
    const r = await req('/inventory/items', { method: 'POST', ...auth, body });
    if (r.json?.id) created.push(r.json.id);
    return r;
  }

  // --- 1. Three types create correctly ---
  const inv = await mk({ sku: `T-INV-${stamp}`, name: 'Inventory Widget', type: 'INVENTORY_PRODUCT', sellingPrice: 35, purchaseCost: 20, incomeAccountId: revenue?.id, cogsAccountId: expense?.id, inventoryAssetAccountId: asset?.id });
  check('INVENTORY_PRODUCT created', inv.status === 201 && inv.json?.type === 'INVENTORY_PRODUCT', `status=${inv.status} type=${inv.json?.type}`);
  check('inventory keeps asset + cogs mapping', !!inv.json?.inventoryAssetAccountId && !!inv.json?.cogsAccountId);

  const non = await mk({ sku: `T-NON-${stamp}`, name: 'Non-Inventory Part', type: 'NON_INVENTORY_PRODUCT', sellingPrice: 25, purchaseCost: 10, incomeAccountId: revenue?.id, expenseAccountId: expense?.id });
  check('NON_INVENTORY_PRODUCT created', non.status === 201 && non.json?.type === 'NON_INVENTORY_PRODUCT');
  check('non-inventory has no inventory asset account', !non.json?.inventoryAssetAccountId, `got ${non.json?.inventoryAssetAccountId}`);

  const svc = await mk({ sku: `T-SVC-${stamp}`, name: 'Service Item', type: 'SERVICE', sellingPrice: 100, incomeAccountId: revenue?.id });
  check('SERVICE created', svc.status === 201 && svc.json?.type === 'SERVICE');
  check('service has no stock accounts/warehouse', !svc.json?.inventoryAssetAccountId && !svc.json?.defaultWarehouseId);

  // --- 2. Legacy alias normalized on write ---
  const legacy = await mk({ sku: `T-LEG-${stamp}`, name: 'Legacy Alias', type: 'INVENTORY' });
  check('legacy "INVENTORY" alias normalizes to INVENTORY_PRODUCT', legacy.json?.type === 'INVENTORY_PRODUCT', `got ${legacy.json?.type}`);

  // --- 3. Company-unique SKU ---
  const dup = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `T-INV-${stamp}`, name: 'Duplicate', type: 'SERVICE' } });
  check('duplicate SKU within company rejected', dup.status === 400, `status=${dup.status}`);

  // --- 4. Account validation ---
  const wrongType = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `T-BAD-${stamp}`, name: 'Bad mapping', type: 'INVENTORY_PRODUCT', incomeAccountId: asset?.id } });
  check('wrong-type income account rejected', wrongType.status === 400, `status=${wrongType.status}`);
  const missingAcc = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `T-MISS-${stamp}`, name: 'Missing account', type: 'INVENTORY_PRODUCT', inventoryAssetAccountId: '00000000-0000-0000-0000-000000000000' } });
  check('non-existent account rejected', missingAcc.status === 400, `status=${missingAcc.status}`);

  // --- 5. On-hand cannot be edited ---
  if (inv.json?.id) {
    const onhand = await req(`/inventory/items/${inv.json.id}`, { method: 'PATCH', ...auth, body: { onHand: 999 } });
    check('direct on-hand edit rejected', onhand.status === 400, `status=${onhand.status}`);
    const typeChange = await req(`/inventory/items/${inv.json.id}`, { method: 'PATCH', ...auth, body: { type: 'SERVICE' } });
    check('type change on transacted/known item handled', typeChange.status === 200 || typeChange.status === 400);
  }

  // --- 6. Service creates no stock movement ---
  if (svc.json?.id) {
    const mv = await req('/inventory/movements', { method: 'POST', ...auth, body: { itemId: svc.json.id, type: 'RECEIPT', quantity: 5, warehouseId: (meta.json?.warehouses || [])[0]?.id } });
    check('stock movement rejected for SERVICE', mv.status === 400, `status=${mv.status}`);
  }

  // --- 7. Multi-company isolation ---
  const companyA = await prisma.company.findUnique({ where: { id: companyId } });
  if (companyA && inv.json?.id) {
    const companyB = await prisma.company.create({ data: { tenantId: companyA.tenantId, legalName: 'Item Isolation Co', code: `IITEM-${stamp}`, baseCurrency: 'USD' } });
    const itemB = await prisma.inventoryItem.create({ data: { companyId: companyB.id, sku: 'B-1', name: 'B Item', type: 'SERVICE' } });
    const crossEdit = await req(`/inventory/items/${itemB.id}`, { method: 'PATCH', ...auth, body: { name: 'hacked' } });
    check('company A cannot edit company B item', crossEdit.status === 400 || crossEdit.status === 404, `status=${crossEdit.status}`);
    const listA = await req('/inventory/items', auth);
    const idsA = (listA.json?.rows || []).map((r: any) => r.id);
    check('company A item list excludes company B', !idsA.includes(itemB.id));
    await prisma.inventoryItem.delete({ where: { id: itemB.id } });
    await prisma.company.delete({ where: { id: companyB.id } });
  }

  // --- 8. Feature 02: units, defaults, opening stock, account persistence ---
  const warehouses: any[] = meta.json?.warehouses || [];
  const inv2 = await mk({ sku: `T-INV2-${stamp}`, name: 'Units Widget', type: 'INVENTORY_PRODUCT', unit: 'EA', purchaseUnit: 'Box', salesUnit: 'EA', purchaseCost: 20, sellingPrice: 35, minSellingPrice: 25, salesTaxCode: 'VAT15', purchaseTaxCode: 'VAT15', trackExpiry: true, incomeAccountId: revenue?.id, cogsAccountId: expense?.id, inventoryAssetAccountId: asset?.id, defaultWarehouseId: warehouses[0]?.id });
  check('create with purchase/sales units + expiry', inv2.status === 201 && inv2.json?.purchaseUnit === 'Box' && inv2.json?.salesUnit === 'EA' && inv2.json?.trackExpiry === true);
  if (inv2.json?.id) {
    const reopen = await req(`/inventory/items/${inv2.json.id}`, auth);
    const it = reopen.json?.item;
    check('reopen preserves units, tax, accounts', it?.purchaseUnit === 'Box' && it?.salesUnit === 'EA' && it?.salesTaxCode === 'VAT15' && it?.incomeAccountId === revenue?.id && it?.cogsAccountId === expense?.id);
    if (warehouses[0]?.id) {
      const open = await req('/inventory/adjustments', { method: 'POST', ...auth, body: { warehouseId: warehouses[0].id, itemId: inv2.json.id, mode: 'delta', quantity: 10, reason: 'OPENING_BALANCE', unitCost: 20 } });
      check('opening stock adjustment accepted', open.status === 201 || open.status === 200, `status=${open.status}`);
      const after = await req(`/inventory/items/${inv2.json.id}`, auth);
      check('opening stock increases on-hand to 10', Number(after.json?.total?.onHand) === 10, `onHand=${after.json?.total?.onHand}`);
    }
    const newIncome = accounts.filter((a) => a.type === 'REVENUE')[1];
    if (newIncome) {
      const upd = await req(`/inventory/items/${inv2.json.id}`, { method: 'PATCH', ...auth, body: { incomeAccountId: newIncome.id } });
      const reopened = await req(`/inventory/items/${inv2.json.id}`, auth);
      check('master account change persists', upd.status === 200 && reopened.json?.item?.incomeAccountId === newIncome.id);
    }
  }
  const negPrice = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `T-NEG-${stamp}`, name: 'Negative', type: 'SERVICE', sellingPrice: -5 } });
  check('negative selling price rejected', negPrice.status === 400, `status=${negPrice.status}`);
  const negCost = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `T-NEG2-${stamp}`, name: 'Negative cost', type: 'NON_INVENTORY_PRODUCT', purchaseCost: -1 } });
  check('negative purchase cost rejected', negCost.status === 400, `status=${negCost.status}`);

  // --- Cleanup ---
  for (const id of created) await prisma.inventoryItem.delete({ where: { id } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
