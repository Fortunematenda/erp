'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Drawer, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import { PlusOutlined, ReloadOutlined, SyncOutlined, DisconnectOutlined, WalletOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';

export default function BankConnectionsPage() {
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ['banking', 'providers'], queryFn: () => api('/banking/providers') });
  const connections = useQuery({ queryKey: ['banking', 'connections'], queryFn: () => api('/banking/connections') });
  const bankAccounts = useQuery({ queryKey: ['finance', 'bank-accounts'], queryFn: () => api('/finance/bank-accounts') });
  const [connectOpen, setConnectOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);

  function refresh() { qc.invalidateQueries({ queryKey: ['banking', 'connections'] }); qc.invalidateQueries({ queryKey: ['banking', 'feed'] }); }

  async function connect(provider: string) {
    setSaving(true);
    try { await api('/banking/connections', { method: 'POST', body: JSON.stringify({ provider, institutionName: 'External Bank' }) }); message.success('Bank connected'); setConnectOpen(false); refresh(); }
    catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  async function sync(id: string) { try { const r = await api(`/banking/connections/${id}/sync`, { method: 'POST' }); message.success(`Sync complete — ${r.inserted} new, ${r.updated} updated`); refresh(); } catch (e: any) { message.error(e.message); } }
  async function disconnect(id: string) { try { await api(`/banking/connections/${id}/disconnect`, { method: 'POST' }); message.success('Disconnected (history retained)'); refresh(); } catch (e: any) { message.error(e.message); } }
  async function toggle(acc: any, enabled: boolean) { try { await api(`/banking/accounts/${acc.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }); refresh(); } catch (e: any) { message.error(e.message); } }
  async function mapAcc(acc: any, bankId?: string) { try { const b = (bankAccounts.data || []).find((x: any) => x.id === bankId); await api(`/banking/accounts/${acc.id}`, { method: 'PATCH', body: JSON.stringify({ nexusBankAccountId: bankId, glAccountId: b?.ledgerAccountId }) }); message.success('Account mapped'); refresh(); } catch (e: any) { message.error(e.message); } }

  const accountCols: ColumnsType<any> = [
    { title: 'External Account', dataIndex: 'accountName', render: (v, r) => <span><span className="font-medium">{v || r.providerAccountId}</span><span className="text-[#98A2B3]"> · {r.maskedAccountNumber || ''}</span><span className="text-[#98A2B3]"> · {r.currency}</span></span> },
    { title: 'Balance', dataIndex: 'currentBalance', align: 'right', width: 120, render: (v) => fmtMoney(v) },
    { title: 'ERP Bank Account', render: (_v, r) => (
      <Select allowClear showSearch optionFilterProp="label" className="!min-w-[200px]" value={r.nexusBankAccountId || undefined} onChange={(v) => mapAcc(r, v)} placeholder="Map to NexusERP bank" options={(bankAccounts.data || []).map((b: any) => ({ label: `${b.ledgerAccount?.code || ''} · ${b.name} [${b.ledgerAccount?.type || 'BANK'}]`, value: b.id }))} />
    ) },
    { title: 'Enabled', dataIndex: 'enabled', width: 90, render: (v, r) => <Switch checked={v} onChange={(c) => toggle(r, c)} /> },
  ];

  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#171a2e] leading-tight">Bank Connections</h1>
          <p className="text-[13px] text-[#64748b] mt-1">Connect external banks and sync transactions for reconciliation</p>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => refresh()}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setConnectOpen(true)}>Connect Bank</Button>
        </Space>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(connections.data || []).map((c: any) => (
          <Card key={c.id} className="nex-card" styles={{ body: { padding: '18px 20px' } }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ background: '#003366', boxShadow: '0 4px 10px rgba(0,51,102,.3)' }}><WalletOutlined /></div>
                <div>
                  <div className="font-semibold text-[14px] text-[#171a2e]">{c.institutionName || c.provider}</div>
                  <div className="text-[11px] text-[#98A2B3]">{c.provider} · {c.accounts.length} accounts</div>
                </div>
              </div>
              <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: c.status === 'CONNECTED' ? '#ecfdf5' : '#fef2f2', color: c.status === 'CONNECTED' ? '#047857' : '#b42318' }}>● {c.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex items-center justify-between mt-4 text-[12px] text-[#667085]">
              <span>Last sync {c.lastSuccessfulSyncAt ? dayjs(c.lastSuccessfulSyncAt).format('D MMM, HH:mm') : '—'}</span>
              <span className="font-semibold text-[#1f2937]">{c.transactionCount} transactions</span>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Button size="small" icon={<SyncOutlined />} onClick={() => sync(c.id)} disabled={c.status !== 'CONNECTED'}>Sync</Button>
              <Button size="small" onClick={() => setManageId(c.id)}>Manage Accounts</Button>
              <Button size="small" danger icon={<DisconnectOutlined />} onClick={() => disconnect(c.id)} disabled={c.status === 'DISCONNECTED'}>Disconnect</Button>
              <Link href="/finance/reconciliation" className="ml-auto text-[12px] text-[#175CD3] hover:underline">Reconcile →</Link>
            </div>
          </Card>
        ))}
        {!(connections.data || []).length && <Card className="nex-card md:col-span-2 xl:col-span-3" styles={{ body: { padding: '40px' } }}><div className="text-center text-[13px] text-[#a1a6c0]">No bank connections yet. Connect a bank or import a statement to begin.</div></Card>}
      </div>

      <Drawer open={connectOpen} onClose={() => setConnectOpen(false)} title="Connect External Bank" width={560}
        footer={<div className="flex justify-end gap-2"><Button onClick={() => setConnectOpen(false)}>Cancel</Button></div>}>
        <div className="text-[13px] text-[#667085] mb-4">Choose an available connection method. Live Open Banking / direct bank API adapters are not configured in this environment; the SANDBOX provider demonstrates the full sync pipeline, and statement import is the supported fallback.</div>
        <div className="space-y-3">
          {(providers.data || []).map((p: any) => (
            <button key={p.code} onClick={() => connect(p.code)} disabled={saving} className="w-full text-left rounded-xl border border-[#e9edf2] p-4 hover:border-[#0b4a8f] hover:shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[14px] text-[#171a2e]">{p.name}</span>
                <Tag color={p.environment === 'SANDBOX' ? 'gold' : 'green'}>{p.environment}</Tag>
              </div>
              <div className="text-[12px] text-[#98A2B3] mt-1">Read-only · accounts, balances &amp; transactions · {p.capabilities.paymentInitiation ? 'payment initiation' : 'no payments'}</div>
            </button>
          ))}
        </div>
      </Drawer>

      <Modal open={!!manageId} onCancel={() => setManageId(null)} footer={null} title="Bank Accounts" width={720}>
        {(() => { const c = (connections.data || []).find((x: any) => x.id === manageId); return c ? <Table rowKey="id" dataSource={c.accounts} columns={accountCols} pagination={false} /> : null; })()}
      </Modal>
    </div>
  );
}
