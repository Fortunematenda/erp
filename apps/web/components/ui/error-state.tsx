'use client';

import { ERPErrorState } from '@/components/erp/erp-feedback';

/** Consistent error state with an optional Retry action. */
export function ErrorState({ title = 'Unable to load this page', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return <ERPErrorState title={title} message={message} onRetry={onRetry} />;
}
