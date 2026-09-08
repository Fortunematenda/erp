'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Meta = {
  branches: any[];
  departments: any[];
  accounts: any[];
  customers: any[];
  suppliers: any[];
  items: any[];
  warehouses: any[];
  employees: any[];
  taxRates: any[];
  plans: any[];
  categories: any[];
  priceLists: any[];
};

function withEmployeeNames(rows: any[] | undefined) {
  return (rows || []).map((e) => ({
    ...e,
    name: e.name || `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email || e.employeeNo || e.id,
  }));
}

export function useMeta() {
  return useQuery<Meta>({
    queryKey: ['meta'],
    queryFn: async () => {
      const data = await api('/companies/meta');
      return { ...data, employees: withEmployeeNames(data?.employees) };
    },
    staleTime: 60_000,
  });
}
