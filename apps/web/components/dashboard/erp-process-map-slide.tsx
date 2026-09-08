'use client';
import {
  AccountBookOutlined, AppstoreOutlined, AuditOutlined, BankOutlined, BarChartOutlined, BellOutlined, BookOutlined,
  CalculatorOutlined, ClockCircleOutlined, CloudServerOutlined, CreditCardOutlined, DatabaseOutlined, DollarOutlined,
  FileDoneOutlined, FileTextOutlined, FundOutlined, InboxOutlined, ProfileOutlined,
  ReconciliationOutlined, SafetyCertificateOutlined, SettingOutlined, ShopOutlined, ShoppingCartOutlined, SwapOutlined,
  TeamOutlined, TruckOutlined, WalletOutlined,
} from '@ant-design/icons';
import { ProcessSection } from './process-section';
import { ProcessNode } from './process-node';
import { AnimatedFlowArrow } from './animated-flow-arrow';

const SALES_ACCENT = '#16a34a';

const SALES_NODES = [
  { label: 'Customers', icon: <TeamOutlined />, href: '/sales/customers' },
  { label: 'Quotes', icon: <FileTextOutlined />, href: '/sales/quotations' },
  { label: 'Sales Orders', icon: <ShoppingCartOutlined />, href: '/sales/orders' },
  { label: 'Deliveries', icon: <TruckOutlined />, href: '/sales/deliveries' },
  { label: 'Invoices', icon: <FileDoneOutlined />, href: '/sales/invoices' },
  { label: 'Receipts', icon: <WalletOutlined />, href: '/sales/receipts' },
];
const PURCHASING_NODES = [
  { label: 'Vendors', tooltip: 'Vendors / Suppliers', icon: <ShopOutlined />, href: '/procurement' },
  { label: 'POs', tooltip: 'Purchase Orders', icon: <ProfileOutlined />, href: '/procurement' },
  { label: 'GRN', tooltip: 'Receive Items / Goods Received Note', icon: <InboxOutlined />, href: '/procurement' },
  { label: 'Bills', tooltip: 'Vendor Bills', icon: <FileTextOutlined />, href: '/procurement' },
  { label: 'Payments', tooltip: 'Supplier Payments', icon: <BankOutlined />, href: '/procurement' },
];
const INVENTORY_NODES = [
  { label: 'Items', tooltip: 'Items / Products', icon: <AppstoreOutlined />, href: '/inventory' },
  { label: 'Warehouses', icon: <DatabaseOutlined />, href: '/inventory' },
  { label: 'Movements', tooltip: 'Stock Movements', icon: <SwapOutlined />, href: '/inventory' },
  { label: 'Reports', tooltip: 'Stock Reports', icon: <BarChartOutlined />, href: '/inventory' },
];
const PAYROLL_NODES = [
  { label: 'Employees', icon: <TeamOutlined />, href: '/hr' },
  { label: 'Attendance', icon: <ClockCircleOutlined />, href: '/hr' },
  { label: 'Payroll', icon: <DollarOutlined />, href: '/hr' },
  { label: 'Payslips', icon: <FileTextOutlined />, href: '/hr' },
];
const BANKING_NODES = [
  { label: 'Accounts', tooltip: 'Bank Accounts', icon: <BankOutlined />, href: '/finance/cash-bank' },
  { label: 'Checks', tooltip: 'Write Checks', icon: <CreditCardOutlined />, href: '/expenses/write-check' },
  { label: 'Deposits', icon: <WalletOutlined />, href: '/finance/cash-bank' },
  { label: 'Transfers', tooltip: 'Transfer Funds', icon: <SwapOutlined />, href: '/finance/cash-bank' },
  { label: 'Reconcile', tooltip: 'Bank Reconciliation', icon: <ReconciliationOutlined />, href: '/finance/reconciliation' },
];
const ACCOUNTING_NODES = [
  { label: 'COA', tooltip: 'Chart of Accounts', icon: <AccountBookOutlined />, href: '/finance/accounts' },
  { label: 'JE', tooltip: 'Journal Entries', icon: <BookOutlined />, href: '/finance/journals' },
  { label: 'Analysis', icon: <FundOutlined />, href: '/finance/reports' },
  { label: 'Reports', icon: <BarChartOutlined />, href: '/reports' },
  { label: 'Budgets', icon: <CalculatorOutlined />, href: '/finance/budgets' },
  { label: 'Reconcile', icon: <ReconciliationOutlined />, href: '/finance/reconciliation' },
];
const CROSS_NODES = [
  { label: 'Document Flow', icon: <AuditOutlined />, href: '/sales' },
  { label: 'Audit Trail', icon: <SafetyCertificateOutlined />, href: '/administration/security' },
  { label: 'Notifications', icon: <BellOutlined />, href: '/' },
  { label: 'User Management', icon: <TeamOutlined />, href: '/administration' },
  { label: 'Settings', icon: <SettingOutlined />, href: '/administration' },
  { label: 'Backup & Security', icon: <CloudServerOutlined />, href: '/administration/data-jobs' },
];

export function ERPProcessMapSlide() {
  return (
    <div className="p-5">
      <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr_190px] gap-4">
        {/* SALES — vertical flow with connectors on the RIGHT side of nodes */}
        <div className="nex-process-section">
          <div className="text-[11px] uppercase tracking-[0.08em] font-semibold" style={{ color: SALES_ACCENT }}>Sales</div>
          <div className="nex-sales-flow mt-2">
            {SALES_NODES.map((n, i) => (
              <div key={n.label} className="nex-sales-row">
                <ProcessNode label={n.label} icon={n.icon} href={n.href} accent={SALES_ACCENT} />
                {i < SALES_NODES.length - 1 && <AnimatedFlowArrow direction="v" color={SALES_ACCENT} />}
              </div>
            ))}
          </div>
        </div>

        {/* Middle stack: Purchasing, Inventory, Payroll, Banking — horizontal flows */}
        <div className="space-y-4">
          <ProcessSection title="Purchasing" accent="#f97316" nodes={PURCHASING_NODES} />
          <ProcessSection title="Inventory" accent="#0ea5e9" nodes={INVENTORY_NODES} />
          <ProcessSection title="Payroll" accent="#7c3aed" nodes={PAYROLL_NODES} />
          <ProcessSection title="Banking" accent="#0891b2" nodes={BANKING_NODES} />
        </div>

        {/* ACCOUNTING & REPORTING — 2-col grid */}
        <div className="nex-process-section">
          <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#003366]">Accounting &amp; Reporting</div>
          <div className="nex-accounting-grid mt-2">
            {ACCOUNTING_NODES.map((n) => <ProcessNode key={n.label} label={n.label} icon={n.icon} href={n.href} accent="#003366" tooltip={n.tooltip} />)}
          </div>
        </div>
      </div>

      {/* CROSS MODULE FEATURES */}
      <div className="nex-process-section mt-4">
        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#003366]">Cross Module Features</div>
        <div className="flex flex-wrap gap-2 mt-2">
          {CROSS_NODES.map((n) => <ProcessNode key={n.label} label={n.label} icon={n.icon} href={n.href} accent="#003366" />)}
        </div>
      </div>
    </div>
  );
}
