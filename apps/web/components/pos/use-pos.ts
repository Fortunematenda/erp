'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

export type PosMode = 'RETAIL' | 'SERVICE' | 'RESTAURANT';
export type PosItem = { id: string; sku: string; name: string; barcode?: string | null; type?: string; unit?: string | null; price: number; onHand: number | null; tracked: boolean; category?: string | null; imageUrl?: string | null };
export type PosLine = { key: string; itemId: string; name: string; sku: string; unit?: string | null; price: number; qty: number; discount: number; staffId?: string | null; notes?: string | null; serverId?: string; sent?: boolean };
export type PosTender = { key: string; method: string; amount: number | null; reference: string };

export const EXTERNAL = new Set(['CARD', 'BANK', 'MOBILE']);
export const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', BANK: 'Bank transfer', MOBILE: 'Mobile money', CREDIT: 'On account' };
export const round = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const money = (n: number, currency: string) => `${currency} ${Number(n || 0).toFixed(2)}`;
export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Cart, order, shift and payment state shared by every POS layout. The server prices and posts everything. */
export function usePos(mode: PosMode) {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get('order');
  const [boot, setBoot] = useState<any>(null);
  const [items, setItems] = useState<PosItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lines, setLines] = useState<PosLine[]>([]);
  const [order, setOrder] = useState<any>(null);
  const [quote, setQuote] = useState<{ subtotal: number; taxTotal: number; discountTotal: number; total: number } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [staffId, setStaffId] = useState<string | undefined>();
  const [registerId, setRegisterId] = useState<string | undefined>();
  const [tip, setTip] = useState(0);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [held, setHeld] = useState<any[]>([]);
  const payKey = useRef('');

  const can = useCallback((code: string) => !!boot?.can?.[code], [boot]);
  const currency = boot?.currency || 'USD';
  const settings = boot?.settings || {};
  const register = boot?.registers?.find((r: any) => r.id === registerId);
  const shift = register?.shifts?.[0];

  useEffect(() => {
    const sync = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);

  const loadBoot = useCallback(async () => {
    const b = await api('/pos/bootstrap');
    setBoot(b);
    const saved = window.localStorage.getItem('pos.register');
    const regs = b.registers || [];
    setRegisterId((current) => current && regs.some((r: any) => r.id === current) ? current : regs.find((r: any) => r.id === saved)?.id || (regs.length === 1 ? regs[0].id : undefined));
    return b;
  }, []);

  useEffect(() => {
    loadBoot().then((b) => setCustomerId((c) => c || b.settings?.walkInCustomerId || undefined)).catch((e) => notify.error(e.message));
    api('/sales/customers').then((rows) => setCustomers((rows || []).filter((c: any) => c.status !== 'INACTIVE').map((c: any) => ({ id: c.id, name: c.name })))).catch(() => {});
    if (mode !== 'RETAIL') api('/pos/staff').then(setStaff).catch(() => {});
  }, [loadBoot, mode]);

  useEffect(() => { if (registerId) window.localStorage.setItem('pos.register', registerId); }, [registerId]);

  const applyOrder = useCallback((o: any) => {
    setOrder(o);
    setCustomerId(o.customerId || undefined);
    setStaffId(o.assignedEmployeeId || undefined);
    setLines((o.lines || []).map((l: any) => ({ key: l.id, serverId: l.id, itemId: l.itemId, name: l.description, sku: l.sku || '', price: Number(l.unitPrice), qty: Number(l.quantity), discount: Number(l.discount), staffId: l.assignedEmployeeId, notes: l.notes, sent: !!l.sentAt })));
  }, []);

  const loadOrder = useCallback(async () => {
    if (!orderId) { setOrder(null); return; }
    const rows = await api(`/pos/orders?mode=${mode}`);
    const found = (rows || []).find((o: any) => o.id === orderId);
    if (!found) { notify.warning('That order is no longer open'); router.replace(window.location.pathname); return; }
    applyOrder(found);
  }, [orderId, mode, applyOrder, router]);

  useEffect(() => { if (boot) loadOrder().catch((e) => notify.error(e.message)); }, [boot, loadOrder]);

  useEffect(() => {
    if (!boot) return;
    const handle = setTimeout(() => {
      const q = new URLSearchParams({ branchId: boot.branch.id, mode });
      if (search.trim()) q.set('search', search.trim());
      api(`/pos/catalog?${q}`).then((res) => setItems(res.items || [])).catch((e) => notify.error(e.message));
    }, 220);
    return () => clearTimeout(handle);
  }, [boot, search, mode]);

  const linePayload = useCallback((ls: PosLine[]) => ls.map((l) => ({ itemId: l.itemId, quantity: l.qty, unitPrice: l.price, discount: l.discount, assignedEmployeeId: l.staffId || undefined, notes: l.notes || undefined })), []);

  useEffect(() => {
    if (!boot || order) return;
    if (!lines.length) { setQuote(null); setQuoteError(''); return; }
    const handle = setTimeout(() => {
      api('/pos/quote', { method: 'POST', body: JSON.stringify({ branchId: boot.branch.id, customerId, lines: linePayload(lines) }) })
        .then((q) => { setQuote(q); setQuoteError(''); })
        .catch((e) => setQuoteError(e.message));
    }, 250);
    return () => clearTimeout(handle);
  }, [boot, order, lines, customerId, linePayload]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean) as string[])].sort(), [items]);
  const shown = category ? items.filter((i) => i.category === category) : items;
  const deposits = round((order?.tenders || []).filter((t: any) => t.kind === 'DEPOSIT' && t.status === 'CAPTURED').reduce((s: number, t: any) => s + Number(t.amount), 0));
  const goods = order ? Number(order.total) : quote?.total ?? round(lines.reduce((s, l) => s + l.price * l.qty - l.discount, 0));
  const taxTotal = order ? Number(order.taxTotal) : quote?.taxTotal ?? 0;
  const total = round(goods + tip);
  const due = round(Math.max(0, total - deposits));
  const needsShift = !!registerId && !shift;
  const shiftWaiting = shift?.status === 'CLOSING';
  const noCustomer = !customerId;
  const walkIn = !!customerId && customerId === settings.walkInCustomerId;
  const qtyInCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.itemId, (m.get(l.itemId) || 0) + l.qty);
    return m;
  }, [lines]);

  const orderCall = useCallback(async (path: string, body: any) => {
    setBusy(true);
    try {
      const res = await api(path, { method: 'POST', body: JSON.stringify(body) });
      await loadOrder();
      return res;
    } catch (e: any) { notify.error(e.message); return null; } finally { setBusy(false); }
  }, [loadOrder]);

  /** Adds one unit. Lines merge per item and professional; open orders add on the server. */
  const add = useCallback((item: PosItem, qty = 1) => {
    if (order) { orderCall(`/pos/orders/${order.id}/lines`, { lines: [{ itemId: item.id, quantity: qty, unitPrice: item.price, assignedEmployeeId: staffId }] }); return null; }
    const key = `${item.id}:${staffId || ''}`;
    setLines((prev) => {
      const found = prev.find((l) => l.key === key);
      if (found) return prev.map((l) => l.key === key ? { ...l, qty: round(l.qty + qty) } : l);
      return [...prev, { key, itemId: item.id, name: item.name, sku: item.sku, unit: item.unit, price: item.price, qty, discount: 0, staffId: staffId || null }];
    });
    return key;
  }, [order, orderCall, staffId]);

  const remove = useCallback((line: PosLine) => {
    if (order && line.serverId) {
      if (line.sent && !can('pos.cancel')) { notify.warning('This item was sent to the kitchen. Ask a manager to cancel it.'); return; }
      const reason = line.sent ? window.prompt(`Why is ${line.name} being cancelled?`) : '';
      if (line.sent && !reason) return;
      orderCall(`/pos/orders/${order.id}/lines/${line.serverId}/void`, { reason: reason || undefined });
      return;
    }
    setLines((prev) => prev.filter((x) => x.key !== line.key));
  }, [order, can, orderCall]);

  const patchLine = useCallback((key: string, patch: Partial<PosLine>) => setLines((prev) => prev.map((x) => x.key === key ? { ...x, ...patch } : x)), []);

  const scan = useCallback(async (code: string) => {
    const value = code.trim();
    if (!value || !boot) return;
    try {
      const res = await api(`/pos/catalog?branchId=${boot.branch.id}&mode=${mode}&barcode=${encodeURIComponent(value)}`);
      if (!res.items?.length) { notify.warning('Unknown barcode', { description: value }); return; }
      add(res.items[0]);
    } catch (e: any) { notify.error(e.message); }
  }, [boot, mode, add]);

  /** Returns why payment cannot start, or an empty string. */
  const paymentBlocker = useCallback(() => {
    if (!online) return 'You are offline. Payment stays closed until the connection returns.';
    if (!lines.length) return 'Add an item first.';
    if (quoteError) return quoteError;
    if (needsShift) return 'SHIFT';
    if (shiftWaiting) return 'This register is waiting for a manager to approve the last cash count.';
    if (noCustomer) return 'Choose a customer, or set a walk-in customer in POS settings.';
    return '';
  }, [online, lines.length, quoteError, needsShift, shiftWaiting, noCustomer]);

  const resetCart = useCallback(() => {
    setLines([]); setQuote(null); setTip(0);
    if (order) { setOrder(null); router.replace(window.location.pathname); }
    setCustomerId(settings.walkInCustomerId || undefined);
  }, [order, router, settings.walkInCustomerId]);

  const pay = useCallback(async (tenders: PosTender[], note?: string) => {
    if (busy) return null;
    if (!payKey.current) payKey.current = newKey();
    setBusy(true);
    try {
      const sale = await api('/pos/sales/complete', {
        method: 'POST',
        headers: { 'Idempotency-Key': payKey.current },
        body: JSON.stringify({
          branchId: boot.branch.id, mode, customerId, registerId, notes: note || undefined, assignedEmployeeId: staffId, tip: tip || undefined,
          ...(order ? { saleId: order.id } : { lines: linePayload(lines) }),
          tenders: tenders.filter((t) => Number(t.amount) > 0).map((t) => ({ method: t.method, amount: Number(t.amount), reference: t.reference.trim() || undefined })),
        }),
      });
      payKey.current = '';
      setReceipt(sale);
      resetCart();
      notify.success(`Sale ${sale.saleNo} posted`);
      if (sale.fiscalStatus === 'FAILED') notify.warning('The sale posted but fiscalisation failed. Retry it from Transactions.');
      return sale;
    } catch (e: any) { notify.error(e.message); return null; } finally { setBusy(false); }
  }, [busy, boot, mode, customerId, registerId, staffId, tip, order, lines, linePayload, resetCart]);

  const hold = useCallback(async () => {
    if (!lines.length || order) return;
    setBusy(true);
    try {
      const res = await api('/pos/sales/hold', { method: 'POST', body: JSON.stringify({ branchId: boot.branch.id, mode, customerId, registerId, lines: linePayload(lines) }) });
      setLines([]); setTip(0);
      notify.success(`Cart held as ${res.saleNo}`);
    } catch (e: any) { notify.error(e.message); } finally { setBusy(false); }
  }, [lines, order, boot, mode, customerId, registerId, linePayload]);

  const loadHeld = useCallback(async () => {
    try { setHeld(await api(`/pos/orders?mode=${mode}&cart=HELD&branchId=${boot.branch.id}`)); } catch (e: any) { notify.error(e.message); }
  }, [mode, boot]);

  const recall = useCallback(async (row: any) => {
    if (lines.length && !window.confirm('Replace the cart on screen with this held cart?')) return false;
    try {
      const sale = await api(`/pos/sales/${row.id}/recall`, { method: 'POST' });
      setLines((sale.lines || []).map((l: any) => ({ key: newKey(), itemId: l.itemId, name: l.description, sku: l.sku || '', price: Number(l.unitPrice), qty: Number(l.quantity), discount: Number(l.discount), staffId: l.assignedEmployeeId, notes: l.notes })));
      setCustomerId(sale.customerId || settings.walkInCustomerId || undefined);
      return true;
    } catch (e: any) { notify.error(e.message); return false; }
  }, [lines.length, settings.walkInCustomerId]);

  const saveAsOrder = useCallback(async (extra: Record<string, any> = {}) => {
    if (!lines.length && !extra.allowEmpty) return null;
    setBusy(true);
    try {
      const res = await api('/pos/orders', { method: 'POST', body: JSON.stringify({ branchId: boot.branch.id, mode, customerId, registerId, assignedEmployeeId: staffId, lines: linePayload(lines), ...extra }) });
      setLines([]);
      router.replace(`${window.location.pathname}?order=${res.id}`);
      notify.success(`${mode === 'SERVICE' ? 'Job' : 'Order'} ${res.saleNo} saved`);
      return res;
    } catch (e: any) { notify.error(e.message); return null; } finally { setBusy(false); }
  }, [lines, boot, mode, customerId, registerId, staffId, linePayload, router]);

  const closeOrder = useCallback(() => { setOrder(null); setLines([]); router.replace(window.location.pathname); }, [router]);

  const openShift = useCallback(async (float: number) => {
    if (!registerId) return false;
    setBusy(true);
    try {
      await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ registerId, openingFloat: float || 0 }) });
      await loadBoot();
      notify.success('Shift opened');
      return true;
    } catch (e: any) { notify.error(e.message); return false; } finally { setBusy(false); }
  }, [registerId, loadBoot]);

  const takeDeposit = useCallback(async (d: PosTender) => {
    if (!order) return false;
    if (EXTERNAL.has(d.method) && !d.reference.trim()) { notify.warning('Enter the approval reference'); return false; }
    const res = await orderCall(`/pos/orders/${order.id}/deposit`, { method: d.method, amount: d.amount, reference: d.reference.trim() || undefined, registerId });
    if (res) notify.success('Deposit recorded');
    return !!res;
  }, [order, orderCall, registerId]);

  const sendKitchen = useCallback(async () => {
    if (!order) return;
    const res = await orderCall(`/pos/sales/${order.id}/kitchen`, {});
    if (res) notify.success('Sent to kitchen');
  }, [order, orderCall]);

  return {
    mode, router, boot, can, currency, settings, online, busy, setBusy,
    items, shown, search, setSearch, category, setCategory, categories, qtyInCart,
    lines, setLines, order, quote, quoteError, goods, taxTotal, total, due, deposits, tip, setTip,
    customers, customerId, setCustomerId, staff, staffId, setStaffId, noCustomer, walkIn,
    registerId, setRegisterId, register, shift, needsShift, shiftWaiting,
    add, remove, patchLine, scan, paymentBlocker, pay, hold, held, loadHeld, recall, saveAsOrder, closeOrder,
    openShift, takeDeposit, sendKitchen, orderCall, loadOrder, receipt, setReceipt,
  };
}

export type Pos = ReturnType<typeof usePos>;
