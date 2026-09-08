'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Alert, Button, Space, Tag } from 'antd';
import { BugOutlined } from '@ant-design/icons';
import { useAuthPermissions } from '../Can';

interface DiagResult { test: string; result: string; durationMs: number; details?: any; correlationId?: string; }

// Developer Tools — the legacy smoke tests relocated here.
// Only Platform Admin / Technical Admin (permission integrations.diagnostics).
export function Diagnostics() {
  const { permissions } = useAuthPermissions();
  const canRun = permissions.includes('integrations.diagnostics');
  const qc = useQueryClient();
  const [results, setResults] = useState<DiagResult[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string, label: string) {
    setBusy(action); setError(null);
    try {
      const r = await api(`/integrations/diagnostics/${action}`, { method: 'POST' });
      setResults((prev) => [r, ...prev].slice(0, 10));
      qc.invalidateQueries({ queryKey: ['/integrations/status'] });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  }

  if (!canRun) return <Alert type="warning" showIcon message="Diagnostics are restricted to Platform Admin / Technical Admin (integrations.diagnostics)." />;

  const tests = [
    { action: 'payment', label: 'Payment Test', hint: 'Create simulated payment (mock)' },
    { action: 'email', label: 'Email Test', hint: 'Safe mock email' },
    { action: 'sms', label: 'SMS Test', hint: 'Safe mock SMS' },
    { action: 'storage', label: 'Storage Test', hint: 'Write → read → delete temp object' },
    { action: 'queue', label: 'Queue Test', hint: 'Enqueue simulated job' },
    { action: 'fiscal', label: 'Fiscal Mock Test', hint: 'Verify ZIMRA safe mode' },
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold" style={{ color: '#003366' }}>
        <BugOutlined /> Diagnostics
      </div>
      <Alert className="mb-3" type="warning" showIcon message="Developer tools — never executed against live providers. No charges, messages, fiscal receipts or real money move from these tests." />
      <Space wrap>
        {tests.map((t) => (
          <Button key={t.action} size="small" loading={busy === t.action} onClick={() => run(t.action, t.label)} title={t.hint}>{t.label}</Button>
        ))}
      </Space>
      {error && <Alert className="mt-3" type="error" showIcon message={error} />}
      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          {results.map((r, i) => (
            <div key={i} className="rounded border border-slate-200 p-2.5 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">{r.test}</span>
                <Tag color={r.result === 'SUCCESS' ? 'green' : 'red'}>{r.result}</Tag>
                <span className="text-slate-400">Duration {r.durationMs}ms</span>
                {r.correlationId && <code className="text-[11px] text-slate-400">{r.correlationId}</code>}
              </div>
              {r.details && Object.keys(r.details).length > 0 && (
                <pre className="mt-1.5 overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-600">{JSON.stringify(r.details, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
