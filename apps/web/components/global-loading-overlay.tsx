'use client';
import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';

/**
 * Global blocking loading overlay. Shown while any backend request (query fetch
 * or mutation/action) is in flight so users cannot keep clicking. A short delay
 * avoids flicker on fast responses; once shown it stays a minimum duration for a
 * smooth feel. Covers the whole viewport (and drawers/modals).
 */
export function GlobalLoadingOverlay() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const active = fetching > 0 || mutating > 0;
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    if (active) {
      showTimer = setTimeout(() => { shownAt.current = Date.now(); setVisible(true); }, 220);
    } else if (visible) {
      const elapsed = Date.now() - shownAt.current;
      hideTimer = setTimeout(() => setVisible(false), Math.max(0, 420 - elapsed));
    }
    return () => { if (showTimer) clearTimeout(showTimer); if (hideTimer) clearTimeout(hideTimer); };
  }, [active, visible]);

  if (!visible) return null;
  return (
    <div className="nex-loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="nex-loading-card">
        <span className="nex-spinner" aria-hidden />
        <span className="nex-loading-text">{mutating > 0 ? 'Processing…' : 'Loading…'}</span>
      </div>
    </div>
  );
}
