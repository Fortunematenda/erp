'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { InvoiceForm } from '@/components/sales/sales-doc-form';

export default function NewInvoicePage() {
  const router = useRouter();
  const sp = useSearchParams();
  const customerId = sp.get('customer') || undefined;
  const projectId = sp.get('project') || undefined;
  return (
    <div className="nex-fade max-w-[1024px] mx-auto">
      <InvoiceForm initial={customerId || projectId ? { customerId, projectId } : undefined} onSaved={(id) => router.replace(id ? `/sales/invoices/${id}/edit` : '/sales/invoices')} />
    </div>
  );
}

