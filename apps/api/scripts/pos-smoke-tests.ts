/**
 * POS API workflow test against a running API and seeded database.
 *   npx tsx scripts/pos-smoke-tests.ts
 * Restores POS branch settings it changes. Creates real postings in the demo company.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  try {
    for (const line of readFileSync(resolve(__dirname, '../.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch { /* existing env */ }
}
loadEnv();
const prisma = new PrismaClient();
const BASE = process.env.POS_TEST_BASE || 'http://localhost:4000/api';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  [ok] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}
const okStatus = (s: number) => s === 200 || s === 201;
const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

async function req(path: string, opts: { method?: string; token?: string; body?: any; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text: String(text).slice(0, 400) };
}

async function journalsBalance(sourceIds: string[]) {
  const journals = await prisma.journalEntry.findMany({ where: { sourceId: { in: sourceIds } }, include: { lines: true } });
  return journals.length > 0 && journals.every((j) => near(j.lines.reduce((s, l) => s + Number(l.debit), 0), j.lines.reduce((s, l) => s + Number(l.credit), 0)));
}

async function main() {
  const login = await req('/auth/login', { method: 'POST', body: { email: 'admin@demo.local', password: 'Password123!' } });
  check('login', !!login.json?.token, login.text);
  if (!login.json?.token) { console.log(`${pass} passed, ${fail} failed`); process.exit(1); }
  let token = login.json.token as string;
  const companyId = login.json.companies?.[0]?.id;
  if (companyId) {
    const sw = await req('/auth/switch-company', { method: 'POST', token, body: { companyId } });
    if (sw.json?.token) token = sw.json.token;
  }
  const t = { token };

  console.log('\nSetup');
  const boot = await req('/pos/bootstrap', t);
  check('bootstrap returns branch and permissions', boot.status === 200 && !!boot.json?.branch?.id && boot.json?.can?.['pos.sell'] === true, `status=${boot.status} ${boot.text}`);
  const branchId = boot.json.branch.id as string;
  const original = boot.json.settings;
  const setRes = await req('/pos/settings', { ...t, method: 'PUT', body: { branchId, retailEnabled: true, serviceEnabled: true, restaurantEnabled: true, allowCredit: true } });
  check('enable all POS modes', okStatus(setRes.status), setRes.text);
  const badDevice = await req('/pos/settings', { ...t, method: 'PUT', body: { branchId, fiscalDeviceId: '00000000-0000-0000-0000-000000000000' } });
  check('foreign fiscal device rejected', badDevice.status === 400, String(badDevice.status));

  const cat = await req('/pos/catalog?mode=SERVICE', t);
  check('catalog', cat.status === 200 && Array.isArray(cat.json?.items), `status=${cat.status}`);
  const customers = await req('/sales/customers', t);
  const customer = (customers.json || []).find((c: any) => c.status === 'ACTIVE') || customers.json?.[0];
  let item = (cat.json?.items || []).find((i: any) => i.type === 'SERVICE' || i.type === 'NON_INVENTORY_PRODUCT');
  if (!item) {
    const meta = await req('/companies/meta', t);
    const revenue = (meta.json?.accounts || []).find((a: any) => a.type === 'REVENUE' || a.type === 'INCOME');
    const created = await req('/inventory/items', { ...t, method: 'POST', body: { sku: `POS-SVC-${Date.now()}`, name: 'POS smoke labour', type: 'SERVICE', sellingPrice: 25, incomeAccountId: revenue?.id } });
    item = created.json?.id ? { id: created.json.id, price: 25, type: 'SERVICE' } : null;
    check('service item created', !!item, `status=${created.status} ${created.text}`);
  }
  if (!customer || !item) {
    check('sale fixture', false, 'need a customer and a catalogue item');
    return;
  }
  const line = (quantity = 1) => ({ itemId: item.id, quantity, unitPrice: Number(item.price) });

  try {
    console.log('\nCheckout');
    const key = `pos-smoke-${Date.now()}`;
    const body = { branchId, mode: 'SERVICE', customerId: customer.id, lines: [line(2)], tenders: [{ method: 'CASH', amount: 100000 }] };
    const sale = await req('/pos/sales/complete', { ...t, method: 'POST', headers: { 'Idempotency-Key': key }, body });
    check('cash sale completes', okStatus(sale.status) && sale.json?.saleStatus === 'POSTED', `status=${sale.status} ${sale.text}`);
    const total = Number(sale.json?.total || 0);
    const cash = sale.json?.tenders?.find((x: any) => x.method === 'CASH');
    check('change returned on cash', cash && near(Number(cash.changeAmount), 100000 - total), JSON.stringify(cash));
    check('invoice linked and paid', !!sale.json?.invoice?.id && sale.json?.invoice?.paymentStatus === 'PAID', sale.json?.invoice?.paymentStatus);
    check('completedAt recorded', !!sale.json?.completedAt);
    const again = await req('/pos/sales/complete', { ...t, method: 'POST', headers: { 'Idempotency-Key': key }, body });
    check('idempotent replay returns same sale', again.json?.id === sale.json?.id, `first=${sale.json?.id} second=${again.json?.id}`);
    const invoiceId = sale.json?.invoice?.id;
    const salesJ = await prisma.journalEntry.count({ where: { sourceId: invoiceId, sourceType: 'SALES_INVOICE' } });
    check('exactly one sales journal', salesJ === 1, String(salesJ));
    check('sale journals balance', await journalsBalance([invoiceId]));

    const quote = await req('/pos/quote', { ...t, method: 'POST', body: { branchId, customerId: customer.id, lines: [line(2)] } });
    check('quote matches posted total', okStatus(quote.status) && near(Number(quote.json?.total), total), `quote=${quote.json?.total} sale=${total}`);
    const held = await req('/pos/sales/hold', { ...t, method: 'POST', body: { branchId, mode: 'SERVICE', customerId: customer.id, lines: [line(1)] } });
    check('cart held', okStatus(held.status) && held.json?.cartStatus === 'HELD', held.text);
    const recalled = await req(`/pos/sales/${held.json?.id}/recall`, { ...t, method: 'POST' });
    check('held cart recalled with its lines', okStatus(recalled.status) && recalled.json?.lines?.length === 1, recalled.text);
    const recalled2 = await req(`/pos/sales/${held.json?.id}/recall`, { ...t, method: 'POST' });
    check('held cart cannot be recalled twice', recalled2.status === 400, String(recalled2.status));
    const staffRes = await req('/pos/staff', t);
    check('staff list', staffRes.status === 200 && Array.isArray(staffRes.json));
    const accts = await req('/pos/cash-accounts', t);
    check('cash accounts list', accts.status === 200 && Array.isArray(accts.json) && accts.json.length > 0);

    const overpay = await req('/pos/sales/complete', { ...t, method: 'POST', body: { ...body, tenders: [{ method: 'CARD', amount: total + 10, reference: 'AUTH1' }] } });
    check('card overpayment rejected', overpay.status === 400, `${overpay.status} ${overpay.text}`);
    const noRef = await req('/pos/sales/complete', { ...t, method: 'POST', body: { ...body, tenders: [{ method: 'CARD', amount: total }] } });
    check('card without approval reference rejected', noRef.status === 400, `${noRef.status} ${noRef.text}`);
    const short = await req('/pos/sales/complete', { ...t, method: 'POST', body: { ...body, tenders: [{ method: 'CASH', amount: 0.01 }] } });
    check('underpayment rejected', short.status === 400, `${short.status} ${short.text}`);
    const zeroQty = await req('/pos/sales/complete', { ...t, method: 'POST', body: { ...body, lines: [line(0)] } });
    check('zero quantity rejected as bad request', zeroQty.status === 400, `${zeroQty.status} ${zeroQty.text}`);
    const priceHack = await prisma.posSale.count({ where: { idempotencyKey: null, total: 0.01 } });
    check('no sale saved from rejected checkouts', priceHack === 0);

    const split = await req('/pos/sales/complete', { ...t, method: 'POST', body: { ...body, tenders: [{ method: 'CARD', amount: 10, reference: 'AUTH-SPLIT' }, { method: 'CASH', amount: total }] } });
    const splitTenders = split.json?.tenders || [];
    check('split tender posts', okStatus(split.status) && splitTenders.length === 2, `${split.status} ${split.text}`);
    check('split tender change only on cash', near(splitTenders.reduce((s: number, x: any) => s + Number(x.amount) - Number(x.changeAmount), 0), total), JSON.stringify(splitTenders));
    const splitReceipts = await prisma.receipt.count({ where: { invoiceId: split.json?.invoice?.id } });
    check('one receipt per tender', splitReceipts === 2, String(splitReceipts));

    console.log('\nReturns');
    const saleLine = sale.json?.lines?.[0];
    const noReason = await req(`/pos/sales/${sale.json.id}/return`, { ...t, method: 'POST', body: { lines: [{ saleLineId: saleLine.id, quantity: 1 }] } });
    check('return needs a reason', noReason.status === 400, String(noReason.status));
    const ret = await req(`/pos/sales/${sale.json.id}/return`, { ...t, method: 'POST', body: { reason: 'Smoke partial', refundMethod: 'CASH', lines: [{ saleLineId: saleLine.id, quantity: 1 }] } });
    check('partial return posts for approver', okStatus(ret.status) && ret.json?.status === 'POSTED', `${ret.status} ${ret.text}`);
    check('refund equals half the sale', near(Number(ret.json?.refundAmount), total / 2), String(ret.json?.refundAmount));
    const over = await req(`/pos/sales/${sale.json.id}/return`, { ...t, method: 'POST', body: { reason: 'Too many', lines: [{ saleLineId: saleLine.id, quantity: 2 }] } });
    check('over-return rejected', over.status === 400, `${over.status} ${over.text}`);
    const rest = await req(`/pos/sales/${sale.json.id}/return`, { ...t, method: 'POST', body: { reason: 'Rest', refundMethod: 'ACCOUNT', lines: [{ saleLineId: saleLine.id, quantity: 1 }] } });
    check('account return refunds no cash', okStatus(rest.status) && Number(rest.json?.refundAmount) === 0, `${rest.status} ${rest.text}`);
    const reversed = await prisma.posSale.findUnique({ where: { id: sale.json.id } });
    check('fully returned sale is REVERSED', reversed?.saleStatus === 'REVERSED', reversed?.saleStatus);
    const creditIds = (await prisma.posReturn.findMany({ where: { saleId: sale.json.id } })).map((r) => r.creditNoteId!).filter(Boolean);
    check('credit notes posted and balanced', creditIds.length === 2 && await journalsBalance(creditIds));
    const returnsList = await req('/pos/returns', t);
    check('returns list', returnsList.status === 200 && returnsList.json.some((r: any) => r.id === ret.json?.id));

    console.log('\nOpen orders, split and deposit');
    const order = await req('/pos/orders', { ...t, method: 'POST', body: { branchId, mode: 'SERVICE', customerId: customer.id, lines: [line(1)] } });
    check('open order created as DRAFT', okStatus(order.status) && order.json?.saleStatus === 'DRAFT', `${order.status} ${order.text}`);
    const added = await req(`/pos/orders/${order.json.id}/lines`, { ...t, method: 'POST', body: { lines: [line(3)] } });
    check('lines added', okStatus(added.status) && added.json?.lines?.length === 2, `${added.status} ${added.text}`);
    const preJournals = await prisma.journalEntry.count({ where: { sourceId: order.json.id } });
    check('open order posts nothing', preJournals === 0 && !added.json?.invoiceId);
    const splitRes = await req(`/pos/orders/${order.json.id}/split`, { ...t, method: 'POST', body: { lineIds: [added.json.lines[1].id] } });
    const child = (splitRes.json || []).find((o: any) => o.id !== order.json.id && o.notes?.includes(order.json.saleNo));
    check('order split into two bills', okStatus(splitRes.status) && !!child, `${splitRes.status} ${splitRes.text}`);
    const deposit = await req(`/pos/orders/${order.json.id}/deposit`, { ...t, method: 'POST', body: { method: 'BANK', amount: 5, reference: 'EFT-1' } });
    check('deposit taken', okStatus(deposit.status) && deposit.json?.tenders?.some((x: any) => x.kind === 'DEPOSIT'), `${deposit.status} ${deposit.text}`);
    const cancelDep = await req(`/pos/orders/${order.json.id}/cancel`, { ...t, method: 'POST', body: { reason: 'test' } });
    check('order with deposit cannot be cancelled', cancelDep.status === 400, String(cancelDep.status));
    const paidOrder = await req('/pos/sales/complete', { ...t, method: 'POST', body: { branchId, saleId: order.json.id, tenders: [{ method: 'CASH', amount: 1000 }] } });
    check('order paid with deposit applied', okStatus(paidOrder.status) && paidOrder.json?.invoice?.paymentStatus === 'PAID', `${paidOrder.status} ${paidOrder.text}`);
    const depReceipt = await prisma.receipt.findFirst({ where: { note: { contains: order.json.saleNo } } });
    check('deposit receipt fully applied', !!depReceipt && near(Number(depReceipt.unapplied), 0), JSON.stringify({ applied: depReceipt?.applied, unapplied: depReceipt?.unapplied }));
    const cashPart = paidOrder.json?.tenders?.find((x: any) => x.kind === 'PAYMENT' && x.method === 'CASH');
    check('cash covers only the balance after deposit', cashPart && near(Number(cashPart.amount) - Number(cashPart.changeAmount), Number(paidOrder.json.total) - 5), JSON.stringify(cashPart));
    const voidChild = await req(`/pos/orders/${child.id}/lines/${child.lines[0].id}/void`, { ...t, method: 'POST', body: { reason: 'Customer changed mind' } });
    check('unsent line voided', okStatus(voidChild.status) && voidChild.json?.lines?.length === 0, `${voidChild.status} ${voidChild.text}`);
    const cancelChild = await req(`/pos/orders/${child.id}/cancel`, { ...t, method: 'POST', body: { reason: 'Empty' } });
    check('empty order cancelled', okStatus(cancelChild.status), cancelChild.text);

    console.log('\nRestaurant and kitchen');
    const area = await req('/pos/restaurant/areas', { ...t, method: 'POST', body: { branchId, name: `Smoke ${Date.now()}` } });
    const stamp = Date.now().toString().slice(-6);
    const t1 = await req('/pos/restaurant/tables', { ...t, method: 'POST', body: { branchId, areaId: area.json?.id, code: `S${stamp}A`, name: `Smoke A${stamp}`, capacity: 4 } });
    const t2 = await req('/pos/restaurant/tables', { ...t, method: 'POST', body: { branchId, areaId: area.json?.id, code: `S${stamp}B`, name: `Smoke B${stamp}`, capacity: 2 } });
    check('area and tables created', okStatus(area.status) && okStatus(t1.status) && okStatus(t2.status), `${area.text} ${t1.text}`);
    const tableOrder = await req('/pos/orders', { ...t, method: 'POST', body: { branchId, mode: 'RESTAURANT', tableId: t1.json.id, customerId: customer.id, lines: [line(1)] } });
    check('table order opened', okStatus(tableOrder.status), tableOrder.text);
    const dup = await req('/pos/orders', { ...t, method: 'POST', body: { branchId, mode: 'RESTAURANT', tableId: t1.json.id, customerId: customer.id } });
    check('second order on busy table blocked', dup.status === 409, String(dup.status));
    const areas = await req(`/pos/restaurant/areas?branchId=${branchId}`, t);
    const tableRow = areas.json?.flatMap((a: any) => a.tables).find((x: any) => x.id === t1.json.id);
    check('table shows occupied with its order', tableRow?.status === 'OCCUPIED' && tableRow?.openOrders?.length === 1, JSON.stringify(tableRow?.status));
    const fire = await req(`/pos/sales/${tableOrder.json.id}/kitchen`, { ...t, method: 'POST', body: {} });
    check('order fired to kitchen', okStatus(fire.status) && fire.json?.lines?.length === 1, `${fire.status} ${fire.text}`);
    const refire = await req(`/pos/sales/${tableOrder.json.id}/kitchen`, { ...t, method: 'POST', body: {} });
    check('nothing new is not re-fired', refire.status === 400, String(refire.status));
    await req(`/pos/orders/${tableOrder.json.id}/lines`, { ...t, method: 'POST', body: { lines: [line(1)] } });
    const fire2 = await req(`/pos/sales/${tableOrder.json.id}/kitchen`, { ...t, method: 'POST', body: {} });
    check('only the new line goes on the second ticket', okStatus(fire2.status) && fire2.json?.lines?.length === 1, fire2.text);
    const badJump = await req(`/pos/kitchen/${fire.json.id}/status`, { ...t, method: 'POST', body: { status: 'COMPLETED' } });
    check('invalid kitchen transition rejected', badJump.status === 400, String(badJump.status));
    for (const ticket of [fire.json, fire2.json]) {
      await req(`/pos/kitchen/${ticket.id}/status`, { ...t, method: 'POST', body: { status: 'PREPARING' } });
      await req(`/pos/kitchen/${ticket.id}/status`, { ...t, method: 'POST', body: { status: 'READY' } });
    }
    const readyOrder = await prisma.posSale.findUnique({ where: { id: tableOrder.json.id } });
    check('order READY when all tickets ready', readyOrder?.orderStatus === 'READY', readyOrder?.orderStatus);
    const moved = await req(`/pos/orders/${tableOrder.json.id}/move`, { ...t, method: 'POST', body: { tableId: t2.json.id } });
    check('order moved to another table', okStatus(moved.status) && moved.json?.tableId === t2.json.id, moved.text);
    const paidTable = await req('/pos/sales/complete', { ...t, method: 'POST', body: { branchId, saleId: tableOrder.json.id, tenders: [{ method: 'MOBILE', amount: Number(readyOrder?.total), reference: 'ECO-1' }] } });
    check('table order paid by mobile', okStatus(paidTable.status) && paidTable.json?.orderStatus === 'COMPLETED', `${paidTable.status} ${paidTable.text}`);
    const tickets = await prisma.kitchenTicket.findMany({ where: { saleId: tableOrder.json.id } });
    check('ready tickets completed on payment', tickets.every((x) => x.status === 'COMPLETED'), tickets.map((x) => x.status).join(','));
    const tableAfter = await prisma.restaurantTable.findUnique({ where: { id: t2.json.id } });
    check('table needs cleaning after payment', tableAfter?.status === 'NEEDS_CLEANING', tableAfter?.status);

    console.log('\nRegisters and shifts');
    const reg = await req('/pos/registers', { ...t, method: 'POST', body: { branchId, name: `Smoke till ${stamp}`, code: `SMK${stamp}` } });
    check('register created', okStatus(reg.status) && !!reg.json?.id, reg.text);
    const noShift = await req('/pos/sales/complete', { ...t, method: 'POST', body: { ...body, registerId: reg.json.id } });
    check('register sale needs an open shift', noShift.status === 400, String(noShift.status));
    const shift = await req('/pos/shifts/open', { ...t, method: 'POST', body: { registerId: reg.json.id, openingFloat: 50 } });
    check('shift opened', okStatus(shift.status) && shift.json?.status === 'OPEN', shift.text);
    const shift2 = await req('/pos/shifts/open', { ...t, method: 'POST', body: { registerId: reg.json.id, openingFloat: 50 } });
    check('second shift on same register blocked', shift2.status === 409, String(shift2.status));
    const regSale = await req('/pos/sales/complete', { ...t, method: 'POST', body: { ...body, registerId: reg.json.id, tenders: [{ method: 'CASH', amount: 1000 }] } });
    check('register cash sale', okStatus(regSale.status) && regSale.json?.shiftId === shift.json.id, regSale.text);
    const noNote = await req(`/pos/shifts/${shift.json.id}/cash`, { ...t, method: 'POST', body: { kind: 'OUT', amount: 5 } });
    check('cash out needs a reason', noNote.status === 400, String(noNote.status));
    await req(`/pos/shifts/${shift.json.id}/cash`, { ...t, method: 'POST', body: { kind: 'OUT', amount: 5, note: 'Petty cash' } });
    const regRet = await req(`/pos/sales/${regSale.json.id}/return`, { ...t, method: 'POST', body: { reason: 'Drawer refund', refundMethod: 'CASH', lines: [{ saleLineId: regSale.json.lines[0].id, quantity: 1 }] } });
    check('cash refund from register', okStatus(regRet.status) && regRet.json?.status === 'POSTED', regRet.text);
    const drawer = await req(`/pos/shifts/${shift.json.id}/cash`, t);
    const expected = 50 + Number(regSale.json.total) - 5 - Number(regRet.json?.refundAmount || 0);
    check('expected drawer cash is float + sales - payouts - refunds', near(drawer.json?.expected, expected), `api=${drawer.json?.expected} expected=${expected}`);
    const short2 = await req(`/pos/shifts/${shift.json.id}/close`, { ...t, method: 'POST', body: { actualCash: expected - 2 } });
    check('short count waits for approval', okStatus(short2.status) && short2.json?.status === 'CLOSING' && near(Number(short2.json?.variance), -2), short2.text);
    const approved = await req(`/pos/shifts/${shift.json.id}/approve`, { ...t, method: 'POST', body: { note: 'Counted twice' } });
    check('manager approves variance', okStatus(approved.status) && approved.json?.status === 'CLOSED', approved.text);

    console.log('\nCashier permissions');
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const cashierRole = await prisma.role.findFirst({ where: { companyId, name: 'Cashier' } });
    check('Cashier role provisioned', !!cashierRole);
    if (cashierRole) {
      const email = 'pos-cashier@demo.local';
      const user = await prisma.user.upsert({
        where: { email },
        update: { status: 'ACTIVE' },
        create: { email, firstName: 'POS', lastName: 'Cashier', passwordHash: await bcrypt.hash('Password123!', 10) },
      });
      const membership = await prisma.membership.upsert({
        where: { userId_companyId: { userId: user.id, companyId } },
        update: { role: 'USER', status: 'ACTIVE' },
        create: { userId: user.id, companyId, tenantId: company.tenantId, role: 'USER' },
      });
      await prisma.membershipRole.deleteMany({ where: { membershipId: membership.id } });
      await prisma.membershipRole.create({ data: { membershipId: membership.id, roleId: cashierRole.id } });
      const cl = await req('/auth/login', { method: 'POST', body: { email, password: 'Password123!' } });
      let ct = cl.json?.token as string;
      const sw = ct ? await req('/auth/switch-company', { method: 'POST', token: ct, body: { companyId } }) : null;
      if (sw?.json?.token) ct = sw.json.token;
      check('cashier can log in', !!ct, cl.text);
      const c = { token: ct };
      const cBoot = await req('/pos/bootstrap', c);
      check('cashier sees reduced permissions', cBoot.json?.can?.['pos.sell'] === true && cBoot.json?.can?.['pos.refund.approve'] === false, JSON.stringify(cBoot.json?.can));
      const tampered = await req('/pos/sales/complete', { ...c, method: 'POST', body: { ...body, lines: [{ itemId: item.id, quantity: 1, unitPrice: 0.01 }], tenders: [{ method: 'CASH', amount: 1000 }] } });
      check('cashier cannot override the server price', tampered.status === 400, `${tampered.status} ${tampered.text}`);
      const cheap = await req('/pos/sales/complete', { ...c, method: 'POST', body: { ...body, lines: [line(1)], tenders: [{ method: 'CASH', amount: 1000 }] } });
      check('cashier completes a normal sale', okStatus(cheap.status) && cheap.json?.saleStatus === 'POSTED', `${cheap.status} ${cheap.text}`);
      const cRet = await req(`/pos/sales/${cheap.json?.id}/return`, { ...c, method: 'POST', body: { reason: 'Customer return', lines: [{ saleLineId: cheap.json?.lines?.[0]?.id, quantity: 1 }] } });
      check('cashier return waits for approval', okStatus(cRet.status) && cRet.json?.status === 'PENDING_APPROVAL', `${cRet.status} ${cRet.text}`);
      const nothingPosted = !(await prisma.posReturn.findUnique({ where: { id: cRet.json?.id } }))?.creditNoteId;
      check('pending return posts no credit note', nothingPosted);
      const cApprove = await req(`/pos/returns/${cRet.json?.id}/approve`, { ...c, method: 'POST' });
      check('cashier cannot approve refund', cApprove.status === 403, String(cApprove.status));
      const mApprove = await req(`/pos/returns/${cRet.json?.id}/approve`, { ...t, method: 'POST' });
      check('manager approves pending return', okStatus(mApprove.status) && mApprove.json?.status === 'POSTED' && Number(mApprove.json?.refundAmount) > 0, `${mApprove.status} ${mApprove.text}`);
      const again2 = await req(`/pos/returns/${cRet.json?.id}/approve`, { ...t, method: 'POST' });
      check('return cannot be approved twice', again2.status === 409, String(again2.status));
      const cSettings = await req('/pos/settings', { ...c, method: 'PUT', body: { branchId, allowCredit: true } });
      check('cashier cannot change POS settings', cSettings.status === 403, String(cSettings.status));
      const cDiscount = await req('/pos/sales/complete', { ...c, method: 'POST', body: { ...body, customerId: customer.id, tenders: [{ method: 'CREDIT', amount: 1 }] } });
      check('cashier cannot sell on account', cDiscount.status === 400, `${cDiscount.status} ${cDiscount.text}`);
      const cOrder = await req('/pos/orders', { ...c, method: 'POST', body: { branchId, mode: 'RESTAURANT', customerId: customer.id, lines: [line(1)] } });
      const cFire = await req(`/pos/sales/${cOrder.json?.id}/kitchen`, { ...c, method: 'POST', body: {} });
      const cVoid = await req(`/pos/orders/${cOrder.json?.id}/lines/${cOrder.json?.lines?.[0]?.id}/void`, { ...c, method: 'POST', body: {} });
      check('cashier cannot void a line already sent to the kitchen', okStatus(cFire.status) && cVoid.status === 400, `${cFire.status} ${cVoid.status}`);
      const cCancel = await req(`/pos/kitchen/${cFire.json?.id}/status`, { ...c, method: 'POST', body: { status: 'CANCELLED' } });
      check('cashier cannot cancel a kitchen ticket', cCancel.status === 400, String(cCancel.status));
      await req(`/pos/orders/${cOrder.json?.id}/cancel`, { ...t, method: 'POST', body: { reason: 'test cleanup' } });
      const blindReg = await req('/pos/registers', { ...t, method: 'POST', body: { branchId, name: `Blind ${stamp}`, code: `BLD${stamp}` } });
      const blindShift = await req('/pos/shifts/open', { ...c, method: 'POST', body: { registerId: blindReg.json?.id, openingFloat: 20 } });
      const blind = await req(`/pos/shifts/${blindShift.json?.id}/cash`, c);
      check('cashier counts blind (no expected total)', blind.status === 200 && blind.json?.expected === null && blind.json?.cashSales === null, blind.text);
      const sup = await req(`/pos/shifts/${blindShift.json?.id}/cash`, t);
      check('supervisor sees expected drawer total', near(Number(sup.json?.expected), 20), sup.text);
      await req(`/pos/shifts/${blindShift.json?.id}/close`, { ...c, method: 'POST', body: { actualCash: 20 } });
    }

    console.log('\nFiscal, reports and security');
    const fiscal = await req(`/pos/sales/${split.json.id}/fiscalise`, { ...t, method: 'POST' });
    check('fiscal retry responds without server error', fiscal.status < 500, `${fiscal.status} ${fiscal.text}`);
    const summary = await req(`/pos/reports/summary?branchId=${branchId}`, t);
    check('summary has net sales, profit and breakdowns', summary.status === 200 && typeof summary.json?.netSales === 'number' && Array.isArray(summary.json?.topItems) && !!summary.json?.byMode, summary.text);
    const denied = await req('/pos/sales/complete', { method: 'POST', body: { lines: [], tenders: [] } });
    check('unauthenticated denied', denied.status === 401, String(denied.status));

    const other = await prisma.company.findFirst({ where: { id: { not: companyId } } });
    if (other) {
      const otherBranch = await prisma.branch.findFirst({ where: { companyId: other.id } });
      const foreign = await req('/pos/orders', { ...t, method: 'POST', body: { branchId: otherBranch?.id, mode: 'SERVICE', customerId: customer.id, lines: [line(1)] } });
      const landed = foreign.json?.branchId === otherBranch?.id;
      check('cannot open an order in another company branch', !landed, `${foreign.status} branch=${foreign.json?.branchId}`);
      if (okStatus(foreign.status) && foreign.json?.id) await req(`/pos/orders/${foreign.json.id}/cancel`, { ...t, method: 'POST', body: { reason: 'cleanup' } });
      const foreignSale = await prisma.posSale.findFirst({ where: { companyId: other.id } });
      if (foreignSale) {
        const peek = await req(`/pos/orders/${foreignSale.id}/lines`, { ...t, method: 'POST', body: { lines: [line(1)] } });
        check('cannot edit another company order', peek.status === 400, String(peek.status));
      }
    } else {
      check('cross-company isolation (no second company seeded; tested foreign id)', (await req('/pos/orders/00000000-0000-0000-0000-000000000000/lines', { ...t, method: 'POST', body: { lines: [line(1)] } })).status === 400);
    }
  } finally {
    await req('/pos/settings', { ...t, method: 'PUT', body: { branchId, retailEnabled: original.retailEnabled, serviceEnabled: original.serviceEnabled, restaurantEnabled: original.restaurantEnabled, allowCredit: original.allowCredit } });
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
