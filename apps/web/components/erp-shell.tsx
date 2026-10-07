'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Button, ColorPicker, Drawer, Dropdown, Grid, Layout, Menu, Popover, Select, Space, Typography } from 'antd';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight, Banknote, BarChart3, BookOpen, Building2, Calculator, Calendar, Check, ChevronRight,
  CircleDollarSign, ClipboardCheck, Contact, CreditCard, FileCheck, FileText, FolderKanban, Landmark,
  LayoutDashboard, LayoutGrid, Lightbulb, List, LogOut, Mail, Menu as MenuIcon, Palette, PanelLeftClose,
  PanelLeftOpen, Percent, Plug, Printer, Receipt, RotateCcw, Scale, Server, Settings, ShieldCheck,
  ShoppingCart, Store, Target, Truck, Undo2, User, Users, Wallet, Wrench,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-store';
import { api } from '@/lib/api';
import { ActionCenter } from '@/components/workspace/action-center';
import { GlobalSearch } from '@/components/workspace/global-search';
import { QuickCreate } from '@/components/workspace/quick-create';
import { RouteProgress } from '@/components/route-progress';

const { Sider, Header, Content } = Layout;

function NavIcon({ icon: Icon, size = 18 }: { icon: LucideIcon; size?: number }) {
  return <Icon size={size} strokeWidth={1.75} aria-hidden className="nex-nav-icon" />;
}

const nav = [
  {
    key: 'grp-overview', label: 'Overview', children: [
      { key: '/dashboard', label: 'Dashboard', icon: <NavIcon icon={LayoutDashboard} /> },
      { key: '/reports', label: 'Reports & BI', icon: <NavIcon icon={BarChart3} /> },
    ],
  },
  {
    key: 'grp-commercial', label: 'Commercial', children: [
      {
        key: '/sales', label: 'Sales & Revenue', icon: <NavIcon icon={ShoppingCart} />, children: [
          { key: '/sales', label: 'Dashboard' },
          { key: '/sales/quotations', label: 'Quotations' },
          { key: '/sales/orders', label: 'Orders' },
          { key: '/sales/invoices', label: 'Invoices' },
          { key: '/sales/deliveries', label: 'Deliveries' },
          { key: '/sales/receipts', label: 'Receipts' },
          { key: '/sales/credit-notes', label: 'Credit Notes' },
          { key: '/sales/debit-notes', label: 'Debit Notes' },
          { key: '/sales/register', label: 'Sales Register' },
          { key: '/sales/reports', label: 'Sales Reports' },
        ],
      },
      {
        key: '/crm', label: 'Customers & CRM', icon: <NavIcon icon={Contact} />, children: [
          { key: '/crm', label: 'Dashboard' },
          { key: '/sales/customers', label: 'Customers' },
        ],
      },
        { key: '/procurement', label: 'Procurement', icon: <NavIcon icon={Store} /> },
        { key: '/inventory', label: 'Products & Services', icon: <NavIcon icon={LayoutGrid} /> },
        {
          key: '/expenses', label: 'Expenses', icon: <NavIcon icon={Wallet} />, children: [
            { key: '/expenses/bills', label: 'Bill Management' },
            { key: '/expenses/enter-bill', label: 'Enter Bill' },
            { key: '/expenses/pay-bill', label: 'Pay Bill' },
            { key: '/expenses/write-check', label: 'Write Check' },
            { key: '/expenses/credit-card-charges', label: 'Credit Card Charges' },
            { key: '/expenses/vendor-credits', label: 'Vendor Credits' },
            { key: '/expenses/check-printing', label: 'Check Printing' },
          ],
        },
    ],
  },
  {
    key: 'grp-ops', label: 'Operations', children: [
      {
        key: '/finance', label: 'Finance & Accounting', icon: <NavIcon icon={CircleDollarSign} />, children: [
          { key: '/finance', label: 'Dashboard' },
          { key: '/finance/accounts', label: 'Chart of Accounts' },
          { key: '/finance/journals', label: 'Journal Entries' },
          { key: '/finance/ledger', label: 'General Ledger' },
          { key: '/finance/trial-balance', label: 'Trial Balance' },
          { key: '/finance/reports', label: 'Financial Reports' },
          { key: '/finance/ar-aging', label: 'A/R Aging' },
          { key: '/finance/ap-aging', label: 'A/P Aging' },
  { key: '/finance/bank-connections', label: 'Bank Connections' },
          { key: '/finance/costing', label: 'Costing' },
          { key: '/finance/reconciliation', label: 'Bank Reconciliation' },
          { key: '/finance/cash-bank', label: 'Cash & Bank' },
          { key: '/finance/periods', label: 'Financial Periods' },
          { key: '/finance/budgets', label: 'Budgets' },
          { key: '/finance/budget-control', label: 'Budget Control' },
          { key: '/finance/tax-rates', label: 'Tax Rates' },
          { key: '/finance/currency', label: 'Currency & Exchange' },
          { key: '/finance/vat-report', label: 'VAT Report' },
        ],
      },
      { key: '/projects', label: 'Projects', icon: <NavIcon icon={FolderKanban} /> },
      { key: '/hr', label: 'HR & Payroll', icon: <NavIcon icon={Users} />, children: [
        { key: '/hr', label: 'Dashboard' },
        { key: '/hr/payroll-rules', label: 'Payroll Rules' },
        { key: '/hr/recruitment', label: 'Recruitment' },
        { key: '/hr/onboarding', label: 'Onboarding' },
        { key: '/hr/leave-benefits', label: 'Leave & Benefits' },
      ] },
      { key: '/performance', label: 'Performance', icon: <NavIcon icon={Target} /> },
      { key: '/assets', label: 'Assets', icon: <NavIcon icon={Wrench} /> },
      { key: '/compliance', label: 'Compliance & Risk', icon: <NavIcon icon={ShieldCheck} /> },
    ],
  },
  {
    key: 'grp-platform', label: 'Platform', children: [
      { key: '/fiscalisation', label: 'Fiscalisation', icon: <NavIcon icon={Server} /> },
      { key: '/integrations', label: 'Integrations', icon: <NavIcon icon={Plug} /> },
      {
        key: '/administration', label: 'Administration', icon: <NavIcon icon={Settings} />, children: [
          { key: '/administration', label: 'Dashboard' },
          { key: '/administration/workflows', label: 'Workflows & Approvals' },
          { key: '/administration/my-approvals', label: 'My Approvals' },
          { key: '/administration/security', label: 'Security' },
          { key: '/administration/integrations-config', label: 'Integrations Config' },
          { key: '/administration/email-templates', label: 'Email Templates' },
          { key: '/administration/data-jobs', label: 'Data & Jobs' },
        ],
      },
    ],
  },
];

const PAGE_TITLES: Record<string, [string, string]> = {
  '/dashboard': ['Dashboard', 'Business overview at a glance'],
  '/reports': ['Reports & BI', 'Financial and operational reporting'],
  '/sales': ['Sales & Revenue', 'Quotations, orders, invoicing and receipts'],
  '/sales/customers': ['Customers', 'Manage customer accounts and credit limits'],
  '/sales/quotations': ['Quotations', 'Draft and convert quotes to orders'],
  '/sales/orders': ['Sales Orders', 'Confirmed orders ready for invoicing'],
  '/sales/invoices': ['Invoices', 'Issue and post sales invoices'],
  '/sales/deliveries': ['Deliveries', 'Dispatch orders — stock issue and COGS'],
  '/sales/receipts': ['Receipts', 'Customer payments received'],
  '/sales/credit-notes': ['Credit Notes', 'Customer credits and returns'],
  '/sales/debit-notes': ['Debit Notes', 'Additional customer charges — surcharges and backorders'],
  '/sales/register': ['Sales Register', 'Chronological audit trail of all sales documents'],
  '/sales/reports': ['Sales Reports', 'Analyse revenue, customers, products, tax and sales performance'],
  '/crm': ['Customers & CRM', 'Leads, opportunities and customer interactions'],
  '/procurement': ['Procurement', 'Suppliers, requisitions, purchase orders and payables'],
  '/inventory': ['Products & Services', 'Items, stock, warehouses and movements'],
  '/expenses/bills': ['Bill Management', 'Supplier bills and payables'],
  '/expenses/enter-bill': ['Enter Bill', 'Record a supplier bill'],
  '/expenses/pay-bill': ['Pay Bill', 'Make payments against supplier bills'],
  '/expenses/write-check': ['Write Check', 'Record a check payment'],
  '/expenses/credit-card-charges': ['Credit Card Charges', 'Track card spending and payments'],
  '/expenses/vendor-credits': ['Vendor Credits', 'Credits from suppliers against bills'],
  '/expenses/check-printing': ['Check Printing', 'Write, record and print checks'],
  '/finance': ['Finance & Accounting', 'Chart of accounts, journals, budgets and reports'],
  '/finance/accounts': ['Chart of Accounts', 'Account tree with live balances'],
  '/finance/journals': ['Journal Entries', 'Post and reverse manual journals'],
  '/finance/ledger': ['General Ledger', 'Per-account history with running balance'],
  '/finance/trial-balance': ['Trial Balance', 'Verify debits equal credits'],
  '/finance/reports': ['Financial Reports', 'P&L, balance sheet, cash flow and variances'],
  '/finance/ar-aging': ['A/R Aging', 'Receivables outstanding by age'],
  '/finance/ap-aging': ['A/P Aging', 'Payables outstanding by age'],
  '/finance/costing': ['Costing', 'Inventory valuation and item costs'],
  '/projects': ['Projects', 'Plan and track project work'],
  '/finance/reconciliation': ['Bank Reconciliation', 'Match ledger postings to the bank statement'],
  '/finance/cash-bank': ['Cash & Bank', 'Bank and cash accounts and transfers'],
  '/finance/periods': ['Financial Periods', 'Open and close accounting periods'],
  '/finance/budgets': ['Budgets', 'Set budget amounts per account and period'],
  '/finance/budget-control': ['Budget Control', 'Rules to warn or block overspend'],
  '/finance/tax-rates': ['Tax Rates', 'Sales tax / VAT rates used on documents'],
  '/finance/currency': ['Currency & Exchange', 'Currencies and exchange rates'],
  '/finance/vat-report': ['VAT Report', 'Output and input VAT summary'],
  '/hr': ['HR & Payroll', 'Employees, leave, attendance and payroll'],
  '/performance': ['Performance', 'KPI templates, assessment cycles, QA reviews and incentives'],
  '/hr/payroll-rules': ['Payroll Rules', 'Effective-dated PAYE & NSSA configuration'],
  '/hr/recruitment': ['Recruitment', 'Vacancies, candidates and the hiring pipeline'],
  '/hr/onboarding': ['Onboarding', 'Templates and task checklists for new employees'],
  '/hr/leave-benefits': ['Leave & Benefits', 'Leave types, balances and employee benefits'],
  '/assets': ['Assets', 'Asset register, depreciation and maintenance'],
  '/compliance': ['Compliance & Risk', 'Risks, obligations and compliance calendar'],
  '/fiscalisation': ['Fiscalisation', 'ZIMRA fiscal device management'],
  '/integrations': ['Integrations', 'Connected services and APIs'],
'/administration': ['Administration', 'Users, branches, audit and configuration'],
'/administration/workflows': ['Workflows & Approvals', 'Configure approval workflows per document type'],
'/administration/my-approvals': ['My Approvals', 'Submit documents for approval and action pending approvals'],
'/administration/security': ['Security', 'MFA, password reset, email verification and session security'],
'/administration/integrations-config': ['Integrations Config', 'Configure ZIMRA, payments, email/SMS, storage, queue and security settings'],
'/administration/email-templates': ['Email Templates', 'Configurable templates for invoices, quotations, statements and payslips'],
'/administration/data-jobs': ['Data & Jobs', 'Automated jobs, database backups, numbering and preferences'],
};

type SidebarTheme = { bg: string; text: string };
const DEFAULT_THEME: SidebarTheme = { bg: '#003366', text: '#ffffff' };
const LIGHT_SIDEBAR = '#f7f8fb';
const SWATCHES: SidebarTheme[] = [
  { bg: '#003366', text: '#ffffff' },
  { bg: '#0b4a8f', text: '#ffffff' },
  { bg: '#0f172a', text: '#ffffff' },
  { bg: '#0e7490', text: '#ffffff' },
  { bg: '#f7f8fb', text: '#171a2e' },
  { bg: '#ffffff', text: '#171a2e' },
];

function hexLuminance(hex: string) {
  let n = hex.replace('#', '');
  if (n.length === 3) n = n.split('').map((c) => c + c).join('');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const QUICK_MODULES = [
  { key: '/sales', label: 'Sales', icon: <NavIcon icon={ShoppingCart} /> },
  { key: '/crm', label: 'Customers & CRM', icon: <NavIcon icon={Contact} /> },
  { key: '/procurement', label: 'Procurement', icon: <NavIcon icon={Store} /> },
  { key: '/inventory', label: 'Products & Services', icon: <NavIcon icon={LayoutGrid} /> },
  { key: '/finance', label: 'Finance', icon: <NavIcon icon={CircleDollarSign} /> },
  { key: '/hr', label: 'HR & Payroll', icon: <NavIcon icon={Users} /> },
  { key: '/assets', label: 'Assets', icon: <NavIcon icon={Wrench} /> },
  { key: '/compliance', label: 'Compliance', icon: <NavIcon icon={ShieldCheck} /> },
  { key: '/reports', label: 'Reports & BI', icon: <NavIcon icon={BarChart3} /> },
  { key: '/fiscalisation', label: 'Fiscalisation', icon: <NavIcon icon={Server} /> },
  { key: '/integrations', label: 'Integrations', icon: <NavIcon icon={Plug} /> },
  { key: '/administration', label: 'Administration', icon: <NavIcon icon={Settings} /> },
];

const PAGE_ICONS: Record<string, React.ReactNode> = {
  '/sales': <NavIcon icon={LayoutDashboard} />, '/crm': <NavIcon icon={LayoutDashboard} />, '/sales/customers': <NavIcon icon={Contact} />, '/sales/quotations': <NavIcon icon={FileText} />,
  '/sales/orders': <NavIcon icon={ClipboardCheck} />, '/sales/invoices': <NavIcon icon={FileCheck} />, '/sales/deliveries': <NavIcon icon={Truck} />, '/sales/receipts': <NavIcon icon={Wallet} />,
  '/sales/credit-notes': <NavIcon icon={Undo2} />,
  '/sales/debit-notes': <NavIcon icon={Receipt} />,
  '/sales/register': <NavIcon icon={List} />,
  '/sales/reports': <NavIcon icon={BarChart3} />,
  '/finance': <NavIcon icon={LayoutDashboard} />, '/finance/accounts': <NavIcon icon={BookOpen} />, '/finance/journals': <NavIcon icon={BookOpen} />,
  '/finance/ledger': <NavIcon icon={List} />, '/finance/trial-balance': <NavIcon icon={Scale} />, '/finance/reports': <NavIcon icon={BarChart3} />, '/finance/ar-aging': <NavIcon icon={Users} />, '/finance/ap-aging': <NavIcon icon={Store} />, '/finance/costing': <NavIcon icon={LayoutGrid} />, '/projects': <NavIcon icon={FolderKanban} />, '/hr': <NavIcon icon={Users} />, '/hr/payroll-rules': <NavIcon icon={Percent} />, '/hr/recruitment': <NavIcon icon={User} />, '/hr/onboarding': <NavIcon icon={ClipboardCheck} />, '/hr/leave-benefits': <NavIcon icon={Calendar} />,
  '/finance/reconciliation': <NavIcon icon={ArrowLeftRight} />, '/finance/cash-bank': <NavIcon icon={Landmark} />, '/finance/periods': <NavIcon icon={Calendar} />, '/finance/budgets': <NavIcon icon={Calculator} />, '/finance/budget-control': <NavIcon icon={ShieldCheck} />, '/finance/tax-rates': <NavIcon icon={Percent} />, '/finance/currency': <NavIcon icon={CircleDollarSign} />, '/finance/vat-report': <NavIcon icon={Receipt} />,
  '/expenses/bills': <NavIcon icon={FileText} />, '/expenses/enter-bill': <NavIcon icon={FileCheck} />, '/expenses/pay-bill': <NavIcon icon={Banknote} />, '/expenses/write-check': <NavIcon icon={FileCheck} />, '/expenses/credit-card-charges': <NavIcon icon={CreditCard} />, '/expenses/vendor-credits': <NavIcon icon={ArrowLeftRight} />, '/expenses/check-printing': <NavIcon icon={Printer} />,
  '/administration': <NavIcon icon={Settings} />, '/administration/workflows': <NavIcon icon={ClipboardCheck} />, '/administration/my-approvals': <NavIcon icon={Check} />, '/administration/security': <NavIcon icon={ShieldCheck} />, '/administration/integrations-config': <NavIcon icon={Plug} />, '/administration/email-templates': <NavIcon icon={Mail} />, '/administration/data-jobs': <NavIcon icon={Server} />,
};

function loadTheme(userId?: string): SidebarTheme {
  if (!userId) return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(`nex-sidebar-${userId}`);
    if (raw) {
      const parsed = { ...DEFAULT_THEME, ...JSON.parse(raw) } as SidebarTheme;
      if (String(parsed.bg).toLowerCase() === LIGHT_SIDEBAR) return DEFAULT_THEME;
      return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_THEME;
}

function buildMenuItems(nav: any[], onOpen: (item: any) => void, onClose: () => void, mobile = false) {
  return nav.map((group: any) => ({
    type: 'group' as const,
    label: <span className="nex-section-label !p-0">{group.label}</span>,
    children: group.children.map((item: any) =>
      item.children
        ? mobile
          ? {
              key: 'sub-' + item.key,
              label: item.label,
              icon: item.icon,
              children: item.children.map((child: any) => ({
                key: child.key,
                label: child.label,
                icon: PAGE_ICONS[child.key] || <NavIcon icon={ChevronRight} size={14} />,
              })),
            }
          : {
              key: 'flyout-' + item.key,
              label: (
                <span onMouseEnter={() => onOpen(item)} onMouseLeave={onClose} className="flex items-center justify-between gap-2">
                  <span>{item.label}</span>
                  <ChevronRight size={14} strokeWidth={1.75} className="opacity-40" aria-hidden />
                </span>
              ),
              icon: <span onMouseEnter={() => onOpen(item)} onMouseLeave={onClose} className="nex-nav-icon-wrap">{item.icon}</span>,
            }
        : { key: item.key, label: <span>{item.label}</span>, icon: item.icon },
    ),
  }));
}

export function ErpShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { token, user, companies, activeCompanyId, setSession, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeQuery, setActiveQuery] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [flyout, setFlyout] = useState<any | null>(null);
  const [flyoutClosing, setFlyoutClosing] = useState(false);
  const [flyoutPointerTop, setFlyoutPointerTop] = useState(28);
  const flyoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarTheme, setSidebarTheme] = useState<SidebarTheme>(() => loadTheme(user?.id));

  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
    else closeFlyout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const FLYOUT_TOP = 64;
  const FLYOUT_BOTTOM = 16;
  // Compute the vertical position of the flyout pointer so it aligns with the
  // parent menu item that opened the flyout (recomputed on scroll/resize).
  function computeFlyoutPointer(item: any) {
    const label = item?.label;
    if (!label) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>('.ant-menu-item'));
    const el = els.find((n) => {
      const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
      return t === label || t.startsWith(label + ' ');
    });
    if (!el) return;
    const r = el.getBoundingClientRect();
    const max = window.innerHeight - FLYOUT_TOP - FLYOUT_BOTTOM - 20;
    setFlyoutPointerTop(Math.max(20, Math.min(r.top + r.height / 2 - FLYOUT_TOP, max)));
  }
  useEffect(() => {
    const onScroll = () => { if (flyout) computeFlyoutPointer(flyout); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyout]);

  useEffect(() => () => { if (flyoutTimer.current) clearTimeout(flyoutTimer.current); }, []);

  useEffect(() => {
    if (user?.id) {
      setSidebarTheme(loadTheme(user.id));
      setActiveQuery(window.location.search);
    }
  }, [user?.id]);

  async function switchCompany(companyId: string) {
    const r = await api('/auth/switch-company', { method: 'POST', body: JSON.stringify({ companyId }) });
    setSession({ token: r.token, activeCompanyId: companyId, lastCompanyId: companyId });
    location.reload();
  }

  function saveTheme(t: SidebarTheme) {
    setSidebarTheme(t);
    if (user?.id) localStorage.setItem(`nex-sidebar-${user.id}`, JSON.stringify(t));
  }

  function openFlyout(item: any) {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    setFlyout(item);
    setFlyoutClosing(false);
    computeFlyoutPointer(item);
  }
  function cancelClose() {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    setFlyoutClosing(false);
  }
  function scheduleClose() {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    setFlyoutClosing(true);
    flyoutTimer.current = setTimeout(() => { setFlyout(null); setFlyoutClosing(false); }, 280);
  }
  function closeFlyout() {
    if (flyoutTimer.current) clearTimeout(flyoutTimer.current);
    setFlyout(null);
    setFlyoutClosing(false);
  }

  function go(key: string) {
    closeFlyout();
    setMobileNavOpen(false);
    setActiveQuery(key.includes('?') ? key.slice(key.indexOf('?')) : '');
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('nex:navigate'));
    router.push(key);
  }

  const flatNav = useMemo(() => {
    const out: any[] = [];
    nav.forEach((g: any) => g.children.forEach((item: any) => {
      if (item.children) item.children.forEach((c: any) => out.push({ label: c.label, value: c.key }));
      else out.push({ label: item.label, value: item.key });
    }));
    return out;
  }, []);
  if (!token) return null;

  const fullPath = path + activeQuery;
  const selected = flatNav
    .map((n) => n.value)
    .filter((k: string) => fullPath.startsWith(k))
    .sort((a, b) => b.length - a.length)
    .slice(0, 1);

  const childMatchesPath = (key: string) => fullPath === key || fullPath.startsWith(`${key}/`) || fullPath.startsWith(`${key}?`);
  const activeFlyoutItem = nav
    .flatMap((g: any) => g.children)
    .filter((item: any) => item.children?.some((child: any) => childMatchesPath(child.key)))
    .sort((a: any, b: any) => {
      const best = (item: any) => Math.max(...item.children.map((child: any) => (childMatchesPath(child.key) ? child.key.length : 0)));
      return best(b) - best(a);
    })[0];
  const selectedKeys = [
    ...selected,
    ...(activeFlyoutItem ? [isMobile ? `sub-${activeFlyoutItem.key}` : `flyout-${activeFlyoutItem.key}`] : []),
  ];

  const userMenu = {
    items: [
      { key: 'name', label: <div><div className="font-semibold">{user?.name}</div><div className="text-xs text-gray-400">{user?.email}</div></div>, disabled: true },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogOut size={15} strokeWidth={1.75} />, label: 'Sign out', onClick: async () => { try { await api('/auth/logout', { method: 'POST' }); } catch {} logout(); router.push('/login'); } },
    ],
  };

  const pageKey = Object.keys(PAGE_TITLES).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0] || '/dashboard';
  const [title] = PAGE_TITLES[pageKey] || PAGE_TITLES['/dashboard'];

  const isLight = hexLuminance(sidebarTheme.bg) > 150;
  const sidebarVars = {
    '--sidebar-bg': sidebarTheme.bg,
    '--sidebar-text': sidebarTheme.text,
    '--sidebar-text-muted': isLight ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.62)',
    '--sidebar-hover': isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.12)',
  } as React.CSSProperties;

  const customizePanel = (
    <div className="w-64">
      <div className="flex items-center justify-between mb-3">
        <span className="font-bold text-[14px]">Sidebar theme</span>
        <Button size="small" type="text" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={() => saveTheme(DEFAULT_THEME)}>Reset</Button>
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8a90ad] mb-2">Presets</div>
      <div className="flex flex-wrap gap-2 mb-4">
        {SWATCHES.map((s) => (
          <button
            key={s.bg}
            title={s.bg}
            onClick={() => saveTheme(s)}
            className="w-8 h-8 rounded-lg border border-black/10 transition-transform hover:scale-110 cursor-pointer"
            style={{ background: s.bg }}
          >
            {sidebarTheme.bg.toLowerCase() === s.bg.toLowerCase() && <span className="inline-flex" style={{ color: s.text }}><Check size={14} strokeWidth={2.25} /></span>}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] text-[#5a6080]">Background</span>
        <ColorPicker value={sidebarTheme.bg} showText onChange={(c) => saveTheme({ ...sidebarTheme, bg: c.toHexString() })} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-[#5a6080]">Text color</span>
        <ColorPicker value={sidebarTheme.text} showText onChange={(c) => saveTheme({ ...sidebarTheme, text: c.toHexString() })} />
      </div>
    </div>
  );

  const quickAccessPanel = (
    <div className="w-[min(540px,92vw)]">
      <div className="font-bold text-[15px]">Workspace modules</div>
      <div className="text-[12px] text-[#8a90ad] mb-4">Jump straight into any part of your ERP</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {QUICK_MODULES.map((m) => (
          <button
            key={m.key}
            onClick={() => { setQuickOpen(false); if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('nex:navigate')); router.push(m.key); }}
            className="group flex flex-col items-start gap-2 rounded-xl border border-[#e8ebf2] bg-white px-3 py-3 hover:bg-[#f7f8fb] hover:border-[#d5dbe8] transition-colors duration-150 cursor-pointer text-left"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[#003366] bg-[#eef3f9]">{m.icon}</div>
            <span className="font-semibold text-[13px] text-[#171a2e] leading-snug">{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const sidebarBrand = (
    <div className={`h-14 flex items-center gap-2.5 px-4 shrink-0 ${!isMobile && collapsed ? 'justify-center px-0' : ''}`}>
      <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center text-white shrink-0">
        <Building2 size={16} strokeWidth={1.75} aria-hidden />
      </div>
      {(isMobile || !collapsed) && (
        <div className="leading-tight">
          <div className="nex-sidebar-logo-title font-bold text-[15.5px] tracking-tight">NexusERP</div>
          <div className="nex-sidebar-logo-sub text-[11px] font-medium mt-0.5">Cloud Suite</div>
        </div>
      )}
    </div>
  );

  const sidebarMenu = (
    <Menu
      mode="inline"
      inlineCollapsed={!isMobile && collapsed}
      selectedKeys={selectedKeys}
      defaultOpenKeys={isMobile ? selected.map((k: string) => {
        const parent = nav.flatMap((g: any) => g.children).find((item: any) => item.children?.some((c: any) => k.startsWith(c.key) || k === c.key));
        return parent ? `sub-${parent.key}` : null;
      }).filter(Boolean) as string[] : undefined}
      items={buildMenuItems(nav, openFlyout, scheduleClose, isMobile)}
      onClick={({ key }) => {
        if (key.startsWith('sub-') || key.startsWith('flyout-')) {
          if (key.startsWith('flyout-')) go(key.slice('flyout-'.length));
          return;
        }
        go(key);
      }}
      style={{ background: 'transparent', borderInlineEnd: 'none', paddingTop: 4 }}
      className="!border-e-0 nex-sidebar-menu"
    />
  );

  const sidebarCustomize = (isMobile || !collapsed) && (
    <div className="p-4 shrink-0 border-t" style={{ borderColor: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.14)' }}>
      <Popover content={customizePanel} trigger="click" placement={isMobile ? 'top' : 'rightTop'}>
        <Button
          block
          icon={<Palette size={15} strokeWidth={1.75} />}
          className="!rounded-xl"
          style={{ background: 'transparent', color: 'var(--sidebar-text)', borderColor: isLight ? 'rgba(15,23,42,0.2)' : 'rgba(255,255,255,0.25)' }}
        >
          Customize sidebar
        </Button>
      </Popover>
    </div>
  );

  return (
      <Layout className="min-h-screen">
        <RouteProgress />
      {!isMobile && (
        <Sider
          width={252}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          theme={isLight ? 'light' : 'dark'}
          className={`nex-sidebar ${isLight ? 'nex-sidebar-light !border-[#e6e9f0]' : '!border-white/10'} !fixed left-0 top-0 bottom-0 z-20 overflow-hidden !border-r`}
          style={{ background: sidebarTheme.bg, ...sidebarVars }}
        >
          {sidebarBrand}
          {sidebarMenu}
          {sidebarCustomize}

          {flyout && (
            <>
              <div
                className="fixed inset-y-0 right-0 z-30"
                style={{ left: collapsed ? 92 : 264, background: 'rgba(11,20,55,0.04)' }}
                onClick={closeFlyout}
              />
              <div
                className="fixed top-[64px] bottom-[16px] z-40 w-[240px]"
                style={{ left: collapsed ? 92 : 264 }}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
              >
                <div className="absolute -left-[30px] top-0 bottom-0 w-[30px]" />
                <span className="nex-flyout-pointer" style={{ top: flyoutPointerTop, borderRightColor: '#ffffff' }} aria-hidden="true" />
                <div
                  className={`absolute inset-0 bg-white rounded-[18px] shadow-[0_20px_50px_rgba(15,23,42,0.16)] border border-[rgba(15,23,42,0.07)] flex flex-col overflow-hidden transition-[opacity,transform] duration-200 ease-out ${
                    flyoutClosing ? 'opacity-0 translate-y-2 scale-[0.99]' : 'opacity-100 translate-y-0 scale-100'
                  }`}
                >
                  <div className="h-12 shrink-0 flex items-center gap-2.5 px-4 border-b border-[rgba(15,23,42,0.06)] bg-[#f8f9fc]">
                  <span className="text-[#003366] shrink-0">{flyout.icon}</span>
                  <span className="font-semibold text-[13px] truncate text-[#171a2e]">{flyout.label}</span>
                </div>
                <div className="flex-1 overflow-y-auto py-2 px-2">
                  {flyout.children.map((child: any) => {
                    const active = fullPath.startsWith(child.key);
                    return (
                      <button
                        key={child.key}
                        onClick={() => { closeFlyout(); go(child.key); }}
                        className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 mb-0.5 text-left transition-colors duration-150 cursor-pointer ${
                          active ? 'bg-[#e7eef8]' : 'hover:bg-[#f5f7fb]'
                        }`}
                      >
                        <span className={`shrink-0 ${active ? 'text-[#003366]' : 'text-[#64748b]'}`}>
                          {PAGE_ICONS[child.key] || <ChevronRight size={14} strokeWidth={1.75} />}
                        </span>
                        <span className={`flex-1 text-[13px] truncate ${active ? 'font-semibold text-[#003366]' : 'font-medium text-[#3c4263]'}`}>{child.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="shrink-0 border-t border-[rgba(15,23,42,0.06)] px-4 py-3 flex items-start gap-2 bg-[#fbfcff]">
                  <Lightbulb size={13} strokeWidth={1.75} className="text-[#64748b] mt-0.5 shrink-0" aria-hidden />
                  <span className="text-[11.5px] text-[#64748b]" style={{ lineHeight: 1.5 }}>Tip: hover to preview, click a page to open it.</span>
                </div>
                </div>
              </div>
            </>
          )}
        </Sider>
      )}

      {isMobile && (
        <Drawer
          placement="left"
          width={292}
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', background: sidebarTheme.bg, ...sidebarVars as any }, header: { display: 'none' } }}
          className="nex-mobile-nav-drawer"
          destroyOnClose={false}
        >
          <div className={`nex-sidebar ${isLight ? 'nex-sidebar-light' : ''} flex flex-col h-full overflow-hidden`} style={{ background: sidebarTheme.bg, ...sidebarVars }}>
            {sidebarBrand}
            <div className="flex-1 overflow-y-auto">{sidebarMenu}</div>
            {sidebarCustomize}
          </div>
        </Drawer>
      )}

      <Layout className={`transition-all duration-200 ${isMobile ? 'ml-0' : collapsed ? 'ml-[80px]' : 'ml-[252px]'}`}>
        <Header
          className="nex-app-header !bg-white !px-3 sm:!px-5 flex items-center justify-between gap-2 sticky top-0 z-10"
          style={{ height: 56, lineHeight: 1.25, borderBottom: '1px solid #e6e9f0' }}
        >
          <Space size={isMobile ? 'small' : 'middle'} className="min-w-0">
            <Button
              type="text"
              icon={isMobile ? <MenuIcon size={18} strokeWidth={1.75} /> : collapsed ? <PanelLeftOpen size={18} strokeWidth={1.75} /> : <PanelLeftClose size={18} strokeWidth={1.75} />}
              onClick={() => (isMobile ? setMobileNavOpen(true) : setCollapsed(!collapsed))}
              className="!rounded-lg hover:!bg-[#eef2f9] shrink-0"
              aria-label={isMobile ? 'Open navigation' : 'Toggle sidebar'}
            />
            <div className="min-w-0">
              <Typography.Text strong className="!text-[15px] !leading-none !text-[#171a2e] !block truncate max-w-[42vw] sm:max-w-[280px]">{title}</Typography.Text>
            </div>
          </Space>

          <Space size={isMobile ? 4 : 'middle'} className="shrink-0" wrap={false}>
            <span className="hidden md:inline-flex"><GlobalSearch navigation={flatNav} /></span>
            <span className="inline-flex md:hidden"><GlobalSearch navigation={flatNav} compact /></span>
            <QuickCreate />
            <ActionCenter />

            <Popover content={quickAccessPanel} trigger="click" placement="bottomRight" open={quickOpen} onOpenChange={setQuickOpen}>
              <Button className="nex-quick-access-btn" icon={<LayoutGrid size={16} strokeWidth={1.75} />}>
                <span className="hidden md:inline">Quick Access</span>
              </Button>
            </Popover>

            <Select
              className="nex-header-company"
              popupMatchSelectWidth={false}
              defaultValue={activeCompanyId || companies[0]?.id}
              options={companies.map((c) => ({ label: c.name, value: c.id }))}
              onChange={switchCompany}
            />

            <Dropdown menu={userMenu} placement="bottomRight">
              <Space className="cursor-pointer hover:opacity-85 transition-opacity gap-2.5">
                <Avatar size={32} className="nex-header-avatar">{user?.name?.[0] || 'U'}</Avatar>
                <span className="hidden lg:inline font-medium text-[13px] text-[#3c4263]">{user?.name}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content>
          <div className="erp-page">{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
