'use client';
import { useEffect, useRef, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';

/**
 * Thin progress bar for writes (save, post, delete). Route changes use
 * RouteProgress. Background query refreshes stay silent so cached pages
 * do not flash a bar every time data is revalidated.
 */
export function GlobalLoadingOverlay() {
  const mutating = useIsMutating();
  const active = mutating > 0;

  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    if (active) {
      showTimer = setTimeout(() => { shownAt.current = Date.now(); setVisible(true); }, 180);
    } else if (visible) {
      const elapsed = Date.now() - shownAt.current;
      hideTimer = setTimeout(() => setVisible(false), Math.max(0, 280 - elapsed));
    }
    return () => { if (showTimer) clearTimeout(showTimer); if (hideTimer) clearTimeout(hideTimer); };
  }, [active, visible]);

  if (!visible) return null;
  return (
    <div className="nex-loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="nex-loading-bar" />
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Processing</span>
    </div>
  );
}
