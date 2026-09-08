'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin?: boolean;
} | null;

export type AuthCompany = {
  id: string;
  name: string;
  tenantId?: string;
  role?: string;
};

type SessionPatch = {
  token?: string | null;
  user?: AuthUser;
  companies?: AuthCompany[];
  activeCompanyId?: string | null;
  lastCompanyId?: string | null;
  permissions?: string[];
  roles?: string[];
};

type AuthState = {
  status: AuthStatus;
  token: string | null;
  user: AuthUser;
  companies: AuthCompany[];
  activeCompanyId: string | null;
  lastCompanyId: string | null;
  permissions: string[];
  roles: string[];
  setSession: (patch: SessionPatch) => void;
  setStatus: (status: AuthStatus) => void;
  logout: () => void;
};

export const useAuth = create<AuthState>()(persist(
  (set) => ({
    status: 'initializing',
    token: null,
    user: null,
    companies: [],
    activeCompanyId: null,
    lastCompanyId: null,
    permissions: [],
    roles: [],
    setSession: (patch) => set((s) => ({
      token: patch.token !== undefined ? patch.token : s.token,
      user: patch.user !== undefined ? patch.user : s.user,
      companies: patch.companies !== undefined ? patch.companies : s.companies,
      activeCompanyId: patch.activeCompanyId !== undefined ? patch.activeCompanyId : s.activeCompanyId,
      lastCompanyId: patch.lastCompanyId !== undefined ? patch.lastCompanyId : s.lastCompanyId,
      permissions: patch.permissions !== undefined ? patch.permissions : s.permissions,
      roles: patch.roles !== undefined ? patch.roles : s.roles,
    })),
    setStatus: (status) => set({ status }),
    logout: () => set({
      status: 'unauthenticated',
      token: null,
      user: null,
      companies: [],
      activeCompanyId: null,
      permissions: [],
      roles: [],
    }),
  }),
  {
    name: 'nex-auth',
    partialize: (s) => ({ lastCompanyId: s.lastCompanyId }),
  },
));

let bootstrapped = false;

export async function bootstrapSession() {
  if (bootstrapped) return;
  bootstrapped = true;
  const { api } = await import('./api');
  try {
    const last = useAuth.getState().lastCompanyId;
    const qs = last ? `?companyId=${encodeURIComponent(last)}` : '';
    const r: any = await api(`/auth/session${qs}`);
    if (r?.authenticated && r.token) {
      const activeId = r.activeCompany?.id || r.companies?.[0]?.id || null;
      useAuth.getState().setSession({
        token: r.token,
        user: r.user,
        companies: r.companies || [],
        activeCompanyId: activeId,
        lastCompanyId: activeId,
        permissions: r.permissions || [],
        roles: r.roles || [],
      });
      useAuth.getState().setStatus('authenticated');
      return;
    }
  } catch {
    // No cookie / expired refresh — treat as signed out.
  }
  useAuth.getState().setStatus('unauthenticated');
}
