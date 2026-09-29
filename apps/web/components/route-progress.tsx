'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Thin navy progress bar shown at the very top of the ERP while a route
 * transition is in progress. Starts immediately on internal link clicks and
 * finishes when the new route has rendered. Never blocks the interface.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = e.target as HTMLElement | null;
      const a = el?.closest?.('a') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || a.getAttribute('target') === '_blank') return;
      const dest = href.split('?')[0];
      if (dest === window.location.pathname) return; // same page (e.g. tab query change)
      start();
    }
    // Programmatic navigation (sidebar, flyout, quick access, table links) dispatches this.
    function onNavigate() { start(); }
    document.addEventListener('click', onClick, true);
    document.addEventListener('nex:navigate', onNavigate as EventListener);
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('nex:navigate', onNavigate as EventListener); };
  }, []);

  function start() {
    setActive(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setActive(false), 10000); // safety: never stick
  }

  useEffect(() => {
    // Route committed — hide the bar (with a tiny delay to avoid flicker on fast nav).
    if (timer.current) clearTimeout(timer.current);
    const t = setTimeout(() => setActive(false), 120);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!active) return null;
  return <div className="nex-route-progress" role="progressbar" aria-label="Loading"><div className="bar" /></div>;
}
