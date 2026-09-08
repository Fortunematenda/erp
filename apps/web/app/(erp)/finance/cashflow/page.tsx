'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CashflowPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/finance/reports?report=cash-flow'); }, [router]);
  return null;
}
