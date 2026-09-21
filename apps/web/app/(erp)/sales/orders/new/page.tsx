'use client';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { SalesOrderForm } from '@/components/sales/sales-order-form';

function useQp() {
  const sp = useSearchParams();
  return { customerId: sp.get('customerId') || undefined, sourceQuoteId: sp.get('sourceQuoteId') || undefined };
}

export default function NewSalesOrderPage() {
  const router = useRouter();
  const { customerId, sourceQuoteId } = useQp();
  return (
    <div className="nex-fade">
      <SalesOrderForm onSaved={(id) => router.push(`/sales/orders/${id}/edit`)} initial={{ customerId, sourceQuoteId }} />
    </div>
  );
}
