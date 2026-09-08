import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { PermissionService } from '../auth/permission.service';
import { NumberingService } from '../../core/common/numbering.service';
import { randomToken, sha256 } from '../../core/common/totp';
import * as bcrypt from 'bcryptjs';
import type { RequestUser } from '../../core/context';
import type { AccessScope, UserStatus, MembershipStatus } from '@prisma/client';
const ROLE_LEVELS: Record<string, number> = {
  PLATFORM_SUPER_ADMIN: 100,
  SUPER_ADMIN: 90,
  'Company Administrator': 90,
  ADMIN: 80,
  'Finance Manager': 70,
  'Sales Manager': 70,
  'HR Manager': 70,
  'Procurement Manager': 70,
  'Inventory Manager': 70,
  MANAGER: 60,
  'Accounts Payable Clerk': 50,
  'Accounts Receivable Clerk': 50,
  'Procurement Officer': 50,
  'Sales Clerk': 50,
  'Warehouse Clerk': 40,
  'Payroll Officer': 40,
  ACCOUNTANT: 40,
  VIEWER: 10,
  'Read Only': 10,
};
const DEFAULT_ROLE_LEVEL = 30;

export function roleLevel(role?: string | null): number {
  if (!role) return DEFAULT_ROLE_LEVEL;
  const up = String(role).toUpperCase();
  for (const [k, v] of Object.entries(ROLE_LEVELS)) if (k.toUpperCase() === up) return v;
  // Heuristic fallback so DB-configured roles still sort sensibly.
  if (up.includes('ADMIN') || up.includes('SUPER')) return 80;
  if (up.includes('MANAGER')) return 60;
  if (up.includes('VIEW') || up.includes('READ')) return 10;
  return DEFAULT_ROLE_LEVEL;
}

const PLATFORM_ROLES = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN'];
const COMPANY_WIDE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'Company Administrator'];

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private permissions: PermissionService,
    private numbering: NumberingService,
  ) {}

  // ================= Dashboard =================
  async dashboard(companyId: string) {
    const [activeUsers, branches, auditToday, invited, inactive] = await Promise.all([
      this.prisma.membership.count({ where: { companyId, status: 'ACTIVE', user: { status: 'ACTIVE' } } }),
      this.prisma.branch.count({ where: { companyId, active: true } }),
      this.prisma.auditLog.count({ where: { companyId, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
      this.prisma.membership.count({ where: { companyId, user: { status: 'INVITED' } } }),
      this.prisma.membership.count({ where: { companyId, status: 'ACTIVE', user: { status: { in: ['INACTIVE', 'SUSPENDED', 'LOCKED'] } } } }),
    ]);
    const attention = await this.attentionItems(companyId);
    const reviews = await this.accessReviews(companyId);
    return {
      kpis: {
        activeUsers, branches, invited,
        attentionCount: attention.length,
        reviewCount: reviews.length,
        auditToday,
        inactiveUsers: inactive,
      },
      attention,
      reviews,
    };
  }

  // ================= Users =================
  async listUsers(companyId: string, f: any = {}) {
    const where: any = { companyId, status: f.membershipStatus || undefined };
    if (f.userId) where.userId = f.userId;
    if (f.role) where.role = f.role;
    if (f.accessScope) where.accessScope = f.accessScope;
    if (f.primaryBranchId) where.primaryBranchId = f.primaryBranchId;
    const rows = await this.prisma.membership.findMany({
      where,
      include: {
        user: { include: { employee: { include: { department: true } } } },
        primaryBranch: true,
        branches: { include: { branch: true } },
      },
      orderBy: { effectiveFrom: 'desc' },
      take: 500,
    });
    let out = rows.map((m: any) => this.userRow(m));
    if (f.search) {
      const q = String(f.search).toLowerCase();
      out = out.filter((u: any) =>
        [u.name, u.email, u.employeeNo, u.department, u.role, u.branchLabel].some((v) => v && String(v).toLowerCase().includes(q)));
    }
    if (f.status) out = out.filter((u: any) => u.status === f.status);
    if (f.department) out = out.filter((u: any) => u.departmentId === f.department);
    return out;
  }

  private userRow(m: any) {
    const u = m.user || m;
    const emp = u.employee;
    return {
      membershipId: m.id,
      userId: u.id,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || (emp ? `${emp.firstName} ${emp.lastName}` : ''),
      email: u.email,
      employeeId: emp?.id || null,
      employeeNo: emp?.employeeNo || null,
      department: emp?.department?.name || null,
      departmentId: emp?.departmentId || null,
      jobTitle: emp?.position || null,
      companyName: m.company?.tradingName || m.company?.legalName || null,
      role: m.role,
      roleLevel: roleLevel(m.role),
      accessScope: m.accessScope,
      primaryBranchId: m.primaryBranchId,
      primaryBranch: m.primaryBranch?.name || null,
      branchLabel: m.primaryBranch?.name || (m.accessScope === 'COMPANY_WIDE' ? 'Company Wide' : m.accessScope === 'PLATFORM_WIDE' ? 'Platform Wide' : null),
      additionalBranches: (m.branches || []).map((b: any) => b.branch.name),
      status: u.status,
      isPlatformAdmin: u.isPlatformAdmin,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      membershipStatus: m.status,
      effectiveFrom: m.effectiveFrom,
    };
  }

  /** Data needed to render the Add-User drawer: eligible employees, roles, branches, departments. */
  async userOptions(companyId: string) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId, active: true },
      include: { department: true, user: true },
      orderBy: [{ firstName: 'asc' }],
      take: 300,
    });
    const branches = await this.prisma.branch.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } });
    const roles = await this.prisma.role.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
    const departments = await this.prisma.department.findMany({ where: { branch: { companyId } }, orderBy: { name: 'asc' } });
    return {
      employees: employees.map((e: any) => ({
        id: e.id, employeeNo: e.employeeNo, name: `${e.firstName} ${e.lastName}`.trim(),
        email: e.workEmail || e.email, department: e.department?.name || null, jobTitle: e.position || null,
        hasUser: !!e.user, userStatus: e.user?.status || null, userId: e.user?.id || null,
        branch: e.department?.branch?.name || null, branchId: e.department?.branchId || null,
        active: e.active,
      })),
      branches: branches.map((b: any) => ({ id: b.id, name: b.name, code: b.code })),
      roles: roles.map((r: any) => ({ name: r.name, description: r.description })),
      departments,
    };
  }

  async createUser(actor: RequestUser, dto: any) {
    const isPlatformTarget = dto.isPlatformAdmin || PLATFORM_ROLES.includes(String(dto.role || '').toUpperCase());
    if (isPlatformTarget && !actor.isPlatformAdmin) throw new ForbiddenException('Only a platform administrator can create platform accounts.');

    // Resolve company context: platform admins must pass one, normal users use their session.
    const companyId = isPlatformTarget ? (dto.companyId || actor.companyId) : dto.companyId || actor.companyId;
    if (!companyId) throw new BadRequestException('Company context required.');
    const tenant = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tenantId: true } });
    if (!tenant) throw new NotFoundException('Company not found');
    const tenantId = tenant.tenantId;

    // Employee-first: normal users must come from an Employee master record.
    let email = dto.email ? String(dto.email).toLowerCase().trim() : null;
    let employeeId: string | null = null;
    let empFirstName = '';
    let empLastName = '';
    if (!isPlatformTarget) {
      if (!dto.employeeId) throw new BadRequestException('An employee must be selected to create a user account.');
      const emp = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId, active: true } });
      if (!emp) throw new BadRequestException('Employee not found or inactive in this company.');
      const existing = await this.prisma.user.findUnique({ where: { employeeId: emp.id } });
      if (existing) throw new BadRequestException(`This employee already has a user account (${existing.status}).`);
      email = email || (emp.workEmail || emp.email || '').toLowerCase() || null;
      if (!email) throw new BadRequestException('This employee does not have a work email address.');
      employeeId = emp.id;
      empFirstName = emp.firstName;
      empLastName = emp.lastName;
    } else {
      if (!email) throw new BadRequestException('Email is required for platform accounts.');
    }

    // Role / scope / branch validation
    const role = dto.role || (dto.isPlatformAdmin ? 'PLATFORM_SUPER_ADMIN' : 'VIEWER');
    const level = roleLevel(role);
    if (!actor.isPlatformAdmin && level > roleLevel(actor.role || '')) throw new ForbiddenException('You cannot assign a role above your own authority.');

    const scope = (dto.accessScope || (level >= 80 ? 'COMPANY_WIDE' : 'SINGLE_BRANCH')) as AccessScope;
    if (scope === 'PLATFORM_WIDE' && !isPlatformTarget) throw new BadRequestException('PLATFORM_WIDE scope is reserved for platform accounts.');
    if (!isPlatformTarget) {
      // Role determines what a user can do; scope/branch determines where.
      // Company-wide access is reserved for admin-tier roles.
      if (level < 80 && scope === 'COMPANY_WIDE') throw new BadRequestException('This role requires branch-level access scope.');
      if (scope !== 'COMPANY_WIDE' && !dto.primaryBranchId) throw new BadRequestException('A primary branch is required for this role.');
      if (level >= 80 && scope === 'SINGLE_BRANCH' && !dto.primaryBranchId) throw new BadRequestException('A primary branch is required for this role.');
    }

    const passwordHash = await bcrypt.hash(dto.password || randomToken(20), 12);
    const status = (dto.status || (dto.sendInvitation ? 'INVITED' : 'ACTIVE')) as UserStatus;
    const user = await this.prisma.user.create({
      data: {
        email, passwordHash,
        firstName: dto.firstName || empFirstName || email.split('@')[0] || '',
        lastName: dto.lastName || empLastName || '',
        status, isPlatformAdmin: !!isPlatformTarget, employeeId,
      },
    });

    const membership = await this.prisma.membership.create({
      data: {
        userId: user.id, tenantId, companyId,
        role, accessScope: scope, primaryBranchId: dto.primaryBranchId || null,
        status: 'ACTIVE' as MembershipStatus,
      },
    });
    if (dto.additionalBranchIds?.length) {
      await this.prisma.membershipBranch.createMany({
        data: dto.additionalBranchIds.filter((b: string) => b !== dto.primaryBranchId).map((branchId: string) => ({ membershipId: membership.id, branchId })),
        skipDuplicates: true,
      });
    }
    await this.permissions.ensureCompanyRoles(companyId);
    await this.permissions.assignRoleToMembership(membership.id, role);

    // Invitation: issue a one-time set-password token (dev returns it directly).
    let inviteToken: string | undefined;
    if (status === 'INVITED' || dto.sendInvitation) {
      inviteToken = await this.issueInviteToken(user.id);
    }

    await this.audit.log(companyId, actor.sub, 'USER_CREATED', 'User', user.id, {
      module: 'admin', result: 'SUCCESS', reason: dto.reason,
      metadata: { email: user.email, role, accessScope: scope, primaryBranchId: dto.primaryBranchId, employeeId },
    });
    return { user: { id: user.id, email: user.email, status: user.status, isPlatformAdmin: user.isPlatformAdmin }, membershipId: membership.id, inviteToken };
  }

  async userDetail(companyId: string, userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: { include: { department: true } },
        memberships: {
          where: { companyId },
          include: { primaryBranch: true, branches: { include: { branch: true } }, company: true },
        },
      },
    });
    if (!u) throw new NotFoundException('User not found');
    const m = u.memberships[0];
    const sessions = await this.prisma.refreshToken.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 50 });
    const audit = await this.prisma.auditLog.findMany({ where: { userId, companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const permissions = m ? await this.permissions.getPermissions({ sub: userId, companyId }) : [];
    return {
      ...this.userRow({ ...m, user: u }),
      employee: u.employee ? {
        id: u.employee.id, employeeNo: u.employee.employeeNo, name: `${u.employee.firstName} ${u.employee.lastName}`.trim(),
        department: u.employee.department?.name || null, jobTitle: u.employee.position || null,
        workEmail: u.employee.workEmail || u.employee.email, active: u.employee.active,
        hireDate: u.employee.hireDate,
      } : null,
      mfaEnabled: (await this.prisma.mfaMethod.findFirst({ where: { userId, method: 'TOTP' } }))?.verified === true,
      permissions,
      sessions: sessions.map((s: any) => ({ id: s.id, userAgent: s.userAgent, createdAt: s.createdAt, expiresAt: s.expiresAt })),
      audit: audit.map((entry: any) => ({ ...entry, metadata: this.scrub(entry.metadata) })),
    };
  }

  async updateUserStatus(actor: RequestUser, companyId: string, userId: string, dto: any) {
    const membership = await this.prisma.membership.findFirst({ where: { userId, companyId } });
    if (!membership) throw new NotFoundException('User not in company');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const target = dto.status;
    if (target === 'ACTIVE') {
      // Restore eligibility, keep memberships/role/branches untouched.
      await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE', deactivatedAt: null, deactivationReason: null } });
      await this.audit.log(companyId, actor.sub, 'USER_ACTIVATED', 'User', userId, { module: 'admin', result: 'SUCCESS', reason: dto.reason, metadata: { email: user.email } });
      return { ok: true, status: 'ACTIVE' };
    }
    if (target === 'INACTIVE' || target === 'SUSPENDED' || target === 'LOCKED') {
      // Protections
      if (userId === actor.sub) throw new ForbiddenException('You cannot deactivate your own account while using it.');
      if (user.isPlatformAdmin) {
        const platformAdmins = await this.prisma.user.count({ where: { isPlatformAdmin: true, status: 'ACTIVE' } });
        if (platformAdmins <= 1) throw new ForbiddenException('At least one active platform administrator is required.');
      } else {
        const isSuper = COMPANY_WIDE_ROLES.map((r) => r.toUpperCase()).includes(String(membership.role).toUpperCase());
        // Last-admin protection only applies when the target is currently an
        // active admin — deactivating an INVITED/SUSPENDED account is safe.
        if (isSuper && user.status === 'ACTIVE') {
          const superCount = await this.prisma.membership.count({
            where: { companyId, status: 'ACTIVE', role: { in: COMPANY_WIDE_ROLES }, user: { status: 'ACTIVE' } },
          });
          if (superCount <= 1) throw new ForbiddenException('At least one active Super Admin is required for this company.');
        }
        const actorIsSuper = COMPANY_WIDE_ROLES.map((r) => r.toUpperCase()).includes(String(actor.role || '').toUpperCase());
        if (roleLevel(membership.role) > roleLevel(actor.role || '') && !actorIsSuper) {
          throw new ForbiddenException('You cannot deactivate a user with a higher role than your own.');
        }
      }
      await this.prisma.user.update({ where: { id: userId }, data: { status: target, deactivatedAt: new Date(), deactivationReason: dto.reason || null } });
      // Revoke sessions where supported.
      await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(companyId, actor.sub, target === 'INACTIVE' ? 'USER_DEACTIVATED' : 'USER_SUSPENDED', 'User', userId, {
        module: 'admin', result: 'SUCCESS', reason: dto.reason, metadata: { email: user.email, status: target },
      });
      return { ok: true, status: target, sessionsRevoked: true };
    }
    throw new BadRequestException('Unsupported status transition');
  }

  async updateUserAccess(actor: RequestUser, companyId: string, userId: string, dto: any) {
    const membership = await this.prisma.membership.findFirst({ where: { userId, companyId } });
    if (!membership) throw new NotFoundException('User not in company');

    const newRole = dto.role ?? membership.role;
    const newScope = (dto.accessScope ?? membership.accessScope) as AccessScope;
    if (roleLevel(newRole) > roleLevel(actor.role || '')) throw new ForbiddenException('You cannot assign a role above your own authority.');
    if (newScope === 'PLATFORM_WIDE') throw new ForbiddenException('Platform scope cannot be assigned from company administration.');

    const isPlatformTarget = PLATFORM_ROLES.includes(String(newRole).toUpperCase());
    if (isPlatformTarget && !actor.isPlatformAdmin) throw new ForbiddenException('Only a platform administrator can assign platform roles.');

    const level = roleLevel(newRole);
    if (level < 80 && !dto.primaryBranchId && newScope !== 'COMPANY_WIDE') {
      throw new BadRequestException('A primary branch is required for this role.');
    }

    const before = {
      role: membership.role, accessScope: membership.accessScope,
      primaryBranchId: membership.primaryBranchId,
      branches: (await this.prisma.membershipBranch.findMany({ where: { membershipId: membership.id }, include: { branch: true } })).map((b: any) => b.branch.name),
    };
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { role: newRole, accessScope: newScope, primaryBranchId: dto.primaryBranchId ?? (level >= 80 && newScope === 'COMPANY_WIDE' ? null : membership.primaryBranchId) },
      });
      await tx.membershipBranch.deleteMany({ where: { membershipId: membership.id } });
      const branchIds = [...(dto.additionalBranchIds || []), ...(newScope === 'COMPANY_WIDE' ? [] : dto.primaryBranchId ? [dto.primaryBranchId] : [])]
        .filter((b: string, i: number, arr: string[]) => arr.indexOf(b) === i);
      if (branchIds.length) await tx.membershipBranch.createMany({ data: branchIds.map((branchId: string) => ({ membershipId: membership.id, branchId })), skipDuplicates: true });
      return tx.membership.findUnique({ where: { id: membership.id }, include: { user: true, primaryBranch: true, branches: { include: { branch: true } } } });
    });
    await this.permissions.ensureCompanyRoles(companyId);
    await this.permissions.assignRoleToMembership(membership.id, newRole);

    const after = {
      role: newRole, accessScope: newScope, primaryBranchId: updated!.primaryBranchId,
      branches: updated!.branches.map((b: any) => b.branch.name),
    };
    await this.audit.log(companyId, actor.sub, 'USER_ACCESS_CHANGED', 'User', userId, {
      module: 'admin', result: 'SUCCESS', reason: dto.reason,
      metadata: { email: updated!.user.email, before, after },
    });
    return { ok: true, membership: this.userRow(updated) };
  }

  async resendInvitation(actor: RequestUser, companyId: string, userId: string) {
    const membership = await this.prisma.membership.findFirst({ where: { userId, companyId } });
    if (!membership) throw new NotFoundException('User not in company');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'INVITED' && user.status !== 'ACTIVE') throw new BadRequestException(`Resend invitation is only available for INVITED accounts (current: ${user.status}).`);
    const token = await this.issueInviteToken(userId);
    await this.prisma.user.update({ where: { id: userId }, data: user.status === 'INVITED' ? {} : { status: 'INVITED' } });
    await this.audit.log(companyId, actor.sub, 'INVITATION_SENT', 'User', userId, { module: 'admin', result: 'SUCCESS', metadata: { email: user.email } });
    return { ok: true, inviteToken: token };
  }

  async revokeSessions(actor: RequestUser, companyId: string, userId: string, dto: any) {
    const membership = await this.prisma.membership.findFirst({ where: { userId, companyId } });
    if (!membership) throw new NotFoundException('User not in company');
    if (dto?.sessionId) {
      await this.prisma.refreshToken.updateMany({ where: { id: dto.sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    } else {
      await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log(companyId, actor.sub, 'SESSIONS_REVOKED', 'User', userId, { module: 'admin', result: 'SUCCESS', reason: dto?.reason, metadata: { sessionId: dto?.sessionId || 'all' } });
    return { ok: true };
  }

  // ================= Memberships =================
  async listMemberships(companyId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { companyId },
      include: { user: { include: { employee: true } }, primaryBranch: true, branches: { include: { branch: true } }, company: true },
      orderBy: { effectiveFrom: 'desc' },
      take: 500,
    });
    return rows.map((m: any) => ({
      id: m.id, userId: m.userId, email: m.user.email,
      userName: `${m.user.firstName} ${m.user.lastName}`.trim(),
      employeeNo: m.user.employee?.employeeNo || null,
      company: m.company.tradingName || m.company.legalName,
      role: m.role, accessScope: m.accessScope,
      primaryBranch: m.primaryBranch?.name || null,
      branches: m.branches.map((b: any) => b.branch.name),
      status: m.status, effectiveFrom: m.effectiveFrom, userStatus: m.user.status,
    }));
  }

  async createMembership(actor: RequestUser, dto: any) {
    const companyId = dto.companyId || actor.companyId;
    if (!companyId) throw new BadRequestException('Company context required.');
    const tenant = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tenantId: true } });
    if (!tenant) throw new NotFoundException('Company not found');

    let user: any;
    if (dto.userId) {
      user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    } else if (dto.employeeId) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: dto.employeeId, companyId, active: true },
        include: { user: true },
      });
      if (!employee) throw new BadRequestException('Employee not found or inactive in this company.');
      if (!employee.user) throw new BadRequestException('Create the employee-linked user account before adding a membership.');
      user = employee.user;
    } else if (dto.email) {
      user = await this.prisma.user.findUnique({ where: { email: String(dto.email).toLowerCase() } });
      if (!user) throw new BadRequestException('The user account does not exist. Create it from an employee first.');
    } else {
      throw new BadRequestException('userId or email is required');
    }

    const role = dto.role || 'Read Only';
    if (roleLevel(role) > roleLevel(actor.role || '')) throw new ForbiddenException('You cannot assign a role above your own authority.');
    const scope = (dto.accessScope || (roleLevel(role) >= 80 ? 'COMPANY_WIDE' : 'SINGLE_BRANCH')) as AccessScope;
    if (roleLevel(role) < 80 && !dto.primaryBranchId && scope !== 'COMPANY_WIDE') throw new BadRequestException('A primary branch is required for this role.');

    const membership = await this.prisma.membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      update: { role, accessScope: scope, primaryBranchId: dto.primaryBranchId || null },
      create: { userId: user.id, tenantId: tenant.tenantId, companyId, role, accessScope: scope, primaryBranchId: dto.primaryBranchId || null },
    });
    if (dto.additionalBranchIds?.length) {
      await this.prisma.membershipBranch.createMany({ data: dto.additionalBranchIds.filter((b: string) => b !== dto.primaryBranchId).map((branchId: string) => ({ membershipId: membership.id, branchId })), skipDuplicates: true });
    }
    await this.permissions.ensureCompanyRoles(companyId);
    await this.permissions.assignRoleToMembership(membership.id, role);
    await this.audit.log(companyId, actor.sub, 'MEMBERSHIP_CHANGED', 'Membership', membership.id, { module: 'admin', result: 'SUCCESS', reason: dto.reason, metadata: { email: user.email, role, scope } });
    return membership;
  }

  async updateMembership(actor: RequestUser, companyId: string, id: string, dto: any) {
    const m = await this.prisma.membership.findFirst({ where: { id, companyId } });
    if (!m) throw new NotFoundException('Membership not found');
    const role = dto.role ?? m.role;
    if (roleLevel(role) > roleLevel(actor.role || '')) throw new ForbiddenException('You cannot assign a role above your own authority.');
    if (dto.status && m.status === 'ACTIVE' && roleLevel(role) >= 80) {
      const supers = await this.prisma.membership.count({ where: { companyId, status: 'ACTIVE', role: { in: COMPANY_WIDE_ROLES } } });
      if (supers <= 1) throw new ForbiddenException('At least one active Super Admin is required for this company.');
    }
    await this.prisma.membership.update({ where: { id }, data: { role: dto.role, accessScope: dto.accessScope, primaryBranchId: dto.primaryBranchId, status: dto.status } });
    if (dto.additionalBranchIds) {
      await this.prisma.membershipBranch.deleteMany({ where: { membershipId: id } });
      await this.prisma.membershipBranch.createMany({ data: dto.additionalBranchIds.filter((b: string) => b !== dto.primaryBranchId).map((branchId: string) => ({ membershipId: id, branchId })), skipDuplicates: true });
    }
    await this.permissions.ensureCompanyRoles(companyId);
    await this.permissions.assignRoleToMembership(id, role);
    await this.audit.log(companyId, actor.sub, 'MEMBERSHIP_CHANGED', 'Membership', id, { module: 'admin', result: 'SUCCESS', reason: dto.reason, metadata: { role, accessScope: dto.accessScope, status: dto.status } });
    return { ok: true };
  }

  async deactivateMembership(actor: RequestUser, companyId: string, id: string, dto: any) {
    const m = await this.prisma.membership.findFirst({ where: { id, companyId } });
    if (!m) throw new NotFoundException('Membership not found');
    if (m.status === 'ACTIVE' && COMPANY_WIDE_ROLES.map((r) => r.toUpperCase()).includes(String(m.role).toUpperCase())) {
      const supers = await this.prisma.membership.count({ where: { companyId, status: 'ACTIVE', role: { in: COMPANY_WIDE_ROLES } } });
      if (supers <= 1) throw new ForbiddenException('At least one active Super Admin is required for this company.');
    }
    await this.prisma.membership.update({ where: { id }, data: { status: 'INACTIVE' as MembershipStatus } });
    await this.audit.log(companyId, actor.sub, 'MEMBERSHIP_CHANGED', 'Membership', id, { module: 'admin', result: 'SUCCESS', reason: dto?.reason, metadata: { status: 'INACTIVE' } });
    return { ok: true };
  }

  // ================= Branches =================
  async listBranches(companyId: string) {
    const branches = await this.prisma.branch.findMany({ where: { companyId }, include: { fiscalDevices: true, warehouses: true, departments: { include: { employees: { select: { id: true } } } } }, orderBy: { name: 'asc' } });
    const rows = await Promise.all(branches.map(async (b: any) => {
      const users = await this.prisma.membership.count({ where: { companyId, OR: [{ primaryBranchId: b.id }, { branches: { some: { branchId: b.id } } }] } });
      return {
        id: b.id, name: b.name, code: b.code, companyId,
        location: [b.city, b.province, b.country].filter(Boolean).join(', ') || null,
        manager: b.managerName || null, active: b.active,
        users, warehouses: b.warehouses.length, fiscalDevices: b.fiscalDevices.length,
        employees: b.departments.reduce((n: number, d: any) => n + d.employees.length, 0),
        defaultCurrency: b.defaultCurrency, timezone: b.timezone,
        createdAt: b.createdAt,
      };
    }));
    return rows;
  }

  async createBranch(actor: RequestUser, companyId: string, dto: any) {
    const code = (dto.code || '').trim() || await this.numbering.next(companyId, 'BR');
    const branch = await this.prisma.branch.create({ data: { companyId, name: dto.name, code, managerId: dto.managerId, managerName: dto.managerName, phone: dto.phone, email: dto.email, street: dto.street, city: dto.city, address: dto.address, province: dto.province, postalCode: dto.postalCode, country: dto.country, defaultCurrency: dto.defaultCurrency || 'USD', timezone: dto.timezone, active: dto.active ?? true } });
    await this.audit.log(companyId, actor.sub, 'BRANCH_CREATED', 'Branch', branch.id, { module: 'admin', result: 'SUCCESS', metadata: { code, name: branch.name } });
    return branch;
  }

  async updateBranch(actor: RequestUser, companyId: string, id: string, dto: any) {
    const exists = await this.prisma.branch.findFirst({ where: { id, companyId } });
    if (!exists) throw new NotFoundException('Branch not found');
    const branch = await this.prisma.branch.update({ where: { id }, data: { name: dto.name, managerId: dto.managerId, managerName: dto.managerName, phone: dto.phone, email: dto.email, street: dto.street, city: dto.city, address: dto.address, province: dto.province, postalCode: dto.postalCode, country: dto.country, defaultCurrency: dto.defaultCurrency, timezone: dto.timezone, active: dto.active } });
    await this.audit.log(companyId, actor.sub, 'BRANCH_UPDATED', 'Branch', id, { module: 'admin', result: 'SUCCESS', reason: dto?.reason, metadata: { name: branch.name } });
    return branch;
  }

  async branchDetail(companyId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, companyId }, include: { fiscalDevices: true, warehouses: true, departments: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    const users = await this.prisma.membership.findMany({
      where: { companyId, OR: [{ primaryBranchId: id }, { branches: { some: { branchId: id } } }] },
      include: { user: true, primaryBranch: true, branches: { include: { branch: true } } },
      take: 200,
    });
    const audit = await this.prisma.auditLog.findMany({ where: { companyId, branchId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
    return {
      ...branch,
      users: users.map((m: any) => ({ membershipId: m.id, userId: m.userId, name: `${m.user.firstName} ${m.user.lastName}`.trim(), email: m.user.email, role: m.role, isPrimary: m.primaryBranchId === id, status: m.user.status })),
      audit: audit.map((entry: any) => ({ ...entry, metadata: this.scrub(entry.metadata) })),
    };
  }

  async setBranchActive(actor: RequestUser, companyId: string, id: string, dto: any) {
    const branch = await this.prisma.branch.findFirst({ where: { id, companyId } });
    if (!branch) throw new NotFoundException('Branch not found');
    if (!dto.active) {
      const warnings: string[] = [];
      const [openDays, activeWarehouses, activeEmployees] = await Promise.all([
        this.prisma.fiscalDay.count({ where: { device: { branchId: id }, status: 'OPEN' } }),
        this.prisma.warehouse.count({ where: { branchId: id } }),
        this.prisma.employee.count({ where: { active: true, department: { branchId: id } } }),
      ]);
      if (openDays) warnings.push(`${openDays} open fiscal day(s)`);
      if (activeWarehouses) warnings.push(`${activeWarehouses} active warehouse(s)`);
      if (activeEmployees) warnings.push(`${activeEmployees} active employee(s)`);
      if (warnings.length) throw new BadRequestException(`Branch cannot be deactivated: ${warnings.join(', ')}.`);
    }
    const updated = await this.prisma.branch.update({ where: { id }, data: { active: dto.active } });
    await this.audit.log(companyId, actor.sub, dto.active ? 'BRANCH_ACTIVATED' : 'BRANCH_DEACTIVATED', 'Branch', id, { module: 'admin', result: 'SUCCESS', reason: dto.reason });
    return { ok: true, active: updated.active };
  }

  // ================= Audit logs =================
  /** Never expose passwords, tokens, keys or secret material in audit payloads (§50). */
  private scrub(v: any, depth = 0): any {
    if (depth > 6) return '[…]';
    if (Array.isArray(v)) return v.map((x) => this.scrub(x, depth + 1));
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, val] of Object.entries(v)) {
        if (/(password|passwd|token|secret|apikey|api_key|privatekey|private_key|authorization|credential|hash|iv\b)/i.test(k)) out[k] = '[REDACTED]';
        else out[k] = this.scrub(val, depth + 1);
      }
      return out;
    }
    return v;
  }

  async listAudit(companyId: string, f: any = {}) {
    const where: any = { companyId };
    if (f.userId) where.userId = f.userId;
    if (f.module) where.module = f.module;
    if (f.action) where.action = f.action;
    if (f.entityType) where.entityType = f.entityType;
    if (f.result) where.result = f.result;
    if (f.branchId) where.branchId = f.branchId;
    if (f.from || f.to) where.createdAt = { ...(f.from ? { gte: new Date(Number(f.from)) } : {}), ...(f.to ? { lte: new Date(Number(f.to)) } : {}) };
    const page = Number(f.page) || 1;
    const pageSize = Math.min(Number(f.pageSize) || 50, 200);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where, include: { user: { include: { employee: true } }, branch: true },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    let items = rows.map((r: any) => ({
      id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId,
      module: r.module, result: r.result, reason: r.reason, correlationId: r.correlationId,
      metadata: this.scrub(r.metadata), createdAt: r.createdAt,
      userName: r.user ? `${r.user.firstName} ${r.user.lastName}`.trim() || r.user.email : (r.userId || 'System'),
      userEmail: r.user?.email || null,
      employeeNo: r.user?.employee?.employeeNo || null,
      branch: r.branch?.name || null,
    }));
    if (f.search) {
      const q = String(f.search).toLowerCase();
      items = items.filter((r: any) => [r.action, r.entityType, r.userName, r.userEmail, r.employeeNo, r.module].some((v) => v && String(v).toLowerCase().includes(q)));
    }
    return { items, total, page, pageSize };
  }

  async auditDetail(companyId: string, id: string) {
    const row = await this.prisma.auditLog.findFirst({ where: { id, companyId }, include: { user: { include: { employee: true } }, branch: true } });
    if (!row) throw new NotFoundException('Audit event not found');
    return {
      id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId,
      module: row.module, result: row.result, reason: row.reason, correlationId: row.correlationId,
      metadata: this.scrub(row.metadata), createdAt: row.createdAt,
      userName: row.user ? `${row.user.firstName} ${row.user.lastName}`.trim() || row.user.email : (row.userId || 'System'),
      userEmail: row.user?.email || null, employeeNo: row.user?.employee?.employeeNo || null,
      branch: row.branch?.name || null,
    };
  }

  async exportAuditCsv(companyId: string, f: any = {}) {
    const { items } = await this.listAudit(companyId, { ...f, page: 1, pageSize: 2000 });
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Date', 'User', 'Employee #', 'Module', 'Action', 'Record', 'Branch', 'Result', 'Reason', 'Correlation ID'];
    const lines = items.map((r: any) => [r.createdAt?.toISOString?.() || r.createdAt, r.userName, r.employeeNo, r.module, r.action, `${r.entityType}:${r.entityId || ''}`, r.branch, r.result, r.reason, r.correlationId].map(esc).join(','));
    return [header.map(esc).join(','), ...lines].join('\n');
  }

  // ================= Access reviews =================
  async accessReviews(companyId: string) {
    const reviews: any[] = [];
    // Offboarded (inactive) employees with active user access.
    const offboarded = await this.prisma.employee.findMany({
      where: { companyId, active: false, user: { isNot: null } },
      include: { user: true },
      take: 100,
    });
    for (const e of offboarded as any[]) {
      if (e.user && e.user.status === 'ACTIVE') {
        reviews.push({
          id: `off-${e.id}`, type: 'OFFBOARDED_ACCESS', severity: 'high',
          title: `${e.firstName} ${e.lastName} was offboarded but still has active access.`,
          detail: `User status is ${e.user.status}.`, userId: e.user.id, employeeId: e.id,
          action: 'deactivate',
        });
      }
    }
    // Inactive employees without any user account.
    const noUser = await this.prisma.employee.findMany({
      where: { companyId, active: true, user: { is: null } },
      include: { department: true },
      take: 100,
    });
    for (const e of noUser as any[]) {
      reviews.push({
        id: `nou-${e.id}`, type: 'NO_USER', severity: 'medium',
        title: `${e.firstName} ${e.lastName} has no user account.`,
        detail: [e.department?.name, e.position].filter(Boolean).join(' · '),
        employeeId: e.id, action: 'create_user',
      });
    }
    // Pending invitations.
    const invited = await this.prisma.user.findMany({ where: { status: 'INVITED', memberships: { some: { companyId } } }, include: { memberships: { where: { companyId } } }, take: 100 });
    for (const u of invited as any[]) {
      reviews.push({ id: `inv-${u.id}`, type: 'PENDING_INVITE', severity: 'medium', title: `Invitation pending for ${u.email}.`, detail: 'Account has not completed identity setup.', userId: u.id, action: 'resend_invite' });
    }
    // Active users with no branch scope.
    const noBranch = await this.prisma.membership.findMany({
      where: { companyId, status: 'ACTIVE', accessScope: { not: 'COMPANY_WIDE' }, primaryBranchId: null },
      include: { user: true },
      take: 100,
    });
    for (const m of noBranch as any[]) {
      if (m.user && m.user.status === 'ACTIVE') {
        reviews.push({
          id: `nb-${m.id}`, type: 'NO_BRANCH', severity: 'high',
          title: `${m.user.firstName} ${m.user.lastName} has no branch assignment.`,
          detail: `Role ${m.role} requires a primary branch.`, userId: m.user.id, action: 'edit_access',
        });
      }
    }
    return reviews.slice(0, 200);
  }

  async attentionItems(companyId: string) {
    const reviews = await this.accessReviews(companyId);
    const items: any[] = reviews.map((r) => ({ id: r.id, type: r.type, severity: r.severity, title: r.title, detail: r.detail }));
    return items;
  }

  // ================= Config =================
  async configSchema() {
    return GROUPS;
  }

  async getConfig(companyId: string) {
    const rows = await this.prisma.systemConfig.findMany({ where: { companyId } });
    const map: Record<string, any> = {};
    for (const r of rows) map[r.key] = (r.value as any)?.value ?? r.value;
    const out: Record<string, any> = {};
    for (const g of GROUPS) {
      out[g.id] = { label: g.label, description: g.description, values: {} };
      for (const f of g.fields) {
        const key = `${g.prefix}${f.key}`;
        out[g.id].values[f.key] = f.type === 'secret' ? { set: map[key] != null } : (map[key] ?? f.default ?? null);
      }
    }
    return out;
  }

  async saveConfigGroup(actor: RequestUser, companyId: string, groupId: string, dto: any) {
    const g = GROUPS.find((x) => x.id === groupId);
    if (!g) throw new BadRequestException('Unknown configuration group');
    await this.prisma.$transaction(async (tx) => {
      for (const f of g.fields) {
        const v = dto.values?.[f.key];
        if (v === undefined || v === null) continue;
        if (f.type === 'secret') {
          if (v === '' || v?.set === true) continue; // keep existing secret
          continue;
        }
        const key = `${g.prefix}${f.key}`;
        await tx.systemConfig.upsert({
          where: { companyId_key: { companyId, key } },
          update: { value: { value: v } },
          create: { companyId, key, value: { value: v }, description: `${g.label} — ${f.label}` },
        });
      }
    });
    await this.audit.log(companyId, actor.sub, 'CONFIG_UPDATED', 'SystemConfig', groupId, { module: 'admin', result: 'SUCCESS', reason: dto.reason, metadata: { group: groupId } });
    return this.getConfig(companyId);
  }

  private async issueInviteToken(userId: string): Promise<string> {
    const token = randomToken(32);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    });
    // Mail is mocked in dev — returning the token lets local builds continue.
    return process.env.NODE_ENV === 'production' ? '' : token;
  }
}

type CfgField = { key: string; label: string; type: 'text' | 'select' | 'number' | 'toggle' | 'secret'; options?: string[]; default?: any; hint?: string };
type CfgGroup = { id: string; label: string; description: string; prefix: string; fields: CfgField[] };

const GROUPS: CfgGroup[] = [
  {
    id: 'company', label: 'Company', description: 'Company identity used on documents and in the UI.', prefix: 'pref.',
    fields: [
      { key: 'companyName', label: 'Company Name', type: 'text', hint: 'Shown on invoices, quotes and reports.' },
      { key: 'email', label: 'Company Email', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
      { key: 'currency', label: 'Default Currency', type: 'select', options: ['USD', 'ZWL', 'ZAR', 'EUR', 'GBP'], default: 'USD', hint: 'The default currency used when creating new transactions. Existing posted transactions are not converted when this setting changes.' },
      { key: 'vatDefault', label: 'Default VAT %', type: 'number', default: 15 },
      { key: 'invoiceDueDays', label: 'Invoice Due Days', type: 'number', default: 30 },
      { key: 'fiscalRequiredByDefault', label: 'Fiscalise by default', type: 'toggle', default: true, hint: 'Whether new invoices default to requiring ZIMRA fiscalisation.' },
      { key: 'pdfHeader', label: 'PDF Header', type: 'text' },
      { key: 'pdfFooter', label: 'PDF Footer', type: 'text' },
    ],
  },
  {
    id: 'userAccess', label: 'User & Access', description: 'Defaults that govern new user provisioning.', prefix: 'cfg.useraccess.',
    fields: [
      { key: 'defaultInviteStatus', label: 'Default status for new users', type: 'select', options: ['ACTIVE', 'INVITED'], default: 'INVITED' },
      { key: 'requireWorkEmail', label: 'Require work email for users', type: 'toggle', default: true, hint: 'User accounts are created from the employee work email.' },
      { key: 'allowPersonalEmail', label: 'Fall back to personal email', type: 'toggle', default: false, hint: 'If an employee has no work email, allow using the personal email for login.' },
    ],
  },
  {
    id: 'numbering', label: 'Numbering', description: 'Document numbering formats. {prefix}-{seq:000000} is the default.', prefix: 'numbering:',
    fields: [
      { key: 'INV', label: 'Invoice (INV)', type: 'text', default: '{prefix}-{seq:000000}' },
      { key: 'QT', label: 'Quotation (QT)', type: 'text', default: '{prefix}-{seq:000000}' },
      { key: 'SO', label: 'Sales Order (SO)', type: 'text', default: '{prefix}-{seq:000000}' },
      { key: 'PO', label: 'Purchase Order (PO)', type: 'text', default: '{prefix}-{seq:000000}' },
      { key: 'GRN', label: 'Goods Received (GRN)', type: 'text', default: '{prefix}-{seq:000000}' },
      { key: 'JE', label: 'Journal (JE)', type: 'text', default: '{prefix}-{seq:000000}' },
      { key: 'EMP', label: 'Employee (EMP)', type: 'text', default: '{prefix}-{seq:000000}' },
    ],
  },
  {
    id: 'finance', label: 'Finance', description: 'Accounting defaults.', prefix: 'cfg.finance.',
    fields: [
      { key: 'allowNegativeStock', label: 'Allow negative stock', type: 'toggle', default: false, hint: 'Warn or block stock movements that take quantity below zero.' },
      { key: 'requireJournalReason', label: 'Require reason on journals', type: 'toggle', default: false },
      { key: 'defaultTaxRate', label: 'Default tax rate %', type: 'number', default: 15 },
    ],
  },
  {
    id: 'sales', label: 'Sales', description: 'Sales and invoicing defaults.', prefix: 'cfg.sales.',
    fields: [
      { key: 'autoNumberInvoices', label: 'Auto-number invoices', type: 'toggle', default: true },
      { key: 'allowOversell', label: 'Allow overselling stock', type: 'toggle', default: false },
      { key: 'creditNoteRequiresApproval', label: 'Credit notes require approval', type: 'toggle', default: true },
    ],
  },
  {
    id: 'security', label: 'Security', description: 'Authentication & session policy. Applied where the local authentication provider supports it.', prefix: 'cfg.security.',
    fields: [
      { key: 'sessionTimeoutMinutes', label: 'Session timeout (minutes)', type: 'number', default: 480, hint: 'Idle session timeout for the local auth provider.' },
      { key: 'failedLoginLockout', label: 'Lockout after failed logins', type: 'number', default: 5, hint: 'Lock an account after this many consecutive failed logins (when supported).' },
      { key: 'inviteExpiryDays', label: 'Invitation expiry (days)', type: 'number', default: 7 },
      { key: 'mfaRequiredForAdmins', label: 'Require MFA for administrators', type: 'toggle', default: false, hint: 'When enabled, company administrators must set up TOTP before signing in.' },
    ],
  },
];
