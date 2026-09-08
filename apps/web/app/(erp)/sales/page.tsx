'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Table, Typography } from 'antd';
import { DollarOutlined, FileDoneOutlined, RiseOutlined, ShoppingCartOutlined, TeamOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { StatCard } from '@/components/stat-card';
import { StatusTag } from '@/components/crud-page';
import { fmtDate, fmtMoney } from '@/lib/format';

const quickLinks = [
  { href: '/sales/customers', label: 'Customers', desc: 'Manage customer accounts & credit', icon: <TeamOutlined />, color: '#0b4a8f' },
  { href: '/sales/quotations', label: 'Quotations', desc: 'Draft & convert quotes to orders', icon: <RiseOutlined />, color: '#0ea5e9' },
  { href: '/sales/orders', label: 'Orders', desc: 'Confirmed sales orders pipeline', icon: <ShoppingCartOutlined />, color: '#8b5cf6' },
  { href: '/sales/invoices', label: 'Invoices', desc: 'Issue and post sales invoices', icon: <FileDoneOutlined />, color: '#10b981' },
  { href: '/sales/receipts', label: 'Receipts', desc: 'Record customer payments', icon: <DollarOutlined />, color: '#f59e0b' },
];

export default function SalesDashboard() {
  const router = useRouter();
  const invoices = useQuery({ queryKey: ['/sales/invoices'], queryFn: () => api('/sales/invoices') });
  const receipts = useQuery({ queryKey: ['/sales/receipts'], queryFn: () => api('/sales/receipts') });
  const customers = useQuery({ queryKey: ['/sales/customers'], queryFn: () => api('/sales/customers') });
  const quotations = useQuery({ queryKey: ['/sales/quotations'], queryFn: () => api('/sales/quotations') });
  const orders = useQuery({ queryKey: ['/sales/sales-orders'], queryFn: () => api('/sales/sales-orders') });

  const totalInvoiced = (invoices.data || []).reduce((s: number, r: any) => s + Number(r.total), 0);
  const totalReceived = (receipts.data || []).reduce((s: number, r: any) => s + Number(r.amount), 0);
  const outstanding = Math.max(0, totalInvoiced - totalReceived);
  const openQuotes = (quotations.data || []).filter((r: any) => r.status === 'DRAFT').length;
  const confirmedOrders = (orders.data || []).filter((r: any) => r.status === 'CONFIRMED').length;

  // Latest 3, newest first (server already returns newest-first; sort defensively by doc date).
  const recentInvoices = useMemo(() => [...(invoices.data || [])].sort((a: any, b: any) => new Date(b.invoiceDate || b.createdAt).getTime() - new Date(a.invoiceDate || a.createdAt).getTime()).slice(0, 3), [invoices.data]);
  const recentReceipts = useMemo(() => [...(receipts.data || [])].sort((a: any, b: any) => new Date(b.receiptDate || b.createdAt).getTime() - new Date(a.receiptDate || a.createdAt).getTime()).slice(0, 3), [receipts.data]);
  const recentQuotes = useMemo(() => (quotations.data || []).filter((r: any) => String(r.status || '').toUpperCase() === 'DRAFT').sort((a: any, b: any) => new Date(b.quotationDate || b.createdAt).getTime() - new Date(a.quotationDate || a.createdAt).getTime()).slice(0, 3), [quotations.data]);

  const row = (url: string) => ({ onClick: () => router.push(url), className: 'cursor-pointer' });
  const openDoc = (tip: string, url: string) => <Link href={url} className="font-mono text-[12px] text-[#003366] font-semibold hover:text-[#0b4a8f] hover:underline" onClick={(e) => e.stopPropagation()}>{tip}</Link>;

  return (
    <div className="nex-fade">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<FileDoneOutlined />} label="Total invoiced" value={fmtMoney(totalInvoiced)} color="#003366" hint={`${invoices.data?.length || 0} invoices`} />
        <StatCard icon={<DollarOutlined />} label="Collected" value={fmtMoney(totalReceived)} color="#10b981" hint={`${receipts.data?.length || 0} receipts`} />
        <StatCard icon={<ShoppingCartOutlined />} label="Outstanding" value={fmtMoney(outstanding)} color="#f59e0b" hint="To be collected" />
        <StatCard icon={<TeamOutlined />} label="Customers" value={customers.data?.length || 0} color="#0ea5e9" hint={`${openQuotes} draft quotes · ${confirmedOrders} confirmed orders`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <Card className="nex-card" title="Recent invoices" extra={<Link href="/sales/invoices"><Button type="link" size="small">View all</Button></Link>} styles={{ body: { padding: 0 } }}>
          <Table size="small" rowKey="id" dataSource={recentInvoices} pagination={false} onRow={(r: any) => row(`/sales/invoices/${r.id}/edit`)} columns={[
            { title: 'Invoice', dataIndex: 'invoiceNo', render: (v, r: any) => openDoc(v, `/sales/invoices/${r.id}/edit`) },
            { title: 'Customer', render: (_, r: any) => r.customer?.name || 'Cash' },
            { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => fmtMoney(v) },
            { title: 'Status', dataIndex: 'status', width: 100, render: (v) => <StatusTag value={v} /> },
          ]} />
        </Card>
        <Card className="nex-card" title="Recent receipts" extra={<Link href="/sales/receipts"><Button type="link" size="small">View all</Button></Link>} styles={{ body: { padding: 0 } }}>
          <Table size="small" rowKey="id" dataSource={recentReceipts} pagination={false} onRow={(r: any) => row(`/sales/receipts?receipt=${r.id}`)} columns={[
            { title: 'Receipt', dataIndex: 'receiptNo', render: (v, r: any) => openDoc(v, `/sales/receipts?receipt=${r.id}`) },
            { title: 'Date', dataIndex: 'receiptDate', render: fmtDate },
            { title: 'Amount', dataIndex: 'amount', align: 'right', render: (v) => fmtMoney(v) },
          ]} />
        </Card>
        <Card className="nex-card" title="Draft quotations" extra={<Link href="/sales/quotations"><Button type="link" size="small">View all</Button></Link>} styles={{ body: { padding: 0 } }}>
          <Table size="small" rowKey="id" dataSource={recentQuotes} pagination={false} onRow={(r: any) => row(`/sales/quotations/${r.id}/edit`)} columns={[
            { title: 'Quote', dataIndex: 'quotationNo', render: (v, r: any) => openDoc(v, `/sales/quotations/${r.id}/edit`) },
            { title: 'Customer', render: (_, r: any) => r.customer?.name || '—' },
            { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => fmtMoney(v) },
          ]} />
        </Card>
      </div>

      <div>
        <Typography.Text strong className="!text-[15px]">Quick access</Typography.Text>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mt-3">
          {quickLinks.map((m) => (
            <Link key={m.href} href={m.href}>
              <div className="nex-card nex-card-hover h-full">
                <div className="flex items-center gap-4 px-5 py-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg shrink-0" style={{ background: m.color, boxShadow: `0 6px 14px ${m.color}55` }}>{m.icon}</div>
                  <div className="min-w-0">
                    <div className="font-semibold text-[14px] text-[#171a2e] truncate">{m.label}</div>
                    <div className="text-[11px] text-[#a1a6c0] leading-tight mt-0.5">{m.desc}</div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
