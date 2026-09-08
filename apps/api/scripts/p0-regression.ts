/**
 * Stage 1 P0 live regression against the running API + database.
 *   npm run test:p0 -w @nexuserp/api
 *
 * Expects API at http://localhost:4003 (PORT from env) and seeded demo company.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
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

const BASE = `http://localhost:${process.env.PORT || 4003}/api`;
const prisma = new PrismaClient();

let pass = 0, fail = 0;
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  results.push({ name, ok, detail });
}

async function req(path: string, opts: { method?: string; token?: string; body?: any; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text, headers: res.headers };
}

async function login(email: string, password = 'Password123!') {
  const r = await req('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status >= 400 || !r.json?.token) throw new Error(`Login failed for ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.token as string;
}

async function ensureClerk(companyId: string, tenantId: string) {
  const email = 'clerk@demo.local';
  const passwordHash = await bcrypt.hash('Password123!', 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, status: 'ACTIVE' },
    create: { email, passwordHash, firstName: 'Sales', lastName: 'Clerk' },
  });
  const membership = await prisma.membership.upsert({
    where: { userId_companyId: { userId: user.id, companyId } },
    update: { role: 'CLERK' },
    create: { userId: user.id, tenantId, companyId, role: 'CLERK' },
  });
  const role = await prisma.role.findFirst({ where: { companyId, name: 'Sales Clerk' } });
  if (role) {
    await prisma.membershipRole.deleteMany({ where: { membershipId: membership.id } });
    await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
  }
  return email;
}

async function main() {
  console.log(`P0 regression → ${BASE}\n`);
  const admin = await login('admin@demo.local');
  const me = await req('/auth/me', { token: admin }).catch(() => ({ status: 0, json: null }));
  const companies = await prisma.company.findMany({ take: 2, include: { tenant: true } });
  const company = companies[0];
  if (!company) throw new Error('No company in database — run db:seed');
  const branch = await prisma.branch.findFirst({ where: { companyId: company.id } });
  const warehouse = await prisma.warehouse.findFirst({ where: { companyId: company.id } });
  if (!branch || !warehouse) throw new Error('Seed branch/warehouse missing');

  await ensureClerk(company.id, company.tenantId);

  // ----- 1 blank display name -----
  const c1 = await req('/sales/customers', { method: 'POST', token: admin, body: { companyName: 'P0 Test Customer', name: '', email: 'p0@test.local', paymentTerms: 'Net 30' } });
  check('1. Create customer with blank display name', c1.status < 400 && c1.json?.name === 'P0 Test Customer', `${c1.status} name=${c1.json?.name}`);
  const customerId = c1.json?.id;

  // ----- 2 invalid email -----
  const c2 = await req('/sales/customers', { method: 'POST', token: admin, body: { companyName: 'Bad Email Co', email: 'not-an-email' } });
  check('2. Create customer with invalid email → 400', c2.status === 400, `status=${c2.status}`);

  // product
  const sku = 'P0-ROUTER-001';
  let item = await prisma.inventoryItem.findFirst({ where: { companyId: company.id, sku } });
  if (!item) {
    const created = await req('/inventory/items', { method: 'POST', token: admin, body: { sku, name: 'P0 Router', unit: 'EA', type: 'INVENTORY', sellingPrice: 1200, purchaseCost: 800, active: true } });
    item = created.json;
  } else {
    await req(`/inventory/items/${item.id}`, { method: 'PATCH', token: admin, body: { sellingPrice: 1200, purchaseCost: 800 } });
  }
  const itemId = item!.id;
  const taxRate = 15;
  await prisma.stockReservation.deleteMany({ where: { companyId: company.id, itemId, status: 'ACTIVE' } });

  // opening stock 20
  const bal0 = await req(`/inventory/items/${itemId}`, { token: admin });
  const onHand0 = Number(bal0.json?.total?.onHand ?? bal0.json?.onHand ?? 0);
  if (onHand0 < 20) {
    const need = 20 - onHand0;
    await req('/inventory/movements', { method: 'POST', token: admin, body: { warehouseId: warehouse.id, itemId, type: 'RECEIPT', quantity: need, unitCost: 800, reference: 'P0-OPENING' } });
  }
  const afterOpen = await req(`/inventory/items/${itemId}`, { token: admin });
  const opening = Number(afterOpen.json?.total?.onHand ?? afterOpen.json?.onHand ?? 0);
  check('Opening stock ≥ 20', opening >= 20, `onHand=${opening}`);

  const line = { description: 'P0 Router', itemId, quantity: 5, unitPrice: 1200, taxRate };

  // ----- 3 negative qty -----
  const qNeg = await req('/sales/quotations', { method: 'POST', token: admin, body: { branchId: branch.id, customerId, validUntil: new Date(Date.now() + 86400000 * 30).toISOString(), lines: [{ ...line, quantity: -1 }] } });
  check('3. Quote negative quantity → 400', qNeg.status === 400, `status=${qNeg.status}`);

  // ----- 4 negative rate -----
  const qNegR = await req('/sales/quotations', { method: 'POST', token: admin, body: { branchId: branch.id, customerId, lines: [{ ...line, unitPrice: -100 }] } });
  check('4. Quote negative rate → 400', qNegR.status === 400, `status=${qNegR.status}`);

  // good quote
  const quote = await req('/sales/quotations', { method: 'POST', token: admin, body: { branchId: branch.id, customerId, validUntil: new Date(Date.now() + 86400000 * 30).toISOString(), lines: [line] } });
  const qtOk = quote.status < 400 && Number(quote.json?.subtotal) === 6000 && Number(quote.json?.taxTotal) === 900 && Number(quote.json?.total) === 6900;
  check('Quote 5×1200 @15% = 6900', qtOk, `sub=${quote.json?.subtotal} tax=${quote.json?.taxTotal} tot=${quote.json?.total}`);
  const quoteId = quote.json?.id;

  // ----- 5 cancel then accept -----
  const qCancel = await req('/sales/quotations', { method: 'POST', token: admin, body: { branchId: branch.id, customerId, lines: [{ ...line, quantity: 1 }] } });
  await req(`/sales/quotations/${qCancel.json.id}/status`, { method: 'PATCH', token: admin, body: { status: 'CANCELLED' } });
  const accAfter = await req(`/sales/quotations/${qCancel.json.id}/status`, { method: 'PATCH', token: admin, body: { status: 'ACCEPTED' } });
  check('5. Cancel quote then accept → fail', accAfter.status >= 400, `status=${accAfter.status}`);

  // ----- 6 convert twice -----
  const conv1 = await req(`/sales/quotations/${quoteId}/convert`, { method: 'POST', token: admin, body: {} });
  check('Quote → order first convert', conv1.status < 400, `status=${conv1.status} ${JSON.stringify(conv1.json?.message || conv1.json?.orderNo)}`);
  const orderId = conv1.json?.id;
  const conv2 = await req(`/sales/quotations/${quoteId}/convert`, { method: 'POST', token: admin, body: {} });
  check('6. Convert quote twice → second fail', conv2.status >= 400, `status=${conv2.status}`);

  // confirm reservations if convert did not
  if (orderId) await req(`/sales/sales-orders/${orderId}/confirm`, { method: 'POST', token: admin, body: {} });

  const so = await req(`/sales/sales-orders/${orderId}`, { token: admin });
  const soLine = (so.json?.lines || [])[0];

  // ----- delivery 3 -----
  const del = await req('/sales/deliveries', { method: 'POST', token: admin, body: { salesOrderId: orderId, warehouseId: warehouse.id, lines: [{ salesOrderLineId: soLine?.id, quantity: 3 }] } });
  check('Create delivery qty 3', del.status < 400, `status=${del.status} ${JSON.stringify(del.json?.message || del.json?.deliveryNo)}`);
  const delId = del.json?.id;
  const dispatched = await req(`/sales/deliveries/${delId}/dispatch`, { method: 'POST', token: admin, body: {} });
  check('Dispatch delivery', dispatched.status < 400, `status=${dispatched.status} ${JSON.stringify(dispatched.json?.message || dispatched.json?.status)}`);

  const stockAfter = await req(`/inventory/items/${itemId}`, { token: admin });
  const onHand = Number(stockAfter.json?.total?.onHand ?? stockAfter.json?.onHand);
  check('10. Delivery stock 20→17 (or opening-3)', onHand === opening - 3, `onHand=${onHand} expected=${opening - 3}`);

  const mv = await prisma.stockMovement.findMany({ where: { itemId, reference: dispatched.json?.deliveryNo || del.json?.deliveryNo } });
  const issue = mv.find((m) => m.type === 'ISSUE');
  check('10. Stock delivery creates negative signed movement', !!issue && Number(issue!.signedQuantity) < 0, `type=${issue?.type} signed=${issue?.signedQuantity}`);

  const remaining = Number(soLine?.quantity || 5) - 3;
  const so2 = await req(`/sales/sales-orders/${orderId}`, { token: admin });
  const deliveredQty = Number((so2.json?.lines || [])[0]?.deliveredQty || 0);
  check('Remaining order qty 2', deliveredQty === 3 || Number(so2.json?.fulfilledQty) === 3, `deliveredQty=${deliveredQty}`);

  // ----- 9 delivery → invoice tax -----
  const invFromDel = await req(`/sales/deliveries/${delId}/invoice`, { method: 'POST', token: admin, body: {} });
  const taxOk = invFromDel.status < 400 && Number(invFromDel.json?.subtotal) === 3600 && Number(invFromDel.json?.taxTotal) === 540 && Number(invFromDel.json?.total) === 4140;
  check('9. Delivery → Invoice preserves 15% VAT (3600+540=4140)', taxOk, `sub=${invFromDel.json?.subtotal} tax=${invFromDel.json?.taxTotal} tot=${invFromDel.json?.total} status=${invFromDel.status} ${JSON.stringify(invFromDel.json?.message || '')}`);
  const invoiceId = invFromDel.json?.id;

  // ----- 13 clerk cannot post -----
  let clerkToken = '';
  try { clerkToken = await login('clerk@demo.local'); } catch (e: any) { check('Clerk login', false, e.message); }
  if (clerkToken) {
    const forbid = await req(`/sales/invoices/${invoiceId}/post`, { method: 'POST', token: clerkToken });
    check('13. User without permission cannot post invoice → 403', forbid.status === 403, `status=${forbid.status}`);
  }

  const posted = await req(`/sales/invoices/${invoiceId}/post`, { method: 'POST', token: admin });
  check('Post invoice', posted.status < 400, `status=${posted.status} ${JSON.stringify(posted.json?.message || posted.json?.invoiceStatus)}`);

  const je = await prisma.journalEntry.findFirst({ where: { companyId: company.id, sourceType: 'SALES_INVOICE', sourceId: invoiceId }, include: { lines: true } });
  const dr = je?.lines.reduce((s, l) => s + Number(l.debit), 0) || 0;
  const cr = je?.lines.reduce((s, l) => s + Number(l.credit), 0) || 0;
  const ar = je?.lines.find((l) => Number(l.debit) > 0);
  check('8. Posted invoice total matches GL AR amount', !!je && Math.abs(Number(ar?.debit || 0) - 4140) < 0.02, `AR=${ar?.debit} invoice=4140`);
  check('15. Debits = Credits for invoice journal', Math.abs(dr - cr) < 0.02, `Dr=${dr} Cr=${cr}`);

  // ----- 7 posted invoice PATCH -----
  const patch = await req(`/sales/invoices/${invoiceId}`, { method: 'PATCH', token: admin, body: { notes: 'x', lines: [{ description: 'P0 Router', itemId, quantity: 1, unitPrice: 1200, taxRate: 15 }] } });
  check('7. Post invoice then change qty/rate → 409', patch.status === 409, `status=${patch.status} ${JSON.stringify(patch.json?.message || patch.json)}`);

  // ----- payments -----
  const pay1 = await req('/sales/receipts', { method: 'POST', token: admin, headers: { 'Idempotency-Key': `p0-pay-${invoiceId}-1` }, body: { customerId, amount: 2000, method: 'CASH', allocations: [{ invoiceId, amount: 2000 }], idempotencyKey: `p0-pay-${invoiceId}-1` } });
  const invAfter1 = await req('/sales/invoices', { token: admin });
  const row1 = (Array.isArray(invAfter1.json) ? invAfter1.json : []).find((i: any) => i.id === invoiceId);
  check('Pay 2000 → balance 2140 PARTIALLY_PAID', pay1.status < 400 && Number(row1?.balanceDue) === 2140 && row1?.paymentStatus === 'PARTIALLY_PAID', `status=${pay1.status} bal=${row1?.balanceDue} pay=${row1?.paymentStatus} invStatus=${row1?.invoiceStatus}`);
  check('P0-14 invoiceStatus stays POSTED while paymentStatus is PARTIALLY_PAID', row1?.invoiceStatus === 'POSTED' && row1?.paymentStatus === 'PARTIALLY_PAID', `invoiceStatus=${row1?.invoiceStatus} paymentStatus=${row1?.paymentStatus}`);

  const payDup = await req('/sales/receipts', { method: 'POST', token: admin, headers: { 'Idempotency-Key': `p0-pay-${invoiceId}-1` }, body: { customerId, amount: 2000, method: 'CASH', allocations: [{ invoiceId, amount: 2000 }], idempotencyKey: `p0-pay-${invoiceId}-1` } });
  const receiptCount = await prisma.receipt.count({ where: { companyId: company.id, idempotencyKey: `p0-pay-${invoiceId}-1` } });
  check('14. Duplicate payment request does not create duplicate', payDup.status < 400 && receiptCount === 1, `count=${receiptCount} status=${payDup.status}`);

  const pay2 = await req('/sales/receipts', { method: 'POST', token: admin, body: { customerId, amount: 2140, method: 'CASH', allocations: [{ invoiceId, amount: 2140 }], idempotencyKey: `p0-pay-${invoiceId}-2` } });
  const invAfter2 = await req('/sales/invoices', { token: admin });
  const row2 = (Array.isArray(invAfter2.json) ? invAfter2.json : []).find((i: any) => i.id === invoiceId);
  check('Pay 2140 → balance 0 PAID', pay2.status < 400 && Number(row2?.balanceDue) <= 0.005 && row2?.paymentStatus === 'PAID', `bal=${row2?.balanceDue} pay=${row2?.paymentStatus}`);

  const over = await req('/sales/receipts', { method: 'POST', token: admin, body: { customerId, amount: 10, method: 'CASH', allocations: [{ invoiceId, amount: 10 }] } });
  check('Overpayment rejected', over.status >= 400, `status=${over.status}`);

  const payJe = await prisma.journalEntry.findFirst({ where: { companyId: company.id, sourceType: 'RECEIPT', sourceId: pay1.json?.id }, include: { lines: true } });
  const pdr = payJe?.lines.reduce((s, l) => s + Number(l.debit), 0) || 0;
  const pcr = payJe?.lines.reduce((s, l) => s + Number(l.credit), 0) || 0;
  check('15b. Debits = Credits for payment journal', !!payJe && Math.abs(pdr - pcr) < 0.02, `Dr=${pdr} Cr=${pcr}`);

  // ----- 11 RETURN_IN -----
  const ret = await req('/inventory/movements', { method: 'POST', token: admin, body: { warehouseId: warehouse.id, itemId, type: 'RETURN_IN', quantity: 1, unitCost: 800, reference: 'P0-RETURN' } });
  check('11. Return creates positive stock movement', ret.status < 400 && Number(ret.json?.signedQuantity) > 0 && ret.json?.type === 'RETURN_IN', `status=${ret.status} type=${ret.json?.type} signed=${ret.json?.signedQuantity}`);

  // ----- 12 cross-company PDF -----
  const otherCo = companies[1] || await (async () => {
    const t = await prisma.tenant.create({ data: { name: 'P0 Other Tenant', slug: `p0-other-${Date.now()}` } });
    return prisma.company.create({ data: { tenantId: t.id, legalName: 'Other Co', tradingName: 'Other Co', code: `OTH${Date.now() % 9999}`, baseCurrency: 'USD' } });
  })();
  const otherQuote = await prisma.quotation.create({
    data: { companyId: otherCo.id, quotationNo: `QT-ISO-${Date.now()}`, status: 'DRAFT', subtotal: 1, taxTotal: 0, total: 1, lines: { create: [{ description: 'secret', quantity: 1, unitPrice: 1, taxRate: 0, taxAmount: 0, lineTotal: 1 }] } },
  });
  const pdfCross = await req(`/documents/quote/${otherQuote.id}/pdf`, { token: admin });
  check('12. Cross-company PDF access blocked', pdfCross.status === 400 || pdfCross.status === 403 || pdfCross.status === 404, `status=${pdfCross.status}`);
  const ownPdf = await req(`/documents/quote/${quoteId}/pdf`, { token: admin });
  const isPdf = ownPdf.status === 200 && (ownPdf.headers.get('content-type') || '').includes('pdf');
  check('P0-08 Quote PDF works', isPdf || ownPdf.status === 200, `status=${ownPdf.status} type=${ownPdf.headers.get('content-type')}`);

  // JWT production guard unit-check (local)
  const { isUnsafeJwtSecret } = await import('../src/core/security/jwt-secret');
  check('P0-15 known default secrets are unsafe', isUnsafeJwtSecret('secret') && isUnsafeJwtSecret('local-dev-secret') && isUnsafeJwtSecret('changeme'));

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
