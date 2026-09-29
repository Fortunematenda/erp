/**
 * Fiscalisation status integrity suite.
 *   npm run test:fiscal-status -w @nexuserp/api
 *
 * Reproduces and guards the "fiscalised invoice still shows READY" bug:
 *  - an accepted fiscal receipt must resolve the document to FISCALISED (authoritative)
 *  - reconcile repairs stale statuses from accepted receipts only
 *  - re-fiscalising returns the existing receipt (no duplicate submission)
 *  - draft documents cannot be fiscalised; cross-company is rejected
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const p = resolve(__dirname, '../.env');
  try { for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (!m || process.env[m[1]]) continue; process.env[m[1]] = m[2].replace(/^"|"$/g, ''); } } catch { /* env */ }
}
loadEnv();
const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) { if (ok) { pass++; console.log(`  [ok] ${name}`); } else { fail++; console.log(`  [FAIL] ${name}${detail ? ' - ' + detail : ''}`); } }
async function req(path: string, opts: { method?: string; token?: string; body?: any } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text(); let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}

async function main() {
  console.log('Fiscalisation status integrity suite');
  const start = new Date();
  const login = await req('/auth/login', { method: 'POST', body: { email: 'admin@demo.local', password: 'Password123!' } });
  let token: string = login.json.token; const companyId: string = login.json.companies?.[0]?.id;
  const sw = await req('/auth/switch-company', { method: 'POST', token, body: { companyId } }); if (sw.json?.token) token = sw.json.token;
  const auth = { token };
  const meta = await req('/companies/meta', auth);
  const warehouse = (meta.json?.warehouses || [])[0];

  // Ensure a MOCK device exists
  let devices = (await req('/fiscalisation/devices', auth)).json || [];
  let device = devices.find((d: any) => d.environment === 'MOCK' && d.status === 'ACTIVE');
  if (!device) {
    const branches = (await req('/fiscalisation/branches', auth)).json || [];
    const created = await req('/fiscalisation/devices', { method: 'POST', ...auth, body: { branchId: branches[0]?.id, name: 'Status Test Device', serialNumber: `ST-${Date.now()}`, environment: 'MOCK', activationKey: 'TEST-KEY' } });
    device = created.json;
    await req(`/fiscalisation/devices/${device.id}/register`, { method: 'POST', ...auth });
    device = (await req(`/fiscalisation/devices/${device.id}`, auth)).json;
  }
  if (!device) { console.log('  [skip] no fiscal device available'); await prisma.$disconnect(); process.exit(0); }
  if (device.dayStatus !== 'OPEN') await req(`/fiscalisation/devices/${device.id}/open-day`, { method: 'POST', ...auth });

  const stamp = Date.now();
  const item = await req('/inventory/items', { method: 'POST', ...auth, body: { sku: `FST-${stamp}`, name: 'Status Widget', type: 'SERVICE', sellingPrice: 100 } });
  const customer = await req('/sales/customers', { method: 'POST', ...auth, body: { name: `Status Customer ${stamp}` } });
  const customerId = customer.json?.id;
  const items: string[] = item.json?.id ? [item.json.id] : [];
  const invoices: string[] = [];

  async function mkInvoice(post: boolean) {
    const inv = await req('/sales/invoices', { method: 'POST', ...auth, body: { customerId, lines: [{ itemId: item.json.id, description: 'Status Widget', quantity: 1, unitPrice: 100, taxRate: 0 }] } });
    invoices.push(inv.json.id);
    if (post) await req(`/sales/invoices/${inv.json.id}/post`, { method: 'POST', ...auth });
    return inv.json.id;
  }

  // Draft cannot be fiscalised
  const draftId = await mkInvoice(false);
  const draftFiscal = await req(`/fiscalisation/devices/${device.id}/fiscalise`, { method: 'POST', ...auth, body: { invoiceId: draftId } });
  check('draft invoice cannot be fiscalised', draftFiscal.status === 400, `status=${draftFiscal.status}`);

  // Posted invoice fiscalises and becomes FISCALISED
  const invId = await mkInvoice(true);
  const fis = await req(`/fiscalisation/devices/${device.id}/fiscalise`, { method: 'POST', ...auth, body: { invoiceId: invId } });
  check('posted invoice fiscalised', fis.status < 400 && !!fis.json?.id, `status=${fis.status}`);
  let inv = (await req('/sales/invoices', auth)).json.find((i: any) => i.id === invId);
  check('invoice fiscalStatus = FISCALISED after submit', inv?.fiscalStatus === 'FISCALISED', `got ${inv?.fiscalStatus}`);

  // Simulate the stale READY bug, then reconcile
  await prisma.salesInvoice.update({ where: { id: invId }, data: { fiscalStatus: 'READY' } });
  inv = (await req('/sales/invoices', auth)).json.find((i: any) => i.id === invId);
  check('stale READY reproduced', inv?.fiscalStatus === 'READY' && !!inv?.fiscalReceipt);
  const rec = await req('/fiscalisation/reconcile', { method: 'POST', ...auth });
  check('reconcile repaired stale status', rec.status < 400 && Number(rec.json?.invoices) >= 1, `repaired=${rec.json?.invoices}`);
  inv = (await req('/sales/invoices', auth)).json.find((i: any) => i.id === invId);
  check('invoice reads FISCALISED after reconcile', inv?.fiscalStatus === 'FISCALISED', `got ${inv?.fiscalStatus}`);

  // Re-fiscalising returns the existing receipt (no duplicate)
  const before = await prisma.fiscalReceipt.count({ where: { invoiceId: invId } });
  const again = await req(`/fiscalisation/devices/${device.id}/fiscalise`, { method: 'POST', ...auth, body: { invoiceId: invId } });
  const after = await prisma.fiscalReceipt.count({ where: { invoiceId: invId } });
  check('re-fiscalise returns existing receipt, no duplicate', again.status < 400 && before === 1 && after === 1, `before=${before} after=${after}`);

  // Cross-company rejection
  const companyA = await prisma.company.findUnique({ where: { id: companyId } });
  const companyB = await prisma.company.create({ data: { tenantId: companyA!.tenantId, legalName: 'Fiscal Isolation Co', code: `FISO-${stamp}`, baseCurrency: 'USD' } });
  const branchB = await prisma.branch.create({ data: { companyId: companyB.id, name: 'B', code: 'B1' } });
  const invB = await prisma.salesInvoice.create({ data: { companyId: companyB.id, branchId: branchB.id, invoiceNo: `B-${stamp}`, status: 'POSTED', invoiceStatus: 'POSTED', fiscalStatus: 'READY', fiscalRequired: true, subtotal: 10, taxTotal: 0, total: 10 } });
  const cross = await req(`/fiscalisation/devices/${device.id}/fiscalise`, { method: 'POST', ...auth, body: { invoiceId: invB.id } });
  check('cross-company fiscalisation rejected', cross.status === 400 || cross.status === 404, `status=${cross.status}`);

  // Cleanup
  await prisma.fiscalReceipt.deleteMany({ where: { invoiceId: { in: invoices } } });
  await prisma.journalEntry.deleteMany({ where: { companyId, createdAt: { gte: start }, sourceType: 'SALES_INVOICE', sourceId: { in: invoices } } });
  await prisma.salesInvoiceLine.deleteMany({ where: { invoiceId: { in: invoices } } });
  await prisma.salesInvoice.deleteMany({ where: { id: { in: invoices } } });
  await prisma.salesInvoice.deleteMany({ where: { id: invB.id } });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: items } } });
  await prisma.branch.delete({ where: { id: branchB.id } });
  await prisma.company.delete({ where: { id: companyB.id } });
  if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
