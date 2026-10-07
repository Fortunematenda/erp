import type { ThemeConfig } from 'antd';

/**
 * NexuERP visual tokens.
 * Light values are active. Dark values are defined so a later theme switch
 * can map the same names without hunting hardcoded colours.
 */
export const erpColor = {
  light: {
    primary: '#003366',
    primaryHover: '#0b4a8f',
    accent: '#0b4a8f',
    bg: '#f6f7fb',
    bgElevated: '#ffffff',
    bgSubtle: '#f8f9fc',
    border: '#e4e7ee',
    borderStrong: '#cbd2de',
    text: '#171a2e',
    textMuted: '#5c6578',
    textFaint: '#8b93a7',
    success: '#15803d',
    warning: '#b45309',
    error: '#dc2626',
    info: '#0369a1',
  },
  dark: {
    primary: '#8eb4e8',
    primaryHover: '#b7cff5',
    accent: '#8eb4e8',
    bg: '#0f1218',
    bgElevated: '#171b22',
    bgSubtle: '#1e242e',
    border: '#2a3140',
    borderStrong: '#3a4456',
    text: '#eef1f6',
    textMuted: '#a7b0c0',
    textFaint: '#7d8798',
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#7dd3fc',
  },
} as const;

export const erpRadius = {
  control: 8,
  card: 12,
  overlay: 16,
} as const;

export const erpAntdTheme: ThemeConfig = {
  token: {
    colorPrimary: erpColor.light.primary,
    colorInfo: erpColor.light.info,
    colorLink: erpColor.light.primary,
    colorSuccess: erpColor.light.success,
    colorWarning: erpColor.light.warning,
    colorError: erpColor.light.error,
    colorText: erpColor.light.text,
    colorTextSecondary: erpColor.light.textMuted,
    colorTextPlaceholder: erpColor.light.textFaint,
    colorBorder: erpColor.light.borderStrong,
    colorBorderSecondary: erpColor.light.border,
    colorBgLayout: erpColor.light.bg,
    colorBgContainer: erpColor.light.bgElevated,
    colorBgElevated: erpColor.light.bgElevated,
    borderRadius: erpRadius.control,
    borderRadiusSM: 6,
    borderRadiusLG: erpRadius.card,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: 13,
    controlHeight: 36,
    controlOutline: 'rgba(0, 51, 102, 0.12)',
    controlOutlineWidth: 2,
    motionDurationFast: '0.12s',
    motionDurationMid: '0.16s',
    motionDurationSlow: '0.2s',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    boxShadowSecondary: '0 8px 24px rgba(15, 23, 42, 0.08)',
  },
  components: {
    Button: {
      primaryShadow: 'none',
      fontWeight: 600,
      borderRadius: erpRadius.control,
      controlHeight: 36,
    },
    Card: { paddingLG: 20, borderRadiusLG: erpRadius.card },
    Table: {
      headerBg: erpColor.light.bgSubtle,
      headerColor: erpColor.light.textMuted,
      headerSplitColor: erpColor.light.border,
      rowHoverBg: '#f4f7fb',
      borderColor: erpColor.light.border,
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
    },
    Menu: { itemHeight: 36, itemBorderRadius: 8 },
    Modal: { borderRadiusLG: erpRadius.overlay },
    Drawer: { paddingLG: 20 },
    Tag: { borderRadiusSM: 6 },
    Input: {
      activeBorderColor: erpColor.light.primary,
      hoverBorderColor: '#94a3b8',
      activeShadow: '0 0 0 3px rgba(0, 51, 102, 0.10)',
    },
    Select: { optionSelectedBg: '#eef3f8' },
    Tabs: { horizontalMargin: '0 0 16px 0' },
  },
};
