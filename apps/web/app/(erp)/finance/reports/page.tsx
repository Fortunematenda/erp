'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FinancialReports } from '@/components/finance/financial-reports';

const KEY_TO_TAB: Record<string, string> = { 'profit-loss': 'pnl', 'balance-sheet': 'bs', cashflow: 'cashflow', 'budget-vs-actual': 'variance' };
const TAB_TO_KEY: Record<string, string> = { pnl: 'profit-loss', bs: 'balance-sheet', cashflow: 'cashflow', variance: 'budget-vs-actual' };

function ReportsInternal() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = KEY_TO_TAB[sp.get('report') || 'profit-loss'] || 'pnl';
  const [active, setActive] = useState(initial);

  useEffect(() => {
    const want = KEY_TO_TAB[sp.get('report') || 'profit-loss'] || 'pnl';
    if (want !== active) setActive(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.get('report')]);

  return <FinancialReports active={active} onActiveChange={(k) => router.replace(`/finance/reports?report=${TAB_TO_KEY[k]}`)} />;
}

export default function ReportsPage() {
  return <Suspense fallback={null}><ReportsInternal /></Suspense>;
}
