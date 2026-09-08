import './globals.css';
import { Providers } from '@/components/providers';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'NexusERP Cloud',
  description: 'Multi-tenant ERP SaaS',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#003366',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
