'use client';
import '@ant-design/v5-patch-for-react-19';
import { QueryClient, QueryClientProvider, keepPreviousData } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/components/auth-provider';
import { GlobalLoadingOverlay } from '@/components/global-loading-overlay';
import { erpAntdTheme } from '@/lib/erp-theme';
import { SonnerMessageBridge } from '@/components/sonner-message-bridge';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, gcTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1, placeholderData: keepPreviousData } } }));
  return (
    <QueryClientProvider client={client}>
      <ConfigProvider theme={erpAntdTheme}>
        <AntApp>
          <SonnerMessageBridge />
          <AuthProvider>{children}</AuthProvider>
          <Toaster
            position="top-right"
            closeButton
            expand
            visibleToasts={4}
            gap={10}
            offset={16}
            toastOptions={{
              classNames: {
                toast: 'nex-toast',
                title: 'nex-toast-title',
                description: 'nex-toast-desc',
                actionButton: 'nex-toast-action',
                closeButton: 'nex-toast-close',
              },
            }}
          />
        </AntApp>
      </ConfigProvider>
      <GlobalLoadingOverlay />
    </QueryClientProvider>
  );
}
