'use client';
import { ArrowDownOutlined, ArrowRightOutlined } from '@ant-design/icons';

// Animated connector between process steps. The dashes continuously flow in the
// direction of travel (CSS: moving background-position). Respects reduced motion.
export function AnimatedFlowArrow({ direction, color = '#003366' }: { direction: 'h' | 'v'; color?: string }) {
  if (direction === 'v') {
    return (
      <div className="flow-arrow-v" aria-hidden="true" style={{ color }}>
        <span className="flow-dash-v" />
        <ArrowDownOutlined style={{ fontSize: 12 }} />
      </div>
    );
  }
  return (
    <div className="flow-arrow-h" aria-hidden="true" style={{ color }}>
      <span className="flow-dash-h" />
      <ArrowRightOutlined style={{ fontSize: 12 }} />
    </div>
  );
}
