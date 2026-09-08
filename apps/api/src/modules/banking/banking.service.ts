import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SecretService } from '../../core/common/secret.service';
import { BankProviderRegistry } from './bank-providers';

const SANITIZE = (o: any) => {
  if (o == null) return o;
  const c: any = { ...o };
  delete c.accessTokenCipher; delete c.refreshTokenCipher; delete c.accessTokenPlaintext; delete c.refreshTokenPlaintext;
  return c;
};

@Injectable()
export class BankingService {
  constructor(private prisma: PrismaService, private registry: BankProviderRegistry, private secrets: SecretService) {}

  listProviders() {
    return this.registry.list().map((p) => ({ code: p.code, name: p.name, environment: p.environment, capabilities: p.capabilities }));
  }

  async listConnections(companyId: string, tenantId?: string) {
    const connections = await this.prisma.bankConnection.findMany({ where: { companyId, ...(tenantId ? { tenantId } : {}) }, orderBy: { createdAt: 'desc' } });
    return Promise.all(connections.map(async (c) => {
      const accounts = await this.prisma.externalBankAccount.findMany({ where: { bankConnectionId: c.id }, orderBy: { accountName: 'asc' } });
      const txnCount = await this.prisma.bankTransaction.count({ where: { bankConnectionId: c.id } });
      return { ...SANITIZE(c), accounts: accounts.map(SANITIZE), transactionCount: txnCount };
    }));
  }

  async createConnection(companyId: string, tenantId: string, userId: string, dto: { provider: string; institutionName?: string; authorizeUrl?: string }) {
    const provider = this.registry.get(dto.provider);
    const connection = await this.prisma.bankConnection.create({
      data: { tenantId, companyId, provider: provider.code, institutionName: dto.institutionName || provider.name, status: 'CONNECTED', createdById: userId },
    });
    // Pull the provider accounts and stage them (disabled until explicitly enabled/mapped).
    const accounts = await provider.listAccounts(connection);
    for (const a of accounts) {
      const dup = await this.prisma.externalBankAccount.findFirst({ where: { companyId, providerAccountId: a.providerAccountId } });
      if (dup) continue;
      await this.prisma.externalBankAccount.create({ data: { tenantId, companyId, bankConnectionId: connection.id, providerAccountId: a.providerAccountId, institutionName: a.institutionName, accountName: a.accountName, accountType: a.accountType, accountSubtype: a.accountSubtype, maskedAccountNumber: a.maskedAccountNumber, currency: a.currency, currentBalance: a.currentBalance || 0, availableBalance: a.availableBalance || 0, enabled: false } });
    }
    return SANITIZE(connection);
  }

  async connectWithToken(companyId: string, tenantId: string, userId: string, dto: { provider: string; accessToken?: string; refreshToken?: string; expiresIn?: number }) {
    const connection = await this.prisma.bankConnection.create({
      data: {
        tenantId, companyId, provider: dto.provider, institutionName: 'External Bank', status: 'CONNECTED', createdById: userId,
        accessTokenCipher: this.secrets.encrypt(dto.accessToken),
        refreshTokenCipher: this.secrets.encrypt(dto.refreshToken),
        tokenExpiresAt: dto.expiresIn ? new Date(Date.now() + Number(dto.expiresIn) * 1000) : null,
      },
    });
    return SANITIZE(connection);
  }

  async listAccounts(companyId: string, connectionId: string) {
    await this.requireConnection(companyId, connectionId);
    const accounts = await this.prisma.externalBankAccount.findMany({ where: { companyId, bankConnectionId: connectionId }, orderBy: { accountName: 'asc' } });
    return accounts.map(SANITIZE);
  }

  async mapAccount(companyId: string, accountId: string, dto: { nexusBankAccountId?: string; glAccountId?: string; enabled?: boolean }) {
    const account = await this.prisma.externalBankAccount.findFirst({ where: { id: accountId, companyId } });
    if (!account) throw new NotFoundException('External bank account not found');
    // Prevent duplicate active mapping to the same nexus bank account.
    if (dto.nexusBankAccountId && (dto.enabled ?? account.enabled)) {
      const dup = await this.prisma.externalBankAccount.findFirst({ where: { companyId, nexusBankAccountId: dto.nexusBankAccountId, enabled: true, id: { not: accountId } } });
      if (dup) throw new BadRequestException('This NexusERP bank account is already mapped to an external account.');
    }
    return SANITIZE(await this.prisma.externalBankAccount.update({ where: { id: accountId }, data: { nexusBankAccountId: dto.nexusBankAccountId ?? undefined, glAccountId: dto.glAccountId ?? undefined, enabled: dto.enabled ?? undefined } }));
  }

  async syncConnection(companyId: string, connectionId: string) {
    const connection = await this.requireConnection(companyId, connectionId);
    const provider = this.registry.get(connection.provider);
    const accounts = await this.prisma.externalBankAccount.findMany({ where: { companyId, bankConnectionId: connectionId, enabled: true } });
    let inserted = 0, updated = 0, duplicates = 0;
    const balances = await provider.getBalances(connection);
    for (const account of accounts) {
      const since = account.lastTransactionSyncAt || undefined;
      const txs = await provider.syncTransactions(connection, account, since);
      for (const t of txs) {
        const existing = await this.prisma.bankTransaction.findUnique({ where: { externalAccountId_providerTransactionId: { externalAccountId: account.id, providerTransactionId: t.providerTransactionId } } });
        const data = { companyId, tenantId: connection.tenantId, bankConnectionId: connection.id, externalAccountId: account.id, providerTransactionId: t.providerTransactionId, bookingDate: t.bookingDate, valueDate: t.valueDate, amount: t.amount, currency: t.currency, direction: t.direction, description: t.description, reference: t.reference, bankReference: t.bankReference, counterpartyName: t.counterpartyName, counterpartyAccountMasked: t.counterpartyAccountMasked, providerType: t.providerType, providerStatus: t.providerStatus, runningBalance: t.runningBalance, rawMetadata: t.raw as any, lastSeenAt: new Date() };
        if (existing) { await this.prisma.bankTransaction.update({ where: { id: existing.id }, data: { providerStatus: t.providerStatus, lastSeenAt: new Date() } }); updated++; }
        else { await this.prisma.bankTransaction.create({ data }); inserted++; }
      }
      const bal = balances.find((b) => b.accountId === account.providerAccountId);
      await this.prisma.externalBankAccount.update({ where: { id: account.id }, data: { currentBalance: bal?.currentBalance ?? account.currentBalance, availableBalance: bal?.availableBalance ?? account.availableBalance, balanceUpdatedAt: new Date(), lastTransactionSyncAt: new Date() } });
    }
    await this.prisma.bankConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date(), lastSuccessfulSyncAt: new Date(), lastSyncError: null } });
    return { inserted, updated, duplicates, syncedAt: new Date() };
  }

  async feed(companyId: string, externalAccountId?: string) {
    const where: any = { companyId };
    if (externalAccountId) where.externalAccountId = externalAccountId;
    const rows = await this.prisma.bankTransaction.findMany({ where, orderBy: { bookingDate: 'desc' }, take: 500 });
    return rows.map((r) => ({
      id: r.id, bookingDate: r.bookingDate, valueDate: r.valueDate, amount: Number(r.amount), currency: r.currency, direction: r.direction,
      description: r.description, reference: r.reference, bankReference: r.bankReference, counterpartyName: r.counterpartyName,
      providerStatus: r.providerStatus, matchStatus: r.matchStatus, externalAccountId: r.externalAccountId, bankConnectionId: r.bankConnectionId,
    }));
  }

  async disconnect(companyId: string, connectionId: string) {
    const connection = await this.requireConnection(companyId, connectionId);
    await this.prisma.bankConnection.update({ where: { id: connection.id }, data: { status: 'DISCONNECTED' } });
    // Historical transactions + accounts are retained (never deleted).
    return SANITIZE(connection);
  }

  private async requireConnection(companyId: string, connectionId: string) {
    const c = await this.prisma.bankConnection.findFirst({ where: { id: connectionId, companyId } });
    if (!c) throw new NotFoundException('Bank connection not found');
    return c;
  }
}
