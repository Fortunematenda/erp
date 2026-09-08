import { Injectable } from '@nestjs/common';

export interface NormalizedBankTx {
  providerTransactionId: string;
  bookingDate?: Date;
  valueDate?: Date;
  amount: number;
  currency: string;
  direction: 'MONEY_IN' | 'MONEY_OUT';
  description?: string;
  reference?: string;
  bankReference?: string;
  counterpartyName?: string;
  counterpartyAccountMasked?: string;
  providerType?: string;
  providerStatus?: string;
  runningBalance?: number;
  raw?: any;
}

export interface ProviderAccount {
  providerAccountId: string;
  institutionName?: string;
  accountName?: string;
  accountType?: string;
  accountSubtype?: string;
  maskedAccountNumber?: string;
  currency: string;
  currentBalance?: number;
  availableBalance?: number;
}

// Read-only provider-capability declaration (payment initiation stays OFF).
export interface BankProviderCapabilities {
  accountInfo: boolean;
  balances: boolean;
  transactions: boolean;
  webhooks: boolean;
  paymentInitiation: boolean;
}

export interface BankFeedProvider {
  code: string;
  name: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  capabilities: BankProviderCapabilities;
  listAccounts(connection: any): Promise<ProviderAccount[]>;
  getBalances(connection: any): Promise<{ accountId: string; currentBalance: number; availableBalance: number }[]>;
  syncTransactions(connection: any, account: any, since?: Date): Promise<NormalizedBankTx[]>;
}

// -----------------------------------------------------------------------------
// SANDBOX / demo provider — demonstrates the full ingest -> normalize -> dedup
// pipeline without any real bank. Live Open Banking / aggregator adapters are
// added later behind the same BankFeedProvider interface (they are NOT present
// here; the architecture is pluggable and no fake bank is advertised).
// -----------------------------------------------------------------------------
@Injectable()
export class DemoBankProvider implements BankFeedProvider {
  code = 'SANDBOX_DEMO';
  name = 'Demo Bank (Sandbox)';
  environment: 'SANDBOX' | 'PRODUCTION' = 'SANDBOX';
  capabilities: BankProviderCapabilities = { accountInfo: true, balances: true, transactions: true, webhooks: false, paymentInitiation: false };

  async listAccounts(): Promise<ProviderAccount[]> {
    return [
      { providerAccountId: 'acc-operating', institutionName: 'Demo Bank', accountName: 'Operating', accountType: 'checking', accountSubtype: 'current', maskedAccountNumber: '• 4732', currency: 'USD', currentBalance: 12450.33, availableBalance: 12450.33 },
      { providerAccountId: 'acc-savings', institutionName: 'Demo Bank', accountName: 'Savings', accountType: 'savings', accountSubtype: 'savings', maskedAccountNumber: '• 2271', currency: 'USD', currentBalance: 8200.00, availableBalance: 8200.00 },
      { providerAccountId: 'acc-zar', institutionName: 'Demo Bank', accountName: 'ZAR Account', accountType: 'checking', accountSubtype: 'current', maskedAccountNumber: '• 1844', currency: 'ZAR', currentBalance: 15000.00, availableBalance: 15000.00 },
    ];
  }

  async getBalances(): Promise<{ accountId: string; currentBalance: number; availableBalance: number }[]> {
    return (await this.listAccounts()).map((a) => ({ accountId: a.providerAccountId, currentBalance: a.currentBalance || 0, availableBalance: a.availableBalance || 0 }));
  }

  async syncTransactions(_connection: any, account: any, since?: Date): Promise<NormalizedBankTx[]> {
    // Synthetic, deterministic transactions so repeated syncs are idempotent.
    const day = new Date();
    const txId = (n: string) => `${account.providerAccountId}-${n}`;
    const rows: NormalizedBankTx[] = [
      { providerTransactionId: txId('RCP-000006'), bookingDate: day, valueDate: day, amount: 100, currency: account.currency, direction: 'MONEY_IN', description: 'Customer payment', reference: 'RCP-000006', counterpartyName: 'E2E Customer', providerType: 'CREDIT', providerStatus: 'POSTED', runningBalance: 100 },
      { providerTransactionId: txId('SP-000008'), bookingDate: day, valueDate: day, amount: 500, currency: account.currency, direction: 'MONEY_OUT', description: 'Supplier payment', reference: 'SP-000008', counterpartyName: 'Test Supplier Co', providerType: 'DEBIT', providerStatus: 'POSTED', runningBalance: -400 },
      { providerTransactionId: txId('BANK-FEE'), bookingDate: day, valueDate: day, amount: 25, currency: account.currency, direction: 'MONEY_OUT', description: 'Monthly service fee', reference: 'FEE-0901', providerType: 'DEBIT', providerStatus: 'POSTED', runningBalance: -425 },
      { providerTransactionId: txId('TRF-007'), bookingDate: day, valueDate: day, amount: 1000, currency: account.currency, direction: 'MONEY_OUT', description: 'Transfer to savings', reference: 'TRF-000007', counterpartyName: 'Self', providerType: 'TRANSFER', providerStatus: 'POSTED', runningBalance: -1425 },
    ];
    if (since) return rows.filter((r) => r.bookingDate && new Date(r.bookingDate) > since);
    return rows;
  }
}

@Injectable()
export class BankProviderRegistry {
  constructor(private demo: DemoBankProvider) { this.register(demo); }
  private providers = new Map<string, BankFeedProvider>();
  register(p: BankFeedProvider) { this.providers.set(p.code, p); }
  get(code: string): BankFeedProvider {
    if (!this.providers.has(code) && code === this.demo.code) this.providers.set(code, this.demo);
    const p = this.providers.get(code);
    if (!p) throw new Error(`No bank feed provider registered for '${code}'`);
    return p;
  }
  list(): BankFeedProvider[] { return [...this.providers.values()]; }
}
