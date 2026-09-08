'use client';
import { PageHeader } from '@/components/page';
import { TemplateDesigner } from '@/components/template-designer/template-designer';

export default function InvoiceTemplate() {
  return (<><PageHeader title="Invoice Template Designer" subtitle="Customise the professional invoice document — branding, layout, labels, columns, totals, notes and footer. Independent from the quotation template." /><TemplateDesigner type="invoice" /></>);
}

