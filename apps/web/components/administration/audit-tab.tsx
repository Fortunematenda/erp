'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Descriptions, Drawer, Input, Select, Table, Tag, Tooltip, message, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { fmtDateTime } from '@/lib/format';
import dayjs from 'dayjs';

export function AuditTab() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<any>({});
  const [detail, setDetail] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
  qs.set('page', String(page)); qs.set('pageSize', String(pageSize));

  const q = useQuery({ queryKey: ['/admin/audit-logs', qs.toString()], queryFn: () => api(`/admin/audit-logs?${qs.toString()}`) });
  const options = useQuery({ queryKey: ['/admin/users/options'], queryFn: () => api('/admin/users/options') });

  const modules = useMemo(() => {
    const set = new Set<string>();
    (q.data?.items || []).forEach((r: any) => r.module && set.add(r.module));
    return [...set];
  }, [q.data]);

  const userOptions = useMemo(() => {
    const set = new Set<string>();
    (q.data?.items || []).forEach((r: any) => { if (r.userEmail) set.add(`${r.userEmail}`); });
    return [...set].map((e) => ({ label: e, value: e }));
  }, [q.data]);

  const columns: ColumnsType<any> = [
    { title: 'Date / Time', dataIndex: 'createdAt', width: 165, render: (v) => fmtDateTime(v) },
    {
      title: 'User', key: 'user', width: 200,
      render: (_, r) => (
        <div>
          <div className="text-[13px] font-medium text-slate-700">{r.userName}</div>
          <div className="text-[11px] text-slate-400">{r.userEmail || ''}{r.employeeNo ? ` · ${r.employeeNo}` : ''}</div>
        </div>
      ),
    },
    { title: 'Module', dataIndex: 'module', width: 110, render: (v) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—' },
    { title: 'Action', dataIndex: 'action', width: 180, render: (v) => <span className="font-mono text-[11.5px] text-slate-600">{v}</span> },
    { title: 'Record', key: 'record', width: 180, ellipsis: true, render: (_, r) => <span className="text-[12px]">{r.entityType}{r.entityId ? ` · ${String(r.entityId).slice(0, 8)}` : ''}</span> },
    { title: 'Branch', dataIndex: 'branch', width: 110, render: (v) => v || '—' },
    { title: 'Result', dataIndex: 'result', width: 90, render: (v) => v ? <Tag color={v === 'SUCCESS' ? 'green' : v === 'FAILURE' ? 'red' : 'default'} style={{ fontSize: 11 }}>{v}</Tag> : '—' },
    { title: 'Actions', key: 'a', width: 70, fixed: 'right', render: (_, r) => <Button size="small" onClick={() => setDetail(r)}>View</Button> },
  ];

  function exportCsv() {
    const e = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') e.set(k, String(v)); });
    const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/admin/audit-logs/export/csv?${e.toString()}`;
    // The API helper can't stream downloads — fetch with the session token manually.
    const token = useAuth.getState().token;
    fetch(url, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => { if (!r.ok) throw new Error('Export failed'); return r.blob(); })
      .then((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'audit-log.csv';
        a.click();
      })
      .catch((e) => message.error(e.message));
  }

  return (
    <>
      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search action, user, record…" className="w-52 !rounded-xl" onChange={(e) => { setFilters((f: any) => ({ ...f, search: e.target.value })); setPage(1); }} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="User" className="!min-w-[170px]" options={userOptions} onChange={(v) => { setFilters((f: any) => ({ ...f, userId: v })); setPage(1); }} />
        <Select allowClear placeholder="Module" className="!min-w-[130px]" options={modules.map((m) => ({ label: m, value: m }))} onChange={(v) => { setFilters((f: any) => ({ ...f, module: v })); setPage(1); }} />
        <Select allowClear placeholder="Result" className="!min-w-[110px]" options={['SUCCESS', 'FAILURE', 'DENIED'].map((r) => ({ label: r, value: r }))} onChange={(v) => { setFilters((f: any) => ({ ...f, result: v })); setPage(1); }} />
        <DatePicker.RangePicker
          className="!rounded-xl"
          onChange={(v) => {
            if (v && v[0] && v[1]) { setFilters((f: any) => ({ ...f, from: v[0]!.valueOf(), to: v[1]!.valueOf() })); setPage(1); }
            else setFilters((f: any) => ({ ...f, from: undefined, to: undefined }));
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-slate-400">{q.data?.total || 0} events</span>
          <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['/admin/audit-logs'] })} /></Tooltip>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button>
        </div>
      </div>
      <Card className="nex-card" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id" loading={q.isLoading} dataSource={q.data?.items || []} columns={columns} scroll={{ x: 1200 }}
          pagination={{
            current: page, pageSize, total: q.data?.total || 0, showSizeChanger: true,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            showTotal: (t) => `${t} events`,
          }}
        />
      </Card>
      {detail && <AuditDetailDrawer id={detail.id} onClose={() => setDetail(null)} />}
    </>
  );
}

function AuditDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['/admin/audit-logs', id], queryFn: () => api(`/admin/audit-logs/${id}`) });
  const r = q.data;
  const meta = r?.metadata || r?.details || {};
  const before = meta.before || null;
  const after = meta.after || null;

  return (
    <Drawer open onClose={onClose} title="Audit Event" width={640} destroyOnHidden styles={{ body: { padding: '12px 24px 24px' } }}>
      {q.isLoading ? <div className="py-10 text-center text-slate-400">Loading…</div> : q.error ? <Alert type="error" message={(q.error as Error).message} /> : (
        <div>
          <Descriptions column={1} size="small" labelStyle={{ width: 140 }} contentStyle={{ fontSize: 13 }}>
            <Descriptions.Item label="Date / Time">{fmtDateTime(r.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="User">{r.userName}{r.userEmail ? <span className="text-slate-400"> · {r.userEmail}</span> : null}</Descriptions.Item>
            <Descriptions.Item label="Employee #">{r.employeeNo || '—'}</Descriptions.Item>
            <Descriptions.Item label="Action"><Tag style={{ fontSize: 12 }}>{r.action}</Tag></Descriptions.Item>
            <Descriptions.Item label="Module">{r.module || '—'}</Descriptions.Item>
            <Descriptions.Item label="Record">{r.entityType}{r.entityId ? ` · ${r.entityId}` : ''}</Descriptions.Item>
            <Descriptions.Item label="Branch">{r.branch || '—'}</Descriptions.Item>
            <Descriptions.Item label="Result">{r.result || '—'}</Descriptions.Item>
            <Descriptions.Item label="Reason">{r.reason || '—'}</Descriptions.Item>
            <Descriptions.Item label="Correlation ID">{r.correlationId || '—'}</Descriptions.Item>
          </Descriptions>
          {before && after && (
            <div className="mt-4">
              <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-2">Changes</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="nex-card px-3 py-2 bg-slate-50">
                  <div className="text-[11px] font-semibold text-red-500 uppercase mb-1">Before</div>
                  <pre className="text-[11.5px] text-slate-600 whitespace-pre-wrap m-0">{JSON.stringify(before, null, 2)}</pre>
                </div>
                <div className="nex-card px-3 py-2 bg-slate-50">
                  <div className="text-[11px] font-semibold text-green-600 uppercase mb-1">After</div>
                  <pre className="text-[11.5px] text-slate-600 whitespace-pre-wrap m-0">{JSON.stringify(after, null, 2)}</pre>
                </div>
              </div>
            </div>
          )}
          {Object.keys(meta).length > 0 && !before && (
            <div className="mt-4">
              <div className="text-[12px] font-bold uppercase tracking-wider text-slate-400 mb-2">Details</div>
              <pre className="text-[11.5px] text-slate-600 whitespace-pre-wrap">{JSON.stringify(meta, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default AuditTab;
