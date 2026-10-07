'use client';

import { useEffect } from 'react';
import { App, message as staticMessage } from 'antd';
import { notify } from '@/lib/notify';
import { setConfirmApi } from '@/components/erp/erp-overlay';

type Kind = 'success' | 'error' | 'warning' | 'info';

function textOf(content: unknown): string {
  if (typeof content === 'string' || typeof content === 'number') return String(content);
  if (content && typeof content === 'object' && 'content' in content) {
    const inner = (content as { content?: unknown }).content;
    if (typeof inner === 'string' || typeof inner === 'number') return String(inner);
  }
  return '';
}

function bind(api: object) {
  const target = api as Partial<Record<Kind, (...args: unknown[]) => unknown>>;
  (['success', 'error', 'warning', 'info'] as Kind[]).forEach((kind) => {
    target[kind] = (content: unknown, ...rest: unknown[]) => {
      const text = textOf(content);
      if (text) notify[kind](text);
      const onClose = rest.find((item) => typeof item === 'function') as (() => void) | undefined;
      onClose?.();
      return Promise.resolve();
    };
  });
}

/** Sends Ant Design message calls through Sonner so the app has one toast. */
export function SonnerMessageBridge() {
  const { message, modal } = App.useApp();
  useEffect(() => {
    bind(message);
    bind(staticMessage);
    setConfirmApi(modal);
  });
  return null;
}
