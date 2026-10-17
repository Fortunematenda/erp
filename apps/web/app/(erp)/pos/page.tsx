'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChefHat, ShoppingCart, Wrench } from 'lucide-react';
import { api } from '@/lib/api';

const LINKS: [string, string, string, string][] = [
  ['Transactions', '/pos/transactions', 'Completed sales, receipts and fiscal retries', 'pos.access'],
  ['Returns & refunds', '/pos/returns', 'Partial returns, approvals and credit notes', 'pos.refund'],
  ['Cashier shifts', '/pos/shifts', 'Floats, cash in and out, counts', 'pos.access'],
  ['Registers', '/pos/registers', 'Cash drawers and their ledger accounts', 'pos.registers.manage'],
  ['Restaurant floor', '/pos/restaurant', 'Tables, tabs, moves and split bills', 'pos.restaurant'],
  ['Kitchen display', '/pos/kitchen', 'Tickets by station', 'pos.kitchen'],
  ['Service jobs', '/pos/services', 'Open jobs, deposits and status', 'pos.access'],
  ['Reports', '/pos/reports', 'Sales, margin, tenders and cashiers', 'pos.reports'],
  ['Settings', '/pos/settings', 'Modes, warehouse, walk-in customer, fiscal device', 'pos.settings'],
];

export default function Page() {
  const router = useRouter();
  const [boot, setBoot] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  useEffect(() => {
    api('/pos/bootstrap').then((b) => {
      setBoot(b);
      if (b.can?.['pos.reports']) {
        const from = new Date(); from.setHours(0, 0, 0, 0);
        api(`/pos/reports/summary?branchId=${b.branch.id}&from=${from.toISOString()}`).then(setSummary).catch(() => setSummary(null));
      }
    }).catch(() => setBoot(null));
  }, []);

  const can = (c: string) => !!boot?.can?.[c];
  const currency = boot?.currency || '';
  const s = boot?.settings || {};
  const terminals = [
    { label: 'Retail', text: 'Barcode checkout', href: '/pos/terminal', icon: ShoppingCart, on: s.retailEnabled },
    { label: 'Services', text: 'Jobs, staff and deposits', href: '/pos/terminal/services', icon: Wrench, on: s.serviceEnabled },
    { label: 'Restaurant', text: 'Tables and kitchen', href: '/pos/restaurant', icon: ChefHat, on: s.restaurantEnabled },
  ].filter((t) => t.on);
  const alerts = summary ? [
    summary.pendingReturns > 0 && { text: `${summary.pendingReturns} return(s) waiting for approval or reconciliation`, href: '/pos/returns' },
    summary.fiscalFailed > 0 && { text: `${summary.fiscalFailed} sale(s) today failed fiscalisation`, href: '/pos/transactions?fiscal=FAILED' },
    summary.pendingPayment > 0 && { text: `${summary.pendingPayment} sale(s) posted with payment not fully recorded`, href: '/pos/transactions?status=PENDING_PAYMENT' },
  ].filter(Boolean) as { text: string; href: string }[] : [];

  return (
    <div className="space-y-5">
      {can('pos.sell') && (
        <div className="grid gap-3 sm:grid-cols-3">
          {terminals.map((t) => (
            <button key={t.href} type="button" onClick={() => router.push(t.href)} className="flex items-center gap-3 rounded-2xl bg-[#003366] p-4 text-left text-white">
              <t.icon size={26} />
              <div><div className="text-[15px] font-semibold">{t.label}</div><div className="text-[12px] text-[#cbd5e1]">{t.text}</div></div>
            </button>
          ))}
          {!terminals.length && boot && <div className="text-[13px] text-[#64748b]">No POS modes are switched on for {boot.branch?.name}. Turn one on in POS settings.</div>}
        </div>
      )}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <button key={a.href} type="button" onClick={() => router.push(a.href)} className="block w-full rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-left text-[13px] text-[#92400e]">{a.text}</button>
          ))}
        </div>
      )}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Sales today', `${currency} ${summary.revenue.toFixed(2)}`],
            ['Transactions', summary.transactions],
            ['Average sale', `${currency} ${summary.average.toFixed(2)}`],
            ['Gross profit', `${currency} ${summary.grossProfit.toFixed(2)} (${summary.margin}%)`],
            ['Refunds', `${currency} ${summary.refunds.toFixed(2)}`],
            ['Open shifts', summary.openShifts],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-[#e6e9f0] bg-white p-4">
              <div className="text-[12px] text-[#64748b]">{label}</div>
              <div className="mt-1 text-[20px] font-semibold text-[#171a2e]">{value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {LINKS.filter(([, , , perm]) => !boot || can(perm)).map(([label, href, text]) => (
          <button key={href} type="button" onClick={() => router.push(href)} className="rounded-2xl border border-[#e6e9f0] bg-white p-4 text-left">
            <div className="text-[14px] font-semibold text-[#003366]">{label}</div>
            <div className="mt-1 text-[13px] text-[#64748b]">{text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
