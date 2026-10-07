import type { ReactNode } from 'react';
import { ERPPageHeader } from '@/components/erp/erp-page';

export function PageHeader({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: ReactNode }) {
  return <ERPPageHeader title={title} description={subtitle} actions={extra} />;
}
