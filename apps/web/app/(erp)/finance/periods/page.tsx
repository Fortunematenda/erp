'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Drawer, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { ReloadOutlined, CheckCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { FinanceSummaryCard } from '@/components/finance-ui';

const STATUS_TONE: Record<string, [string, string]> = { FUTURE: ['#f2f4f7', '#475467'], OPEN: ['#eef4ff', '#1d4ed8'], SOFT_CLOSED: ['#fffbeb', '#92400e'], CLOSED: ['#f2f4f7', '#171a2e'], LOCKED: ['#1f2937', '#fff'] };
function StatusPill(s: string) { const [bg, fg] = STATUS_TONE[s] || STATUS_TONE.OPEN; return <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: bg, color: fg }}>{s.replace(/_/g, ' ')}</span>; }
function checkIcon(status: string) { return status === 'FAIL' ? <Tag icon={<CloseCircleOutlined />} color="red" style={{ borderRadius: 6 }}>BLOCKING</Tag> : <Tag icon={<CheckCircleOutlined />} color="green" style={{ borderRadius: 6 }}>Pass</Tag>; }

function PeriodDrawer({ open, period, onClose, refresh }: { open: boolean; period: any; onClose: () => void; refresh: () => void }) {
  const qc = useQueryClient();
  const checklist = useQuery({ queryKey: ['/finance/periods/checklist', period?.id], queryFn: () => api(`/finance/periods/${period.id}/close-checklist`), enabled: !!period });
  const [opening, setOpening] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cl = checklist.data;
  const blocking = cl?.blocking ?? 0;

  async function act(action: 'soft-close' | 'close') {
    setOpening(true);
    try { await api(`/finance/periods/${period.id}/${action}`, { method: 'POST' }); message.success(action === 'close' ? 'Period closed' : 'Period soft-closed'); refresh(); qc.invalidateQueries({ queryKey: ['/finance/periods/checklist'] }); onClose(); }
    catch (e: any) { message.error(e.message); } finally { setOpening(false); }
  }
  async function reopen() {
    if (!reason.trim()) { message.warning('A reason is required to reopen'); return; }
    setOpening(true);
    try { await api(`/finance/periods/${period.id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }); message.success('Period reopened'); setReopenOpen(false); setReason(''); refresh(); qc.invalidateQueries({ queryKey: ['/finance/periods/checklist'] }); onClose(); }
    catch (e: any) { message.error(e.message); } finally { setOpening(false); }
  }

  return (
    <Drawer open={open} onClose={onClose} width={620} destroyOnHidden title={<span>{period?.name}<span className="text-[#a1a6c0] font-normal"> · {period ? dayjs(period.startDate).format('D MMM YYYY') : ''} – {period ? dayjs(period.endDate).format('D MMM YYYY') : ''}</span></span>}>
      {period && (
        <Tabs items={[
          { key: 'overview', label: 'Overview', children: (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
              <Row k="Status" v={StatusPill(period.status)} />
              <Row k="Period Number" v={String(period.periodNumber)} />
              <Row k="Start Date" v={dayjs(period.startDate).format('D MMM YYYY')} />
              <Row k="End Date" v={dayjs(period.endDate).format('D MMM YYYY')} />
              <Row k="Closed By" v={period.closedBy || '—'} />
              <Row k="Closed At" v={period.closedAt ? dayjs(period.closedAt).format('D MMM YYYY HH:mm') : '—'} />
            </div>
          ) },
          { key: 'checklist', label: 'Close Checklist', children: cl ? (
            <div>
              <div className="flex items-center gap-3 mb-4 text-[13px]"><span className="font-semibold" style={{ color: blocking ? '#b42318' : '#047857' }}>{cl.passed}/{cl.total} checks passed</span>{blocking > 0 && <Tag color="red" style={{ borderRadius: 6 }}>{blocking} blocking</Tag>}</div>
              <div className="space-y-2">
                {cl.checks.map((c: any) => (
                  <div key={c.code} className="flex items-start gap-2 rounded-lg border border-[#f2f3f9] px-3 py-2.5">
                    {checkIcon(c.status)}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-[#171a2e]">{c.label}</div>
                      <div className="text-[12px] text-[#98A2B3]">{c.message}</div>
                    </div>
                    {c.actionRoute && <Link href={c.actionRoute} className="text-[12px] text-[#175CD3] hover:underline">Open</Link>}
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="text-[#a1a6c0] text-[13px] py-8 text-center">Loading close readiness…</div> },
        ]} />
      )}
      <div className="flex items-center gap-2 mt-5 pt-4 border-t border-[#f2f3f9]">
        {period?.status === 'OPEN' && <><Button onClick={() => act('soft-close')} loading={opening}>Soft Close</Button><Button type="primary" disabled={blocking > 0} onClick={() => act('close')} loading={opening}>Close Period</Button></>}
        {period?.status === 'SOFT_CLOSED' && <Button type="primary" disabled={blocking > 0} onClick={() => act('close')} loading={opening}>Final Close</Button>}
        {period?.status === 'CLOSED' && <Button danger onClick={() => setReopenOpen(true)}>Reopen</Button>}
      </div>
      <Modal open={reopenOpen} onCancel={() => setReopenOpen(false)} onOk={reopen} okText="Reopen" confirmLoading={opening} title="Reopen Period"><p className="text-[13px] text-[#667085]">Reopening can change previously issued statements and may affect the next period's opening balances. Enter a reason.</p><Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reopening (required)" /></Modal>
    </Drawer>
  );
}
function Row({ k, v }: { k: string; v: any }) { return <div><div className="text-[12px] text-[#98A2B3]">{k}</div><div className="font-medium text-[#334155]">{v}</div></div>; }

export default function FinancialPeriodsPage() {
  const qc = useQueryClient();
  const years = useQuery({ queryKey: ['/finance/periods'], queryFn: () => api('/finance/periods') });
  const [yearId, setYearId] = useState<string | undefined>();
  const [view, setView] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  const yearList = years.data || [];
  const activeYear = yearList.find((y: any) => y.id === yearId) || yearList[0];
  useEffect(() => { if (yearList.length && !yearId) setYearId(yearList[0].id); }, [yearList, yearId]);
  const periods = (activeYear?.periods || []).filter((p: any) => !statusFilter || p.status === statusFilter);

  const now = dayjs();
  const currentPeriod = periodOf(activeYear?.periods, now);
  const open = (activeYear?.periods || []).filter((p: any) => p.status === 'OPEN').length;
  const closed = (activeYear?.periods || []).filter((p: any) => p.status === 'CLOSED' || p.status === 'LOCKED').length;

  function refresh() { qc.invalidateQueries({ queryKey: ['/finance/periods'] }); }

  const cols: ColumnsType<any> = [
    { title: 'Period', dataIndex: 'name', width: 140, render: (v, r) => <button onClick={() => setView(r)} className="font-medium text-left hover:text-[#003366] hover:underline">{v}{currentPeriod?.id === r.id && <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] bg-[#eef4ff] text-[#1d4ed8] font-semibold">CURRENT</span>}</button> },
    { title: 'Date Range', width: 180, render: (_v, r) => <span className="text-[#5a6080]">{dayjs(r.startDate).format('D MMM')} – {dayjs(r.endDate).format('D MMM YYYY')}</span> },
    { title: 'Status', dataIndex: 'status', width: 130, render: (v) => StatusPill(v) },
    { title: 'Closed By', dataIndex: 'closedBy', width: 130, render: (v) => v || '—' },
    { title: 'Closed At', dataIndex: 'closedAt', width: 150, render: (v) => v ? dayjs(v).format('D MMM YYYY HH:mm') : '—' },
    { title: 'Actions', width: 170, render: (_v, r) => (
      <div className="flex items-center gap-2">
        <Button size="small" onClick={() => setView(r)}>Review</Button>
        {r.status === 'OPEN' && <Button size="small" onClick={() => setView(r)}>Close</Button>}
        {r.status === 'CLOSED' && <Link href={`/finance/trial-balance?print=1`}><Button size="small">Reports</Button></Link>}
      </div>
    ) },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">Financial Periods</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Period control, month-end close and year-end accounting</p>
        </div>
        <Space wrap>
          <Select value={yearId} onChange={setYearId} className="!min-w-[140px]" options={yearList.map((y: any) => ({ label: `FY ${y.year}`, value: y.id }))} />
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
        </Space>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <FinanceSummaryCard label="Current Period" value={currentPeriod ? currentPeriod.name : '—'} valueColor="#2563eb" subtitle={currentPeriod?.status || 'N/A'} />
        <FinanceSummaryCard label="Open Periods" value={open} valueColor="#047857" subtitle="Available for posting" />
        <FinanceSummaryCard label="Closed Periods" value={closed} valueColor="#7c3aed" subtitle="Posting blocked" />
        <FinanceSummaryCard label="Year-End Status" value="In Progress" valueColor="#f59e0b" subtitle={`${(activeYear?.periods || []).filter((p: any) => p.status === 'CLOSED' || p.status === 'LOCKED').length} of ${(activeYear?.periods || []).length} periods closed`} />
      </div>

      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <Select allowClear placeholder="All Status" className="!min-w-[150px]" value={statusFilter} onChange={setStatusFilter} options={['FUTURE', 'OPEN', 'SOFT_CLOSED', 'CLOSED', 'LOCKED'].map((s) => ({ label: s.replace(/_/g, ' '), value: s }))} />
        <span className="ml-auto text-[12px] text-[#98A2B3]">{periods.length} periods · FY {activeYear?.year}</span>
      </div>

      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <Table rowKey="id" loading={years.isLoading} dataSource={periods} columns={cols} pagination={false} scroll={{ x: 900 }} size="middle" />
      </Card>

      <PeriodDrawer open={!!view} period={view} onClose={() => setView(null)} refresh={refresh} />
    </div>
  );
}

function periodOf(periods: any[] | undefined, date: any) { return (periods || []).find((p) => dayjs(date).isAfter(dayjs(p.startDate).subtract(1, 'day')) && dayjs(date).isBefore(dayjs(p.endDate).add(1, 'day'))); }
