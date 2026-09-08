const BASE = 'http://localhost:4000/api';

const PATHS = [
  'dashboard/summary',
  'sales/invoices', 'sales/customers', 'sales/quotations', 'sales/orders', 'sales/receipts', 'sales/credit-notes', 'sales/debit-notes', 'sales/deliveries', 'sales/debtor-age', 'sales/sales-report', 'sales/departments-report',
  'procurement/suppliers', 'procurement/purchase-orders', 'procurement/supplier-invoices', 'procurement/supplier-payments', 'procurement/goods-received-notes', 'procurement/purchase-requisitions', 'procurement/vendor-credits',
  'finance/accounts', 'finance/journals', 'finance/trial-balance', 'finance/budgets', 'finance/tax-rates', 'finance/budget-vs-actual', 'finance/vat-report', 'finance/balance-sheet', 'finance/cashflow', 'finance/periods', 'finance/cash-bank', 'finance/currency', 'finance/ap-aging', 'finance/reconciliation',
  'inventory/items', 'inventory/warehouses', 'inventory/stock-counts', 'inventory/batches', 'inventory/serials',
  'hr/employees', 'hr/departments', 'hr/payroll-runs', 'hr/leave-requests', 'hr/attendance', 'hr/recruitment', 'hr/benefits', 'hr/onboarding', 'hr/leave-balances',
  'crm/leads', 'crm/opportunities', 'crm/tasks', 'crm/interactions',
  'assets', 'assets/categories',
  'compliance/obligations', 'compliance/controls', 'compliance/engagements', 'compliance/findings', 'compliance/statutory-rules',
  'projects', 'projects/profitability', 'projects/timesheets',
  'fiscalisation/devices', 'fiscalisation/receipts', 'fiscalisation/config',
  'approvals/workflows', 'approvals/requests', 'approvals/document-types',
  'reports/datasets', 'reports',
  'system/jobs', 'system/backups', 'system/numbering', 'system/preferences',
  'admin/config', 'admin/audit-logs', 'admin/report',
  'integrations/connections',
];

async function main() {
  const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.local', password: 'Password123!' }) });
  const token = (await login.json()).token;
  const auth = { authorization: `Bearer ${token}` };
  const rows = [];
  let ok = 0, fail = 0, guarded = 0;
  for (const p of PATHS) {
    const r = await fetch(`${BASE}/${p}`, { headers: auth });
    const anon = await fetch(`${BASE}/${p}`);
    const status = r.status;
    const anonStatus = anon.status;
    if (status === 200) ok++; else fail++;
    if (anonStatus === 401) guarded++;
    rows.push({ path: p, auth: status, anon: anonStatus });
  }
  console.log(`\nAUTH-SWEEP: ${PATHS.length} endpoints | ${ok} returned 200 with token | ${fail} non-200 | ${guarded} reject unauth (401)`);
  console.log('--- non-200 (with token) ---');
  rows.filter((r) => r.auth !== 200).forEach((r) => console.log(`  ${r.auth}  /${r.path}   (anon ${r.anon})`));
  console.log('--- 200 with token (evidence) ---');
  rows.filter((r) => r.auth === 200).forEach((r) => console.log(`  200  /${r.path}`));
  console.log('--- unauth NOT 401 (security concern) ---');
  rows.filter((r) => r.anon !== 401).forEach((r) => console.log(`  /${r.path}  anon=${r.anon}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
