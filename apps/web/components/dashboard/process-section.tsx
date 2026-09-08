'use client';
import { Fragment } from 'react';
import { AnimatedFlowArrow } from './animated-flow-arrow';
import { ProcessNode } from './process-node';

type Node = { label: string; icon: React.ReactNode; href: string; accent?: string; tooltip?: string };

// A titled process section containing a linear flow of nodes separated by
// animated arrows. Arrows are direct flex children so they can stretch/shrink
// to keep all nodes on one line on desktop. direction = 'h' (left→right) or 'v'.
export function ProcessSection({ title, accent, nodes, direction = 'h' }: { title: string; accent: string; nodes: Node[]; direction?: 'h' | 'v' }) {
  return (
    <div className="nex-process-section">
      <div className="text-[11px] uppercase tracking-[0.08em] font-semibold" style={{ color: accent }}>{title}</div>
      <div className={`nex-process-flow mt-2 ${direction === 'v' ? 'nex-process-flow-v' : ''}`}>
        {nodes.map((n, i) => (
          <Fragment key={n.label}>
            {i > 0 && <AnimatedFlowArrow direction={direction} color={accent} />}
            <ProcessNode label={n.label} icon={n.icon} href={n.href} accent={n.accent || accent} tooltip={n.tooltip} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
