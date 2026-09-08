'use client';
import { Children, useEffect, useState } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';

const AUTOPLAY_MS = 20000; // 20 seconds

// Two-slide dashboard carousel. Slide 0 (Business Performance / Fiscalisation)
// always shows first. A single controlled timer advances every 20s; it is cleared
// and restarted on any index change (manual or auto), paused on hover/focus, and
// paused when the tab is hidden. No overlapping timers.
export function DashboardFeatureSlider({ children }: { children: React.ReactNode }) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    setHidden(document.hidden);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (paused || hidden || n <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % n), AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [index, paused, hidden, n]);

  const go = (i: number) => setIndex(((i % n) + n) % n);

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div key={index} className="nex-slide-in">{slides[index]}</div>
      {n > 1 && (
        <>
          <button type="button" className="nex-slider-arrow nex-slider-arrow-left" onClick={() => go(index - 1)} aria-label="Previous slide"><LeftOutlined /></button>
          <button type="button" className="nex-slider-arrow nex-slider-arrow-right" onClick={() => go(index + 1)} aria-label="Next slide"><RightOutlined /></button>
          <div className="nex-slider-dots">
            {slides.map((_, i) => (
              <button key={i} type="button" className={`nex-slider-dot ${i === index ? 'active' : ''}`} onClick={() => go(i)} aria-label={`Go to slide ${i + 1}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
