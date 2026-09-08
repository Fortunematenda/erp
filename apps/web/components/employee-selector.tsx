'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';

export function useEmployees() {
  const [term, setTerm] = useState('');
  const q = useQuery({ queryKey: ['/crm/employees', term], queryFn: () => api(`/crm/employees${term ? `?q=${encodeURIComponent(term)}` : ''}`) });
  return { employees: q.data || [], loading: q.isLoading, term, setTerm };
}

export function EmployeeSelector({ value, onChange, placeholder = 'Select employee', allowClear = true, style }: { value?: string; onChange?: (v: string) => void; placeholder?: string; allowClear?: boolean; style?: React.CSSProperties }) {
  const { employees, loading, term, setTerm } = useEmployees();
  const options = useMemo(() => employees.map((e: any) => ({ label: e.name, value: e.id, search: `${e.name} ${e.email || ''} ${e.employeeNo || ''} ${e.position || ''}` })), [employees]);
  return (
    <Select
      showSearch
      allowClear={allowClear}
      placeholder={placeholder}
      value={value || undefined}
      onChange={onChange}
      loading={loading}
      style={{ width: '100%', ...style }}
      filterOption={(input, opt) => String((opt as any)?.search || '').toLowerCase().includes(input.toLowerCase())}
      onSearch={(v) => setTerm(v)}
      optionRender={(opt) => {
        const e = employees.find((x: any) => x.id === opt.value);
        return (
          <div className="flex items-center gap-2.5 py-0.5">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg,#003366,#1d5fb5)' }}>{(e?.firstName || '?').charAt(0)}{(e?.lastName || '').charAt(0)}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5"><span className="font-medium text-[13px] text-[#171a2e] truncate">{opt.label}</span>{e?.employeeNo ? <span className="text-[10px] text-[#8a90ad]">{e.employeeNo}</span> : null}</div>
              <div className="text-[11px] text-[#8a90ad] truncate">{[e?.position, e?.branch, e?.email].filter(Boolean).join(' · ') || <span className="flex items-center gap-1"><UserOutlined />Internal employee</span>}</div>
            </div>
          </div>
        );
      }}
      options={options}
    />
  );
}
