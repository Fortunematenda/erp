'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-store';
import { ErpShell } from '@/components/erp-shell';

function MinimalLoader() {
  return (
    <div className="min-h-screen flex bg-[#f5f6fa]" role="status" aria-live="polite">
      <div className="hidden md:block w-[252px] shrink-0 bg-[#003366]" />
      <div className="flex-1 p-6 md:p-8">
        <div className="h-5 w-40 rounded bg-white mb-2" />
        <div className="h-3 w-56 rounded bg-white/80 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[108px] rounded-xl bg-white" />)}
        </div>
        <span className="sr-only">Loading workspace</span>
      </div>
    </div>
  );
}

// Central protected layout guard. Only three states are possible:
//  - initializing: session is being restored silently — show a subtle loader.
//  - unauthenticated: real logout/expiry — redirect to /login.
//  - authenticated: render the ERP shell, preserving the current route.
export function ProtectedArea({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status);
  const token = useAuth((s) => s.token);
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      const current = window.location.pathname + window.location.search;
      const params = new URLSearchParams();
      // A token still present but status unauthenticated = genuine session expiry
      // (not a normal refresh or an explicit sign-out, which clears the token).
      if (token) params.set('expired', '1');
      // Preserve the intended destination so login can return the user there.
      if (current && current !== '/') params.set('returnTo', current);
      const qs = params.toString();
      router.replace(qs ? `/login?${qs}` : '/login');
    }
  }, [status, router, token]);

  if (status !== 'authenticated' || !token) return <MinimalLoader />;
  return <ErpShell>{children}</ErpShell>;
}
