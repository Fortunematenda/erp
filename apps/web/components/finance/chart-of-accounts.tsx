'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-store';
import { Button, Card, Input, Select, Space, Table, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined, PrinterOutlined, DownloadOutlined, AuditOutlined, EyeOutlined, EditOutlined, StopOutlined, CheckCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { fmtDate, fmtMoney } from '@/lib/format';
import { subtypeLabel, TYPE_TONE } from '@/components/finance/account-meta';
import { AccountDetailDrawer } from '@/components/finance/account-detail-drawer';
import { AccountFormDrawer } from '@/components/finance/account-form-drawer';
import { SoftBadge } from '@/components/crud-page';
import { ACTIONS_COL, RowActionsMenu } from '@/components/row-actions-menu';

const NUM = (a: string, b: string) => { const na = Number(a), nb = Number(b); if (!isNaN(na) && !isNaN(nb)) return na - nb; return String(a).localeCompare(String(b), undefined, { numeric: true }); };

// Determine if a code is numeric-friendly so codes sort as 1000,1100,1110...
function compareNodes(a: any, b: any, field: string): number {
  switch (field) {
    case 'code': return NUM(a.code, b.code);
    case 'name': return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    case 'type': return String(a.type).localeCompare(String(b.type), undefined, { numeric: true });
    case 'normal': return String(a.type).localeCompare(String(b.type), undefined, { numeric: true });
    case 'balance': return Number(a.summaryBalance ?? a.balance ?? 0) - Number(b.summaryBalance ?? b.balance ?? 0);
    case 'active': case 'status': return Number(!!a.active) - Number(!!b.active);
    case 'created': case 'createdAt': return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    default: return NUM(a.code, b.code);
  }
}
// Sorting happens at the tree level so Parent → Child relationships are never
// broken; only siblings within a parent (and root accounts) are reordered.
function sortTree(nodes: any[], field: string, dir: 'asc' | 'desc'): any[] {
  const arr = [...nodes].sort((a, b) => { const r = compareNodes(a, b, field); return dir === 'asc' ? r : -r; });
  return arr.map((n) => ({ ...n, children: sortTree(n.children || [], field, dir) }));
}
// Roll up a parent account's displayed balance = its own posting balance + the
// sum of its descendants. Collapsing a branch never changes financial totals.
function rollup(nodes: any[]): any[] {
  nodes.forEach((n) => {
    n.children = rollup(n.children || []);
    n.summaryBalance = Number((Number(n.balance || 0) + (n.children || []).reduce((s: number, c: any) => s + Number(c.summaryBalance || 0), 0)).toFixed(2));
  });
  return nodes;
}

const TYPE_TABS = [
  { key: 'all', label: 'All', type: '', category: '' },
  { key: 'ASSET', label: 'Asset', type: 'ASSET', category: '' },
  { key: 'LIABILITY', label: 'Liability', type: 'LIABILITY', category: '' },
  { key: 'EQUITY', label: 'Equity', type: 'EQUITY', category: '' },
  { key: 'REVENUE', label: 'Income', type: 'REVENUE', category: '' },
  { key: 'EXPENSE', label: 'Expense', type: 'EXPENSE', category: '' },
  { key: 'BANK', label: 'Bank', type: '', category: 'BANK' },
  { key: 'CASH', label: 'Cash', type: '', category: 'CASH' },
  { key: 'CREDIT_CARD', label: 'Credit Card', type: '', category: 'CREDIT_CARD' },
  { key: 'LOAN', label: 'Loan', type: '', category: 'LOAN' },
  { key: 'COGS', label: 'COGS', type: '', category: 'COGS' },
  { key: 'OTHER_INCOME', label: 'Other Income', type: '', category: 'OTHER_INCOME' },
  { key: 'OTHER_EXPENSE', label: 'Other Expense', type: '', category: 'OTHER_EXPENSE' },
];

function typeBadge(type: string) {
  return <SoftBadge tone={TYPE_TONE[type] || 'grey'}>{typeLabel(type)}</SoftBadge>;
}

export function ChartOfAccounts() {
  const qc = useQueryClient();
  const { permissions } = useAuth();
  const summary = useQuery({ queryKey: ['finance', 'accounts-summary'], queryFn: () => api('/finance/accounts/summary') });
  const accounts = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => api('/finance/accounts') });
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [type, setType] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'code', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const s = summary.data;
  const eq = s?.equation;

  // Debounce search so we do not refilter on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  // Reset to page 1 whenever the dataset is narrowed.
  useEffect(() => { setPage(1); }, [debouncedQ, type, category, status]);

  // Build a hierarchy-preserving tree: keep matched accounts AND their ancestor
  // chain (so filters/search retain parent context), roll up parent balances,
  // then sort siblings within each parent.
  const { tree, flatAll, totalBalance, matchedIds } = useMemo(() => {
    const all = accounts.data || [];
    const byId: Record<string, any> = {}; all.forEach((a: any) => { byId[a.id] = a; });
    const matches = (a: any) =>
      (type ? a.type === type : true) &&
      (category ? a.category === category : true) &&
      (status === 'INACTIVE' ? a.active === false : status === 'ACTIVE' ? a.active === true : true) &&
      (!debouncedQ || `${a.code} ${a.name} ${a.description || ''} ${a.subtype || ''} ${a.parentName || ''}`.toLowerCase().includes(debouncedQ.toLowerCase()));
    const visible = new Set<string>(); const matched: string[] = [];
    for (const a of all) {
      if (matches(a)) {
        matched.push(a.id);
        let cur: any = a;
        while (cur) { visible.add(cur.id); cur = cur.parentId ? byId[cur.parentId] : null; }
      }
    }
    let t = rollup(buildList(all.filter((a: any) => visible.has(a.id))));
    t = sortTree(t, sort.field, sort.dir);
    const out: any[] = []; const walk = (n: any) => n.forEach((r: any) => { out.push(r); if (r.children?.length) walk(r.children); }); walk(t);
    return { tree: t, flatAll: out, totalBalance: t.reduce((s: number, r: any) => s + Number(r.summaryBalance || 0), 0), matchedIds: matched };
  }, [accounts.data, debouncedQ, type, category, status, sort]);

  // Expansion: user toggled + auto-expand ancestor branches when searching/filtering.
  const [manualExpanded, setManualExpanded] = useState<string[]>([]);
  const autoExpanded = useMemo(() => {
    if (!debouncedQ && !type && !category) return [] as string[];
    const all = accounts.data || []; const byId: Record<string, any> = {}; all.forEach((a: any) => { byId[a.id] = a; });
    const set = new Set<string>();
    for (const id of matchedIds) { let cur: any = byId[id]; while (cur) { set.add(cur.id); cur = cur.parentId ? byId[cur.parentId] : null; } }
    return [...set];
  }, [debouncedQ, type, category, matchedIds, accounts.data]);
  const expandedRowKeys = (debouncedQ || type || category) ? [...new Set([...manualExpanded, ...autoExpanded])] : manualExpanded;

  function handleTableChange(pagination: any, _filters: any, sorter: any) {
    setPage(pagination?.current || 1);
    setPageSize(pagination?.pageSize || 25);
    if (sorter && sorter.field && sorter.order) setSort({ field: String(sorter.field), dir: sorter.order === 'ascend' ? 'asc' : 'desc' });
    else { setSort({ field: 'code', dir: 'asc' }); setPage(1); }
  }
  const sortOrderFor = (field: string): 'ascend' | 'descend' | null => (sort.field === field ? (sort.dir === 'asc' ? 'ascend' : 'descend') : null);

  function refresh() { qc.invalidateQueries({ queryKey: ['finance', 'accounts'] }); qc.invalidateQueries({ queryKey: ['finance', 'accounts-summary'] }); }

  function exportCsv() {
    const csv = [
      ['Code', 'Account Name', 'Type', 'Sub-type', 'Parent', 'Normal Balance', 'Balance', 'Status', 'Created'].join(','),
      ...flatAll.map((r: any) => [r.code, `"${r.name}"`, r.type, r.subtype || '', r.parentName || '', (r.type === 'ASSET' || r.type === 'EXPENSE') ? 'Debit' : 'Credit', Number(r.balance).toFixed(2), r.active ? 'ACTIVE' : 'INACTIVE', r.createdAt ? fmtDate(r.createdAt) : '',].join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'chart-of-accounts.csv'; a.click(); URL.revokeObjectURL(url);
  }

  const columns: ColumnsType<any> = [
    { title: 'Code', dataIndex: 'code', width: 100, sorter: true, sortOrder: sortOrderFor('code'), render: (v, r) => <button onClick={() => setOpenDetail(r.id)} className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{v}</button> },
    { title: 'Account Name', dataIndex: 'name', sorter: true, sortOrder: sortOrderFor('name'), render: (v, r) => (
      <div className="flex items-center gap-2" style={{ paddingLeft: (r.depth || 0) * 16 }}>
        <button onClick={() => setOpenDetail(r.id)} className="font-medium text-[#171a2e] hover:text-[#003366] hover:underline text-left">{v}</button>
        {r.hasChildren && <Tag className="!mr-0" color="default" style={{ borderRadius: 6 }}>GROUP</Tag>}
      </div>
    ) },
    { title: 'Type / Sub-Type', dataIndex: 'type', width: 170, sorter: true, sortOrder: sortOrderFor('type'), render: (_, r) => <div className="flex flex-col gap-1"><span>{typeBadge(r.type)}</span>{r.subtype && <span className="text-[11px] text-[#98A2B3]">{subtypeLabel(r.subtype)}</span>}</div> },
    { title: 'Parent', dataIndex: 'parentName', width: 150, render: (v) => v || '—' },
    { title: 'Normal', dataIndex: 'normal', width: 80, sorter: true, sortOrder: sortOrderFor('normal'), render: (_, r) => <span className="text-[12px] text-[#5a6080]">{r.type === 'ASSET' || r.type === 'EXPENSE' ? 'Debit' : 'Credit'}</span> },
    { title: 'Balance', dataIndex: 'summaryBalance', width: 140, align: 'right', sorter: true, sortOrder: sortOrderFor('balance'), render: (_, r) => <span className={`font-bold text-[14px] ${Number(r.summaryBalance) < 0 ? 'text-[#d64545]' : 'text-[#475467]'}`}>{fmtMoney(r.summaryBalance)}</span> },
    { title: 'Status', dataIndex: 'active', width: 100, sorter: true, sortOrder: sortOrderFor('active'), render: (v) => <StatusTag value={v ? 'ACTIVE' : 'INACTIVE'} /> },
    { title: 'Created', dataIndex: 'createdAt', width: 110, sorter: true, sortOrder: sortOrderFor('createdAt'), render: (v) => (v ? fmtDate(v) : '—') },
    { ...ACTIONS_COL, render: (_, r) => (
      <RowActionsMenu items={[
        { key: 'view', label: 'View', icon: <EyeOutlined />, onClick: () => setOpenDetail(r.id) },
        { key: 'ledger', label: 'Open General Ledger', icon: <AuditOutlined />, onClick: () => window.location.assign(`/finance/ledger?accountId=${r.id}`) },
        { key: 'edit', label: 'Edit Account', icon: <EditOutlined />, onClick: () => openEdit(r) },
        ...(r.active
          ? [{ key: 'deactivate', label: 'Deactivate', icon: <StopOutlined />, danger: true as const, onClick: () => action(r, 'deactivate') }]
          : [{ key: 'activate', label: 'Reactivate', icon: <CheckCircleOutlined />, onClick: () => action(r, 'activate') }]),
      ]} />
    ) },
  ];

  const typeOptions = TYPE_TABS.filter((t) => t.key !== 'all').map((t) => ({ label: t.label, value: t.key }));
  const activeKey = TYPE_TABS.find((t) => t.type === type && t.category === category)?.key || 'all';
  function onTypeSelect(v?: string) { const tab = TYPE_TABS.find((t) => t.key === v); setType(tab?.type || ''); setCategory(tab?.category || ''); }

  async function openEdit(r: any) {
    // Always load the FULL account record (parent, opening balance, balance)
    // rather than initialising from a possibly-partial table row.
    try {
      const full = await api(`/finance/accounts/${r.id}`);
      setEditing(full);
    } catch {
      setEditing(r);
    }
    setFormOpen(true);
  }
  async function action(r: any, kind: 'deactivate' | 'activate') {
    try { await api(`/finance/accounts/${r.id}/${kind}`, { method: 'POST' }); message.success(`Account ${kind}d`); refresh(); } catch (e: any) { message.error(e.message); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">Chart of Accounts</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Financial statement categories and balances</p>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button>
          {/* System-account seeding only for authorized users */}
          {permissions?.includes('admin.roles.manage') && <Button icon={<AuditOutlined />} onClick={refresh}>Seed System Accounts</Button>}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add Account</Button>
        </Space>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-5">
        <SumCard label="Total Accounts" value={s?.totalAccounts} sub={`${s?.activeAccounts} active · ${s?.inactiveAccounts} inactive`} onClick={() => { setType(''); setCategory(''); }} />
        <SumCard label="Total Assets" value={eq?.assets} tone="green" onClick={() => { setType('ASSET'); setCategory(''); }} />
        <SumCard label="Total Liabilities" value={eq?.liabilities} tone="amber" onClick={() => { setType('LIABILITY'); setCategory(''); }} />
        <SumCard label="Total Equity" value={eq?.equity} tone="purple" onClick={() => { setType('EQUITY'); setCategory(''); }} />
      </div>

      <div className={`nex-card mb-5 flex items-center justify-between px-5 py-4`} style={{ borderLeft: `4px solid ${eq?.difference === 0 ? '#10b981' : '#f59e0b'}` }}>
        <div>
          <div className="text-[13px] font-semibold text-[#5a6080]">Accounting equation</div>
          <div className="text-[14px] text-[#171a2e] mt-1">
            Assets <span className="font-semibold">{fmtMoney(eq?.assets)}</span> = Liabilities <span className="font-semibold">{fmtMoney(eq?.liabilities)}</span> + Equity <span className="font-semibold">{fmtMoney(eq?.equity)}</span> + Net Income <span className="font-semibold">{fmtMoney(eq?.netIncome)}</span>
          </div>
        </div>
        <SoftBadge tone={eq?.difference === 0 ? 'green' : 'amber'}>{eq?.difference === 0 ? 'Balanced' : `Difference ${fmtMoney(eq?.difference)}`}</SoftBadge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-5">
        {(s?.categoryCards || []).map((c: any) => (
          <button key={c.category} onClick={() => setCategory(category === c.category ? '' : c.category)} title="Click to filter accounts"
            className={`nex-card text-left p-3.5 rounded-[12px] cursor-pointer transition-shadow hover:shadow-md hover:border-[#0b4a8f33] ${category === c.category ? 'border-[#0b4a8f] ring-1 ring-[#0b4a8f40]' : ''}`}>
            <div className="text-[12px] font-semibold text-[#667085]">{subtypeLabel(c.category)}</div>
            <div className="text-[18px] font-semibold text-[#475467] mt-1 leading-tight">{fmtMoney(c.balance)}</div>
            <div className="text-[11px] text-[#98A2B3] mt-1">{c.count} {c.count === 1 ? 'account' : 'accounts'}</div>
          </button>
        ))}
      </div>

      <Card className="nex-card mb-5" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-wrap items-center gap-2 px-5 pt-3.5 pb-3 border-b border-[#f2f3f9]">
          {TYPE_TABS.map((t) => (
            <button key={t.key} onClick={() => { setType(t.type); setCategory(t.category); }} className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${(type === t.type && category === t.category) ? 'bg-[#003366] text-white' : 'bg-[#f2f3f9] text-[#5a6080] hover:bg-[#e8ebf4]'}`}>{t.label}</button>
          ))}
        </div>
        <div className="nex-coa-toolbar flex flex-wrap items-center gap-3 px-5 py-3">
          <Input allowClear prefix={<span className="text-[#a1a6c0] mr-1">🔍</span>} placeholder="Search code, account name or description..." className="!rounded-[9px]" style={{ flex: '0 1 440px', minWidth: 320, maxWidth: 480 }} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select allowClear placeholder="All Types" className="!rounded-[9px]" style={{ width: 170 }} value={activeKey === 'all' ? undefined : activeKey} onChange={onTypeSelect} options={typeOptions} />
          <Select allowClear placeholder="All Statuses" className="!rounded-[9px]" style={{ width: 150 }} value={status} onChange={setStatus} options={[{ label: 'Active', value: 'ACTIVE' }, { label: 'Inactive', value: 'INACTIVE' }]} />
          <span className="ml-auto text-[12px] text-[#98A2B3] whitespace-nowrap">{flatAll.length} {flatAll.length === 1 ? 'account' : 'accounts'} · Balance {fmtMoney(totalBalance)}</span>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-2 border-b border-[#f2f3f9]">
          <button onClick={() => setManualExpanded(flatAll.filter((a: any) => (a.children?.length || 0) > 0).map((a: any) => a.id))} className="text-[12px] font-medium text-[#175CD3] hover:underline">Expand All</button>
          <span className="text-[#dfe1ee]">·</span>
          <button onClick={() => setManualExpanded([])} className="text-[12px] font-medium text-[#175CD3] hover:underline">Collapse All</button>
        </div>
        <Table
          rowKey="id"
          loading={accounts.isLoading}
          dataSource={tree}
          columns={columns}
          onChange={handleTableChange}
          expandable={{ expandedRowKeys, onExpand: (expanded, record) => setManualExpanded((prev) => (expanded ? [...new Set([...prev, record.id])] : prev.filter((id) => id !== record.id))), rowExpandable: (record) => (record.children?.length || 0) > 0 }}
          pagination={{ current: page, pageSize, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'], onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
          scroll={{ x: 1050 }}
          size="middle"
        />
      </Card>

      <AccountFormDrawer open={formOpen} account={editing} onClose={() => setFormOpen(false)} onSaved={refresh} />
      <AccountDetailDrawer open={!!openDetail} accountId={openDetail} onClose={() => setOpenDetail(null)} onEdit={(a) => { setOpenDetail(null); setEditing(a); setFormOpen(true); }} onChanged={refresh} />
    </div>
  );
}

function buildList(list: any[]) {
  const ids = new Set(list.map((a: any) => a.id));
  const byId: Record<string, any> = {};
  list.forEach((a: any) => { byId[a.id] = { ...a, children: [] as any[] }; });
  const roots: any[] = [];
  list.forEach((a: any) => {
    const node = byId[a.id];
    const parent = a.parentId ? byId[a.parentId] : null;
    if (parent) parent.children.push(node); else roots.push(node);
  });
  const walk = (nodes: any[], depth: number) => nodes.forEach((n) => { n.depth = depth; n.hasChildren = n.children.length > 0; n.parentName = list.find((x: any) => x.id === n.parentId)?.name || ''; walk(n.children, depth + 1); });
  walk(roots, 0);
  return roots;
}

function SumCard({ label, value, sub, tone, onClick }: { label: string; value?: number; sub?: string; tone?: string; onClick: () => void }) {
  const color = tone === 'green' ? '#10b981' : tone === 'amber' ? '#f59e0b' : tone === 'purple' ? '#8b5cf6' : '#2563eb';
  return (
    <button onClick={onClick} className="nex-card text-left p-4 rounded-[12px] min-h-[100px] cursor-pointer transition-shadow hover:shadow-md hover:border-[#0b4a8f33]">
      <div className="text-[13px] font-semibold text-[#667085]">{label}</div>
      <div className={`text-[21px] font-semibold leading-[1.2] tracking-[-0.01em] mt-1 ${Number(value ?? 0) < 0 ? 'text-[#d64545]' : 'text-[#475467]'}`}>{value == null ? '—' : fmtMoney(value)}</div>
      {sub && <div className="text-[11.5px] text-[#98A2B3] mt-1">{sub}</div>}
    </button>
  );
}

function typeLabel(t: string) {
  return ({ ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', REVENUE: 'Income', EXPENSE: 'Expense' } as Record<string, string>)[t] || t;
}
