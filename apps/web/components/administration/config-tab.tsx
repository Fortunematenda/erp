'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Input, InputNumber, Select, Switch, Tabs, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { HelpTooltip } from './shared';

export function ConfigTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const schema = useQuery({ queryKey: ['/admin/config/schema'], queryFn: () => api('/admin/config/schema') });
  const values = useQuery({ queryKey: ['/admin/config'], queryFn: () => api('/admin/config') });

  const groups = (schema.data || []).map((g: any) => ({
    ...g,
    filtered: !search || g.label.toLowerCase().includes(search.toLowerCase()) || g.fields.some((f: any) => f.label.toLowerCase().includes(search.toLowerCase())),
  }));

  const items = groups.filter((g: any) => g.filtered).map((g: any) => ({
    key: g.id,
    label: g.label,
    children: <GroupForm group={g} initial={values.data?.[g.id]?.values} onSaved={() => qc.invalidateQueries({ queryKey: ['/admin/config'] })} />,
  }));

  return (
    <>
      <div className="nex-card mb-4 px-4 py-3 flex flex-wrap items-center gap-3">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search settings…" className="w-72 !rounded-xl" onChange={(e) => setSearch(e.target.value)} />
        <div className="text-[12px] text-slate-400">Settings are grouped by module. Secrets are stored encrypted and never displayed.</div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-slate-400">{groups.filter((g: any) => g.filtered).length} groups</span>
          <Button icon={<ReloadOutlined />} onClick={() => { qc.invalidateQueries({ queryKey: ['/admin/config'] }); qc.invalidateQueries({ queryKey: ['/admin/config/schema'] }); }} />
        </div>
      </div>
      {values.isLoading || schema.isLoading ? <div className="py-10 text-center text-slate-400">Loading…</div> : (
        <Tabs items={items} tabPosition="left" tabBarStyle={{ minWidth: 190 }} />
      )}
    </>
  );
}

function GroupForm({ group, initial, onSaved }: { group: any; initial?: any; onSaved?: () => void }) {
  const [form, setForm] = useState<Record<string, any>>(() => {
    const out: Record<string, any> = {};
    group.fields.forEach((f: any) => { out[f.key] = f.default ?? (f.type === 'toggle' ? false : ''); });
    return out;
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    try {
      setSaving(true);
      await api(`/admin/config/${group.id}`, { method: 'PUT', body: JSON.stringify({ values: form }) });
      message.success(`${group.label} saved`);
      onSaved?.();
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  return (
    <div>
      <p className="text-[13px] text-slate-500 mb-4">{group.description}</p>
      <div className="space-y-0">
        {group.fields.map((f: any) => (
          <div key={f.key} className="flex items-start justify-between gap-6 py-3 border-b border-slate-100 last:border-0">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-slate-700 flex items-center">
                {f.label}
                {f.hint && <HelpTooltip text={f.hint} />}
              </div>
              {f.type === 'secret' && <div className="text-[11.5px] text-slate-400">{form[f.key]?.set ? 'Stored (encrypted)' : 'Not configured'}</div>}
            </div>
            <div className="w-56 shrink-0">
              {f.type === 'toggle' && <Switch checked={!!form[f.key]} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />}
              {f.type === 'select' && <Select className="w-full" value={form[f.key] ?? undefined} options={(f.options || []).map((o: any) => ({ value: o, label: o }))} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />}
              {f.type === 'number' && <InputNumber className="w-full" value={form[f.key]} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />}
              {f.type === 'text' && <Input value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />}
              {f.type === 'secret' && <Input.Password placeholder={form[f.key]?.set ? '•••••••• (keep existing)' : 'Set secret…'} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />}
            </div>
          </div>
        ))}
      </div>
      <Button type="primary" className="mt-4" loading={saving} onClick={save}>Save {group.label}</Button>
    </div>
  );
}

export default ConfigTab;
