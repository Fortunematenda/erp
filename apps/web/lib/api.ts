const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

function nestMessage(body: any, fallback: string) {
  const m = body?.message;
  if (Array.isArray(m)) return m.filter(Boolean).join(' ');
  if (typeof m === 'string' && m.trim()) return m;
  if (typeof body?.error === 'string' && body.error.trim()) return body.error;
  return fallback;
}

export async function api(path: string, init: RequestInit = {}) {
  const { useAuth } = await import('./auth-store');
  const token = useAuth.getState().token;
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  const text = await res.text();
  let body: any = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/session') && !path.startsWith('/auth/login')) {
      const { useAuth: auth } = await import('./auth-store');
      if (auth.getState().status === 'authenticated') auth.getState().setStatus('unauthenticated');
    }
    throw new Error(nestMessage(body, res.statusText || `Request failed (${res.status})`));
  }
  return body;
}
