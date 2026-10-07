import type { Preview } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { erpAntdTheme } from '../lib/erp-theme';
import '../app/globals.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <ConfigProvider theme={erpAntdTheme}>
          <div style={{ background: '#f6f7fb', padding: 24, minHeight: 240 }}>
            <Story />
          </div>
        </ConfigProvider>
      </QueryClientProvider>
    ),
  ],
};

export default preview;
