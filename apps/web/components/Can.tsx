'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';

export function useAuthPermissions() {
  const { permissions: cached, roles: cachedRoles, status } = useAuth();
  const hasCached = cached.length > 0;
  // RBAC is restored during session bootstrap, so prefer the cached set to avoid
  // briefly rendering with zero permissions. Fall back to the endpoint if empty.
  const q = useQuery({
    queryKey: ['auth-permissions'],
    queryFn: () => api('/auth/permissions'),
    enabled: !hasCached && status === 'authenticated',
    staleTime: 60_000,
  });
  const permissions = q.data?.permissions || cached;
  const roles = q.data?.roles || cachedRoles;
  return { permissions, roles, isLoading: status !== 'authenticated' || (!hasCached && q.isLoading) };
}

export function Can({ permission, children, fallback }: { permission: string | string[]; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { permissions, isLoading } = useAuthPermissions();
  if (isLoading) return null;
  const ok = Array.isArray(permission) ? permission.some((p) => permissions.includes(p)) : permissions.includes(permission);
  return ok ? <>{children}</> : <>{fallback || null}</>;
}
