'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Button, Skeleton, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney, fmtNumber } from '@/lib/format';
import { Can } from '@/components/Can';
import { SoftBadge } from '@/components/crud-page';
import { DatasetTable, DrillDrawer, LoadOrError, Money, exportReportCsv, invoiceLink, billLink, EmptyState, tableRowKey } from './report-renderers';
import { ReportCtx } from './report-renderers';

const qs = (params: Record<string, any>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '' && v !== 'ALL') q.set(k, String(v));
  const s = q.toString(); return s ? `?${s}` : '';
};

/* ================================ PURCHASING ================================ */
export function PurchasingTab({ ctx }: { ctx: ReportCtx }) {
  const ap = { asOf: ctx.win.to || undefined };
  const apQ = useQuery({ queryKey: ['ap-aging', ap.asOf], queryFn: () => api(`/procurement/ap-aging${qs(ap)}`) });
  const [drill, setDrill] = useState<any>(null);
  const bva = useQuery({ queryKey: ['supplier-payments'], queryFn: () => api('/procurement/supplier-payments') });

  return (
    <div className="space-y-5">
      {/* By supplier */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-bold text-[#171a2e]">Purchases by Supplier</span>
          <button className="no-print text-[12px] text-[#1d5fb5] hover:underline" onClick={() => exportReportCsv('purchases-by-supplier', ctx, 'Purchases by Supplier', [
            { key: 'supplier', label: 'Supplier' }, { key: 'bills', label: 'Bills' }, { key: 'total', label: 'Purchases' }, { key: 'paid', label: 'Paid' }, { key: 'outstanding', label: 'Outstanding' },
          ], [])}>CSV</button>
        </div>
        <DatasetTable ctx={ctx} dataset="PURCHASE_BY_SUPPLIER" title="Purchases by Supplier" drill={(r: any) => setDrill(r)} />
      </div>

      {/* Supplier bills */}
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Supplier Bills</div>
        <DatasetTable ctx={ctx} dataset="SUPPLIER_BILLS" title="Supplier Bills" />
      </div>

      {/* A/P aging */}
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">A/P Aging</div>
        <LoadOrError q={apQ} label="A/P Aging">
          {(d) => {
            const byVendor = d.byVendor || d.bySupplier || [];
            const summary = d.summary || {};
            return (
              <>
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus'].map((k) => (
                    <div key={k} className="nex-card border rounded-lg px-3 py-2 text-center">
                      <div className="text-[11px] text-[#64748b]">{k === 'current' ? 'Current' : k.replace('d', '').replace('_', '–') + 'd'}</div>
                      <div className="text-[15px] font-semibold text-[#171a2e]">{fmtMoney((summary as any)[k])}</div>
                    </div>
                  ))}
                </div>
                <Table rowKey={(r: any) => tableRowKey(r, r.supplierId, r.supplier?.id, r.name)} size="small" dataSource={byVendor} pagination={{ pageSize: 15 }} columns={[
                  { title: 'Supplier', render: (_v, r: any) => <a className="text-[13px] font-medium text-[#1d5fb5]" onClick={() => setDrill(r)}>{r.supplier?.name || r.name || '—'}</a> },
                  { title: 'Current', align: 'right', dataIndex: 'current', render: (v: any) => <Money v={v} /> },
                  { title: '1–30', align: 'right', dataIndex: 'd1_30', render: (v: any) => <Money v={v} /> },
                  { title: '31–60', align: 'right', dataIndex: 'd31_60', render: (v: any) => <Money v={v} /> },
                  { title: '61–90', align: 'right', dataIndex: 'd61_90', render: (v: any) => <Money v={v} /> },
                  { title: '90+', align: 'right', dataIndex: 'd90plus', render: (v: any) => <Money v={v} color="#dc2626" bold /> },
                  { title: 'Total', align: 'right', dataIndex: 'total', render: (v: any) => <Money v={v} bold /> },
                ] as ColumnsType<any>} />
              </>
            );
          }}
        </LoadOrError>
      </div>

      {/* Supplier payments */}
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Supplier Payments</div>
        <LoadOrError q={bva} label="Supplier Payments">
          {(d) => {
            const rows = Array.isArray(d) ? d : d.rows || [];
            return <Table rowKey={(r: any) => tableRowKey(r)} size="small" dataSource={rows} pagination={{ pageSize: 15 }} columns={[
              { title: 'Payment #', dataIndex: 'paymentNo', render: (v: any, r: any) => v || r.number || '—' },
              { title: 'Date', dataIndex: 'paymentDate', render: (v: any, r: any) => fmtDate(v || r.date) },
              { title: 'Supplier', render: (_v, r: any) => r.supplier?.name || r.supplierName || '—' },
              { title: 'Amount', align: 'right', dataIndex: 'amount', render: (v: any) => <Money v={v} bold /> },
              { title: 'Method', dataIndex: 'method', render: (v: any) => v || '—' },
            ] as ColumnsType<any>} />;
          }}
        </LoadOrError>
      </div>

      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} title={drill?.supplier || drill?.name || ''} subtitle={`${drill?.bills ?? '—'} bills · Outstanding ${fmtMoney(drill?.outstanding)}`}>
        {drill && <Table rowKey="id" size="small" dataSource={drill._children || drill.children || []} pagination={{ pageSize: 15 }} columns={[
          { title: 'Bill', render: (_v, x) => billLink(x.invoiceNo, x.id) },
          { title: 'Date', dataIndex: 'invoiceDate', render: (v: any) => fmtDate(v) },
          { title: 'Total', align: 'right', dataIndex: 'total', render: (v: any) => <Money v={v} bold /> },
          { title: 'Outstanding', align: 'right', dataIndex: 'outstanding', render: (v: any) => <Money v={v} color={Number(v) > 0 ? '#dc2626' : undefined} /> },
          { title: 'Status', dataIndex: 'paymentStatus', render: (v: any) => <Tag>{String(v).replace(/_/g, ' ')}</Tag> },
        ] as ColumnsType<any>} />}
      </DrillDrawer>
    </div>
  );
}

/* ================================ CUSTOMERS ================================ */
export function CustomersTab({ ctx }: { ctx: ReportCtx }) {
  const [bucket, setBucket] = useState<string | null>(null);
  const [drill, setDrill] = useState<any>(null);
  const debtors = useQuery({ queryKey: ['debtor-age'], queryFn: () => api('/sales/debtor-age') });
  const customers = useQuery({ queryKey: ['cust-dir'], queryFn: () => api('/sales/customers') });
  const creditNotes = useQuery({ queryKey: ['cn'], queryFn: () => api('/sales/credit-notes') });

  return (
    <div className="space-y-5">
      {/* Customer summary */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-bold text-[#171a2e]">Customer Summary</span>
          <button className="no-print text-[12px] text-[#1d5fb5] hover:underline" onClick={() => exportReportCsv('customer-summary', ctx, 'Customer Summary', [
            { key: 'name', label: 'Customer' }, { key: 'email', label: 'Email' }, { key: 'creditLimit', label: 'Credit Limit' }, { key: 'outstanding', label: 'Outstanding' },
          ], [])}>CSV</button>
        </div>
        <DatasetTable ctx={ctx} dataset="CUSTOMERS" title="Customer Directory" drill={(r: any) => setDrill(r)} />
      </div>

      {/* Debtor ageing */}
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Debtor Ageing</div>
        <LoadOrError q={debtors} label="Debtor Ageing">
          {(d) => {
            const s = d.summary || {};
            return (
              <>
                <div className="grid grid-cols-5 gap-2 mb-3">
                  {[['Current', s.current], ['1–30', s.d30], ['31–60', s.d60], ['61–90', s.d90], ['90+', s.d90plus]].map(([label, v]: any) => (
                    <div key={label} className="nex-card border rounded-lg px-3 py-2 text-center">
                      <div className="text-[11px] text-[#64748b]">{label}</div><div className="text-[15px] font-semibold text-[#171a2e]">{fmtMoney(v)}</div>
                    </div>
                  ))}
                </div>
                <Table rowKey={(r: any) => tableRowKey(r, r.customer?.id, r.customerId)} size="small" dataSource={d.byCustomer} pagination={{ pageSize: 15 }} columns={[
                  { title: 'Customer', render: (_v, r: any) => <a className="text-[13px] font-medium text-[#1d5fb5]" onClick={() => setDrill(r.customer)}>{r.customer?.name || 'Cash / None'}</a> },
                  { title: 'Current', align: 'right', dataIndex: 'current', render: (v: any) => <Money v={v} /> },
                  { title: '1–30', align: 'right', dataIndex: 'd30', render: (v: any) => <Money v={v} /> },
                  { title: '31–60', align: 'right', dataIndex: 'd60', render: (v: any) => <Money v={v} /> },
                  { title: '61–90', align: 'right', dataIndex: 'd90', render: (v: any) => <Money v={v} /> },
                  { title: '90+', align: 'right', dataIndex: 'd90plus', render: (v: any) => <Money v={v} color="#dc2626" bold /> },
                  { title: 'Total', align: 'right', dataIndex: 'total', render: (v: any) => <Money v={v} bold /> },
                ] as ColumnsType<any>} />
              </>
            );
          }}
        </LoadOrError>
      </div>

      {/* Outstanding invoices */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-bold text-[#171a2e]">Outstanding Invoices {bucket && <Tag color="blue">{bucket}</Tag>}</span>
          {bucket && <Button size="small" onClick={() => setBucket(null)}>Clear bucket</Button>}
        </div>
        <DatasetTable ctx={ctx} dataset="OUTSTANDING_INVOICES" title="Outstanding Invoices" extraParams={bucket ? { bucket } : {}} />
      </div>

      {/* Credit notes */}
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Credit Notes</div>
        <DatasetTable ctx={ctx} dataset="CREDIT_NOTES" title="Credit Notes" />
      </div>

      {/* Customer statement drawer */}
      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} title={drill?.name || ''} subtitle={`Outstanding ${fmtMoney(drill?.outstanding)} · Credit limit ${fmtMoney(drill?.creditLimit)}`}>
        {drill && <CustomerStatement customerId={drill.id} />}
      </DrillDrawer>
    </div>
  );
}

function CustomerStatement({ customerId }: { customerId: string }) {
  const trail = useQuery({ queryKey: ['cust-trail', customerId], queryFn: () => api(`/sales/customers/${customerId}/trail`) });
  const payments = useQuery({ queryKey: ['cust-pay', customerId], queryFn: () => api(`/sales/customers/${customerId}/payments/summary`) });
  return (
    <div className="space-y-4">
      <LoadOrError q={payments} label="Payments">
        {(d) => (
          <div className="grid grid-cols-3 gap-3">
            {[['Total Billed', d.totalBilled], ['Total Paid', d.totalPaid], ['Outstanding', d.outstanding]].map(([l, v]: any) => (
              <div key={l} className="nex-card border rounded-lg px-3 py-2 text-center"><div className="text-[11px] text-[#64748b]">{l}</div><div className="text-[15px] font-semibold">{fmtMoney(v)}</div></div>
            ))}
          </div>
        )}
      </LoadOrError>
      <LoadOrError q={trail} label="Statement">
        {(d) => {
          const rows = Array.isArray(d) ? d : (d.rows || d.entries || []);
          if (!rows.length) return <EmptyState title="No activity" hint="No transactions found for this customer in the current data." />;
          return <Table rowKey={(r: any) => tableRowKey(r, r.date, r.type, r.number, r.amount)} size="small" dataSource={rows} pagination={{ pageSize: 15 }} columns={[
            { title: 'Date', dataIndex: 'date', render: (v: any) => fmtDate(v) },
            { title: 'Type', dataIndex: 'type', render: (v: any) => <Tag>{String(v || '—').replace(/_/g, ' ')}</Tag> },
            { title: 'Document', dataIndex: 'number', render: (v: any, r: any) => r.invoiceId ? invoiceLink(v, r.invoiceId) : v || '—' },
            { title: 'Amount', align: 'right', dataIndex: 'amount', render: (v: any) => <Money v={v} bold /> },
          ] as ColumnsType<any>} />;
        }}
      </LoadOrError>
    </div>
  );
}

/* ================================ INVENTORY ================================ */
export function InventoryTab({ ctx }: { ctx: ReportCtx }) {
  const [drill, setDrill] = useState<any>(null);
  const items = useQuery({ queryKey: ['inv-items'], queryFn: () => api('/inventory/items') });
  const warehouses = useQuery({ queryKey: ['wh'], queryFn: () => api('/inventory/warehouses') });
  const categories = useQuery({ queryKey: ['icat'], queryFn: () => api('/inventory/categories') });

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[14px] font-bold text-[#171a2e]">Stock Valuation</span>
          <button className="no-print text-[12px] text-[#1d5fb5] hover:underline" onClick={() => exportReportCsv('stock-valuation', ctx, 'Stock Valuation', [
            { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Item' }, { key: 'onHand', label: 'On Hand' }, { key: 'avgCost', label: 'Avg Cost' }, { key: 'value', label: 'Value' },
          ], [])}>CSV</button>
        </div>
        <DatasetTable ctx={ctx} dataset="INVENTORY_ITEMS" title="Stock Valuation" drill={(r: any) => setDrill(r)} />
      </div>

      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Stock Movement</div>
        <DatasetTable ctx={ctx} dataset="INVENTORY_MOVEMENTS" title="Stock Movement" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Can permission="inventory.view">
          <div>
            <div className="text-[14px] font-bold text-[#171a2e] mb-2">Fast-Moving Items</div>
            <MiniReport path="/inventory/reports/best-sellers" empty="No sales recorded in this period." />
          </div>
          <div>
            <div className="text-[14px] font-bold text-[#171a2e] mb-2">Slow-Moving Items</div>
            <MiniReport path="/inventory/reports/slow-moving" empty="All items have recent movement." />
          </div>
          <div>
            <div className="text-[14px] font-bold text-[#171a2e] mb-2">Non-Moving Items</div>
            <MiniReport path="/inventory/reports/dead-stock" empty="No dead stock." />
          </div>
          <div>
            <div className="text-[14px] font-bold text-[#171a2e] mb-2">Reorder Report</div>
            <MiniReport path="/inventory/reorder" empty="Nothing below reorder level." />
          </div>
        </Can>
      </div>

      <DrillDrawer open={!!drill} onClose={() => setDrill(null)} title={drill?.name || ''} subtitle={`${drill?.sku || ''} · On hand ${fmtNumber(drill?.onHand)} · Value ${fmtMoney(drill?.value)}`}>
        {drill && <ItemDetail itemId={drill.id} />}
      </DrillDrawer>
    </div>
  );
}

function MiniReport({ path, empty }: { path: string; empty: string }) {
  const q = useQuery({ queryKey: ['mini', path], queryFn: () => api(path) });
  if (q.isLoading) return <div className="p-4"><Skeleton active /></div>;
  const rows = Array.isArray(q.data) ? q.data : (q.data?.rows || []);
  if (!rows.length) return <EmptyState title="No data" hint={empty} />;
  const cols = Object.keys(rows[0]).filter((k) => !['id', 'itemId', 'movements'].includes(k)).slice(0, 6);
  return <Table rowKey={(r: any) => tableRowKey(r, r.sku, r.name)} size="small" dataSource={rows} pagination={{ pageSize: 8 }} columns={cols.map((k) => ({
    title: k.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase()), dataIndex: k,
    align: typeof rows[0][k] === 'number' ? 'right' as const : 'left' as const,
    render: (v: any) => typeof v === 'number' ? (String(k).match(/cost|value|price|revenue|sales/i) ? fmtMoney(v) : fmtNumber(v)) : String(v ?? '—'),
  })) as ColumnsType<any>} />;
}

function ItemDetail({ itemId }: { itemId: string }) {
  const item = useQuery({ queryKey: ['item', itemId], queryFn: () => api(`/inventory/items/${itemId}`) });
  const movements = useQuery({ queryKey: ['item-mov', itemId], queryFn: () => api(`/inventory/movements${qs({ itemId })}`) });
  return (
    <div className="space-y-4">
      {item.data && (
        <div className="grid grid-cols-3 gap-3">
          {[['Selling Price', fmtMoney(item.data.sellingPrice)], ['Purchase Cost', fmtMoney(item.data.purchaseCost)], ['Reorder Level', fmtNumber(item.data.reorderLevel)]].map(([l, v]) => (
            <div key={l} className="nex-card border rounded-lg px-3 py-2 text-center"><div className="text-[11px] text-[#64748b]">{l}</div><div className="text-[14px] font-semibold">{v}</div></div>
          ))}
        </div>
      )}
      <div className="text-[13px] font-bold text-[#171a2e]">Recent Movements</div>
      <LoadOrError q={movements} label="Movements">
        {(d) => {
          const rows = Array.isArray(d) ? d : (d.rows || d.movements || []);
          if (!rows.length) return <EmptyState title="No movements" hint="This item has no stock movements recorded." />;
          return <Table rowKey={(r: any) => tableRowKey(r, r.occurredAt, r.type, r.quantity, r.warehouseId)} size="small" dataSource={rows} pagination={{ pageSize: 12 }} columns={[
            { title: 'Date', dataIndex: 'occurredAt', render: (v: any) => fmtDate(v) },
            { title: 'Type', dataIndex: 'type', render: (v: any) => <Tag>{String(v).replace(/_/g, ' ')}</Tag> },
            { title: 'Qty', align: 'right', dataIndex: 'quantity', render: (v: any) => fmtNumber(v) },
            { title: 'Unit Cost', align: 'right', dataIndex: 'unitCost', render: (v: any) => <Money v={v} /> },
            { title: 'Warehouse', dataIndex: 'warehouse', render: (v: any) => typeof v === 'object' ? v?.name || '—' : v || '—' },
          ] as ColumnsType<any>} />;
        }}
      </LoadOrError>
    </div>
  );
}

/* ================================ HR & PAYROLL ================================ */
export function HrTab({ ctx }: { ctx: ReportCtx }) {
  const cycles = useQuery({ queryKey: ['perf-cycles'], queryFn: () => api('/performance/cycles') });
  const [perfCycle, setPerfCycle] = useState<string | null>(null);
  const [perfDept, setPerfDept] = useState<string | null>(null);
  const perf = useQuery({
    queryKey: ['perf-completion', perfCycle, perfDept],
    queryFn: () => api(`/performance/assessments${qs({ cycleId: perfCycle || undefined, departmentId: perfDept || undefined })}`),
  });
  const departments = useQuery({ queryKey: ['hr-depts'], queryFn: () => api('/hr/departments') });

  return (
    <div className="space-y-5">
      <Tabs size="small" items={[
        { key: 'workforce', label: 'Workforce', children: (
          <div className="space-y-4">
            <div>
              <div className="text-[14px] font-bold text-[#171a2e] mb-2">Employee Directory</div>
              <DatasetTable ctx={ctx} dataset="EMPLOYEES" title="Employee Directory" />
            </div>
          </div>
        ) },
        { key: 'leave', label: 'Leave', children: (
          <div>
            <div className="text-[14px] font-bold text-[#171a2e] mb-2">Leave Balances</div>
            <DatasetTable ctx={ctx} dataset="LEAVE_BALANCES" title="Leave Balances" />
          </div>
        ) },
        { key: 'attendance', label: 'Attendance', children: (
          <div>
            <div className="text-[14px] font-bold text-[#171a2e] mb-2">Attendance Records</div>
            <DatasetTable ctx={ctx} dataset="ATTENDANCE" title="Attendance" />
          </div>
        ) },
        { key: 'performance', label: 'Performance', children: (
          <Can permission="performance.reports.view">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <select className="ant-select ant-select-sm border rounded px-2 py-1" value={perfCycle || ''} onChange={(e) => setPerfCycle(e.target.value || null)} style={{ minWidth: 180 }}>
                  <option value="">All Cycles</option>
                  {(cycles.data || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="ant-select ant-select-sm border rounded px-2 py-1" value={perfDept || ''} onChange={(e) => setPerfDept(e.target.value || null)} style={{ minWidth: 160 }}>
                  <option value="">All Departments</option>
                  {(departments.data || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <LoadOrError q={perf} label="Performance Completion">
                {(rows: any[]) => {
                  const submitted = rows.filter((r) => r.employeeSubmittedAt).length;
                  const missing = rows.length - submitted;
                  const overdue = rows.filter((r) => r.employeeSubmissionOverdue).length;
                  return (
                    <>
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        {[['Employees', rows.length], ['Submitted', submitted], ['Missing', missing], ['Overdue', overdue]].map(([l, v]: any) => (
                          <div key={l} className="nex-card border rounded-lg px-3 py-2 text-center"><div className="text-[11px] text-[#64748b]">{l}</div><div className="text-[16px] font-bold text-[#171a2e]">{v}</div></div>
                        ))}
                      </div>
                      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 15 }} columns={[
                        { title: 'Employee', render: (_v, r: any) => <Link href={`/hr/employees/${r.employeeId}`} className="text-[13px] text-[#1d5fb5] hover:underline">{r.employee?.firstName} {r.employee?.lastName}</Link> },
                        { title: 'Department', render: (_v, r: any) => r.employee?.department?.name || '—' },
                        { title: 'Cycle', render: (_v, r: any) => r.cycle?.name },
                        { title: 'Submission', render: (_v, r: any) => r.employeeSubmittedAt ? <SoftBadge tone="green" dotless>SUBMITTED</SoftBadge> : r.employeeSubmissionOverdue ? <SoftBadge tone="red" dotless>OVERDUE</SoftBadge> : <SoftBadge tone="grey" dotless>NOT SUBMITTED</SoftBadge> },
                        { title: 'QA', render: (_v, r: any) => r.qaSubmittedAt ? <SoftBadge tone="green" dotless>SUBMITTED</SoftBadge> : <SoftBadge tone="grey" dotless>—</SoftBadge> },
                        { title: 'Score', align: 'right', render: (_v, r: any) => r.totalScore != null ? <b>{Number(r.totalScore).toFixed(1)}%</b> : '—' },
                        { title: 'Result', render: (_v, r: any) => r.result ? <SoftBadge tone={r.result === 'PASS' ? 'green' : 'red'} dotless>{r.result}</SoftBadge> : '—' },
                      ] as ColumnsType<any>} />
                    </>
                  );
                }}
              </LoadOrError>
            </div>
          </Can>
        ) },
        { key: 'payroll', label: 'Payroll', children: (
          <Can permission="payroll.view">
            <div>
              <div className="text-[14px] font-bold text-[#171a2e] mb-2">Payroll Register <Tag color="red" className="ml-1">SENSITIVE</Tag></div>
              <div className="text-[12px] text-[#94a3b8] mb-2">Requires Payroll permission. Access is audited.</div>
              <DatasetTable ctx={ctx} dataset="PAYSLIPS" title="Payroll Register" />
            </div>
          </Can>
        ) },
      ]} />
    </div>
  );
}

/* ================================ OPERATIONS ================================ */
export function OperationsTab({ ctx }: { ctx: ReportCtx }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Project Profitability</div>
        <DatasetTable ctx={ctx} dataset="PROJECTS" title="Project Profitability" />
      </div>
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Asset Register</div>
        <DatasetTable ctx={ctx} dataset="ASSETS" title="Asset Register" />
      </div>
      <div>
        <div className="text-[14px] font-bold text-[#171a2e] mb-2">Lead Pipeline</div>
        <DatasetTable ctx={ctx} dataset="LEADS" title="Lead Pipeline" />
      </div>
      <Can permission="fiscalisation.reports.view">
        <div className="nex-card border rounded-lg p-4 flex items-center justify-between">
          <div><div className="text-[13px] font-bold text-[#171a2e]">Fiscalisation Reports</div><div className="text-[12px] text-[#64748b]">Fiscal receipts, VAT summary, fiscal days and ZIMRA reconciliation</div></div>
          <Link href="/fiscalisation"><button className="text-[12px] px-3 py-1.5 rounded bg-[#003366] text-white font-medium">Open Fiscal Reports →</button></Link>
        </div>
      </Can>
      <Can permission="compliance.view">
        <div className="nex-card border rounded-lg p-4 flex items-center justify-between">
          <div><div className="text-[13px] font-bold text-[#171a2e]">Compliance Reports</div><div className="text-[12px] text-[#64748b]">Summary, findings and risk register</div></div>
          <Link href="/compliance"><button className="text-[12px] px-3 py-1.5 rounded bg-[#003366] text-white font-medium">Open Compliance →</button></Link>
        </div>
      </Can>
      <Can permission="admin.audit.view">
        <div className="nex-card border rounded-lg p-4 flex items-center justify-between">
          <div><div className="text-[13px] font-bold text-[#171a2e]">Administration Reports</div><div className="text-[12px] text-[#64748b]">User activity, audit events and configuration changes</div></div>
          <Link href="/admin"><button className="text-[12px] px-3 py-1.5 rounded bg-[#003366] text-white font-medium">Open Administration →</button></Link>
        </div>
      </Can>
    </div>
  );
}
