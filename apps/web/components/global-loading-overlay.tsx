'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';

/**
 * Global blocking loading overlay. Shown while any backend request (query fetch
 * or mutation/action) is in flight, and during route navigation, so users always
 * get immediate feedback and cannot keep clicking. A short delay avoids flicker on
 * fast responses; once shown it stays a minimum duration for a smooth feel.
 * Covers the whole viewport (and drawers/modals).
 */
export function GlobalLoadingOverlay() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const pathname = usePathname();
  const [navPending, setNavPending] = useState(false);
  const active = fetching > 0 || mutating > 0 || navPending;

  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  // Route navigation (sidebar, flyout, quick access, search, links) dispatches nex:navigate.
  useEffect(() => {
    let safety: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      setNavPending(true);
      if (safety) clearTimeout(safety);
      safety = setTimeout(() => setNavPending(false), 10_000); // never stick
    };
    document.addEventListener('nex:navigate', start as EventListener);
    return () => { document.removeEventListener('nex:navigate', start as EventListener); if (safety) clearTimeout(safety); };
  }, []);
  // Route committed — clear the navigation pending flag.
  useEffect(() => { setNavPending(false); }, [pathname]);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    if (active) {
      showTimer = setTimeout(() => { shownAt.current = Date.now(); setVisible(true); }, 180);
    } else if (visible) {
      const elapsed = Date.now() - shownAt.current;
      hideTimer = setTimeout(() => setVisible(false), Math.max(0, 400 - elapsed));
    }
    return () => { if (showTimer) clearTimeout(showTimer); if (hideTimer) clearTimeout(hideTimer); };
  }, [active, visible]);

  if (!visible) return null;
  return (
    <div className="nex-loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="nex-loading-bar" />
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{mutating > 0 ? 'Processing' : 'Loading'}</span>
    </div>
  );
}
