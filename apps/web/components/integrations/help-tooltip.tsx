'use client';
import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

// Shared help-tooltip used across Integrations, Fiscalisation, Bank
// configuration, Payment Gateway, Email, Storage and Queue screens.
// Accessible via mouse hover AND keyboard focus (antd Tooltip handles focus).
export function HelpTooltip({ text, width }: { text: string; width?: number }) {
  return (
    <Tooltip
      title={<span style={{ display: 'block', width: width || 260, lineHeight: 1.6 }}>{text}</span>}
      placement="top"
      styles={{ root: { maxWidth: 360 } }}
    >
      <QuestionCircleOutlined
        tabIndex={0}
        aria-label="Help"
        className="ml-1 inline-flex items-center text-[13px] align-middle cursor-help"
        style={{ color: '#94a3b8' }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.blur(); }}
      />
    </Tooltip>
  );
}

export default HelpTooltip;
