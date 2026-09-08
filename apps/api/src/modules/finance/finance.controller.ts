import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { AccountDto, BudgetDto, CreateJournalDto, TaxRateDto } from './finance.dto';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { PermissionService } from '../auth/permission.service';
import { PostingService } from './posting.service';
import { GeneralLedgerService, SUBTYPE_LABELS, SUBTYPE_BY_TYPE } from './general-ledger.service';

/** Normal-balance display value: ASSET/EXPENSE -> debit-credit, LIABILITY/EQUITY/REVENUE -> credit-debit. */
function normal(type: string, debit: any, credit: any) {
  const net = Number((Number(debit) - Number(credit)).toFixed(2));
  return type === 'ASSET' || type === 'EXPENSE' ? net : -net;
}

@ApiTags('Finance') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('finance')
export class FinanceController {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService, private posting: PostingService, private permissionService: PermissionService, private ledger: GeneralLedgerService) {}

  // ----- Chart of accounts -----
  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.view')
  @Get('accounts') async accounts(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (q.type) where.type = q.type;
    if (q.subtype) where.subtype = q.subtype;
    if (q.status === 'INACTIVE') where.active = false;
    else if (q.status === 'ACTIVE') where.active = true;
    const all = await this.prisma.ledgerAccount.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
    const balances = await this.ledger.accountBalances(companyId, q.asOf ? new Date(String(q.asOf)) : undefined);
    const list = all.filter((a) => (!where.type || a.type === where.type) && (!where.subtype || a.subtype === where.subtype) && (where.active === undefined || a.active === where.active)).map((a) => {
      const b = balances[a.id] || { balance: 0 };
      return { ...a, balance: Number(b.balance.toFixed(2)), category: this.ledger.category(a) };
    });
    return list;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.view')
  @Get('accounts/summary') async accountSummary(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const all = await this.prisma.ledgerAccount.findMany({ where: { companyId } });
    const balances = await this.ledger.accountBalances(companyId);
    const active = all.filter((a) => a.active);
    const byType: Record<string, number> = {};
    const byCategory: Record<string, { balance: number; count: number }> = {};
    for (const a of all) {
      byType[a.type] = (byType[a.type] || 0) + 1;
      const bal = Number((balances[a.id]?.balance || 0)).toFixed(2);
      const cat = this.ledger.category(a);
      byCategory[cat] = byCategory[cat] || { balance: 0, count: 0 };
      byCategory[cat].balance += Number(bal);
      byCategory[cat].count += 1;
    }
    const typeBalances: Record<string, number> = { ASSET: 0, LIABILITY: 0, EQUITY: 0, REVENUE: 0, EXPENSE: 0 };
    for (const a of all) typeBalances[a.type] += Number((balances[a.id]?.balance || 0));
    const revenue = typeBalances.REVENUE;
    const expenses = typeBalances.EXPENSE;
    const netIncome = Number((revenue - expenses).toFixed(2));
    const assets = Number(typeBalances.ASSET.toFixed(2));
    const liabilities = Number(typeBalances.LIABILITY.toFixed(2));
    const equity = Number((typeBalances.EQUITY + netIncome).toFixed(2));
    const difference = Number((assets - (liabilities + equity)).toFixed(2));
    return {
      totalAccounts: all.length,
      activeAccounts: active.length,
      inactiveAccounts: all.length - active.length,
      byType,
      categoryCards: Object.entries(byCategory).map(([category, v]) => ({ category, balance: Number(v.balance.toFixed(2)), count: v.count })),
      equation: { assets, liabilities, equity, netIncome, difference },
    };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.view')
  @Get('accounts/:id') async accountDetail(@Req() req: any, @Param('id') id: string, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const account = await this.prisma.ledgerAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new BadRequestException('Account not found');
    const parent = account.parentId ? await this.prisma.ledgerAccount.findFirst({ where: { id: account.parentId, companyId } }) : null;
    const [balance, openingEntry, recent, auditTrail] = await Promise.all([
      this.ledger.singleBalance(companyId, id, q.asOf ? new Date(String(q.asOf)) : undefined),
      this.prisma.journalEntry.findFirst({ where: { companyId, status: 'POSTED', sourceType: 'OPENING_BALANCE', lines: { some: { accountId: id } } }, include: { lines: true }, orderBy: { date: 'asc' } }),
      this.prisma.journalLine.findMany({ where: { accountId: id, journal: { companyId, status: 'POSTED' } }, include: { journal: true }, orderBy: { journal: { date: 'desc' } }, take: 10 }),
      this.prisma.auditLog.findMany({ where: { companyId, entityType: 'LedgerAccount', entityId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const recentEntries = await Promise.all(recent.map(async (l) => {
      const src = await this.ledger.resolveJournalSource(l.journal.sourceType, l.journal.sourceId, l.journal.reference, l.journal.sourceType === 'MANUAL' ? l.journal.description : null);
      return { id: l.id, date: l.journal.date, journalId: l.journal.id, journalNumber: l.journal.number, description: l.description || l.journal.description, reference: src.number || '', sourceLabel: src.label, sourceRoute: src.route, debit: Number(l.debit), credit: Number(l.credit) };
    }));
    return {
      ...account,
      parent: parent ? { id: parent.id, code: parent.code, name: parent.name } : null,
      category: this.ledger.category(account),
      balance: Number((balance.balance || 0).toFixed(2)),
      openingBalance: openingEntry ? Number(openingEntry.lines.find((l2: any) => l2.accountId === id)?.debit || 0) - Number(openingEntry.lines.find((l2: any) => l2.accountId === id)?.credit || 0) : 0,
      openingJournal: openingEntry ? { id: openingEntry.id, number: openingEntry.number, date: openingEntry.date } : null,
      recentEntries,
      auditTrail,
    };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.manage')
  @Get('accounts/:id/audit') async accountAudit(@Req() req: any, @Param('id') id: string) {
    return this.prisma.auditLog.findMany({ where: { companyId: companyIdOf(req.user), entityType: 'LedgerAccount', entityId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.manage')
  @Post('accounts') async createAccount(@Req() req: any, @Body() dto: AccountDto) {
    const companyId = companyIdOf(req.user);
    // --- validation ---
    if (!dto.type) throw new BadRequestException('Account type is required');
    if (!dto.name?.trim()) throw new BadRequestException('Account name is required');
    const code = dto.code?.trim() || await this.numbering.next(companyId, 'ACC');
    const existing = await this.prisma.ledgerAccount.findFirst({ where: { companyId, code } });
    if (existing) throw new BadRequestException(`Account code ${code} already exists`);
    if (dto.subtype && !(await this.isValidSubtype(companyId, dto.type, dto.subtype))) throw new BadRequestException(`Invalid subtype ${dto.subtype} for type ${dto.type}`);
    if (dto.parentId) {
      const parent = await this.prisma.ledgerAccount.findFirst({ where: { id: dto.parentId, companyId } });
      if (!parent) throw new BadRequestException('Parent account not found');
      if (parent.type !== dto.type) throw new BadRequestException('Parent account must share the same account type');
      await this.assertNoCircularParent(dto.parentId, null, companyId);
    }
    const account = await this.prisma.ledgerAccount.create({ data: { companyId, code, name: dto.name, type: dto.type as any, subtype: dto.subtype, customTypeName: dto.customTypeName, isGroup: dto.isGroup ?? false, description: dto.description, taxCode: dto.taxCode, isSystem: dto.isSystem ?? false, parentId: dto.parentId, active: dto.active ?? true } });
    await this.audit.log(companyId, req.user.sub, 'ACCOUNT CREATED', 'LedgerAccount', account.id, { code, name: dto.name, type: dto.type });
    // --- auditable opening balance via journal, never a direct balance mutation ---
    if (dto.openingBalance && Number(dto.openingBalance) !== 0) {
      await this.postOpeningBalance(companyId, req.user.sub, account.id, Number(dto.openingBalance), dto.openingDate, dto.openingOffsetAccountId);
    }
    return this.prisma.ledgerAccount.findUnique({ where: { id: account.id } });
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.manage')
  @Patch('accounts/:id') async updateAccount(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const companyId = companyIdOf(req.user);
    const account = await this.prisma.ledgerAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new BadRequestException('Account not found');
    const before = { name: account.name, type: account.type, subtype: account.subtype, parentId: account.parentId, active: account.active, isSystem: account.isSystem };
    // Protection: system/protected accounts cannot change type or lose their protected flag.
    const PROTECTED = new Set(['accounts payable', 'accounts receivable', 'retained earnings', 'inventory', 'cost of goods sold', 'tax control', 'opening balance equity']);
    if (account.isSystem || PROTECTED.has(String(account.name).toLowerCase())) {
      if (dto.type && dto.type !== account.type) throw new ForbiddenException('Protected system accounts cannot change type');
      if (dto.isSystem === false) throw new ForbiddenException('Protected system accounts cannot be un-marked as system accounts');
    }
    // Type change protection after postings.
    if (dto.type && dto.type !== account.type) {
      const hasLines = await this.prisma.journalLine.count({ where: { accountId: id, journal: { companyId, status: 'POSTED' } } });
      if (hasLines > 0) throw new ForbiddenException('Accounts with posted entries cannot change type');
    }
    if (dto.parentId) {
      const parent = await this.prisma.ledgerAccount.findFirst({ where: { id: dto.parentId, companyId } });
      if (!parent) throw new BadRequestException('Parent account not found');
      if ((dto.type || account.type) !== parent.type) throw new BadRequestException('Parent account must share the same account type');
      if (dto.parentId === id) throw new BadRequestException('An account cannot be its own parent');
      await this.assertNoCircularParent(dto.parentId, id, companyId);
    }
    if (dto.subtype && !(await this.isValidSubtype(companyId, dto.type || account.type, dto.subtype))) throw new BadRequestException(`Invalid subtype ${dto.subtype} for type ${dto.type || account.type}`);
    const { openingBalance, openingDate, openingOffsetAccountId, ...rest } = dto;
    await this.prisma.ledgerAccount.update({ where: { id }, data: { ...rest } });
    await this.audit.log(companyId, req.user.sub, 'ACCOUNT EDITED', 'LedgerAccount', id, { before, after: rest });
    return this.prisma.ledgerAccount.findUnique({ where: { id } });
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.manage')
  @Post('accounts/:id/deactivate') async deactivateAccount(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    await this.prisma.ledgerAccount.updateMany({ where: { id, companyId }, data: { active: false } });
    await this.audit.log(companyId, req.user.sub, 'ACCOUNT DEACTIVATED', 'LedgerAccount', id);
    return { ok: true };
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.manage')
  @Post('accounts/:id/activate') async activateAccount(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    await this.prisma.ledgerAccount.updateMany({ where: { id, companyId }, data: { active: true } });
    await this.audit.log(companyId, req.user.sub, 'ACCOUNT ACTIVATED', 'LedgerAccount', id);
    return { ok: true };
  }

  // ----- Account Types (canonical classes + custom display types) -----
  private canonicalTypes() {
    return (['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const).map((c) => {
      const normal = c === 'ASSET' || c === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
      const label = ({ ASSET: 'Asset', LIABILITY: 'Liability', EQUITY: 'Equity', REVENUE: 'Income', EXPENSE: 'Expense' } as Record<string, string>)[c] || c;
      return { value: c, label, canonicalClass: c, system: true, customTypeName: null, normal };
    });
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.view')
  @Get('account-types') async accountTypes(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const custom = await this.prisma.accountTypeConfig.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
    const types: any[] = this.canonicalTypes().map((t) => ({ ...t, value: t.value }));
    custom.forEach((c) => types.push({ value: `custom:${c.id}`, label: c.name, canonicalClass: c.canonicalClass, system: c.isSystem, customTypeName: c.name, normal: c.normalBalance, active: c.active }));
    return types;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.account_types.manage')
  @Post('account-types') async createAccountType(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('Account type name is required');
    const canonical = String(body.canonicalClass || '').toUpperCase();
    if (!['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(canonical)) throw new BadRequestException('A valid canonical accounting class is required');
    const dup = await this.prisma.accountTypeConfig.findFirst({ where: { companyId, name } });
    if (dup) throw new BadRequestException(`An account type named "${name}" already exists`);
    const normal = String(body.normalBalance || (canonical === 'ASSET' || canonical === 'EXPENSE' ? 'DEBIT' : 'CREDIT')).toUpperCase();
    const created = await this.prisma.accountTypeConfig.create({ data: { companyId, name, canonicalClass: canonical as any, normalBalance: normal, description: body.description, isSystem: false, active: body.active ?? true } });
    await this.audit.log(companyId, req.user.sub, 'ACCOUNT TYPE CREATED', 'AccountTypeConfig', created.id, { name, canonicalClass: canonical });
    return created;
  }

  // ----- Account Sub-Types (canonical taxonomy + custom, scoped by type) -----
  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.accounts.view')
  @Get('account-subtypes') async accountSubtypes(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const forType = String(q.forType || '').toUpperCase();
    const canonical: any[] = (SUBTYPE_BY_TYPE[forType] || []).map((s) => ({ value: s, label: SUBTYPE_LABELS[s] || s, canonicalClass: forType, system: true }));
    const custom = await this.prisma.accountSubtype.findMany({ where: { companyId, canonicalClass: forType as any, active: true }, orderBy: { name: 'asc' } });
    custom.forEach((c) => canonical.push({ value: `custom:${c.id}`, label: c.name, canonicalClass: c.canonicalClass, system: c.isSystem, reportingGroup: c.reportingGroup }));
    return canonical;
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.account_types.manage')
  @Post('account-subtypes') async createAccountSubtype(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('Sub-type name is required');
    const canonical = String(body.canonicalClass || '').toUpperCase();
    if (!['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(canonical)) throw new BadRequestException('A valid canonical accounting class is required');
    const dup = await this.prisma.accountSubtype.findFirst({ where: { companyId, canonicalClass: canonical as any, name } });
    if (dup) throw new BadRequestException(`A sub-type named "${name}" already exists for this account type`);
    const created = await this.prisma.accountSubtype.create({ data: { companyId, canonicalClass: canonical as any, name, reportingGroup: body.reportingGroup, normalBalance: body.normalBalance, description: body.description, isSystem: false, active: body.active ?? true } });
    await this.audit.log(companyId, req.user.sub, 'ACCOUNT SUBTYPE CREATED', 'AccountSubtype', created.id, { name, canonicalClass: canonical });
    return created;
  }

  private async isValidSubtype(companyId: string, type: string, subtype: string) {
    if ((SUBTYPE_BY_TYPE[type] || []).includes(subtype)) return true;
    const custom = await this.prisma.accountSubtype.findFirst({ where: { companyId, canonicalClass: type as any, name: subtype } });
    return !!custom;
  }

  private async assertNoCircularParent(parentId: string, childId: string | null, companyId: string) {
    let cur = parentId;
    const visited = new Set<string>();
    while (cur) {
      if (cur === childId) throw new BadRequestException('Circular account hierarchy is not allowed');
      if (visited.has(cur)) return;
      visited.add(cur);
      const p = await this.prisma.ledgerAccount.findFirst({ where: { id: cur, companyId }, select: { parentId: true } });
      if (!p?.parentId) return;
      cur = p.parentId;
    }
  }

  /** Create an auditable, balanced opening-balance journal entry (never a direct balance mutation). */
  private async postOpeningBalance(companyId: string, userId: string, accountId: string, amount: number, date?: string, offsetAccountId?: string) {
    const account = await this.prisma.ledgerAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException('Account not found');
    // For a debit-normal account the opening value is a Debit; for credit-normal it is a Credit.
    const isDebit = this.ledger.normalSide(account.type) === 'debit';
    const offset = offsetAccountId || await this.getOpeningEquityAccount(companyId);
    const number = await this.numbering.next(companyId, 'JE');
    await this.prisma.journalEntry.create({
      data: {
        companyId, number, date: date ? new Date(date) : new Date(),
        description: `Opening balance for ${account.code} ${account.name}`,
        sourceType: 'OPENING_BALANCE', sourceId: accountId, status: 'POSTED',
        lines: {
          create: [
            { accountId, debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount },
            { accountId: offset, debit: isDebit ? 0 : amount, credit: isDebit ? amount : 0 },
          ],
        },
      },
    });
    await this.audit.log(companyId, userId, 'OPENING BALANCE CREATED', 'LedgerAccount', accountId, { amount, date: date || null, offset });
  }

  private async getOpeningEquityAccount(companyId: string) {
    const named = await this.prisma.ledgerAccount.findFirst({ where: { companyId, type: 'EQUITY', name: { contains: 'opening' } } });
    if (named) return named.id;
    const equ = await this.prisma.ledgerAccount.findFirst({ where: { companyId, type: 'EQUITY' }, orderBy: { code: 'asc' } });
    if (equ) return equ.id;
    const code = await this.numbering.next(companyId, 'ACC');
    const created = await this.prisma.ledgerAccount.create({ data: { companyId, code, name: 'Opening Balance Equity', type: 'EQUITY', subtype: 'OTHER_EQUITY', isSystem: true, description: 'Offset account for opening balance journals' } });
    await this.audit.log(companyId, 'SYSTEM', 'ACCOUNT CREATED', 'LedgerAccount', created.id, { code });
    return created.id;
  }

  /** Authoritative General Ledger for one account. */
  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.reports.view')
  @Get('ledger') async ledgerQuery(@Req() req: any, @Query() q: any) {
    if (!q.accountId) throw new BadRequestException('accountId is required');
    return this.ledger.getAccountLedger(companyIdOf(req.user), String(q.accountId), {
      from: q.from, to: q.to, search: q.search, page: Number(q.page || 1), pageSize: Number(q.pageSize || 50),
    });
  }

  // ----- Journals -----
  @Get('journals') journals(@Req() req: any) {
    return this.prisma.journalEntry.findMany({ where: { companyId: companyIdOf(req.user) }, include: { lines: { include: { account: true } } }, orderBy: { date: 'desc' }, take: 200 });
  }

  // Server-side journal list for the Journal Entries manager (filter / search /
  // sort / paginate the full history, resolving source documents + cleaning UUIDs).
  @Get('journals/list') async journalList(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const page = Math.max(1, Number(q.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(q.pageSize || 50)));
    const where: any = { companyId };
    if (q.status) where.status = String(q.status);
    if (q.source) where.sourceType = String(q.source);
    const dateQ: any = {};
    if (q.from) dateQ.gte = new Date(String(q.from));
    if (q.to) dateQ.lte = new Date(String(q.to).concat('T23:59:59'));
    if (Object.keys(dateQ).length) where.date = dateQ;
    if (q.accountId) where.lines = { some: { accountId: String(q.accountId) } };
    if (q.search) {
      const s = String(q.search);
      where.OR = [
        { number: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { reference: { contains: s, mode: 'insensitive' } },
      ];
    }
    const orderBy = this.journalOrderBy(q.sortBy, q.sortOrder);
    const total = await this.prisma.journalEntry.count({ where });
    const rows = await this.prisma.journalEntry.findMany({ where, include: { lines: { include: { account: true } } }, orderBy, skip: (page - 1) * pageSize, take: pageSize });
    const stripUuid = (s: string) => s ? s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '').replace(/[ \t]+/g, ' ').trim() : '';
    // Resolve each journal's creator from the audit trail (never the current
    // logged-in user) so historical journals keep their real Entered By.
    const ids = rows.map((j) => j.id);
    const audits = ids.length ? await this.prisma.auditLog.findMany({ where: { companyId, entityType: 'JournalEntry', entityId: { in: ids } }, orderBy: { createdAt: 'asc' } }) : [];
    const creatorByJournal = new Map<string, string>();
    for (const a of audits) { if (a.userId && !creatorByJournal.has(a.entityId || '')) creatorByJournal.set(a.entityId || '', a.userId); }
    const userIds = [...new Set([...creatorByJournal.values()].filter(Boolean))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const userByName = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email]));
    const enriched = await Promise.all(rows.map(async (j) => {
      const src = await this.ledger.resolveJournalSource(j.sourceType, j.sourceId, j.reference, j.sourceType === 'MANUAL' ? j.description : null);
      const debit = Number(j.lines.reduce((s, l) => s + Number(l.debit), 0).toFixed(2));
      const credit = Number(j.lines.reduce((s, l) => s + Number(l.credit), 0).toFixed(2));
      const enteredBy = userByName.get(j.createdById || creatorByJournal.get(j.id) || '') || j.createdById || creatorByJournal.get(j.id) || '';
      return {
        id: j.id, number: j.number, date: j.date, description: stripUuid(j.description),
        reference: src.number || '', sourceType: j.sourceType, sourceLabel: src.label, sourceRoute: src.route,
        status: j.status, amount: debit, credit, linesCount: j.lines.length, enteredBy,
        isBalanced: Math.abs(debit - credit) <= 0.01,
        lines: j.lines.map((l) => ({ id: l.id, accountId: l.accountId, code: l.account?.code, name: l.account?.name, type: l.account?.type, description: stripUuid(l.description || ''), debit: Number(l.debit), credit: Number(l.credit) })),
      };
    }));
    let pageDebit = 0, pageCredit = 0;
    for (const r of enriched) { pageDebit += Number(r.amount || 0); pageCredit += Number(r.credit || 0); }
    return { rows: enriched, total, page, pageSize, pageTotals: { debit: Number(pageDebit.toFixed(2)), credit: Number(pageCredit.toFixed(2)) } };
  }

  private journalOrderBy(sortBy?: string, sortOrder?: string) {
    const dir = sortOrder === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'number': return [{ number: dir }];
      case 'description': return [{ description: dir }];
      case 'source': return [{ sourceType: dir }];
      case 'status': return [{ status: dir }];
      case 'amount': return [{ date: dir }];
      case 'createdAt': return [{ createdAt: dir }];
      case 'date': default: return [{ date: 'desc' }, { createdAt: 'desc' }] as any;
    }
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.journals.view')
  @Get('journals/:id') async journalDetail(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const journal = await this.prisma.journalEntry.findFirst({ where: { id, companyId }, include: { lines: { include: { account: true } } } });
    if (!journal) throw new BadRequestException('Journal entry not found');
    const totalDebit = journal.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = journal.lines.reduce((s, l) => s + Number(l.credit), 0);
    const source = await this.ledger.resolveJournalSource(journal.sourceType, journal.sourceId, journal.reference, journal.sourceType === 'MANUAL' ? journal.description : null);
    const created = await this.prisma.auditLog.findFirst({ where: { companyId, entityType: 'JournalEntry', entityId: id }, orderBy: { createdAt: 'asc' } });
    const creatorId = journal.createdById || created?.userId || null;
    const creatorUser = creatorId ? await this.prisma.user.findUnique({ where: { id: creatorId }, select: { firstName: true, lastName: true, email: true } }) : null;
    const stripUuid = (s: string) => s ? s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '').replace(/[ \t]+/g, ' ').trim() : '';
    return {
      ...journal,
      description: stripUuid(journal.description),
      totalDebit: Number(totalDebit.toFixed(2)),
      totalCredit: Number(totalCredit.toFixed(2)),
      difference: Number((totalDebit - totalCredit).toFixed(2)),
      source,
      createdBy: creatorId,
      enteredBy: creatorUser ? `${creatorUser.firstName} ${creatorUser.lastName}`.trim() || creatorUser.email : (creatorId || null),
      lines: journal.lines.map((l) => ({ id: l.id, accountId: l.accountId, accountCode: l.account.code, accountName: l.account.name, accountType: l.account.type, description: stripUuid(l.description || ''), debit: Number(l.debit), credit: Number(l.credit) })),
    };
  }

  @Get('dashboard') async dashboard(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [lines, bankAccounts, creditCards, arInvoices, apInvoices, recentJournals] = await Promise.all([
      this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED' } }, include: { account: true, journal: true } }),
      this.prisma.bankAccount.findMany({ where: { companyId }, include: { ledgerAccount: true }, orderBy: { name: 'asc' } }),
      this.prisma.creditCardAccount.findMany({ where: { companyId, status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
      this.prisma.salesInvoice.findMany({ where: { companyId, invoiceStatus: 'POSTED', balanceDue: { gt: 0 } }, select: { balanceDue: true, customerId: true } }),
      this.prisma.supplierInvoice.findMany({ where: { companyId, status: 'POSTED' }, select: { total: true, amountPaid: true, creditsApplied: true } }),
      this.prisma.journalEntry.findMany({ where: { companyId, status: 'POSTED' }, include: { lines: { select: { debit: true } } }, orderBy: { date: 'desc' }, take: 5 }),
    ]);

    const byAccount: Record<string, any> = {};
    for (const l of lines) {
      if (!byAccount[l.account.code]) byAccount[l.account.code] = { code: l.account.code, name: l.account.name, type: l.account.type, debit: 0, credit: 0 };
      byAccount[l.account.code].debit += Number(l.debit);
      byAccount[l.account.code].credit += Number(l.credit);
    }
    const accts = Object.values(byAccount);
    const sumType = (types: string[]) => accts.filter((a: any) => types.includes(a.type)).reduce((s: number, a: any) => s + normal(a.type, a.debit, a.credit), 0);

    const revenueAll = accts.filter((a: any) => a.type === 'REVENUE').reduce((s: number, a: any) => s + normal('REVENUE', a.debit, a.credit), 0);
    const expenseAll = accts.filter((a: any) => a.type === 'EXPENSE').reduce((s: number, a: any) => s + normal('EXPENSE', a.debit, a.credit), 0);
    const retainedEarnings = Number((revenueAll - expenseAll).toFixed(2));
    const revenueYtd = lines.filter((l) => l.account.type === 'REVENUE' && l.journal.date >= yearStart).reduce((s, l) => s + normal('REVENUE', Number(l.debit), Number(l.credit)), 0);

    const accountsByType = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((type) => ({
      type,
      value: Number(sumType([type]).toFixed(2)),
      count: accts.filter((a: any) => a.type === type).length,
    }));

    // Bank (book = GL + opening balance since opening is not posted).
    let bankValue = 0;
    for (const b of bankAccounts) {
      const a = byAccount[b.ledgerAccount.code];
      bankValue += normal('ASSET', a?.debit || 0, a?.credit || 0) + Number(b.openingBalance || 0);
    }
    const arOpen = arInvoices.reduce((s: number, i: any) => s + Math.max(0, Number(i.balanceDue || 0)), 0);
    const apOpen = apInvoices.reduce((s: number, i: any) => s + Math.max(0, Number(i.total || 0) - Number(i.amountPaid || 0) - Number(i.creditsApplied || 0)), 0);

    const creditCardBalances = await Promise.all(creditCards.map((c) => this.cardBalance(companyId, c.id)));
    const creditCardValue = creditCardBalances.reduce((s: number, b: any) => s + Number(b.balance || 0), 0);

    const loanAccounts = accts.filter((a: any) => a.type === 'LIABILITY' && /loan|note pay|borrow|mortgage|debt/i.test(`${a.code} ${a.name}`));
    const loanValue = loanAccounts.reduce((s: number, a: any) => s + normal('LIABILITY', a.debit, a.credit), 0);

    const revenueCount = accts.filter((a: any) => a.type === 'REVENUE').length;
    const equityCount = accts.filter((a: any) => a.type === 'EQUITY').length;

    const recent = await Promise.all(recentJournals.map(async (j) => {
      const amount = Number((j.lines?.length ? j.lines.filter((l: any) => Number(l.debit) > 0).reduce((s: number, l: any) => s + Number(l.debit), 0) : 0) || 0);
      const source = await this.resolveJournalSource(j.sourceType, j.sourceId, j.reference, j.sourceType === 'MANUAL' ? j.description : null);
      const description = j.description ? j.description.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '').replace(/[ \t]+/g, ' ').trim() : '';
      return { id: j.id, number: j.number, date: j.date, description, status: j.status, sourceType: j.sourceType, amount: Number(amount.toFixed(2)), source };
    }));

    return {
      accountSummary: {
        bankAccounts: { value: Number(bankValue.toFixed(2)), count: bankAccounts.length, subLabel: bankAccounts[0]?.name || 'No bank accounts', route: '/finance/bank-transfers' },
        accountsReceivable: { value: Number(arOpen.toFixed(2)), count: arInvoices.filter((i: any) => Number(i.balanceDue) > 0).length, subLabel: 'Open receivables', route: '/finance/ar-aging' },
        accountsPayable: { value: Number(apOpen.toFixed(2)), count: apInvoices.filter((i: any) => Number(i.total || 0) - Number(i.amountPaid || 0) - Number(i.creditsApplied || 0) > 0).length, subLabel: 'Open payables', route: '/finance/ap-aging' },
        creditCards: { value: Number(creditCardValue.toFixed(2)), count: creditCards.length, subLabel: creditCards[0]?.name || 'No credit cards', route: '/expenses/credit-card-charges' },
        loans: { value: Number(loanValue.toFixed(2)), count: loanAccounts.length, subLabel: loanAccounts.length ? loanAccounts[0].name : 'No loan accounts', route: '/finance/accounts?type=LIABILITY' },
        revenue: { value: Number(revenueYtd.toFixed(2)), count: revenueCount, subLabel: 'Year-to-date revenue', route: '/finance/profit-loss' },
        equity: { value: Number((sumType(['EQUITY']) + retainedEarnings).toFixed(2)), count: equityCount, subLabel: 'Equity + retained earnings', route: '/finance/balance-sheet' },
      },
      accountsByType,
      recentJournals: recent,
    };
  }

  @Get('dashboard/drilldown/:category') async drilldown(@Req() req: any, @Param('category') category: string, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const limit = Math.min(20, Number(q.limit || 15));
    const cat = String(category || '').toUpperCase();
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const asOf = new Date().toISOString();
    const round2 = (n: any) => Number(Number(n).toFixed(2));
    const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
    const fmtDateShort = (d: any) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const restricted = { BANK: 'finance.bank.manage', CREDIT_CARD: 'finance.bank.manage' }[cat];
    if (restricted) {
      const perms = await this.permissionService.getPermissions(req.user);
      if (!perms.includes(restricted)) throw new ForbiddenException(`You do not have permission to view ${cat.replace(/_/g, ' ').toLowerCase()} details.`);
    }

    // Shared GL snapshot (accounts + lines) for bank/loan/revenue/equity.
    const glLines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED' } }, include: { account: true, journal: true } });
    const byAccount: Record<string, any> = {};
    for (const l of glLines) { if (!byAccount[l.account.code]) byAccount[l.account.code] = { id: l.account.id, code: l.account.code, name: l.account.name, type: l.account.type, debit: 0, credit: 0 }; byAccount[l.account.code].debit += Number(l.debit); byAccount[l.account.code].credit += Number(l.credit); }

    const glEntries = async (accountIds: string[], type: string) => {
      const match = glLines.filter((l) => accountIds.includes(l.accountId)).sort((a, b) => (+new Date(a.journal.date) - +new Date(b.journal.date)) || (a.id < b.id ? -1 : 1));
      let run = 0;
      for (const l of match) { run += normal(type, Number(l.debit), Number(l.credit)); (l as any)._run = round2(run); }
      return Promise.all(match.slice(-limit).slice().reverse().map(async (l: any) => {
        const src = await this.resolveJournalSource(l.journal.sourceType, l.journal.sourceId, l.journal.reference, l.journal.sourceType === 'MANUAL' ? l.journal.description : null);
        return { id: l.id, date: l.journal.date, docNo: l.journal.number, typeLabel: src.label, party: src.number || '', debit: round2(l.debit), credit: round2(l.credit), amount: round2(normal(type, Number(l.debit), Number(l.credit))), balance: l._run, route: src.route, status: l.journal.status };
      }));
    };

    if (cat === 'BANK') {
      const banks = await this.prisma.bankAccount.findMany({ where: { companyId }, include: { ledgerAccount: true }, orderBy: { name: 'asc' } });
      const accounts = banks.map((b) => { const a = byAccount[b.ledgerAccount.code]; return { id: b.id, code: b.ledgerAccount.code, name: b.name, bankName: b.bankName, currency: b.currency, balance: round2(normal('ASSET', a?.debit || 0, a?.credit || 0) + Number(b.openingBalance || 0)), route: '/finance/reconciliation' }; });
      const total = round2(accounts.reduce((s, a) => s + Number(a.balance), 0));
      const entries = await glEntries(banks.map((b) => b.ledgerAccountId), 'ASSET');
      return { category: cat, title: 'Bank Accounts', currency: accounts[0]?.currency || 'USD', balance: total, asOf, periodLabel: `As of ${fmtDateShort(asOf)}`, totalLabel: 'Book balance', accounts, entries, total, fullViewLabel: 'View Banking', fullViewRoute: '/finance/reconciliation' };
    }

    if (cat === 'AR') {
      const invoices = await this.prisma.salesInvoice.findMany({ where: { companyId, invoiceStatus: 'POSTED', balanceDue: { gt: 0 } }, include: { customer: true }, orderBy: { invoiceDate: 'desc' } });
      const byCust: Record<string, any> = {};
      for (const i of invoices) { const k = i.customerId || 'none'; if (!byCust[k]) byCust[k] = { id: i.customerId || null, name: i.customer?.name || 'Walk-in Customer', open: 0, outstanding: 0, overdue: 0, children: [] }; const c = byCust[k]; c.open += 1; c.outstanding += Number(i.balanceDue || 0); if (i.dueDate && new Date(i.dueDate) < now) c.overdue += Number(i.balanceDue || 0); c.children.push(i); }
      const accounts = Object.values(byCust).map((c: any) => ({ id: c.id, code: c.id ? `${c.id.slice(0, 4).toUpperCase()}-${c.name.slice(0, 3).toUpperCase()}` : 'NONE', name: c.name, sub: `${c.open} open`, balance: round2(c.outstanding), extra: { overdue: round2(c.overdue) }, route: c.id ? `/sales/customers/${c.id}` : null })).sort((a: any, b: any) => b.balance - a.balance);
      const entries = invoices.slice(0, limit).map((i: any) => ({ id: i.id, date: i.invoiceDate, docNo: i.invoiceNo, typeLabel: 'Invoice', party: i.customer?.name || 'Walk-in Customer', amount: round2(Number(i.total || 0) - Number(i.amountPaid || 0)), balance: round2(i.balanceDue), status: 'OUTSTANDING', route: `/sales/invoices/${i.id}/edit` }));
      const total = round2(accounts.reduce((s: number, a: any) => s + Number(a.balance), 0));
      return { category: cat, title: 'Accounts Receivable', currency: 'USD', balance: total, asOf, periodLabel: `As of ${fmtDateShort(asOf)}`, totalLabel: 'Open receivables', accounts, entries, total, fullViewLabel: 'View Receivables', fullViewRoute: '/finance/ar-aging' };
    }

    if (cat === 'AP') {
      const invoices = await this.prisma.supplierInvoice.findMany({ where: { companyId, status: 'POSTED' }, include: { supplier: true }, orderBy: { invoiceDate: 'desc' } });
      const open = invoices.filter((i: any) => Number(i.total || 0) - Number(i.amountPaid || 0) - Number(i.creditsApplied || 0) > 0.0);
      const bySupplier: Record<string, any> = {};
      for (const i of open) { const k = i.supplierId; if (!bySupplier[k]) bySupplier[k] = { id: i.supplierId, name: i.supplier?.name || 'Unknown', open: 0, outstanding: 0, overdue: 0, children: [] }; const c = bySupplier[k]; c.open += 1; const rem = Number(i.total || 0) - Number(i.amountPaid || 0) - Number(i.creditsApplied || 0); c.outstanding += rem; if (i.dueDate && new Date(i.dueDate) < now) c.overdue += rem; c.children.push(i); }
      const accounts = Object.values(bySupplier).map((c: any) => ({ id: c.id, code: `${c.name.slice(0, 3).toUpperCase()}`, name: c.name, sub: `${c.open} open`, balance: round2(c.outstanding), extra: { overdue: round2(c.overdue) }, route: `/procurement/suppliers/${c.id}` })).sort((a: any, b: any) => b.balance - a.balance);
      const entries = open.map((i: any) => { const rem = round2(Number(i.total || 0) - Number(i.amountPaid || 0) - Number(i.creditsApplied || 0)); return { id: i.id, date: i.invoiceDate, docNo: i.invoiceNo, typeLabel: 'Bill', party: i.supplier?.name || 'Unknown', amount: rem, balance: rem, status: i.paymentStatus, route: `/procurement/bills?bill=${i.id}&tab=management`, original: round2(i.total), paid: round2(Number(i.amountPaid || 0) + Number(i.creditsApplied || 0)), dueDate: i.dueDate }; }).slice(0, limit);
      const total = round2(accounts.reduce((s: number, a: any) => s + Number(a.balance), 0));
      return { category: cat, title: 'Accounts Payable', currency: 'USD', balance: total, asOf, periodLabel: `As of ${fmtDateShort(asOf)}`, totalLabel: 'Open payables', accounts, entries, total, fullViewLabel: 'View Bill Management', fullViewRoute: '/expenses/bills' };
    }

    if (cat === 'CREDIT_CARD') {
      const cards = await this.prisma.creditCardAccount.findMany({ where: { companyId, status: 'ACTIVE' }, orderBy: { name: 'asc' } });
      const balances = await Promise.all(cards.map((c) => this.cardBalance(companyId, c.id)));
      const accounts = cards.map((c, i) => ({ id: c.id, code: c.last4 ? `CC-${c.last4}` : 'CC', name: c.name, last4: c.last4, currency: c.currency || 'USD', balance: round2(balances[i].balance), extra: { availableCredit: round2(Math.max(0, Number(c.creditLimit || 0) - balances[i].balance)), creditLimit: round2(Number(c.creditLimit || 0)), status: c.status }, route: `/expenses/credit-card-charges?cardId=${c.id}` }));
      const total = round2(accounts.reduce((s, a) => s + Number(a.balance), 0));
      const txs = await this.prisma.creditCardTransaction.findMany({ where: { cardAccountId: { in: cards.map((c) => c.id) }, status: 'POSTED' }, include: { cardAccount: true }, orderBy: { date: 'desc' }, take: limit });
      const pays = await this.prisma.creditCardPayment.findMany({ where: { cardAccountId: { in: cards.map((c) => c.id) }, status: 'POSTED' }, include: { cardAccount: true }, orderBy: { date: 'desc' }, take: limit });
      const entries = [
        ...txs.map((t: any) => ({ id: t.id, date: t.date, docNo: t.reference || t.id.slice(0, 8).toUpperCase(), typeLabel: String(t.type).replace(/_/g, ' ').toLowerCase().replace(/^./, (m) => m.toUpperCase()), party: t.vendor || '—', amount: round2(Number(['REFUND', 'CREDIT'].includes(t.type) ? -t.amount : t.amount)), balance: round2(t.amount), status: t.status, route: `/expenses/credit-card-charges` })),
        ...pays.map((p: any) => ({ id: p.id, date: p.date, docNo: p.reference || p.id.slice(0, 8).toUpperCase(), typeLabel: 'Payment', party: p.memo || '—', amount: round2(-Number(p.amount)), balance: round2(Number(p.amount)), status: p.status, route: `/expenses/credit-card-charges` })),
      ].sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, limit);
      return { category: cat, title: 'Credit Cards', currency: accounts[0]?.currency || 'USD', balance: total, asOf, periodLabel: `As of ${fmtDateShort(asOf)}`, totalLabel: 'Outstanding balances', accounts, entries, total, fullViewLabel: 'View Credit Cards', fullViewRoute: '/expenses/credit-card-charges' };
    }

    if (cat === 'LOAN') {
      const loans = Object.values(byAccount).filter((a: any) => a.type === 'LIABILITY' && /loan|note pay|borrow|mortgage|debt/i.test(`${a.code} ${a.name}`));
      const accounts = loans.map((a: any) => ({ id: null, code: a.code, name: a.name, balance: round2(normal('LIABILITY', a.debit, a.credit)), currency: 'USD', route: `/finance/accounts?type=LIABILITY` }));
      const total = round2(accounts.reduce((s, a) => s + Number(a.balance), 0));
      const entries = await glEntries(loans.map((a: any) => a.id), 'LIABILITY');
      return { category: cat, title: 'Loans', currency: 'USD', balance: total, asOf, periodLabel: `As of ${fmtDateShort(asOf)}`, totalLabel: 'Loan balances', accounts, entries, total, fullViewLabel: 'View Chart of Accounts', fullViewRoute: '/finance/accounts?type=LIABILITY' };
    }

    if (cat === 'REVENUE') {
      const revenueAccounts = Object.values(byAccount).filter((a: any) => a.type === 'REVENUE');
      const accounts = revenueAccounts.map((a: any) => { const bal = glLines.filter((l) => l.account.code === a.code && l.journal.date >= yearStart).reduce((s, l) => s + normal('REVENUE', Number(l.debit), Number(l.credit)), 0); return { id: null, code: a.code, name: a.name, balance: round2(bal), currency: 'USD', route: `/finance/accounts?type=REVENUE`, sub: 'Revenue account' }; });
      const total = round2(accounts.reduce((s, a) => s + Number(a.balance), 0));
      const entries = await glEntries(revenueAccounts.map((a: any) => a.id), 'REVENUE');
      const withPct = accounts.map((a) => ({ ...a, pct: pct(Number(a.balance), total) }));
      return { category: cat, title: 'Revenue', currency: 'USD', balance: total, asOf, periodLabel: `Year to date · ${fmtDateShort(yearStart)} – ${fmtDateShort(asOf)}`, totalLabel: 'Year-to-date income', accounts: withPct, entries, total, fullViewLabel: 'View Revenue Accounts', fullViewRoute: '/finance/accounts?type=REVENUE' };
    }

    if (cat === 'EQUITY') {
      const equityAccounts = Object.values(byAccount).filter((a: any) => a.type === 'EQUITY');
      const revenueAll = glLines.filter((l) => l.account.type === 'REVENUE').reduce((s, l) => s + normal('REVENUE', Number(l.debit), Number(l.credit)), 0);
      const expenseAll = glLines.filter((l) => l.account.type === 'EXPENSE').reduce((s, l) => s + normal('EXPENSE', Number(l.debit), Number(l.credit)), 0);
      const currentYearEarnings = round2(revenueAll - expenseAll);
      const accounts = equityAccounts.map((a: any) => ({ id: null, code: a.code, name: a.name, balance: round2(normal('EQUITY', a.debit, a.credit)), currency: 'USD', route: `/finance/accounts?type=EQUITY`, sub: a.name }) as any);
      if (currentYearEarnings !== 0) accounts.push({ id: null, code: 'RETAINED', name: 'Current Year Earnings', balance: currentYearEarnings, currency: 'USD', route: '/finance/accounts?type=EQUITY', sub: 'Net income (not yet closed)' });
      const total = round2(accounts.reduce((s, a) => s + Number(a.balance), 0));
      const entries = await glEntries(equityAccounts.map((a: any) => a.id), 'EQUITY');
      return { category: cat, title: 'Equity', currency: 'USD', balance: total, asOf, periodLabel: `As of ${fmtDateShort(asOf)}`, totalLabel: 'Equity & retained earnings', accounts, entries, total, fullViewLabel: 'View Equity Accounts', fullViewRoute: '/finance/accounts?type=EQUITY' };
    }

    throw new BadRequestException(`Unknown category ${category}`);
  }
  @Post('journals') async createJournal(@Req() req: any, @Body() dto: CreateJournalDto) {
    const companyId = companyIdOf(req.user);
    const totalDebit = dto.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = dto.lines.reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) throw new BadRequestException('Journal is not balanced');
    // Group (non-posting) accounts cannot carry journal lines.
    const lineAccounts = await this.prisma.ledgerAccount.findMany({ where: { companyId, id: { in: dto.lines.map((l) => l.accountId) } }, select: { id: true, isGroup: true, code: true, name: true } });
    const groupLine = lineAccounts.find((a) => a.isGroup);
    if (groupLine) throw new BadRequestException(`Cannot post to group account ${groupLine.code} ${groupLine.name}`);
    const number = await this.numbering.next(companyId, 'JE');
    const journal = await this.prisma.journalEntry.create({
      data: { companyId, number, date: dto.date ? new Date(dto.date) : new Date(), description: dto.description, reference: dto.reference, createdById: req.user.sub, sourceType: 'MANUAL', status: 'POSTED', lines: { create: dto.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit), description: l.description })) } },
      include: { lines: true },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'JournalEntry', journal.id, { number });
    return journal;
  }
  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.journals.reverse')
  @Post('journals/:id/reverse') async reverseJournal(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const journal = await this.prisma.journalEntry.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!journal) throw new BadRequestException('Journal not found');
    if (journal.status === 'REVERSED') return journal;
    const number = await this.numbering.next(companyId, 'JE');
    const reversed = await this.prisma.journalEntry.create({
      data: { companyId, number, date: new Date(), description: `Reverse of ${journal.number}`, reference: journal.reference, sourceType: 'REVERSAL', sourceId: journal.id, status: 'POSTED', lines: { create: journal.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, description: `Reverse: ${l.description}` })) } },
    });
    await this.prisma.journalEntry.update({ where: { id: journal.id }, data: { status: 'REVERSED' } });
    await this.audit.log(companyId, req.user.sub, 'REVERSE', 'JournalEntry', journal.id, { number });
    return reversed;
  }

  // ----- Budgets -----
  @Get('budgets') budgets(@Req() req: any) {
    return this.prisma.budget.findMany({ where: { companyId: companyIdOf(req.user) }, include: { account: true } });
  }
  @Post('budgets') async createBudget(@Req() req: any, @Body() dto: BudgetDto) {
    const companyId = companyIdOf(req.user);
    const budget = await this.prisma.budget.create({ data: { companyId, fiscalYear: dto.fiscalYear, period: dto.period, accountId: dto.accountId, amount: Number(dto.amount) } });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Budget', budget.id);
    return budget;
  }
  @Patch('budgets/:id') updateBudget(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<BudgetDto>) {
    return this.prisma.budget.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: dto });
  }
  @Delete('budgets/:id') async deleteBudget(@Req() req: any, @Param('id') id: string) {
    await this.prisma.budget.deleteMany({ where: { id, companyId: companyIdOf(req.user) } });
    return { ok: true };
  }

  // ----- Tax rates -----
  @Get('tax-rates') taxRates(@Req() req: any) { return this.prisma.taxRate.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: { name: 'asc' } }); }
  @Post('tax-rates') async createTaxRate(@Req() req: any, @Body() dto: TaxRateDto) {
    const companyId = companyIdOf(req.user);
    if (!dto.name?.trim()) throw new BadRequestException('Tax rate name is required');
    const dup = await this.prisma.taxRate.findFirst({ where: { companyId, name: dto.name } });
    if (dup) throw new BadRequestException(`A tax rate with this name already exists for this company`);
    const isDefault = dto.isDefault ?? false;
    if (isDefault && dto.active === false) throw new BadRequestException('This Tax Rate is the company default and cannot be inactive.');
    const code = dto.code || await this.numbering.next(companyId, 'TAX');
    const tax = await this.prisma.$transaction(async (tx) => {
      if (isDefault) await tx.taxRate.updateMany({ where: { companyId, isDefault: true }, data: { isDefault: false } });
      return tx.taxRate.create({ data: { companyId, code, name: dto.name, rate: Number(dto.rate), treatment: dto.treatment, isDefault, active: dto.active ?? true, taxCode: dto.taxCode, authority: dto.authority, validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined, validTo: dto.validTo ? new Date(dto.validTo) : undefined } });
    });
    await this.audit.log(companyId, req.user.sub, 'TAX_RATE_CREATED', 'TaxRate', tax.id, { name: dto.name, rate: dto.rate, isDefault });
    return tax;
  }
  @Patch('tax-rates/:id') async updateTaxRate(@Req() req: any, @Param('id') id: string, @Body() dto: Partial<TaxRateDto>) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.taxRate.findFirst({ where: { id, companyId } });
    if (!existing) throw new BadRequestException('Tax rate not found');
    if (dto.name) { const dup = await this.prisma.taxRate.findFirst({ where: { companyId, name: dto.name, id: { not: id } } }); if (dup) throw new BadRequestException(`A tax rate with this name already exists for this company`); }
    const makeDefault = dto.isDefault === true;
    if (makeDefault && dto.active === false) throw new BadRequestException('This Tax Rate is the company default and cannot be inactive.');
    if (dto.active === false && existing.isDefault) throw new BadRequestException('This Tax Rate is currently the company default and cannot be deactivated until another default is selected.');
    const flat: any = { ...dto };
    if (flat.validFrom) flat.validFrom = new Date(flat.validFrom);
    if (flat.validTo) flat.validTo = new Date(flat.validTo);
    delete flat.isDefault;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) await tx.taxRate.updateMany({ where: { companyId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      return tx.taxRate.update({ where: { id }, data: { ...flat, isDefault: makeDefault ? true : existing.isDefault } });
    });
    return updated;
  }
  @Delete('tax-rates/:id') async deleteTaxRate(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const existing = await this.prisma.taxRate.findFirst({ where: { id, companyId } });
    if (!existing) throw new BadRequestException('Tax rate not found');
    if (existing.isDefault) throw new BadRequestException('This Tax Rate is the company default and cannot be deleted. Select another default first.');
    // Never hard-delete possibly-used rates — deactivate instead (history preserved).
    await this.prisma.taxRate.update({ where: { id }, data: { active: false } });
    await this.audit.log(companyId, req.user.sub, 'TAX_RATE_DEACTIVATED', 'TaxRate', id);
    return { ok: true, deactivated: true };
  }

  // ----- Reports -----
  @Get('trial-balance') async trialBalance(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const lines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED' } }, include: { account: true } });
    const out: Record<string, any> = {};
    for (const l of lines) {
      if (!out[l.account.code]) out[l.account.code] = { code: l.account.code, name: l.account.name, type: l.account.type, debit: 0, credit: 0 };
      out[l.account.code].debit += Number(l.debit);
      out[l.account.code].credit += Number(l.credit);
    }
    return Object.values(out).sort((a: any, b: any) => a.code.localeCompare(b.code));
  }

  // -------------------------------------------------------------------------------
  // Authoritative Working Trial Balance — computed from posted journal lines.
  // -------------------------------------------------------------------------------
  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.reports.view')
  @Get('trial-balance/report') async trialBalanceReport(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const round = (n: any) => Number(Number(n).toFixed(2));
    const to = q.to ? new Date(String(q.to).concat('T23:59:59')) : new Date('9999-12-31');
    const from = q.from ? new Date(String(q.from)) : new Date('1000-01-01');
    const accountType = q.accountType ? String(q.accountType).toUpperCase() : '';
    const includeZero = String(q.includeZero) === 'true';
    const includeInactive = String(q.includeInactive) === 'true';
    const search = (q.search || '').trim().toLowerCase();

    const [accs, closing, opening] = await Promise.all([
      this.prisma.ledgerAccount.findMany({ where: { companyId } }),
      this.prisma.journalLine.groupBy({ by: ['accountId'], where: { journal: { companyId, status: 'POSTED', date: { lte: to } } }, _sum: { debit: true, credit: true } }),
      this.prisma.journalLine.groupBy({ by: ['accountId'], where: { journal: { companyId, status: 'POSTED', date: { lt: from } } }, _sum: { debit: true, credit: true } }),
    ]);
    const clMap = new Map(closing.map((c) => [c.accountId, c._sum]));
    const opMap = new Map(opening.map((c) => [c.accountId, c._sum]));

    // Right-allocate a net (debit-credit) position to a single Debit or Credit column.
    const alloc = (dr: number, cr: number) => {
      const net = round(Number(dr) - Number(cr));
      return net >= 0 ? { debit: round(net), credit: 0 } : { debit: 0, credit: round(-net) };
    };

    const rows: any[] = [];
    for (const a of accs) {
      if (accountType && a.type !== accountType) continue;
      if (a.active === false && !includeInactive) continue;
      const cl = clMap.get(a.id) || { debit: 0, credit: 0 };
      const op = opMap.get(a.id) || { debit: 0, credit: 0 };
      const clDr = round(cl.debit || 0), clCr = round(cl.credit || 0);
      const opDr = round(op.debit || 0), opCr = round(op.credit || 0);
      const mvDr = round(clDr - opDr), mvCr = round(clCr - opCr);
      const clNet = round(clDr - clCr);
      if (search && !`${a.code} ${a.name}`.toLowerCase().includes(search)) continue;
      if (!includeZero && Math.abs(clNet) < 0.005) continue;
      const opAlloc = alloc(opDr, opCr);
      const mvAlloc = alloc(mvDr, mvCr);
      const clAlloc = alloc(clDr, clCr);
      rows.push({
        accountId: a.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, active: a.active,
        debit: clAlloc.debit, credit: clAlloc.credit,
        openingDebit: opAlloc.debit, openingCredit: opAlloc.credit,
        movementDebit: mvAlloc.debit, movementCredit: mvAlloc.credit,
      });
    }
    rows.sort((a: any, b: any) => a.code.localeCompare(b.code, undefined, { numeric: true }));

    const totalDebit = round(rows.reduce((s, r) => s + Number(r.debit), 0));
    const totalCredit = round(rows.reduce((s, r) => s + Number(r.credit), 0));
    const difference = round(totalDebit - totalCredit);
    return {
      period: { from: q.from || null, to: q.to || null },
      rows, totalDebit, totalCredit, difference,
      isBalanced: Math.abs(difference) <= 0.01,
      accountCount: rows.length,
    };
  }

  // Diagnostic: identify any POSTED journal where debit != credit (integrity issue).
  @UseGuards(PermissionsGuard)
  @RequirePermissions('finance.reports.view')
  @Get('trial-balance/diagnostics') async trialBalanceDiagnostics(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const journals = await this.prisma.journalEntry.findMany({ where: { companyId, status: 'POSTED' }, include: { lines: true }, orderBy: { date: 'desc' }, take: 500 });
    const unbalanced = [];
    for (const j of journals) {
      const dr = j.lines.reduce((s, l) => s + Number(l.debit), 0);
      const cr = j.lines.reduce((s, l) => s + Number(l.credit), 0);
      const diff = Number((dr - cr).toFixed(2));
      if (Math.abs(diff) > 0.01) unbalanced.push({ id: j.id, number: j.number, date: j.date, difference: diff, description: j.description });
    }
    return { unBalancedCount: unbalanced.length, unbalanced };
  }

  @Get('profit-loss') async pnl(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const dateScope: any = {};
    if (q.from) dateScope.gte = new Date(String(q.from));
    if (q.to) dateScope.lte = new Date(String(q.to).concat('T23:59:59'));
    const lines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED', ...(Object.keys(dateScope).length ? { date: dateScope } : {}) }, account: { type: { in: ['REVENUE', 'EXPENSE'] } } }, include: { account: true } });
    const grouped: any = { revenue: {}, expenses: {} };
    const names: Record<string, string> = {};
    for (const l of lines) {
      const target = l.account.type === 'REVENUE' ? grouped.revenue : grouped.expenses;
      const amount = l.account.type === 'REVENUE' ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
      target[l.account.code] = (target[l.account.code] || 0) + amount;
      names[l.account.code] = l.account.name;
    }
    const totals = { revenue: Object.values(grouped.revenue).reduce((s: number, v: any) => s + v, 0), expenses: Object.values(grouped.expenses).reduce((s: number, v: any) => s + v, 0) };
    return { ...grouped, names, totals, netProfit: Number((totals.revenue - totals.expenses).toFixed(2)) };
  }

  @Get('balance-sheet') async bs(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const dateScope: any = q.to ? { date: { lte: new Date(String(q.to).concat('T23:59:59')) } } : {};
    const lines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED', ...dateScope }, account: { type: { in: ['ASSET', 'LIABILITY', 'EQUITY'] } } }, include: { account: true } });
    const out: any = { ASSET: {}, LIABILITY: {}, EQUITY: {} };
    const names: Record<string, string> = {};
    for (const l of lines) {
      const normal = l.account.type === 'ASSET' ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
      out[l.account.type][l.account.code] = (out[l.account.type][l.account.code] || 0) + normal;
      names[l.account.code] = l.account.name;
    }
    const totals = {
      ASSET: Number(Object.values(out.ASSET).reduce((s: number, v: any) => s + v, 0).toFixed(2)),
      LIABILITY: Number(Object.values(out.LIABILITY).reduce((s: number, v: any) => s + v, 0).toFixed(2)),
      EQUITY: Number(Object.values(out.EQUITY).reduce((s: number, v: any) => s + v, 0).toFixed(2)),
    };
    const pnlLines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED' }, account: { type: { in: ['REVENUE', 'EXPENSE'] } } }, include: { account: true } });
    const pnl = { revenue: 0, expenses: 0 };
    for (const l of pnlLines) {
      if (l.account.type === 'REVENUE') pnl.revenue += Number(l.credit) - Number(l.debit);
      else pnl.expenses += Number(l.debit) - Number(l.credit);
    }
    const retainedEarnings = Number((pnl.revenue - pnl.expenses).toFixed(2));
    out.EQUITY['retainedEarnings'] = (out.EQUITY['retainedEarnings'] || 0) + retainedEarnings;
    const finalEquity = totals.EQUITY + retainedEarnings;
    return { ...out, names, totals: { ...totals, EQUITY: Number(finalEquity.toFixed(2)), totalEquityAndLiabilities: Number((totals.LIABILITY + finalEquity).toFixed(2)) }, retainedEarnings };
  }

  @Get('cashflow') async cashflow(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const lines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED' }, account: { code: '1000' } }, include: { journal: true } });
    const byMonth: Record<string, { month: string; inflow: number; outflow: number; net: number }> = {};
    for (const l of lines) {
      const d = l.journal.date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { month: key, inflow: 0, outflow: 0, net: 0 };
      byMonth[key].inflow += Number(l.debit);
      byMonth[key].outflow += Number(l.credit);
      byMonth[key].net += Number(l.debit) - Number(l.credit);
    }
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }

  @Get('budget-vs-actual') async budgetVsActual(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const year = new Date().getFullYear();
    const budgets = await this.prisma.budget.findMany({ where: { companyId, fiscalYear: year }, include: { account: true } });
    const lines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED' }, account: { type: { in: ['REVENUE', 'EXPENSE'] } } }, include: { account: true } });
    const actualByAccount: Record<string, number> = {};
    for (const l of lines) {
      if (!actualByAccount[l.accountId]) actualByAccount[l.accountId] = 0;
      const amount = l.account.type === 'REVENUE' ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
      actualByAccount[l.accountId] += amount;
    }
    const rows = budgets.map((b) => {
      const actual = actualByAccount[b.accountId] || 0;
      const budget = Number(b.amount);
      return { accountCode: b.account.code, accountName: b.account.name, type: b.account.type, budget, actual: Number(actual.toFixed(2)), variance: Number((actual - budget).toFixed(2)) };
    });
    const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
    const totalActual = rows.reduce((s, r) => s + r.actual, 0);
    return { year, rows, totals: { budget: totalBudget, actual: Number(totalActual.toFixed(2)), variance: Number((totalActual - totalBudget).toFixed(2)) } };
  }

  private async ensurePeriods(companyId: string) {
    const now = new Date();
    for (const year of [now.getFullYear() - 1, now.getFullYear()]) {
      const fy = await this.prisma.financialYear.upsert({ where: { companyId_year: { companyId, year } }, update: {}, create: { companyId, year } });
      for (let m = 1; m <= 12; m++) {
        const startDate = new Date(year, m - 1, 1);
        const endDate = new Date(year, m, 0, 23, 59, 59);
        await this.prisma.fiscalPeriod.upsert({ where: { companyId_yearId_periodNumber: { companyId, yearId: fy.id, periodNumber: m } }, update: {}, create: { companyId, yearId: fy.id, periodNumber: m, name: new Date(year, m - 1, 1).toLocaleString('en-US', { month: 'long' }), startDate, endDate } });
      }
    }
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.periods.manage')
  @Get('periods') async periods(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    await this.ensurePeriods(companyId);
    const years = await this.prisma.financialYear.findMany({ where: { companyId }, include: { periods: { orderBy: { periodNumber: 'asc' } } }, orderBy: { year: 'desc' } });
    return years;
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.periods.manage')
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.periods.manage')
  @Post('periods/:id/reopen') async reopenPeriod(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const reason = String((req.body && req.body.reason) || '').trim();
    if (!reason) throw new BadRequestException('A reason is required to reopen a period');
    await this.prisma.fiscalPeriod.update({ where: { id }, data: { status: 'OPEN', closedAt: null, closedBy: null } });
    await this.audit.log(companyId, req.user.sub, 'REOPEN_PERIOD', 'FiscalPeriod', id, { reason });
    return { ok: true };
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.periods.manage')
  @Post('periods/:id/soft-close') async softClosePeriod(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    await this.prisma.fiscalPeriod.update({ where: { id }, data: { status: 'SOFT_CLOSED' } });
    await this.audit.log(companyId, req.user.sub, 'SOFT_CLOSE_PERIOD', 'FiscalPeriod', id);
    return { ok: true };
  }

  // Professional period close checklist — runs real checks (no duplicated formulas).
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.periods.manage')
  @Get('periods/:id/close-checklist') async periodCloseChecklist(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id, companyId } });
    if (!period) throw new BadRequestException('Period not found');
    const to = period.endDate, from = period.startDate;
    const round = (n: any) => Number(Number(n).toFixed(2));

    // 1) Trial Balance must balance within the period.
    const tb = await this.prisma.journalLine.aggregate({ where: { journal: { companyId, status: 'POSTED', date: { gte: from, lte: to } } }, _sum: { debit: true, credit: true } });
    const tbDiff = round(Number(tb._sum.debit || 0) - Number(tb._sum.credit || 0));

    // 2) A/R reconciliation: subledger (open invoices) vs A/R control GL (as of end).
    const arInvoices = await this.prisma.salesInvoice.aggregate({ where: { companyId, invoiceStatus: 'POSTED', invoiceDate: { lte: to } }, _sum: { balanceDue: true } });
    const arAcct = await this.prisma.ledgerAccount.findFirst({ where: { companyId, name: { contains: 'Accounts Receivable' } } });
    const arControl = arAcct ? await this.prisma.journalLine.aggregate({ where: { accountId: arAcct.id, journal: { companyId, status: 'POSTED', date: { lte: to } } }, _sum: { debit: true, credit: true } }) : null;
    const arSub = round(Number(arInvoices._sum.balanceDue || 0));
    const arGl = arControl ? round(Number(arControl._sum.debit || 0) - Number(arControl._sum.credit || 0)) : null;
    const arDiff = arGl == null ? null : round(arSub - arGl);

    // 3) A/P reconciliation.
    const apBills = await this.prisma.supplierInvoice.aggregate({ where: { companyId, status: 'POSTED', invoiceDate: { lte: to } }, _sum: { total: true, amountPaid: true, creditsApplied: true } });
    const apAcct = await this.prisma.ledgerAccount.findFirst({ where: { companyId, name: { contains: 'Accounts Payable' } } });
    const apControl = apAcct ? await this.prisma.journalLine.aggregate({ where: { accountId: apAcct.id, journal: { companyId, status: 'POSTED', date: { lte: to } } }, _sum: { debit: true, credit: true } }) : null;
    const apSub = round(Number(apBills._sum.total || 0) - Number(apBills._sum.amountPaid || 0) - Number(apBills._sum.creditsApplied || 0));
    const apGl = apControl ? round(Number(apControl._sum.credit || 0) - Number(apControl._sum.debit || 0)) : null;
    const apDiff = apGl == null ? null : round(apSub - apGl);

    const check = (code: string, label: string, failed: boolean, message: string, actionRoute: string, missing = false) => {
      const status = failed ? 'FAIL' : 'PASS';
      return { code, label, status, severity: failed ? 'BLOCKING' : (missing ? 'WARNING' : 'PASS'), message, actionRoute };
    };

    const checks = [
      { code: 'TB', label: 'Trial Balance (Debits = Credits)', severity: Math.abs(tbDiff) > 0.01 ? 'BLOCKING' : 'PASS', status: Math.abs(tbDiff) > 0.01 ? 'FAIL' : 'PASS', message: Math.abs(tbDiff) > 0.01 ? `Difference $${tbDiff}` : 'Balanced', actionRoute: '/finance/trial-balance' },
      check('AR', 'A/R Subledger reconciles to GL', !!arDiff && Math.abs(arDiff) > 0.01, arDiff == null ? 'A/R GL account not configured' : `A/R subledger ${arSub} vs GL ${arGl} (Difference ${arDiff})`, '/finance/ar-aging', arDiff == null),
      check('AP', 'A/P Subledger reconciles to GL', !!apDiff && Math.abs(apDiff) > 0.01, apDiff == null ? 'A/P GL account not configured' : `A/P subledger ${apSub} vs GL ${apGl} (Difference ${apDiff})`, '/finance/ap-aging', apDiff == null),
      { code: 'BANK', label: 'Bank reconciliation', severity: 'WARNING', status: 'PASS', message: 'Review each bank account before final close', actionRoute: '/finance/reconciliation' },
    ];
    const blocking = checks.filter((c) => c.severity === 'BLOCKING').length;
    const passed = checks.filter((c) => c.status === 'PASS').length;
    return { periodId: id, checks, passed, total: checks.length, blocking, ready: blocking === 0 };
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.periods.manage')
  @Post('periods/:id/close') async closePeriod(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const period = await this.prisma.fiscalPeriod.findFirst({ where: { id, companyId } });
    if (!period) throw new BadRequestException('Period not found');
    if (period.status === 'CLOSED') return { ok: true, alreadyClosed: true };
    const cl = await this.trialBalanceReport(req, { from: period.startDate.toISOString().slice(0, 10), to: period.endDate.toISOString().slice(0, 10) });
    if (!cl.isBalanced) throw new BadRequestException('Cannot close — the Trial Balance is not balanced before closing.');
    const checklist = await this.periodCloseChecklist(req, id);
    if (checklist.blocking > 0) {
      const blockers = checklist.checks.filter((c: any) => c.severity === 'BLOCKING').map((c: any) => c.label).join('; ');
      throw new BadRequestException(`Cannot close — unresolved blocking checks: ${blockers}`);
    }
    await this.prisma.fiscalPeriod.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: req.user.sub } });
    await this.audit.log(companyId, req.user.sub, 'CLOSE_PERIOD', 'FiscalPeriod', id, { balances: cl, checklist: checklist.checks });
    return { ok: true };
  }

  // ----- Bank & Cash -----
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('bank-accounts') bankAccounts(@Req() req: any) { return this.prisma.bankAccount.findMany({ where: { companyId: companyIdOf(req.user) }, include: { ledgerAccount: true }, orderBy: { name: 'asc' } }); }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('bank-accounts') async createBankAccount(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.bankAccount.create({ data: { companyId, ledgerAccountId: body.ledgerAccountId, name: body.name, bankName: body.bankName, accountNumberMasked: body.accountNumberMasked, currency: body.currency || 'USD', openingBalance: Number(body.openingBalance || 0), type: body.type || 'BANK' } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('bank-transfers') bankTransfers(@Req() req: any) { return this.prisma.journalEntry.findMany({ where: { companyId: companyIdOf(req.user), sourceType: 'BANK_TRANSFER' }, orderBy: { date: 'desc' } }); }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('bank-transfers') async bankTransfer(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    if (!body.fromAccountId || !body.toAccountId) throw new BadRequestException('Select source and destination');
    if (body.fromAccountId === body.toAccountId) throw new BadRequestException('Source and destination must differ');
    const amount = Number(body.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be greater than zero');
    const [from, to] = await Promise.all([
      this.prisma.bankAccount.findFirst({ where: { id: body.fromAccountId, companyId }, include: { ledgerAccount: true } }),
      this.prisma.bankAccount.findFirst({ where: { id: body.toAccountId, companyId }, include: { ledgerAccount: true } }),
    ]);
    if (!from?.ledgerAccount || !to?.ledgerAccount) throw new BadRequestException('Bank account(s) not found');
    const journal = await this.posting.postJournal(companyId, {
      date: body.date ? new Date(body.date) : new Date(),
      description: `Bank transfer ${from.name} → ${to.name}${body.reference ? ` (${body.reference})` : ''}`,
      reference: body.reference, sourceType: 'BANK_TRANSFER',
      lines: [
        { code: to.ledgerAccount.code, debit: amount, credit: 0, description: 'Transfer in' },
        { code: from.ledgerAccount.code, debit: 0, credit: amount, description: 'Transfer out' },
      ],
    });
    await this.audit.log(companyId, req.user.sub, 'TRANSFER', 'BankAccount', body.fromAccountId, { to: body.toAccountId, amount });
    return journal;
  }

  // ----- Vendor Credits -----
  private computeVc(lines: any[]) {
    let subtotal = 0, taxTotal = 0;
    const mapped = lines.map((l) => {
      const net = Number(l.quantity) * Number(l.unitPrice);
      const tax = net * (Number(l.taxRate) / 100);
      subtotal += net; taxTotal += tax;
      return { ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate), taxAmount: Number(tax.toFixed(2)), lineTotal: Number((net + tax).toFixed(2)) };
    });
    return { mapped, subtotal: Number(subtotal.toFixed(2)), taxTotal: Number(taxTotal.toFixed(2)), total: Number((subtotal + taxTotal).toFixed(2)) };
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Get('vendor-credits') async vendorCredits(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const where: any = { companyId };
    if (q.supplierId) where.supplierId = q.supplierId;
    if (q.docStatus) where.status = q.docStatus;
    if (q.appStatus) where.applicationStatus = q.appStatus;
    if (q.currency) where.currency = q.currency;
    if (q.q) where.OR = [{ vendorCreditNo: { contains: q.q, mode: 'insensitive' } }, { supplierCreditNo: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { memo: { contains: q.q, mode: 'insensitive' } }, { reason: { contains: q.q, mode: 'insensitive' } }, { supplier: { name: { contains: q.q, mode: 'insensitive' } } }];
    const rows = await this.prisma.vendorCredit.findMany({ where, include: { supplier: true, lines: true, applications: true, refunds: true }, orderBy: { creditDate: 'desc' } });
    const out = rows.map((v: any) => { const applied = v.applications.filter((a: any) => a.status === 'ACTIVE').reduce((s: number, a: any) => s + Number(a.amount), 0); const refunded = Number(v.refundedAmount || 0); const available = Math.max(0, Number(v.total) - applied - refunded); const appStatus = v.status !== 'POSTED' ? v.applicationStatus : (available <= 0.005 ? (v.applications.length ? 'FULLY_APPLIED' : (refunded > 0 ? 'REFUNDED' : v.applicationStatus)) : (applied > 0.005 ? 'PARTIALLY_APPLIED' : 'UNAPPLIED')); return { ...v, appliedAmount: Number(v.appliedAmount || applied || 0), refundedAmount: refunded, available, applicationStatus: appStatus }; });
    return out;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Get('vendor-credits/:id') async vendorCreditDetail(@Req() req: any, @Param('id') id: string) {
    const v = await this.prisma.vendorCredit.findFirst({ where: { id, companyId: companyIdOf(req.user) }, include: { supplier: true, lines: true, applications: true, refunds: true } });
    if (!v) throw new BadRequestException('Vendor credit not found');
    const applied = v.applications.filter((a: any) => a.status === 'ACTIVE').reduce((s: number, a: any) => s + Number(a.amount), 0);
    const refunded = Number(v.refundedAmount || 0);
    const appIds = v.applications.filter((a: any) => a.status === 'ACTIVE').map((a: any) => a.supplierInvoiceId);
    const bills = await this.prisma.supplierInvoice.findMany({ where: { id: { in: appIds } }, select: { id: true, invoiceNo: true } });
    const billNo = new Map(bills.map((b: any) => [b.id, b.invoiceNo]));
    const applications = v.applications.map((a: any) => ({ ...a, billNo: billNo.get(a.supplierInvoiceId) || '—' }));
    return { ...v, applications, appliedAmount: applied, refundedAmount: refunded, available: Math.max(0, Number(v.total) - applied - refunded) };
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Post('vendor-credits') async createVendorCredit(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    if (body.supplierCreditNo && body.supplierCreditNo.trim()) {
      const dup = await this.prisma.vendorCredit.findFirst({ where: { companyId, supplierId: body.supplierId, supplierCreditNo: body.supplierCreditNo.trim() } });
      if (dup) throw new BadRequestException(`This supplier credit memo already exists. ${dup.vendorCreditNo}`);
    }
    let subtotal = 0, taxTotal = 0;
    const mapped = (body.lines || []).map((l: any) => { const net = Number(l.quantity || 1) * Number(l.unitPrice || 0); const tax = net * (Number(l.taxRate || 0) / 100); subtotal += net; taxTotal += tax; return { description: l.description, itemId: l.itemId, accountId: l.accountId, quantity: Number(l.quantity || 1), unitPrice: Number(l.unitPrice || 0), taxRate: Number(l.taxRate || 0), taxAmount: Number(tax.toFixed(2)), lineTotal: Number((net + tax).toFixed(2)) }; });
    const no = await this.numbering.next(companyId, 'VC');
    const vc = await this.prisma.vendorCredit.create({ data: { companyId, supplierId: body.supplierId, vendorCreditNo: no, supplierCreditNo: body.supplierCreditNo?.trim() || null, creditDate: body.creditDate ? new Date(body.creditDate) : new Date(), status: body.status === 'POSTED' ? 'POSTED' : 'DRAFT', applicationStatus: 'UNAPPLIED', currency: body.currency || 'USD', subtotal: Number(subtotal.toFixed(2)), taxTotal: Number(taxTotal.toFixed(2)), total: Number((subtotal + taxTotal).toFixed(2)), reason: body.reason, reference: body.reference, memo: body.memo, sourceInvoiceId: body.sourceInvoiceId, sourcePurchaseOrderId: body.sourcePurchaseOrderId, sourceGrnId: body.sourceGrnId, projectId: body.projectId, fileName: body.fileName, mime: body.mime, dataUrl: body.dataUrl, createdBy: req.user?.name || req.user?.email, createdById: req.user?.sub, lines: { create: mapped } }, include: { lines: true } });
    await this.audit.log(companyId, req.user.sub, 'VENDOR_CREDIT_CREATED', 'VendorCredit', vc.id, { vcNo: vc.vendorCreditNo, reason: vc.reason });
    return vc;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Post('vendor-credits/:id/post') async postVendorCredit(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const vc = await this.prisma.vendorCredit.findFirst({ where: { id, companyId }, include: { lines: true } });
    if (!vc) throw new BadRequestException('Vendor credit not found');
    if (vc.status === 'POSTED') return vc;
    if (!vc.lines.length) throw new BadRequestException('Add at least one credit line');
    const lines: any[] = [];
    for (const l of vc.lines) { const acc = l.accountId ? await this.prisma.ledgerAccount.findFirst({ where: { id: l.accountId, companyId } }) : null; const hasStock = !!l.itemId; const code = acc?.code || (hasStock ? '1200' : '6000'); const net = Number(l.lineTotal) - Number(l.taxAmount || 0); lines.push({ code, debit: 0, credit: Number(net.toFixed(2)), description: l.description }); }
    if (Number(vc.taxTotal) > 0) lines.push({ code: '2100', debit: 0, credit: Number(vc.taxTotal), description: 'Input VAT reversal' });
    lines.push({ code: '2000', debit: Number(vc.total), credit: 0, description: 'Accounts payable reduction' });
    await this.posting.postJournal(companyId, { date: vc.creditDate, description: `Vendor credit ${vc.vendorCreditNo}`, reference: vc.vendorCreditNo, sourceType: 'VENDOR_CREDIT', sourceId: vc.id, lines });
    await this.prisma.vendorCredit.update({ where: { id }, data: { status: 'POSTED', applicationStatus: 'UNAPPLIED' } });
    await this.audit.log(companyId, req.user.sub, 'VENDOR_CREDIT_POSTED', 'VendorCredit', vc.id, { vcNo: vc.vendorCreditNo });
    return this.prisma.vendorCredit.findUnique({ where: { id }, include: { lines: true, applications: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Post('vendor-credits/:id/apply') async applyVendorCredit(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const vc = await this.prisma.vendorCredit.findFirst({ where: { id, companyId }, include: { applications: { where: { status: 'ACTIVE' } }, refunds: true } });
    if (!vc) throw new BadRequestException('Vendor credit not found');
    if (vc.status !== 'POSTED') throw new BadRequestException('Post the vendor credit before applying');
    const applied = vc.applications.reduce((s, a) => s + Number(a.amount), 0);
    const available = Math.max(0, Number(vc.total) - applied - Number(vc.refundedAmount || 0));
    const allocations = body.allocations || [{ supplierInvoiceId: body.supplierInvoiceId, amount: Number(body.amount || 0) }];
    const totalApply = allocations.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
    if (totalApply <= 0) throw new BadRequestException('Select bills to apply');
    if (totalApply > available + 0.001) throw new BadRequestException(`Available credit has changed. Current available credit: ${available.toFixed(2)}`);
    await this.prisma.$transaction(async (tx) => {
      for (const a of allocations) {
        const amt = Number(a.amount || 0); if (amt <= 0) continue;
        const bill = await tx.supplierInvoice.findFirst({ where: { id: a.supplierInvoiceId, companyId } });
        if (!bill) throw new BadRequestException('Supplier invoice not found');
        const bal = Math.max(0, Number(bill.total) - Number(bill.amountPaid) - Number(bill.creditsApplied || 0));
        if (amt > bal + 0.001) throw new BadRequestException(`Cannot apply more than bill outstanding (${bal.toFixed(2)})`);
        await tx.vendorCreditApplication.create({ data: { vendorCreditId: id, supplierInvoiceId: a.supplierInvoiceId, amount: amt, status: 'ACTIVE', createdBy: req.user?.name || req.user?.email } });
        const newCredits = Number(bill.creditsApplied || 0) + amt;
        const newDue = Math.max(0, Number(bill.total) - Number(bill.amountPaid) - newCredits);
        await tx.supplierInvoice.update({ where: { id: bill.id }, data: { creditsApplied: newCredits, balanceDue: newDue } });
      }
      const newApplied = applied + totalApply;
      const appStatus = newApplied >= Number(vc.total) - Number(vc.refundedAmount || 0) - 0.001 ? 'FULLY_APPLIED' : (newApplied > 0.005 ? 'PARTIALLY_APPLIED' : 'UNAPPLIED');
      await tx.vendorCredit.update({ where: { id }, data: { appliedAmount: newApplied, applicationStatus: appStatus } });
    });
    await this.audit.log(companyId, req.user.sub, 'VENDOR_CREDIT_APPLIED', 'VendorCredit', vc.id, { amount: totalApply });
    return this.prisma.vendorCredit.findUnique({ where: { id }, include: { applications: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Post('vendor-credits/:id/applications/:appId/reverse') async reverseApplication(@Req() req: any, @Param('id') id: string, @Param('appId') appId: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const app = await this.prisma.vendorCreditApplication.findFirst({ where: { id: appId, vendorCreditId: id, status: 'ACTIVE' } });
    if (!app) throw new BadRequestException('Application not found');
    if (!body?.reason) throw new BadRequestException('Reason required');
    await this.prisma.$transaction(async (tx) => {
      const bill = await tx.supplierInvoice.findFirst({ where: { id: app.supplierInvoiceId, companyId } });
      if (bill) { const newCredits = Math.max(0, Number(bill.creditsApplied || 0) - Number(app.amount)); const newDue = Math.max(0, Number(bill.total) - Number(bill.amountPaid) - newCredits); await tx.supplierInvoice.update({ where: { id: bill.id }, data: { creditsApplied: newCredits, balanceDue: newDue } }); }
      await tx.vendorCreditApplication.update({ where: { id: appId }, data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: body.reason } });
      const vc = await tx.vendorCredit.findFirst({ where: { id }, include: { applications: { where: { status: 'ACTIVE' } } } });
      if (!vc) throw new BadRequestException('Vendor credit not found');
      const applied = vc.applications.reduce((s: number, a: any) => s + Number(a.amount), 0);
      await tx.vendorCredit.update({ where: { id }, data: { appliedAmount: applied, applicationStatus: applied >= Number(vc.total) - Number(vc.refundedAmount || 0) - 0.001 ? 'FULLY_APPLIED' : (applied > 0.005 ? 'PARTIALLY_APPLIED' : 'UNAPPLIED') } });
    });
    await this.audit.log(companyId, req.user.sub, 'APPLICATION_REVERSED', 'VendorCredit', id, { appId, reason: body.reason });
    return this.prisma.vendorCredit.findUnique({ where: { id }, include: { applications: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Post('vendor-credits/:id/refund') async vendorCreditRefund(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const vc = await this.prisma.vendorCredit.findFirst({ where: { id, companyId }, include: { applications: { where: { status: 'ACTIVE' } }, refunds: true } });
    if (!vc) throw new BadRequestException('Vendor credit not found');
    if (vc.status !== 'POSTED') throw new BadRequestException('Post the vendor credit before refunding');
    const applied = vc.applications.reduce((s, a) => s + Number(a.amount), 0);
    const available = Math.max(0, Number(vc.total) - applied - Number(vc.refundedAmount || 0));
    const amount = Number(body.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    if (amount > available + 0.001) throw new BadRequestException(`Cannot refund more than available credit $${available.toFixed(2)}`);
    const bank = body.bankAccountId ? await this.prisma.bankAccount.findFirst({ where: { id: body.bankAccountId, companyId } }) : null;
    if (!bank) throw new BadRequestException('Deposit to bank/cash account required');
    const bankCode = bank?.ledgerAccountId ? (await this.prisma.ledgerAccount.findFirst({ where: { id: bank.ledgerAccountId } }))?.code || '1000' : '1000';
    const refund = await this.prisma.$transaction(async (tx) => {
      const r = await tx.vendorCreditRefund.create({ data: { companyId, vendorCreditId: id, date: body.date ? new Date(body.date) : new Date(), amount, bankAccountId: bank.id, reference: body.reference, memo: body.memo, status: 'POSTED', createdBy: req.user?.name || req.user?.email, createdById: req.user?.sub } });
      await tx.vendorCredit.update({ where: { id }, data: { refundedAmount: Number(vc.refundedAmount || 0) + amount } });
      return r;
    });
    await this.posting.postJournal(companyId, { date: refund.date, description: `Supplier refund ${refund.reference || refund.id}`, reference: refund.reference ?? undefined, sourceType: 'VENDOR_CREDIT_REFUND', sourceId: refund.id, lines: [
      { code: bankCode, debit: amount, credit: 0, description: 'Cash / bank' },
      { code: '2000', debit: 0, credit: amount, description: 'Supplier credit clearing' },
    ] });
    await this.audit.log(companyId, req.user.sub, 'SUPPLIER_REFUND_RECORDED', 'VendorCredit', id, { amount });
    return this.prisma.vendorCredit.findUnique({ where: { id }, include: { refunds: true, applications: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Post('vendor-credits/:id/void') async voidVendorCredit(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const vc = await this.prisma.vendorCredit.findFirst({ where: { id, companyId }, include: { applications: { where: { status: 'ACTIVE' } }, refunds: true } });
    if (!vc) throw new BadRequestException('Vendor credit not found');
    if (vc.status === 'VOID') throw new BadRequestException('Already void');
    if (vc.applications.length || vc.refunds.length) throw new BadRequestException('Vendor credit has applications/refunds. Reverse them first.');
    if (!body?.reason) throw new BadRequestException('Void reason required');
    await this.prisma.vendorCredit.update({ where: { id }, data: { status: 'VOID', voidReason: body.reason } });
    if (vc.status === 'POSTED') { try { await this.posting.postJournal(companyId, { date: new Date(), description: `Void vendor credit ${vc.vendorCreditNo}`, reference: `${vc.vendorCreditNo}-VOID`, sourceType: 'VENDOR_CREDIT_VOID', sourceId: vc.id, lines: [{ code: '2000', debit: 0, credit: Number(vc.total), description: 'AP reversal' }, { code: '6000', debit: Number(vc.subtotal), credit: 0, description: 'Expense reversal' }] }); } catch {} }
    await this.audit.log(companyId, req.user.sub, 'VENDOR_CREDIT_VOIDED', 'VendorCredit', id, { reason: body.reason });
    return this.prisma.vendorCredit.findUnique({ where: { id } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.vendorcredits.manage')
  @Get('vendor-credits/reports/:kind') async vendorCreditReports(@Req() req: any, @Param('kind') kind: string) {
    const companyId = companyIdOf(req.user);
    const creds = await this.prisma.vendorCredit.findMany({ where: { companyId, status: 'POSTED' }, include: { supplier: true, applications: { where: { status: 'ACTIVE' } }, refunds: true } });
    if (kind === 'available') return creds.map((c: any) => { const applied = c.applications.reduce((s: number, a: any) => s + Number(a.amount), 0); const refunded = Number(c.refundedAmount || 0); const available = Math.max(0, Number(c.total) - applied - refunded); return { id: c.id, creditNo: c.vendorCreditNo, supplier: c.supplier?.name, date: c.creditDate, original: Number(c.total), applied: Number(applied.toFixed(2)), refunded: Number(refunded.toFixed(2)), available: Number(available.toFixed(2)), age: Math.floor((Date.now() - new Date(c.creditDate).getTime()) / 86400000) }; }).filter((c: any) => c.available > 0);
    if (kind === 'by-reason') { const agg: Record<string, any> = {}; for (const c of creds) { const k = c.reason || 'Other'; const r = (agg[k] ||= { reason: k, count: 0, total: 0 }); r.count += 1; r.total += Number(c.total); } return Object.values(agg).map((r: any) => ({ ...r, total: Number(r.total.toFixed(2)) })); }
    if (kind === 'by-supplier') { const agg: Record<string, any> = {}; for (const c of creds) { const k = c.supplier?.name || 'Other'; const r = (agg[k] ||= { supplier: k, count: 0, total: 0 }); r.count += 1; r.total += Number(c.total); } return Object.values(agg).map((r: any) => ({ ...r, total: Number(r.total.toFixed(2)) })); }
    if (kind === 'refunds') return this.prisma.vendorCreditRefund.findMany({ where: { companyId }, include: { vendorCredit: true }, orderBy: { date: 'desc' } });
    return [];
  }

  // ----- Checks -----
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('checks') checks(@Req() req: any) {
    return this.prisma.check.findMany({ where: { companyId: companyIdOf(req.user) }, include: { bankAccount: true, allocations: true }, orderBy: { createdAt: 'desc' } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('checks/next') async nextCheck(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: q.bankAccountId, companyId } });
    if (!bank) throw new BadRequestException('Bank account not found');
    const seq = await this.prisma.checkSequence.findUnique({ where: { companyId_bankAccountId: { companyId, bankAccountId: bank.id } } });
    return { next: String((seq?.lastNumber || 0) + 1).padStart(6, '0') };
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('checks/:id') async checkDetail(@Req() req: any, @Param('id') id: string) {
    const check = await this.prisma.check.findFirst({ where: { id, companyId: companyIdOf(req.user) }, include: { bankAccount: { include: { ledgerAccount: true } }, allocations: { include: { account: true } } } });
    if (!check) throw new BadRequestException('Check not found');
    return check;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('checks') async createCheck(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const bank = await this.prisma.bankAccount.findFirst({ where: { id: body.bankAccountId, companyId }, include: { ledgerAccount: true } });
    if (!bank?.ledgerAccount) throw new BadRequestException('Bank account not found');
    const amount = Number(body.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be greater than zero');
    const allocations: any[] = body.allocations || [];
    const allocTotal = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
    if (allocations.length && Math.abs(allocTotal - amount) > 0.01) throw new BadRequestException('Allocations must total the check amount');
    const recordStatus = body.recordStatus === 'DRAFT' ? 'DRAFT' : 'RECORDED';
    const number = await this.prisma.$transaction(async (tx) => {
      const seq = await tx.checkSequence.upsert({ where: { companyId_bankAccountId: { companyId, bankAccountId: bank.id } }, update: {}, create: { companyId, bankAccountId: bank.id, lastNumber: 0 } });
      const next = seq.lastNumber + 1;
      await tx.checkSequence.update({ where: { id: seq.id }, data: { lastNumber: next } });
      return String(next).padStart(6, '0');
    });
    const check = await this.prisma.check.create({
      data: { companyId, bankAccountId: bank.id, checkNo: number, date: body.date ? new Date(body.date) : new Date(), payTo: body.payTo || 'Manual payee', payeeOverride: body.payeeOverride, amount, amountInWords: body.amountInWords, payeeAddress: body.payeeAddress, memo: body.memo, supplierId: body.supplierId, supplierInvoiceId: body.supplierInvoiceId, supplierPaymentId: body.supplierPaymentId, status: recordStatus, createdBy: req.user?.name || req.user?.email, createdById: req.user?.sub, updatedBy: req.user?.name || req.user?.email, updatedById: req.user?.sub, allocations: { create: allocations.map((a) => ({ accountId: a.accountId, supplierInvoiceId: a.supplierInvoiceId, description: a.description, amount: Number(a.amount || 0) })) } },
      include: { allocations: true, bankAccount: true },
    });
    if (recordStatus === 'RECORDED') {
      const lines: any[] = [];
      for (const a of allocations) {
        if (a.supplierInvoiceId) lines.push({ code: '2000', debit: Number(a.amount), credit: 0, description: 'Accounts payable' });
        else lines.push({ code: (await this.prisma.ledgerAccount.findFirst({ where: { id: a.accountId } }))?.code || '6000', debit: Number(a.amount), credit: 0, description: a.description || 'Expense' });
      }
      if (!lines.length) lines.push({ code: '6000', debit: amount, credit: 0, description: 'Expense' });
      lines.push({ code: bank.ledgerAccount.code, debit: 0, credit: amount, description: 'Cash / bank' });
      await this.posting.postJournal(companyId, { date: check.date, description: `Check ${check.checkNo}`, reference: check.checkNo, sourceType: 'CHECK', sourceId: check.id, lines });
    }
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Check', check.id, { checkNo: check.checkNo, recordStatus });
    return this.prisma.check.findUnique({ where: { id: check.id }, include: { bankAccount: true, allocations: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Patch('checks/:id') async updateCheck(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const check = await this.prisma.check.findFirst({ where: { id, companyId } });
    if (!check) throw new BadRequestException('Check not found');
    if (check.status === 'RECORDED') throw new BadRequestException('Recorded checks cannot be edited. Void it instead.');
    await this.prisma.$transaction(async (tx) => {
      await tx.checkAllocation.deleteMany({ where: { checkId: id } });
      await tx.check.update({ where: { id }, data: { date: body.date ? new Date(body.date) : check.date, payTo: body.payTo ?? check.payTo, payeeOverride: body.payeeOverride, amount: Number(body.amount ?? 0), amountInWords: body.amountInWords, payeeAddress: body.payeeAddress, memo: body.memo, supplierId: body.supplierId, updatedBy: req.user?.name || req.user?.email, updatedById: req.user?.sub, allocations: { create: (body.allocations || []).map((a: any) => ({ accountId: a.accountId, supplierInvoiceId: a.supplierInvoiceId, description: a.description, amount: Number(a.amount || 0) })) } } });
    });
    return this.prisma.check.findUnique({ where: { id }, include: { allocations: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('checks/:id/print') async printCheck(@Req() req: any, @Param('id') id: string) {
    const check = await this.prisma.check.findFirst({ where: { id, companyId: companyIdOf(req.user) } });
    if (!check) throw new BadRequestException('Check not found');
    if (check.status === 'VOID') throw new BadRequestException('Void check cannot be printed');
    await this.prisma.check.update({ where: { id }, data: { printed: true, printCount: Number(check.printCount || 0) + 1, printedAt: check.printedAt || new Date(), lastPrintedAt: new Date(), updatedBy: req.user?.name || req.user?.email, updatedById: req.user?.sub } });
    await this.audit.log(companyIdOf(req.user), req.user.sub, 'PRINT', 'Check', id, { printCount: Number(check.printCount || 0) + 1 });
    return this.prisma.check.findUnique({ where: { id }, include: { bankAccount: true, allocations: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('checks/:id/void') async voidCheck(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const check = await this.prisma.check.findFirst({ where: { id, companyId: companyIdOf(req.user) } });
    if (!check) throw new BadRequestException('Check not found');
    if (check.status === 'VOID') throw new BadRequestException('Check already void');
    if (!body?.reason) throw new BadRequestException('Void reason is required');
    await this.prisma.check.update({ where: { id }, data: { status: 'VOID', clearedStatus: 'VOIDED', voidReason: body.reason, updatedBy: req.user?.name || req.user?.email, updatedById: req.user?.sub } });
    if (check.status === 'RECORDED') { try { await this.posting.postJournal(companyIdOf(req.user), { date: new Date(), description: `Void check ${check.checkNo}`, reference: `${check.checkNo}-VOID`, sourceType: 'CHECK_VOID', sourceId: check.id, lines: [{ code: '1000', debit: Number(check.amount), credit: 0, description: 'Bank reversal' }, { code: '6000', debit: 0, credit: Number(check.amount), description: 'Expense reversal' }] }); } catch {} }
    await this.audit.log(companyIdOf(req.user), req.user.sub, 'VOID', 'Check', id, { reason: body.reason });
    return this.prisma.check.findUnique({ where: { id }, include: { allocations: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('checks/:id/status') async checkStatus(@Req() req: any, @Param('id') id: string, @Body() body: { status: string }) {
    await this.prisma.check.update({ where: { id }, data: { status: body.status } });
    await this.audit.log(companyIdOf(req.user), req.user.sub, body.status.toUpperCase(), 'Check', id);
    return { ok: true };
  }

  // ----- Credit Cards -----
  private async resolveJournalSource(sourceType: string, sourceId: string | null, reference: string | null, descriptionFallback: string | null): Promise<{ label: string; number: string; route: string }> {
    const map: Record<string, any> = {
      SALES_INVOICE: { label: 'Invoice', route: '/sales/invoices', model: 'salesInvoice', numberField: 'invoiceNo' },
      invoice: { label: 'Invoice', route: '/sales/invoices', model: 'salesInvoice', numberField: 'invoiceNo' },
      RECEIPT: { label: 'Customer Receipt', route: '/sales/receipts', model: 'receipt', numberField: 'receiptNo' },
      RECEIPT_REVERSAL: { label: 'Receipt Reversal', route: '/sales/receipts', model: 'receipt', numberField: 'receiptNo' },
      CREDIT_NOTE: { label: 'Credit Note', route: '/sales/credit-notes', model: 'creditNote', numberField: 'creditNoteNo' },
      CREDIT_NOTE_VOID: { label: 'Credit Note Void', route: '/sales/credit-notes', model: 'creditNote', numberField: 'creditNoteNo' },
      SUPPLIER_INVOICE: { label: 'Bill', route: '/expenses/bills', model: 'supplierInvoice', numberField: 'invoiceNo' },
      SUPPLIER_PAYMENT: { label: 'Supplier Payment', route: '/expenses/bills', model: 'supplierPayment', numberField: 'paymentNo' },
      SUPPLIER_PAYMENT_REVERSAL: { label: 'Supplier Payment Reversal', route: '/expenses/bills', model: 'supplierPayment', numberField: 'paymentNo' },
      VENDOR_CREDIT: { label: 'Vendor Credit', route: '/expenses/vendor-credits', model: 'vendorCredit', numberField: 'vendorCreditNo' },
      VENDOR_CREDIT_VOID: { label: 'Vendor Credit Void', route: '/expenses/vendor-credits', model: 'vendorCredit', numberField: 'vendorCreditNo' },
      VENDOR_CREDIT_REFUND: { label: 'Supplier Refund', route: '/expenses/vendor-credits' },
      CHECK: { label: 'Check', route: '/finance/checks', model: 'check', numberField: 'checkNo' },
      CHECK_VOID: { label: 'Check Void', route: '/finance/checks', model: 'check', numberField: 'checkNo' },
      CREDIT_CARD_CHARGE: { label: 'Credit Card Charge', route: '/expenses/credit-card-charges' },
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
    if (!number && descriptionFallback) number = '';
    return { label: item.label, number, route: item.route };
  }

  private async cardBalance(companyId: string, cardId: string) {
    const card = await this.prisma.creditCardAccount.findFirst({ where: { id: cardId, companyId } });
    if (!card) throw new BadRequestException('Card not found');
    const [charges, credits, payments, refunds] = await Promise.all([
      this.prisma.creditCardTransaction.aggregate({ where: { cardAccountId: cardId, status: 'POSTED', type: { in: ['CHARGE', 'FEE', 'INTEREST'] } }, _sum: { amount: true } }),
      this.prisma.creditCardTransaction.aggregate({ where: { cardAccountId: cardId, status: 'POSTED', type: { in: ['REFUND', 'CREDIT'] } }, _sum: { amount: true } }),
      this.prisma.creditCardPayment.aggregate({ where: { cardAccountId: cardId, status: 'POSTED' }, _sum: { amount: true } }),
      null,
    ]);
    const balance = Number(card.openingBalance || 0) + Number(charges._sum.amount || 0) - Number(credits._sum.amount || 0) - Number(payments._sum.amount || 0);
    return { balance: Number(balance.toFixed(2)), charges: Number(charges._sum.amount || 0), credits: Number(credits._sum.amount || 0), payments: Number(payments._sum.amount || 0) };
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('credit-cards') async creditCards(@Req() req: any) {
    const companyId = companyIdOf(req.user);
    const cards = await this.prisma.creditCardAccount.findMany({ where: { companyId }, include: { ledgerAccount: true }, orderBy: { name: 'asc' } });
    const now = new Date(); const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const out = [];
    for (const c of cards) {
      const b = await this.cardBalance(companyId, c.id);
      const [chargesThisMonth, paymentsThisMonth] = await Promise.all([
        this.prisma.creditCardTransaction.aggregate({ where: { cardAccountId: c.id, status: 'POSTED', type: { in: ['CHARGE', 'FEE', 'INTEREST'] }, date: { gte: mStart } }, _sum: { amount: true } }),
        this.prisma.creditCardPayment.aggregate({ where: { cardAccountId: c.id, status: 'POSTED', date: { gte: mStart } }, _sum: { amount: true } }),
      ]);
      out.push({ ...c, currentBalance: b.balance, chargesThisMonth: Number(chargesThisMonth._sum.amount || 0), paymentsThisMonth: Number(paymentsThisMonth._sum.amount || 0), availableCredit: Math.max(0, Number(c.creditLimit) - b.balance) });
    }
    return out;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('credit-cards/:id') async cardDetail(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const card = await this.prisma.creditCardAccount.findFirst({ where: { id, companyId }, include: { ledgerAccount: true, transactions: { orderBy: { date: 'desc' }, include: { allocations: true } }, payments: { orderBy: { date: 'desc' } }, statements: { orderBy: { periodEnd: 'desc' } } } });
    if (!card) throw new BadRequestException('Card not found');
    const b = await this.cardBalance(companyId, id);
    return { ...card, currentBalance: b.balance, availableCredit: Math.max(0, Number(card.creditLimit) - b.balance) };
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('credit-cards') async createCard(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    let ledgerAccountId = body.ledgerAccountId || body.liabilityAccountId;
    if (!ledgerAccountId) {
      // Auto-create a liability account through existing COA service.
      const account = await this.prisma.ledgerAccount.create({ data: { companyId, code: body.accountCode || `215${Math.floor(Math.random() * 9) + 1}${(body.last4 || '1').slice(-1)}`, name: body.name || 'Credit Card', type: 'LIABILITY', parentId: null, active: true } });
      ledgerAccountId = account.id;
    }
    const card = await this.prisma.creditCardAccount.create({ data: { companyId, name: body.name, last4: body.last4?.slice(-4), issuer: body.issuer, cardType: body.cardType, status: body.status || 'ACTIVE', ledgerAccountId, currency: body.currency || 'USD', creditLimit: Number(body.creditLimit || 0), statementDay: body.statementDay ? Number(body.statementDay) : undefined, paymentDueDay: body.paymentDueDay ? Number(body.paymentDueDay) : undefined, openingBalance: Number(body.openingBalance || 0), defaultExpenseAccountId: body.defaultExpenseAccountId, defaultTaxCode: body.defaultTaxCode, branchId: body.branchId, cardholderId: body.cardholderId, cardholderName: body.cardholderName } });
    await this.audit.log(companyId, req.user.sub, 'CARD_CREATED', 'CreditCardAccount', card.id, { name: body.name, last4: body.last4 });
    return this.prisma.creditCardAccount.findUnique({ where: { id: card.id }, include: { ledgerAccount: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Patch('credit-cards/:id') async updateCard(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    await this.prisma.creditCardAccount.updateMany({ where: { id, companyId: companyIdOf(req.user) }, data: { ...body, last4: body.last4 ? String(body.last4).slice(-4) : undefined, creditLimit: body.creditLimit !== undefined ? Number(body.creditLimit) : undefined, statementDay: body.statementDay !== undefined ? Number(body.statementDay) : undefined, paymentDueDay: body.paymentDueDay !== undefined ? Number(body.paymentDueDay) : undefined } });
    await this.audit.log(companyIdOf(req.user), req.user.sub, 'CARD_EDITED', 'CreditCardAccount', id);
    return this.prisma.creditCardAccount.findUnique({ where: { id } });
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('credit-cards/:id/register') async cardRegister(@Req() req: any, @Param('id') id: string) {
    const companyId = companyIdOf(req.user);
    const card = await this.prisma.creditCardAccount.findFirst({ where: { id, companyId }, include: { ledgerAccount: true } });
    if (!card) throw new BadRequestException('Card not found');
    const transactions = await this.prisma.creditCardTransaction.findMany({ where: { cardAccountId: id }, include: { allocations: true }, orderBy: { date: 'asc' } });
    const payments = await this.prisma.creditCardPayment.findMany({ where: { cardAccountId: id }, orderBy: { date: 'asc' } });
    const rows: any[] = [];
    let run = Number(card.openingBalance || 0);
    for (const t of transactions) {
      const signed = ['CHARGE', 'FEE', 'INTEREST'].includes(t.type) ? Number(t.amount) : -Number(t.amount);
      run += t.status === 'POSTED' ? signed : 0;
      rows.push({ kind: 'tx', id: t.id, date: t.date, type: t.type, vendor: t.vendor, description: t.description, projectId: t.projectId, charge: signed > 0 ? Number(t.amount) : 0, credit: signed < 0 ? Number(t.amount) : 0, balance: t.status === 'POSTED' ? Number(run.toFixed(2)) : 0, status: t.status, cleared: t.cleared, receiptStatus: t.receiptStatus, allocations: t.allocations, attachments: t.fileName });
    }
    for (const p of payments) {
      run -= p.status === 'POSTED' ? Number(p.amount) : 0;
      rows.push({ kind: 'pmt', id: p.id, date: p.date, type: 'PAYMENT', description: p.reference ? `Payment ${p.reference}` : 'Card payment', charge: 0, credit: p.status === 'POSTED' ? Number(p.amount) : 0, balance: p.status === 'POSTED' ? Number(run.toFixed(2)) : 0, status: p.status, receiptStatus: 'NOT_REQUIRED' });
    }
    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const b = await this.cardBalance(companyId, id);
    const now = new Date(); const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [cm, pm] = await Promise.all([
      this.prisma.creditCardTransaction.aggregate({ where: { cardAccountId: id, status: 'POSTED', type: { in: ['CHARGE', 'FEE', 'INTEREST'] }, date: { gte: mStart } }, _sum: { amount: true } }),
      this.prisma.creditCardPayment.aggregate({ where: { cardAccountId: id, status: 'POSTED', date: { gte: mStart } }, _sum: { amount: true } }),
    ]);
    return { card, rows, currentBalance: b.balance, chargesThisMonth: Number(cm._sum.amount || 0), paymentsThisMonth: Number(pm._sum.amount || 0), availableCredit: Math.max(0, Number(card.creditLimit) - b.balance), sourceType: 'CREDIT_CARD' };
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('credit-cards/:id/transactions') async cardCharge(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const card = await this.prisma.creditCardAccount.findFirst({ where: { id, companyId }, include: { ledgerAccount: true } });
    if (!card?.ledgerAccount) throw new BadRequestException('Card not found');
    const amount = Number(body.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const taxAmount = Number(body.taxAmount || 0);
    const subtotal = Math.max(0, amount - taxAmount);
    const allocations = (body.allocations && body.allocations.length ? body.allocations : [{ accountId: body.expenseAccountId || card.defaultExpenseAccountId, description: body.description, amount: subtotal }]);
    const allocTotal = allocations.reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
    if (Math.abs(allocTotal - subtotal) > 0.01) throw new BadRequestException('Allocations must total the charge amount (excl. tax)');
    const status = body.status === 'DRAFT' ? 'DRAFT' : 'POSTED';
    const tx = await this.prisma.creditCardTransaction.create({ data: { companyId, cardAccountId: id, date: body.date ? new Date(body.date) : new Date(), type: body.type || 'CHARGE', vendor: body.vendor, description: body.description, expenseAccountId: allocations[0]?.accountId, projectId: body.projectId, amount, subtotal, taxAmount, taxCode: body.taxCode, reference: body.reference, memo: body.memo, supplierId: body.supplierId, status, receiptStatus: body.dataUrl ? 'ATTACHED' : 'MISSING', fileName: body.fileName, mime: body.mime, dataUrl: body.dataUrl, createdBy: req.user?.name || req.user?.email, createdById: req.user?.sub, allocations: { create: allocations.map((a: any) => ({ accountId: a.accountId, projectId: a.projectId, description: a.description, amount: Number(a.amount || 0) })) } }, include: { allocations: true } });
    if (status === 'POSTED') {
      const isDebit = ['CHARGE', 'FEE', 'INTEREST'].includes(tx.type);
      const lines: any[] = [];
      for (const a of allocations) {
        const acc = await this.prisma.ledgerAccount.findFirst({ where: { id: a.accountId, companyId } });
        lines.push({ code: acc?.code || '6000', debit: isDebit ? Number(a.amount) : 0, credit: isDebit ? 0 : Number(a.amount), description: a.description || body.description || 'Expense' });
      }
      if (taxAmount > 0) lines.push({ code: '2100', debit: isDebit ? taxAmount : 0, credit: isDebit ? 0 : taxAmount, description: 'Input tax' });
      lines.push({ code: card.ledgerAccount.code, debit: isDebit ? 0 : amount, credit: isDebit ? amount : 0, description: 'Credit card payable' });
      await this.posting.postJournal(companyId, { date: tx.date, description: `Card charge ${card.name}${body.vendor ? ` - ${body.vendor}` : ''}`, reference: tx.reference ?? undefined, sourceType: 'CREDIT_CARD_CHARGE', sourceId: tx.id, lines });
    }
    await this.audit.log(companyId, req.user.sub, 'CHARGE_CREATED', 'CreditCardTransaction', tx.id, { amount, status });
    return tx;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Patch('credit-cards/:id/transactions/:txId') async updateCharge(@Req() req: any, @Param('id') id: string, @Param('txId') txId: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const tx = await this.prisma.creditCardTransaction.findFirst({ where: { id: txId, cardAccountId: id, companyId } });
    if (!tx) throw new BadRequestException('Transaction not found');
    if (tx.status === 'POSTED') throw new BadRequestException('Posted charges cannot be edited. Void it instead.');
    await this.prisma.$transaction(async (prisma) => {
      await prisma.creditCardTransactionLine.deleteMany({ where: { transactionId: txId } });
      await prisma.creditCardTransaction.update({ where: { id: txId }, data: { date: body.date ? new Date(body.date) : tx.date, vendor: body.vendor, description: body.description, amount: Number(body.amount ?? 0), subtotal: Number(body.amount ?? 0) - Number(body.taxAmount || 0), taxAmount: Number(body.taxAmount || 0), reference: body.reference, memo: body.memo, supplierId: body.supplierId, fileName: body.fileName, mime: body.mime, dataUrl: body.dataUrl, receiptStatus: body.dataUrl ? 'ATTACHED' : 'MISSING', allocations: { create: (body.allocations || []).map((a: any) => ({ accountId: a.accountId, projectId: a.projectId, description: a.description, amount: Number(a.amount || 0) })) } } });
    });
    return this.prisma.creditCardTransaction.findUnique({ where: { id: txId }, include: { allocations: true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('credit-cards/:id/transactions/:txId/void') async voidCharge(@Req() req: any, @Param('id') id: string, @Param('txId') txId: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const tx = await this.prisma.creditCardTransaction.findFirst({ where: { id: txId, cardAccountId: id, companyId } });
    if (!tx) throw new BadRequestException('Transaction not found');
    if (tx.status === 'VOID') throw new BadRequestException('Already void');
    if (tx.status === 'RECONCILED') throw new BadRequestException('Reconciled transaction cannot be voided directly');
    if (!body?.reason) throw new BadRequestException('Void reason required');
    await this.prisma.creditCardTransaction.update({ where: { id: txId }, data: { status: 'VOID', voidReason: body.reason } });
    await this.audit.log(companyId, req.user.sub, 'CHARGE_VOIDED', 'CreditCardTransaction', txId, { reason: body.reason });
    return this.prisma.creditCardTransaction.findUnique({ where: { id: txId } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('credit-cards/:id/receipt') async attachReceipt(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    await this.prisma.creditCardTransaction.updateMany({ where: { id: body.txId, cardAccountId: id, companyId }, data: { receiptStatus: 'ATTACHED', fileName: body.fileName, mime: body.mime, dataUrl: body.dataUrl } });
    await this.audit.log(companyId, req.user.sub, 'RECEIPT_ATTACHED', 'CreditCardTransaction', body.txId, { fileName: body.fileName });
    return { ok: true };
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('credit-cards/:id/payments') cardPayments(@Req() req: any, @Param('id') id: string) {
    return this.prisma.creditCardPayment.findMany({ where: { cardAccountId: id, companyId: companyIdOf(req.user) }, include: { bankAccount: true }, orderBy: { date: 'desc' } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('credit-cards/:id/payments') async cardPayment(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const card = await this.prisma.creditCardAccount.findFirst({ where: { id, companyId }, include: { ledgerAccount: true } });
    if (!card?.ledgerAccount) throw new BadRequestException('Card not found');
    const bank = body.bankAccountId ? await this.prisma.bankAccount.findFirst({ where: { id: body.bankAccountId, companyId }, include: { ledgerAccount: true } }) : null;
    if (!bank?.ledgerAccount) throw new BadRequestException('Select a bank account');
    const amount = Number(body.amount || 0);
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
    const status = body.status === 'DRAFT' ? 'DRAFT' : 'POSTED';
    const pmt = await this.prisma.creditCardPayment.create({ data: { companyId, cardAccountId: id, date: body.date ? new Date(body.date) : new Date(), amount, bankAccountId: bank.id, reference: body.reference, memo: body.memo, status, createdBy: req.user?.name || req.user?.email, createdById: req.user?.sub } });
    if (status === 'POSTED') {
      await this.posting.postJournal(companyId, { date: pmt.date, description: `Credit card payment ${card.name}`, reference: pmt.reference ?? undefined, sourceType: 'CREDIT_CARD_PAYMENT', sourceId: pmt.id, lines: [
        { code: card.ledgerAccount.code, debit: amount, credit: 0, description: 'Credit card payable' },
        { code: bank.ledgerAccount.code, debit: 0, credit: amount, description: 'Cash / bank' },
      ] });
    }
    await this.audit.log(companyId, req.user.sub, 'PAYMENT_CREATED', 'CreditCardPayment', pmt.id, { amount, status });
    return pmt;
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('credit-cards/:id/payments/:pmtId/reverse') async reverseCardPayment(@Req() req: any, @Param('id') id: string, @Param('pmtId') pmtId: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const pmt = await this.prisma.creditCardPayment.findFirst({ where: { id: pmtId, cardAccountId: id, companyId } });
    if (!pmt) throw new BadRequestException('Payment not found');
    if (pmt.status === 'REVERSED') throw new BadRequestException('Already reversed');
    if (!body?.reason) throw new BadRequestException('Reversal reason required');
    const card = await this.prisma.creditCardAccount.findFirst({ where: { id, companyId }, include: { ledgerAccount: true } });
    const bank = pmt.bankAccountId ? await this.prisma.bankAccount.findFirst({ where: { id: pmt.bankAccountId, companyId } }) : null;
    const bankCode = bank?.ledgerAccountId ? (await this.prisma.ledgerAccount.findFirst({ where: { id: bank.ledgerAccountId } }))?.code || '1000' : '1000';
    await this.prisma.creditCardPayment.update({ where: { id: pmtId }, data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: body.reason } });
    if (pmt.status === 'POSTED' && card?.ledgerAccount) await this.posting.postJournal(companyId, { date: new Date(), description: `Reverse card payment ${pmt.reference || pmt.id}`, reference: pmt.reference ? `${pmt.reference}-REV` : undefined, sourceType: 'CREDIT_CARD_PAYMENT_REVERSAL', sourceId: pmt.id, lines: [
      { code: card.ledgerAccount.code, debit: 0, credit: Number(pmt.amount), description: 'Credit card payable reversal' },
      { code: bankCode, debit: Number(pmt.amount), credit: 0, description: 'Bank reversal' },
    ] });
    await this.audit.log(companyId, req.user.sub, 'PAYMENT_REVERSED', 'CreditCardPayment', pmtId, { reason: body.reason });
    return this.prisma.creditCardPayment.findUnique({ where: { id: pmtId } });
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('credit-cards/:id/statements') cardStatements(@Req() req: any, @Param('id') id: string) {
    return this.prisma.creditCardStatement.findMany({ where: { cardAccountId: id, companyId: companyIdOf(req.user) }, orderBy: { periodEnd: 'desc' } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('credit-cards/:id/reconcile') async reconcile(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    const send = body.endDate ? new Date(body.endDate) : new Date();
    const start = new Date(send.getFullYear(), send.getMonth(), 1);
    const txns = await this.prisma.creditCardTransaction.findMany({ where: { cardAccountId: id, status: 'POSTED', date: { gte: start, lte: send } } });
    const payments = await this.prisma.creditCardPayment.findMany({ where: { cardAccountId: id, status: 'POSTED', date: { gte: start, lte: send } } });
    const clearedIds: string[] = body.clearedIds || txns.map((t) => t.id);
    await this.prisma.$transaction(async (prisma) => {
      for (const t of txns) await prisma.creditCardTransaction.update({ where: { id: t.id }, data: { cleared: clearedIds.includes(t.id) ? 'RECONCILED' : 'UNCLEARED' } });
      const charges = txns.filter((t) => ['CHARGE', 'FEE', 'INTEREST'].includes(t.type)).reduce((s, t) => s + Number(t.amount), 0);
      const credits = txns.filter((t) => ['REFUND', 'CREDIT'].includes(t.type)).reduce((s, t) => s + Number(t.amount), 0);
      const pay = payments.reduce((s, p) => s + Number(p.amount), 0);
      const closing = Number(body.closingBalance || 0);
      const difference = Number((Number(body.openingBalance || 0) + charges - credits - pay - closing).toFixed(2));
      await prisma.creditCardStatement.create({ data: { companyId, cardAccountId: id, periodStart: start, periodEnd: send, openingBalance: Number(body.openingBalance || 0), charges, credits, payments: pay, closingBalance: closing, fees: 0, dueDate: body.dueDate ? new Date(body.dueDate) : undefined, status: Math.abs(difference) < 0.01 ? 'RECONCILED' : 'OPEN' } });
      if (Math.abs(difference) > 0.01) throw new BadRequestException(`Reconciliation difference: ${difference.toFixed(2)}. Statement remains OPEN.`);
    });
    await this.audit.log(companyId, req.user.sub, 'RECONCILIATION_COMPLETED', 'CreditCardAccount', id);
    return { ok: true, cleared: txns.length };
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('credit-cards/reports/:kind') async cardReports(@Req() req: any, @Param('kind') kind: string) {
    const companyId = companyIdOf(req.user);
    const txns = await this.prisma.creditCardTransaction.findMany({ where: { companyId, status: 'POSTED' }, include: { cardAccount: true, allocations: true } });
    const agg: Record<string, any> = {};
    if (kind === 'by-account' || kind === 'spend-by-account') {
      for (const t of txns) { for (const a of (t.allocations || [])) { if (!a.accountId) continue; const acc = await this.prisma.ledgerAccount.findFirst({ where: { id: a.accountId } }); const k = acc?.name || a.accountId; const r = (agg[k] ||= { key: k, total: 0, count: 0 }); r.total += Number(a.amount); r.count += 1; } }
      return Object.values(agg).map((r: any) => ({ ...r, total: Number(r.total.toFixed(2)) })).sort((a: any, b: any) => b.total - a.total);
    }
    if (kind === 'by-vendor' || kind === 'spend-by-vendor') {
      for (const t of txns) { if (!t.vendor) continue; const k = t.vendor; const r = (agg[k] ||= { vendor: k, count: 0, charges: 0, credits: 0, lastTransaction: null }); const delta = ['CHARGE', 'FEE', 'INTEREST'].includes(t.type) ? Number(t.amount) : -Number(t.amount); r.count += 1; if (delta > 0) r.charges += delta; else r.credits += -delta; if (!r.lastTransaction || t.date > r.lastTransaction) r.lastTransaction = t.date; }
      return Object.values(agg).map((r: any) => ({ ...r, charges: Number(r.charges.toFixed(2)), credits: Number(r.credits.toFixed(2)), net: Number((r.charges - r.credits).toFixed(2)) }));
    }
    if (kind === 'by-project' || kind === 'spend-by-project') {
      for (const t of txns) { if (!t.projectId) continue; const k = t.projectId; const r = (agg[k] ||= { projectId: k, count: 0, spend: 0, tax: 0 }); r.count += 1; r.spend += Number(t.subtotal || 0); r.tax += Number(t.taxAmount || 0); }
      return Object.values(agg).map((r: any) => ({ ...r, spend: Number(r.spend.toFixed(2)), tax: Number(r.tax.toFixed(2)) }));
    }
    if (kind === 'missing-receipts') return txns.filter((t) => t.receiptStatus === 'MISSING' && ['CHARGE', 'FEE', 'INTEREST'].includes(t.type)).map((t) => ({ id: t.id, date: t.date, card: t.cardAccount?.name, vendor: t.vendor, amount: Number(t.amount), daysOutstanding: Math.floor((Date.now() - new Date(t.date).getTime()) / 86400000) }));
    return [];
  }

  // ----- Budget control -----
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.budget.manage')
  @Get('budget-control') budgetRules(@Req() req: any) {
    return this.prisma.budgetControlRule.findMany({ where: { companyId: companyIdOf(req.user) }, include: { account: true }, orderBy: { id: 'asc' } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.budget.manage')
  @Post('budget-control') async createBudgetRule(@Req() req: any, @Body() body: any) {
    const companyId = companyIdOf(req.user);
    return this.prisma.budgetControlRule.create({ data: { companyId, accountId: body.accountId, departmentId: body.departmentId, projectId: body.projectId, mode: body.mode || 'INFORMATION_ONLY', active: body.active ?? true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.budget.manage')
  @Get('budget-control/evaluate') async evaluate(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const accountId = q.accountId;
    const amount = Number(q.amount || 0);
    const year = new Date().getFullYear();
    const budgets = await this.prisma.budget.findMany({ where: { companyId, accountId, fiscalYear: year } });
    const lines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED' }, accountId } });
    const actual = Number(lines.reduce((s, l) => s + (Number(l.debit) - Number(l.credit)), 0).toFixed(2));
    const budget = Number(budgets.reduce((s, b) => s + Number(b.amount), 0).toFixed(2));
    const remaining = budget - actual - amount;
    const rule = await this.prisma.budgetControlRule.findFirst({ where: { companyId, accountId, active: true } });
    return { budget, actual, committed: amount, remaining: Number(remaining.toFixed(2)), mode: rule?.mode || 'INFORMATION_ONLY', exceeded: remaining < 0 };
  }

  // ----- Currencies & exchange rates -----
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('currencies') currencies(@Req() req: any) { return this.prisma.currency.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: { code: 'asc' } }); }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('currencies') async createCurrency(@Req() req: any, @Body() body: any) {
    return this.prisma.currency.create({ data: { companyId: companyIdOf(req.user), code: body.code, name: body.name, symbol: body.symbol, active: body.active ?? true } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('exchange-rates') rates(@Req() req: any) { return this.prisma.exchangeRate.findMany({ where: { companyId: companyIdOf(req.user) }, orderBy: { effectiveDate: 'desc' } }); }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Post('exchange-rates') async createRate(@Req() req: any, @Body() body: any) {
    return this.prisma.exchangeRate.create({ data: { companyId: companyIdOf(req.user), fromCurrency: body.fromCurrency, toCurrency: body.toCurrency || 'USD', rate: Number(body.rate), effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : new Date(), source: body.source || 'MANUAL' } });
  }
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.bank.manage')
  @Get('resolve-rate/:currency') async resolveRate(@Req() req: any, @Param('currency') currency: string) {
    const companyId = companyIdOf(req.user);
    const r = await this.prisma.exchangeRate.findFirst({ where: { companyId, fromCurrency: currency, toCurrency: 'USD' }, orderBy: { effectiveDate: 'desc' } });
    return { rate: Number(r?.rate || 1) };
  }

  // ----- VAT report -----
  @UseGuards(PermissionsGuard) @RequirePermissions('finance.tax.manage')
  @Get('tax/vat-report') async vatReport(@Req() req: any, @Query() q: any) {
    const companyId = companyIdOf(req.user);
    const { from, to } = q;
    const fromD = from ? new Date(from) : undefined;
    const toD = to ? new Date(to) : undefined;
    const lines = await this.prisma.journalLine.findMany({ where: { journal: { companyId, status: 'POSTED' }, account: { code: '2100' } }, include: { journal: true } });
    let outputVAT = 0, inputVAT = 0;
    for (const l of lines) {
      const d = l.journal.date;
      if (fromD && d < fromD) continue;
      if (toD && d > toD) continue;
      if (Number(l.credit) > 0) outputVAT += Number(l.credit);
      else inputVAT += Number(l.debit);
    }
    const salesWhere: any = { companyId, status: { in: ['POSTED', 'PART_PAID', 'PAID'] } };
    if (fromD || toD) salesWhere.invoiceDate = {}; if (fromD) salesWhere.invoiceDate.gte = fromD; if (toD) salesWhere.invoiceDate.lte = toD;
    const purchasesWhere: any = { companyId }; if (fromD || toD) purchasesWhere.invoiceDate = {}; if (fromD) purchasesWhere.invoiceDate.gte = fromD; if (toD) purchasesWhere.invoiceDate.lte = toD;
    const sales = await this.prisma.salesInvoice.findMany({ where: salesWhere });
    const purchases = await this.prisma.supplierInvoice.findMany({ where: purchasesWhere });
    const taxableSales = sales.reduce((s, i) => s + Number(i.total), 0);
    const taxablePurchases = purchases.reduce((s, i) => s + Number(i.total), 0);
    return { outputVAT: Number(outputVAT.toFixed(2)), inputVAT: Number(inputVAT.toFixed(2)), netVAT: Number((outputVAT - inputVAT).toFixed(2)), taxableSales: Number(taxableSales.toFixed(2)), taxablePurchases: Number(taxablePurchases.toFixed(2)) };
  }
}