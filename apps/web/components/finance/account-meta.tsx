export const ACCOUNT_TYPE_OPTIONS = [
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'REVENUE', label: 'Income / Revenue' },
  { value: 'EXPENSE', label: 'Expense' },
];

export const SUBTYPE_LABELS: Record<string, string> = {
  BANK: 'Bank', CASH: 'Cash', ACCOUNTS_RECEIVABLE: 'Accounts Receivable', INVENTORY: 'Inventory',
  FIXED_ASSET: 'Fixed Asset', OTHER_CURRENT_ASSET: 'Other Current Asset', OTHER_ASSET: 'Other Asset',
  ACCOUNTS_PAYABLE: 'Accounts Payable', CREDIT_CARD: 'Credit Card', LOAN: 'Loan',
  SALES_TAX_PAYABLE: 'Sales Tax Payable', CURRENT_LIABILITY: 'Current Liability', LONG_TERM_LIABILITY: 'Long-Term Liability',
  OTHER_LIABILITY: 'Other Liability', OWNER_CAPITAL: 'Owner Capital', RETAINED_EARNINGS: 'Retained Earnings',
  DRAWINGS: 'Drawings', OTHER_EQUITY: 'Other Equity', REVENUE: 'Revenue', OTHER_INCOME: 'Other Income',
  COGS: 'Cost of Goods Sold', EXPENSE: 'Expense', OTHER_EXPENSE: 'Other Expense',
};

export const SUBTYPES_BY_TYPE: Record<string, string[]> = {
  ASSET: ['BANK', 'CASH', 'ACCOUNTS_RECEIVABLE', 'INVENTORY', 'FIXED_ASSET', 'OTHER_CURRENT_ASSET', 'OTHER_ASSET'],
  LIABILITY: ['ACCOUNTS_PAYABLE', 'CREDIT_CARD', 'LOAN', 'SALES_TAX_PAYABLE', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'OTHER_LIABILITY'],
  EQUITY: ['OWNER_CAPITAL', 'RETAINED_EARNINGS', 'DRAWINGS', 'OTHER_EQUITY'],
  REVENUE: ['REVENUE', 'OTHER_INCOME'],
  EXPENSE: ['COGS', 'EXPENSE', 'OTHER_EXPENSE'],
};

export const TYPE_TONE: Record<string, string> = { ASSET: 'green', LIABILITY: 'amber', EQUITY: 'purple', REVENUE: 'blue', EXPENSE: 'red' };
export const TYPE_COLOR: Record<string, string> = { ASSET: '#10b981', LIABILITY: '#f59e0b', EQUITY: '#8b5cf6', REVENUE: '#0ea5e9', EXPENSE: '#ef4444' };

export function subtypeLabel(v: string | null | undefined) { return v ? (SUBTYPE_LABELS[v] || v) : '—'; }
