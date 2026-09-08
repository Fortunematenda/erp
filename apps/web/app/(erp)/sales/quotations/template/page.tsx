'use client';
import { PageHeader } from '@/components/page';
import { TemplateDesigner } from '@/components/template-designer/template-designer';

export default function QuoteTemplate() {
  return (<><PageHeader title="Quote Template Designer" subtitle="Customise the professional quotation document — branding, layout, labels, columns, totals, validity, acceptance and footer. Independent from the invoice template." /><TemplateDesigner type="quote" /></>);
}

