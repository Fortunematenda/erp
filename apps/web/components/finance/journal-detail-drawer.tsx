'use client';
import { useQuery } from '@tanstack/react-query';
import { Button, Drawer, Skeleton, Table, Tag } from 'antd';
import Link from 'next/link';
import { api } from '@/lib/api';
import { StatusTag } from '@/components/crud-page';
import { fmtDate, fmtMoney } from '@/lib/format';

export function JournalDetailDrawer({ open, journalId, onClose }: { open: boolean; journalId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['finance', 'journal', journalId], queryFn: () => api(`/finance/journals/${journalId}`), enabled: open && !!journalId });
  const d = q.data;
  const totalDebit = d?.totalDebit || 0;
  const totalCredit = d?.totalCredit || 0;
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <Drawer open={open} onClose={onClose} width={620} destroyOnHidden title={d ? `Journal ${d.number}` : 'Journal Entry'}
      extra={<Button type="text" onClick={onClose}><span className="text-[16px]">&times;</span></Button>}>
      {q.isFetching && !d ? <Skeleton active paragraph={{ rows: 8 }} /> : (
        <div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-4 text-[13px] text-[#5a6080]">
            <span><span className="text-[#98A2B3]">Date</span> {d ? fmtDate(d.date) : '—'}</span>
            <span><span className="text-[#98A2B3]">Status</span> {d ? <StatusTag value={d.status} /> : '—'}</span>
            <span><span className="text-[#98A2B3]">Created by</span> <span className="text-[#171a2e]">{d?.createdBy ? d.createdBy.slice(0, 8) : '—'}</span></span>
            {d?.source && <span><span className="text-[#98A2B3]">Source</span> {d.source.number ? <Link href={d.source.route}><span className="font-mono text-[12px] text-[#003366] hover:underline">{d.source.number}</span></Link> : (d.source.label || '—')}</span>}
          </div>
          <div className="text-[13px] text-[#171a2e] mb-4">{d?.description}</div>
          {d?.reference && <div className="text-[12px] text-[#98A2B3] mb-3">Reference: {d.reference}</div>}

          <div className="nex-card overflow-hidden mb-4">
            <div className="text-[12px] font-semibold text-[#98A2B3] uppercase tracking-wide px-4 pt-3 pb-1">Journal Lines</div>
            <Table size="small" rowKey="id" dataSource={d?.lines || []} pagination={false}
              columns={[
                { title: 'Account', render: (_, l: any) => <span><span className="font-mono text-[12px] text-[#003366]">{l.accountCode}</span> <span className="font-medium">{l.accountName}</span></span> },
                { title: 'Description', dataIndex: 'description', ellipsis: true },
                { title: 'Debit', dataIndex: 'debit', align: 'right', render: (v) => <span className="font-semibold text-[#10b981]">{fmtMoney(v)}</span> },
                { title: 'Credit', dataIndex: 'credit', align: 'right', render: (v) => <span className="font-semibold text-[#ef4444]">{fmtMoney(v)}</span> },
              ]} />
            <div className="flex items-center justify-between border-t border-[#f2f3f9] px-4 py-2.5 text-[13px]">
              <span className="font-medium text-[#5a6080]">Totals</span>
              <div className="flex items-center gap-5">
                <span className="font-semibold text-[#10b981]">Dr {fmtMoney(totalDebit)}</span>
                <span className="font-semibold text-[#ef4444]">Cr {fmtMoney(totalCredit)}</span>
                <Tag color={balanced ? 'green' : 'red'}>{balanced ? 'Balanced' : `Diff ${fmtMoney(d?.difference)}`}</Tag>
              </div>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
