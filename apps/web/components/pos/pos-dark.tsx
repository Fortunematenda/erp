'use client';

import { ConfigProvider, theme, type ThemeConfig } from 'antd';

/** The app theme pins light colour tokens, so the dark algorithm alone leaves inputs and overlays white. */
function darkTheme(accent: string): ThemeConfig {
  return {
    algorithm: theme.darkAlgorithm,
    token: {
      colorPrimary: accent,
      colorLink: accent,
      colorInfo: accent,
      colorText: '#e5e7eb',
      colorTextSecondary: '#9ca3af',
      colorTextPlaceholder: '#6b7280',
      colorBorder: '#2f3542',
      colorBorderSecondary: '#262b35',
      colorBgLayout: '#0b0d12',
      colorBgContainer: '#1c1f26',
      colorBgElevated: '#1f232c',
      controlOutline: 'rgba(255, 255, 255, 0.08)',
      boxShadowSecondary: '0 12px 32px rgba(0, 0, 0, 0.5)',
      borderRadius: 10,
    },
    components: {
      Table: { headerBg: '#1c1f26', headerColor: '#9ca3af', headerSplitColor: '#262b35', rowHoverBg: '#232836', borderColor: '#262b35' },
      Select: { optionSelectedBg: '#2a2f3a' },
      Input: { activeBorderColor: accent, hoverBorderColor: '#4b5563', activeShadow: 'none' },
    },
  };
}

export function PosDark({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <ConfigProvider theme={darkTheme(accent)} modal={{ classNames: { wrapper: 'pos-dark-overlay' } }} drawer={{ classNames: { wrapper: 'pos-dark-overlay' } }}>
      <div className="pos-dark contents">{children}</div>
    </ConfigProvider>
  );
}
