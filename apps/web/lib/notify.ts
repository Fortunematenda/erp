'use client';
import { toast as sonner } from 'sonner';

type ToastOpts = { description?: string; duration?: number; action?: { label: string; onClick: () => void } };

function parseMessage(text: string): { title: string; description?: string } {
  const t = String(text || '').trim();
  if (!t) return { title: 'Something went wrong' };
  // "Title — details..." (API style)
  const dash = t.match(/^(.{8,90}?)\s*[—–]\s+(.+)$/s);
  if (dash) return { title: dash[1].trim(), description: dash[2].trim() };
  // Long single paragraph → first sentence as title
  if (t.length > 100) {
    const i = t.indexOf('. ');
    if (i > 24 && i < 110) return { title: t.slice(0, i + 1), description: t.slice(i + 2).trim() };
  }
  return { title: t };
}

function show(kind: 'success' | 'error' | 'warning' | 'info', text: string, opts?: ToastOpts) {
  const parsed = parseMessage(text);
  const description = opts?.description ?? parsed.description;
  const duration = opts?.duration ?? (kind === 'error' ? 8_000 : 4_000);
  const action = opts?.action ? { label: opts.action.label, onClick: opts.action.onClick } : undefined;
  const payload = { description, duration, action };

  if (kind === 'success') return sonner.success(parsed.title, payload);
  if (kind === 'error') return sonner.error(parsed.title, payload);
  if (kind === 'warning') return sonner.warning(parsed.title, payload);
  return sonner.info(parsed.title, payload);
}

/** Professional system toasts (Sonner). Prefer this over Ant Design `message`. */
export const notify = {
  success: (text: string, opts?: ToastOpts) => show('success', text, opts),
  error: (text: string, opts?: ToastOpts) => show('error', text, opts),
  warning: (text: string, opts?: ToastOpts) => show('warning', text, opts),
  info: (text: string, opts?: ToastOpts) => show('info', text, opts),
  /** Drop-in for Ant Design `message` API used across the app. */
  message: {
    success: (text: string) => show('success', String(text)),
    error: (text: string) => show('error', String(text)),
    warning: (text: string) => show('warning', String(text)),
    info: (text: string) => show('info', String(text)),
    loading: (text: string) => sonner.loading(String(text)),
    destroy: () => sonner.dismiss(),
  },
};

export { sonner as toast };
