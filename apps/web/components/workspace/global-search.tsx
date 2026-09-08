'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AutoComplete, Button, Drawer, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export type NavigationSearchItem = { label: string; value: string };

type Result = { id: string; type: string; title: string; subtitle?: string; href: string };

function SearchField({
  navigation,
  className,
  popupWidth,
  autoFocus,
}: {
  navigation: NavigationSearchItem[];
  className?: string;
  popupWidth?: number;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [remote, setRemote] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<React.ComponentRef<typeof AutoComplete>>(null);

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus?.(), 80);
  }, [autoFocus]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus?.();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < 2) { setRemote([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await api(`/workspace/search?q=${encodeURIComponent(q)}&limit=6`);
        setRemote(r.results || []);
      } catch {
        setRemote([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value]);

  const options = useMemo(() => {
    const q = value.trim().toLowerCase();
    const nav = q ? navigation.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 6) : [];
    const groups: any[] = [];
    if (remote.length) groups.push({
      label: 'Records',
      options: remote.map((r) => ({
        value: r.href,
        label: <div className="py-1"><div className="flex items-center gap-2"><Tag bordered={false} className="!m-0 !text-[10px]">{r.type}</Tag><span className="font-semibold text-[#252a3d]">{r.title}</span></div>{r.subtitle && <div className="text-[11px] text-[#81899d] mt-0.5 pl-[52px] truncate">{r.subtitle}</div>}</div>,
      })),
    });
    if (nav.length) groups.push({ label: 'Pages', options: nav.map((n) => ({ value: n.value, label: n.label })) });
    return groups;
  }, [remote, navigation, value]);

  return (
    <AutoComplete
      ref={inputRef}
      className={className || 'nex-global-search'}
      options={options}
      value={value}
      onChange={setValue}
      onSelect={(href) => { setValue(''); router.push(href); }}
      popupMatchSelectWidth={popupWidth ?? true}
      notFoundContent={value.trim().length >= 2 && !loading ? 'No matching records or pages' : null}
      filterOption={false}
      allowClear
      prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
      suffixIcon={<span className="hidden xl:inline text-[10px] text-[#98a0b2] border border-[#e2e6ef] rounded-md px-1.5 py-0.5 bg-white">Ctrl K</span>}
      placeholder={loading ? 'Searching…' : 'Search customers, invoices, items…'}
    />
  );
}

export function GlobalSearch({ navigation, compact }: { navigation: NavigationSearchItem[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);

  if (compact) {
    return (
      <>
        <Button
          type="text"
          className="nex-notif-btn"
          icon={<SearchOutlined />}
          aria-label="Search"
          onClick={() => setOpen(true)}
        />
        <Drawer
          title="Search"
          placement="top"
          height="auto"
          open={open}
          onClose={() => setOpen(false)}
          styles={{ body: { paddingTop: 8, paddingBottom: 20 } }}
        >
          <SearchField navigation={navigation} className="nex-global-search nex-global-search-mobile" autoFocus />
        </Drawer>
      </>
    );
  }

  return <SearchField navigation={navigation} popupWidth={390} />;
}
