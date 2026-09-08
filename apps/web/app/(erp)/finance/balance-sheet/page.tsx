'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BalanceSheetPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/finance/reports?report=balance-sheet'); }, [router]);
  return null;
}
