'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Select, Tag } from 'antd';
import { Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const STATUS_LABEL: Record<string, string> = { OPEN: 'Booked', IN_PREPARATION: 'In progress', READY: 'Ready for collection' };
const NEXT: Record<string, string[]> = { OPEN: ['IN_PREPARATION'], IN_PREPARATION: ['READY'], READY: ['IN_PREPARATION'] };

export default function Page() {
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [canCancel, setCanCancel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const boot = await api('/pos/bootstrap');
      setCurrency(boot.currency);
      setCanCancel(!!boot.can?.['pos.cancel']);
      setJobs(await api(`/pos/orders?mode=SERVICE&cart=ACTIVE&branchId=${boot.branch.id}`));
    } catch (e: any) { notify.error(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function move(id: string, status: string) {
    try { await api(`/pos/orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); load(); } catch (e: any) { notify.error(e.message); }
  }
  async function cancel(job: any) {
    const reason = window.prompt(`Cancel job ${job.saleNo}? Enter a reason.`);
    if (!reason) return;
    try { await api(`/pos/orders/${job.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); load(); } catch (e: any) { notify.error(e.message); }
  }

  const shown = filter ? jobs.filter((j) => j.orderStatus === filter) : jobs;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="primary" icon={<Plus size={14} />} onClick={() => router.push('/pos/terminal/services')}>New job</Button>
        <Select className="min-w-[180px]" value={filter} onChange={setFilter} options={[{ value: '', label: 'All open jobs' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
        <Button icon={<RefreshCw size={14} />} loading={loading} onClick={load}>Refresh</Button>
      </div>
      {!shown.length && !loading && <Empty description="No open jobs. Start one from the services terminal and choose Save job." />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((job) => {
          const deposits = (job.tenders || []).filter((t: any) => t.kind === 'DEPOSIT').reduce((s: number, t: any) => s + Number(t.amount), 0);
          return (
            <div key={job.id} className="rounded-2xl border border-[#e6e9f0] bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[14px] font-semibold text-[#171a2e]">{job.saleNo}</div>
                  <div className="text-[12px] text-[#64748b]">{job.customer?.name || 'No customer'} · {new Date(job.createdAt).toLocaleDateString()}</div>
                </div>
                <Tag color={job.orderStatus === 'READY' ? 'green' : job.orderStatus === 'IN_PREPARATION' ? 'blue' : 'default'} className="!m-0">{STATUS_LABEL[job.orderStatus] || job.orderStatus}</Tag>
              </div>
              <div className="mt-2 text-[13px] text-[#334155]">{(job.lines || []).map((l: any) => l.description).join(', ') || 'No items yet'}</div>
              {job.assignedEmployee && <div className="mt-1 text-[12px] text-[#64748b]">Assigned to {job.assignedEmployee.firstName} {job.assignedEmployee.lastName}</div>}
              <div className="mt-3 flex items-center justify-between text-[13px]">
                <span className="font-semibold">{currency} {Number(job.total).toFixed(2)}</span>
                {deposits > 0 && <span className="text-[#16a34a]">Deposit {currency} {deposits.toFixed(2)}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="primary" size="small" onClick={() => router.push(`/pos/terminal/services?order=${job.id}`)}>Open</Button>
                {(NEXT[job.orderStatus] || []).map((s) => <Button key={s} size="small" onClick={() => move(job.id, s)}>{STATUS_LABEL[s]}</Button>)}
                {canCancel && deposits === 0 && <Button size="small" danger onClick={() => cancel(job)}>Cancel</Button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
