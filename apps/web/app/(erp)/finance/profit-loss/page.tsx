'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProfitLossPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/finance/reports?report=profit-loss'); }, [router]);
  return null;
}
