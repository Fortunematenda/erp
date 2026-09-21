'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Drawer, Dropdown, MenuProps, Skeleton, Tabs, Tag } from 'antd';
import { DownOutlined, MoreOutlined, PayCircleOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { fmtDate, fmtMoney } from '@/lib/format';
import { subtypeLabel } from '@/components/finance/account-meta';
import { JournalDetailDrawer } from '@/components/finance/journal-detail-drawer';

export function AccountDetailDrawer({ open, accountId, onClose, onEdit, onChanged, glParams }: { open: boolean; accountId: string | null; onClose: () => void; onEdit: (a: any) => void; onChanged: () => void; glParams?: string }) {
  const router = useRouter();
  const [journalId, setJournalId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['finance', 'account', accountId], queryFn: () => api(`/finance/accounts/${accountId}`), enabled: open && !!accountId });
  const d = q.data;
  const normal = d ? (d.type === 'ASSET' || d.type === 'EXPENSE' ? 'Debit' : 'Credit') : '—';

  async function activate(deact: boolean) {
    await api(`/finance/accounts/${accountId}/${deact ? 'deactivate' : 'activate'}`, { method: 'POST' });
    onChanged(); q.refetch();
  }

  const glUrl = `/finance/ledger?accountId=${accountId}${glParams || ''}`;
  const more: MenuProps['items'] = [
    { key: 'ledger', label: 'Open General Ledger', onClick: () => { onClose(); router.push(glUrl); } },
    { key: 'edit', label: <span>Edit Account</span>, onClick: () => onEdit(d) },
    ...(d?.active ? [{ key: 'deactivate', label: 'Deactivate', danger: true, onClick: () => activate(true) }] : [{ key: 'activate', label: 'Reactivate', onClick: () => activate(false) }]),
  ];

  const actionContent = (d: any) => (
    <div className="flex items-center gap-2 flex-wrap">
      <Button type="primary" icon={<PayCircleOutlined />} onClick={() => { onClose(); router.push(glUrl); }}>Open General Ledger</Button>
      <Button onClick={() => onEdit(d)}>Edit</Button>
      <Dropdown menu={{ items: more }} trigger={['click']}><Button><MoreOutlined /> More <DownOutlined /></Button></Dropdown>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} width={620} destroyOnHidden
      title={d ? <span>{d.code} · {d.name}</span> : 'Account Details'}
      extra={<Button type="text" onClick={onClose}><span className="text-[16px]">&times;</span></Button>}>
      {q.isFetching && !d ? <Skeleton active paragraph={{ rows: 10 }} /> : !d ? (
        <div className="text-[#a1a6c0] text-[13px]">Unable to load account.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Tag color="geekblue">{d.category || d.type}</Tag>
            <StatusTag value={d.active ? 'ACTIVE' : 'INACTIVE'} />
            {d.isSystem && <Tag color="purple">SYSTEM</Tag>}
          </div>
          <Tabs
            defaultActiveKey="overview"
            items={[
              { key: 'overview', label: 'Overview', children: (
                <div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <Field label="Current Balance" value={<span className={`text-[13px] font-semibold tabular-nums ${d.balance < 0 ? 'text-[#d64545]' : 'text-[#475467]'}`}>{fmtMoney(d.balance)}</span>} />
                    <Field label="Normal Balance" value={normal} />
                    <Field label="Account Code" value={<span className="font-mono text-[13px] text-[#003366]">{d.code}</span>} />
                    <Field label="Account Type" value={d.type} />
                    <Field label="Sub-Type" value={subtypeLabel(d.subtype)} />
                    <Field label="Status" value={<StatusTag value={d.active ? 'ACTIVE' : 'INACTIVE'} />} />
                    <Field label="Parent Account" value={d.parent ? `${d.parent.code} — ${d.parent.name}` : 'None (top level)'} />
                    <Field label="Tax Line" value={d.taxCode || '—'} />
                    <Field label="Description" value={d.description || '—'} span2 />
                    <Field label="Created" value={d.createdAt ? fmtDate(d.createdAt) : '—'} />
                    <Field label="Last Activity" value={d.recentEntries?.[0] ? `${fmtDate(d.recentEntries[0].date)} · ${d.recentEntries[0].sourceLabel}` : '—'} />
                  </div>
                  <div className="rounded-xl border border-[#f2f3f9] p-4 mt-5">
                    <div className="text-[12px] font-semibold text-[#98A2B3] uppercase tracking-wide mb-2">Balance Breakdown</div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <Mini val={fmtMoney(d.openingBalance || 0)} label="Opening" />
                      <Mini val={fmtMoney(d.balance)} label="Current" />
                      <Mini val={d.recentEntries?.length || 0} label="Recent entries" />
                    </div>
                    {d.openingJournal && (
                      <div className="mt-3 text-[12px] text-[#5a6080]">Opening journal: <Link href={`/finance/journals?open=${d.openingJournal.id}`}><span className="font-mono text-[12px] text-[#003366] hover:underline">{d.openingJournal.number}</span></Link> <span className="text-[#a1a6c0]">· {fmtDate(d.openingJournal.date)}</span></div>
                    )}
                  </div>
                  <div className="mt-5">{actionContent(d)}</div>
                </div>
              ) },
              { key: 'entries', label: 'Recent Entries', children: (
                <div>
                  <div className="nex-card overflow-hidden">
                    <table className="w-full text-[13px]">
                      <thead><tr className="bg-[#f8f9ff]">
                        {['Date', 'Journal #', 'Memo', 'Reference', 'Debit', 'Credit'].map((h, i) => <th key={i} className={`text-left text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide px-4 py-2.5 ${i >= 4 ? 'text-right' : ''}`}>{h}</th>)}
                      </tr></thead>
                      <tbody className="divide-y divide-[#f2f3f9]">
                        {(d.recentEntries || []).map((e: any) => (
                          <tr key={e.id} className="hover:bg-[#f8faff]">
                            <td className="px-4 py-2.5 text-[#5a6080]">{fmtDate(e.date)}</td>
                            <td className="px-4 py-2.5"><button onClick={() => setJournalId(e.journalId)} className="font-mono text-[12px] text-[#003366] font-semibold hover:underline">{e.journalNumber}</button></td>
                            <td className="px-4 py-2.5 text-[#475467]">{e.description}</td>
                            <td className="px-4 py-2.5">{e.reference ? <Link href={e.sourceRoute}><span className="font-mono text-[12px] text-[#5a6080] hover:underline">{e.reference}</span></Link> : '—'}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-[#10b981]">{fmtMoney(e.debit)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-[#ef4444]">{fmtMoney(e.credit)}</td>
                          </tr>
                        ))}
                        {!(d.recentEntries || []).length && <tr><td colSpan={6} className="px-4 py-6 text-center text-[#a1a6c0]">No entries yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) },
              { key: 'audit', label: 'Audit Trail', children: (
                <div className="nex-card overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead><tr className="bg-[#f8f9ff]">{[ 'Action', 'User', 'Timestamp', 'Details'].map((h, i) => <th key={i} className="text-left text-[11px] font-semibold text-[#98A2B3] uppercase tracking-wide px-4 py-2.5">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-[#f2f3f9]">
                      {(d.auditTrail || []).map((a: any) => (
                        <tr key={a.id} className="hover:bg-[#f8faff]">
                          <td className="px-4 py-2.5"><Tag>{a.action}</Tag></td>
                          <td className="px-4 py-2.5 text-[#475467]">{a.userId ? a.userId.slice(0, 8) : 'SYSTEM'}</td>
                          <td className="px-4 py-2.5 text-[#5a6080]">{fmtDate(a.createdAt)}</td>
                          <td className="px-4 py-2.5 text-[#a1a6c0] text-[12px]">{a.metadata ? JSON.stringify(a.metadata) : ''}</td>
                        </tr>
                      ))}
                      {!(d.auditTrail || []).length && <tr><td colSpan={4} className="px-4 py-6 text-center text-[#a1a6c0]">No audit events.</td></tr>}
                    </tbody>
                  </table>
                </div>
              ) },
            ]}
          />
        </>
      )}
      <JournalDetailDrawer open={!!journalId} journalId={journalId} onClose={() => setJournalId(null)} />
    </Drawer>
  );
}

function Field({ label, value, span2 }: { label: string; value: React.ReactNode; span2?: boolean }) {
  return <div className={span2 ? 'col-span-2' : ''}><div className="text-[12px] text-[#98A2B3] mb-1">{label}</div><div className="text-[14px] text-[#171a2e]">{value}</div></div>;
}
function Mini({ val, label }: { val: string; label: string }) {
  return <div className="py-1"><div className="text-[15px] font-semibold text-[#1f2937]">{val}</div><div className="text-[11px] text-[#98A2B3]">{label}</div></div>;
}
