import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

// Canonical subtype taxonomy (display label for a stored/inferred subtype).
export const SUBTYPE_LABELS: Record<string, string> = {
  BANK: 'Bank', CASH: 'Cash', ACCOUNTS_RECEIVABLE: 'Accounts Receivable', INVENTORY: 'Inventory',
  FIXED_ASSET: 'Fixed Asset', OTHER_CURRENT_ASSET: 'Other Current Asset', OTHER_ASSET: 'Other Asset',
  ACCOUNTS_PAYABLE: 'Accounts Payable', CREDIT_CARD: 'Credit Card', LOAN: 'Loan',
  SALES_TAX_PAYABLE: 'Sales Tax Payable', CURRENT_LIABILITY: 'Current Liability', LONG_TERM_LIABILITY: 'Long-Term Liability',
  OTHER_LIABILITY: 'Other Liability', OWNER_CAPITAL: 'Owner Capital', RETAINED_EARNINGS: 'Retained Earnings',
  DRAWINGS: 'Drawings', OTHER_EQUITY: 'Other Equity', REVENUE: 'Revenue', OTHER_INCOME: 'Other Income',
  COGS: 'Cost of Goods Sold', EXPENSE: 'Expense', OTHER_EXPENSE: 'Other Expense',
};

export const SUBTYPE_BY_TYPE: Record<string, string[]> = {
  ASSET: ['BANK', 'CASH', 'ACCOUNTS_RECEIVABLE', 'INVENTORY', 'FIXED_ASSET', 'OTHER_CURRENT_ASSET', 'OTHER_ASSET'],
  LIABILITY: ['ACCOUNTS_PAYABLE', 'CREDIT_CARD', 'LOAN', 'SALES_TAX_PAYABLE', 'CURRENT_LIABILITY', 'LONG_TERM_LIABILITY', 'OTHER_LIABILITY'],
  EQUITY: ['OWNER_CAPITAL', 'RETAINED_EARNINGS', 'DRAWINGS', 'OTHER_EQUITY'],
  REVENUE: ['REVENUE', 'OTHER_INCOME'],
  EXPENSE: ['COGS', 'EXPENSE', 'OTHER_EXPENSE'],
};

const CASH_RE = /cash|petty|undeposited|wallet|money market/i;
const BANK_RE = /bank|current account|checking|savings|operating account/i;
const CARD_RE = /credit card|card/i;

@Injectable()
export class GeneralLedgerService {
  constructor(private prisma: PrismaService) {}

  /** Normal-balance side for an account type. */
  normalSide(type: string): 'debit' | 'credit' {
    return type === 'ASSET' || type === 'EXPENSE' ? 'debit' : 'credit';
  }

  /** Display balance (positive on the normal side). */
  display(type: string, debit: any, credit: any): number {
    const net = Number(Number(debit) - Number(credit));
    const v = this.normalSide(type) === 'debit' ? net : -net;
    return Number(v.toFixed(2));
  }

  /** Fine-grained category for an account (used for category cards/table filter). */
  category(account: any): string {
    const sub = (account.subtype || '').toUpperCase();
    if (sub && SUBTYPE_BY_TYPE[account.type]?.includes(sub)) return sub;
    const code = String(account.code || '');
    const name = String(account.name || '');
    const t = String(account.type || '').toUpperCase();
    if (t === 'ASSET') {
      if (BANK_RE.test(`${code} ${name}`)) return 'BANK';
      if (CASH_RE.test(`${code} ${name}`)) return 'CASH';
      if (/receivable|debtor|accounts rec/i.test(name)) return 'ACCOUNTS_RECEIVABLE';
      if (/inventory|stock|wip|finished goods|raw material/i.test(name)) return 'INVENTORY';
      if (/depreciat|plant|equipment|vehicle|building|fixed|furniture|accumulated/i.test(name)) return 'FIXED_ASSET';
      return 'OTHER_CURRENT_ASSET';
    }
    if (t === 'LIABILITY') {
      if (CARD_RE.test(name)) return 'CREDIT_CARD';
      if (/loan|note pay|borrow|mortgage|debt/i.test(name)) return 'LOAN';
      if (/payable/i.test(name)) return 'ACCOUNTS_PAYABLE';
      if (/tax/i.test(name)) return 'SALES_TAX_PAYABLE';
      return 'CURRENT_LIABILITY';
    }
    if (t === 'EQUITY') {
      if (/retained|current year|undistributed/i.test(name)) return 'RETAINED_EARNINGS';
      if (/drawing|owner withdrawal/i.test(name)) return 'DRAWINGS';
      if (/capital|owner|partner/i.test(name)) return 'OWNER_CAPITAL';
      return 'OTHER_EQUITY';
    }
    if (t === 'REVENUE') return /other income|interest|dividend|gain/i.test(name) ? 'OTHER_INCOME' : 'REVENUE';
    if (t === 'EXPENSE') return (/cost of goods|cogs|cost of sales/i.test(name) ? 'COGS' : /other expense|misc|interest expense|bank charges/i.test(name) ? 'OTHER_EXPENSE' : 'EXPENSE');
    return sub;
  }

  /** Aggregate display + raw balances for all accounts of a company (as of optional date). */
  async accountBalances(companyId: string, asOf?: Date) {
    const dateQ: any = { journal: { companyId, status: 'POSTED' } };
    if (asOf) dateQ.journal.date = { lte: asOf };
    const lines = await this.prisma.journalLine.findMany({ where: dateQ, include: { account: true } });
    const map: Record<string, { code: string; name: string; type: string; subtype: string | null; balance: number; debit: number; credit: number }> = {};
    for (const l of lines) {
      if (!l.account) continue;
      const a = l.account;
      if (!map[a.id]) map[a.id] = { code: a.code, name: a.name, type: a.type, subtype: a.subtype, balance: 0, debit: 0, credit: 0 };
      map[a.id].debit += Number(l.debit);
      map[a.id].credit += Number(l.credit);
      map[a.id].balance += this.display(a.type, l.debit, l.credit);
    }
    return map;
  }

  async singleBalance(companyId: string, accountId: string, asOf?: Date) {
    const m = await this.accountBalances(companyId, asOf);
    return m[accountId] || { balance: 0, debit: 0, credit: 0 };
  }

  async resolveJournalSource(sourceType: string, sourceId: string | null, reference: string | null, descriptionFallback: string | null): Promise<{ label: string; number: string; route: string }> {
    const map: Record<string, any> = {
      SALES_INVOICE: { label: 'Invoice', route: '/sales/invoices', model: 'salesInvoice', numberField: 'invoiceNo' },
      invoice: { label: 'Invoice', route: '/sales/invoices', model: 'salesInvoice', numberField: 'invoiceNo' },
      RECEIPT: { label: 'Customer Receipt', route: '/sales/receipts', model: 'receipt', numberField: 'receiptNo' },
      RECEIPT_REVERSAL: { label: 'Receipt Reversal', route: '/sales/receipts', model: 'receipt', numberField: 'receiptNo' },
      CREDIT_NOTE: { label: 'Credit Note', route: '/sales/credit-notes', model: 'creditNote', numberField: 'creditNoteNo' },
      CREDIT_NOTE_VOID: { label: 'Credit Note Void', route: '/sales/credit-notes', model: 'creditNote', numberField: 'creditNoteNo' },
      DEBIT_NOTE: { label: 'Debit Note', route: '/sales/debit-notes', model: 'debitNote', numberField: 'debitNoteNo' },
      DEBIT_NOTE_VOID: { label: 'Debit Note Void', route: '/sales/debit-notes', model: 'debitNote', numberField: 'debitNoteNo' },
      SUPPLIER_INVOICE: { label: 'Supplier Bill', route: '/expenses/bills', model: 'supplierInvoice', numberField: 'invoiceNo' },
      SUPPLIER_PAYMENT: { label: 'Supplier Payment', route: '/expenses/bills', model: 'supplierPayment', numberField: 'paymentNo' },
      SUPPLIER_PAYMENT_REVERSAL: { label: 'Supplier Payment Reversal', route: '/expenses/bills', model: 'supplierPayment', numberField: 'paymentNo' },
      VENDOR_CREDIT: { label: 'Vendor Credit', route: '/expenses/vendor-credits', model: 'vendorCredit', numberField: 'vendorCreditNo' },
      VENDOR_CREDIT_VOID: { label: 'Vendor Credit Void', route: '/expenses/vendor-credits', model: 'vendorCredit', numberField: 'vendorCreditNo' },
      VENDOR_CREDIT_REFUND: { label: 'Supplier Refund', route: '/expenses/vendor-credits' },
      CHECK: { label: 'Check', route: '/finance/checks', model: 'check', numberField: 'checkNo' },
      CHECK_VOID: { label: 'Check Void', route: '/finance/checks', model: 'check', numberField: 'checkNo' },
      CREDIT_CARD_CHARGE: { label: 'Card Charge', route: '/expenses/credit-card-charges' },
      CREDIT_CARD_PAYMENT: { label: 'Card Payment', route: '/expenses/credit-card-charges' },
      CREDIT_CARD_PAYMENT_REVERSAL: { label: 'Card Payment Reversal', route: '/expenses/credit-card-charges' },
      CREDIT_CARD: { label: 'Credit Card', route: '/expenses/credit-card-charges' },
      BANK_TRANSFER: { label: 'Bank Transfer', route: '/finance/bank-transfers' },
      MANUAL: { label: 'Journal Entry', route: '/finance/journals' },
      REVERSAL: { label: 'Reversal', route: '/finance/journals' },
      ASSET_DISPOSAL: { label: 'Asset Disposal', route: '/finance/accounts' },
      COGS: { label: 'Cost of Goods Sold', route: '/finance/accounts' },
      DEPRECIATION: { label: 'Depreciation', route: '/finance/accounts' },
      PAYROLL: { label: 'Payroll', route: '/finance/accounts' },
    };
    const item = map[sourceType] || { label: sourceType ? sourceType.toLowerCase().replace(/_/g, ' ') : 'Journal Entry', route: '/finance/journals' };
    let number = '';
    if (sourceType === 'VENDOR_CREDIT_REFUND' && sourceId) {
      const refund = await this.prisma.vendorCreditRefund.findUnique({ where: { id: sourceId }, include: { vendorCredit: true } });
      number = (refund && (refund.reference || refund.memo)) || (refund?.vendorCredit?.vendorCreditNo || '') || '';
    } else if (sourceId && item.model && item.numberField) {
      const doc = await (this.prisma as any)[item.model].findUnique({ where: { id: sourceId }, select: { [item.numberField]: true } });
      number = doc?.[item.numberField] ? String(doc[item.numberField]) : '';
    }
    if (!number && reference) number = String(reference);
    return { label: item.label, number, route: item.route };
  }

  /**
   * Single authoritative account ledger query.
   * Returns opening / movement / closing (display convention), raw debit+credit
   * totals (page + grand), a deterministic running balance, and paginated rows
   * with resolved business source numbers (never raw UUIDs).
   */
  async getAccountLedger(companyId: string, accountId: string, opts: { from?: string; to?: string; search?: string; page?: number; pageSize?: number } = {}) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { id: accountId, companyId } });
    if (!account) throw new NotFoundException('Account not found');
    const from = opts.from ? new Date(String(opts.from)) : new Date('1000-01-01');
    const to = opts.to ? new Date(String(opts.to).concat('T23:59:59')) : new Date('9999-12-31');
    const search = (opts.search || '').trim().toLowerCase();
    const page = Math.max(1, Number(opts.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(opts.pageSize || 50)));

    const lines = await this.prisma.journalLine.findMany({
      where: { accountId, journal: { companyId, status: 'POSTED' } },
      include: { journal: true },
      orderBy: [{ journal: { date: 'asc' } }, { id: 'asc' }],
    });

    const opening = lines.filter((l) => l.journal.date < from).reduce((s, l) => s + this.display(account.type, l.debit, l.credit), 0);
    const periodLines = lines.filter((l) => l.journal.date >= from && l.journal.date <= to);

    let run = opening;
    const periodRows = periodLines.map((l) => {
      run += this.display(account.type, l.debit, l.credit);
      return { line: l, _run: Number(run.toFixed(2)), _display: this.display(account.type, l.debit, l.credit) };
    });

    const rawDebit = (arr: any[]) => arr.reduce((s, r) => s + Number(r.line.debit), 0);
    const rawCredit = (arr: any[]) => arr.reduce((s, r) => s + Number(r.line.credit), 0);

    // Resolve source numbers only where needed (search match or paged rows).
    const resolve = async (r: any) => {
      const j = r.line.journal;
      return this.resolveJournalSource(j.sourceType, j.sourceId, j.reference, j.sourceType === 'MANUAL' ? j.description : null);
    };
    const rowsSource: Record<string, { label: string; number: string; route: string }> = {};

    let filtered = periodRows;
    if (search) {
      // Cheap fields first (keeps per-line DB resolution bounded).
      const baseMatch = (r: any) => {
        const j = r.line.journal;
        return `${j.number} ${j.description} ${r.line.description || ''} ${j.reference || ''}`.toLowerCase().includes(search);
      };
      filtered = periodRows.filter(baseMatch);
      if (!filtered.length) {
        // Source-document-number search (resolution bounded to recent 200 lines).
        const resolved: any[] = [];
        for (const r of periodRows.slice(0, 200)) {
          const s = await resolve(r);
          if (s.number && s.number.toLowerCase().includes(search)) resolved.push(r);
        }
        filtered = resolved;
      }
    }

    const grandRows = filtered;
    const grand = { debit: Number(rawDebit(grandRows).toFixed(2)), credit: Number(rawCredit(grandRows).toFixed(2)) };
    const totalCount = grandRows.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const startIdx = (page - 1) * pageSize;
    const pageRows = grandRows.slice(startIdx, startIdx + pageSize);

    const rows = await Promise.all(pageRows.map(async (r) => {
      const j = r.line.journal;
      const src = rowsSource[r.line.id] || await resolve(r);
      return {
        id: r.line.id,
        date: j.date,
        journalId: j.id,
        journalNumber: j.number,
        description: r.line.description || j.description,
        reference: src.number || '', sourceType: j.sourceType, sourceLabel: src.label, sourceRoute: src.route,
        debit: Number(r.line.debit), credit: Number(r.line.credit),
        runningBalance: r._run,
      };
    }));

    const netMovement = Number((run - opening).toFixed(2));
    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type, subtype: this.category(account) },
      opening, netMovement, closing: Number(run.toFixed(2)),
      periodDebits: Number(rawDebit(periodRows).toFixed(2)), periodCredits: Number(rawCredit(periodRows).toFixed(2)),
      transactionCount: periodRows.length,
      rows, page, pageSize, totalCount, totalPages,
      pageTotals: { debit: Number(rawDebit(pageRows).toFixed(2)), credit: Number(rawCredit(pageRows).toFixed(2)) },
      grandTotals: { debit: grand.debit, credit: grand.credit, closing: Number(run.toFixed(2)) },
    };
  }
}
