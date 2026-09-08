'use client';
import { useMemo } from 'react';
import { Select, Tag } from 'antd';
import { useMeta } from '@/lib/meta';

// Maps COA AccountType -> friendly badge label + colour.
const TYPE_META: Record<string, { label: string; color: string }> = {
  ASSET: { label: 'ASSET', color: '#0ea5e9' },
  LIABILITY: { label: 'LIABILITY', color: '#a855f7' },
  EQUITY: { label: 'EQUITY', color: '#f59e0b' },
  REVENUE: { label: 'INCOME', color: '#16a34a' },
  EXPENSE: { label: 'EXPENSE', color: '#ef4444' },
};
// Heuristic for cash/bank-type accounts (COA type is only ASSET).
const CASH_RE = /cash|bank|petty|undeposited|wallet|current account|operating account|checking|savings|money market|monet/i;
function cashLike(a: any) { return CASH_RE.test(`${a.code} ${a.name}`); }
function findType(a: any): { label: string; color: string } {
  const t = String(a.type || '').toUpperCase();
  const meta = TYPE_META[t] || { label: t || 'ACCOUNT', color: '#64748b' };
  // Overlay fine-grained badge for cash/bank assets.
  if (t === 'ASSET' && cashLike(a)) return { label: cashLike(a) && /\bbank\b|banking|bank account/i.test(a.name) ? 'BANK' : 'CASH', color: '#16a34a' };
  if (t === 'LIABILITY' && /payable/i.test(a.name)) return { label: 'A/P', color: '#a855f7' };
  if (t === 'ASSET' && /receivable/i.test(a.name)) return { label: 'A/R', color: '#0ea5e9' };
  return meta;
}

// Normalise contextual allowedTypes (aliases -> COA types + cash/bank kept).
function allowedCoaTypes(allowedTypes?: string[]): { types: string[]; cashOnly: boolean } {
  const set = new Set<string>();
  let cashOnly = false;
  (allowedTypes || []).forEach((raw) => {
    const t = String(raw).toUpperCase();
    if (t === 'CASH' || t === 'BANK' || t === 'UNDEPOSITED_FUNDS') { set.add('ASSET'); cashOnly = true; }
    else if (t === 'INCOME' || t === 'COGS' || t === 'REVENUE') set.add('REVENUE');
    else if (t === 'A/P' || t === 'EXPENSE') set.add('EXPENSE');
    else set.add(t);
    if (t === 'A/P' || t === 'LIABILITY') set.add('LIABILITY');
  });
  if (!allowedTypes || !allowedTypes.length) return { types: [], cashOnly: false };
  return { types: [...set], cashOnly };
}

// Reusable, system-wide Chart-of-Accounts selector.
// - hierarchical grouping (parent -> sub-accounts), ordered by account code
// - account-type badge on every option
// - search by code / name / type
// - contextual filtering via allowedTypes (e.g. ['BANK','CASH','UNDEPOSITED_FUNDS'])
export function AccountSelector({ value, onChange, allowedTypes, placeholder = 'Select account', allowClear = true, className, postingOnly }: { value?: string | null; onChange?: (v: string | undefined) => void; allowedTypes?: string[]; placeholder?: string; allowClear?: boolean; className?: string; postingOnly?: boolean }) {
  const meta = useMeta();
  const accounts = useMemo(() => (Array.isArray(meta.data?.accounts) ? meta.data?.accounts : []), [meta.data]);
  const { types, cashOnly } = useMemo(() => allowedCoaTypes(allowedTypes), [allowedTypes]);

  const filtered = useMemo(() => accounts
    .filter((a: any) => a.active !== false)
    .filter((a: any) => (!types.length || types.includes(a.type)) && (!cashOnly || cashLike(a)))
    .sort((a: any, b: any) => String(a.code).localeCompare(String(b.code))), [accounts, types, cashOnly]);

  const tree = useMemo(() => {
    const byId: Record<string, any> = {};
    filtered.forEach((a: any) => { byId[a.id] = { ...a, depth: 0, children: [] as any[] }; });
    const roots: any[] = [];
    filtered.forEach((a: any) => { const n = byId[a.id]; const p = a.parentId ? byId[a.parentId] : null; if (p) p.children.push(n); else roots.push(n); });
    const out: any[] = [];
    const walk = (list: any[], depth: number) => { list.forEach((n) => { n.depth = depth; n.hasChildren = n.children.length > 0; out.push(n); walk(n.children, depth + 1); }); };
    walk(roots, 0);
    return out;
  }, [filtered]);

  const options = useMemo(() => tree.map((a: any) => {
    const t = findType(a);
    return {
      value: a.id,
      searchText: `${a.code} ${a.name} ${a.type} ${t.label}`.toLowerCase(),
      disabled: postingOnly ? a.hasChildren : false,
      label: (
        <div className="flex items-center gap-2" style={{ paddingLeft: a.depth * 16 }}>
          <span className="font-mono text-[12px] text-[#64748b]">{a.code}</span>
          <span className="text-[13px] text-[#171a2e] flex-1 truncate">{a.name}</span>
          <Tag className="!text-[10px] !px-1.5 !leading-4 !m-0" style={{ color: t.color, background: `${t.color}14`, borderColor: `${t.color}33` }}>{t.label}</Tag>
        </div>
      ),
    };
  }), [tree]);

  return (
    <Select
      className={className}
      value={value || undefined}
      onChange={(v) => onChange?.(v)}
      placeholder={placeholder}
      allowClear={allowClear}
      showSearch
      filterOption={(input, option: any) => option?.searchText?.includes(input.toLowerCase())}
      options={options}
    />
  );
}
