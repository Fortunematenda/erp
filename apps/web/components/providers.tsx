'use client';
import '@ant-design/v5-patch-for-react-19';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import { useState } from 'react';
import { AuthProvider } from '@/components/auth-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            borderRadius: 10,
            borderRadiusLG: 14,
            colorPrimary: '#003366',
            colorInfo: '#003366',
            colorLink: '#003366',
            colorSuccess: '#10b981',
            colorWarning: '#f59e0b',
            colorError: '#ef4444',
            colorText: '#171a2e',
            colorTextSecondary: '#5a6080',
            colorBgLayout: '#f5f6fa',
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
            controlHeight: 40,
            boxShadow: '0 12px 40px rgba(23,26,46,.14)',
          },
          components: {
            Button: { primaryShadow: '0 6px 16px rgba(0,51,102,.35)', fontWeight: 600, borderRadius: 10 },
            Card: { paddingLG: 22, borderRadiusLG: 14 },
            Table: { headerBg: '#f8f9fd', headerColor: '#4b5167', headerSplitColor: '#eef0f6', rowHoverBg: '#f6f7ff', borderColor: '#eef0f6' },
            Menu: { itemHeight: 40, itemBorderRadius: 10 },
            Modal: { borderRadiusLG: 16 },
            Tag: { borderRadiusSM: 8 },
            Segmented: { itemSelectedBg: '#fff' },
            Input: { activeShadow: '0 0 0 3px rgba(0,51,102,.18)' },
            Select: { optionSelectedBg: '#eef0ff' },
          },
        }}
      >
        <AntApp><AuthProvider>{children}</AuthProvider></AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
