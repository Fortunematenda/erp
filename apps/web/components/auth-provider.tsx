'use client';
import { useEffect } from 'react';
import { bootstrapSession } from '@/lib/auth-store';

// Triggers the one-time, silent session restore (cookie -> /auth/session). It
// never redirects and never logs out while restoration is pending — it only
// flips status to 'authenticated' / 'unauthenticated' when resolved.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    bootstrapSession();
  }, []);
  return <>{children}</>;
}
