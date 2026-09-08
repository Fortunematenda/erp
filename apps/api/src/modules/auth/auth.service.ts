import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionService } from './permission.service';
import { AuthSecurityService } from './auth-security.service';
import * as bcrypt from 'bcryptjs';
import { randomToken, sha256 } from '../../core/common/totp';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private permissions: PermissionService, private authSec: AuthSecurityService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { memberships: { include: { company: true, tenant: true } } } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
    if (await this.authSec.requiresMfa(user.id)) return { requiresMfa: true, userId: user.id };
    return this.issueSession(user.id);
  }

  async issueSession(userId: string, preferredCompanyId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { memberships: { include: { company: true, tenant: true } } } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account disabled');
    // Track last sign-in for the Administration module (login history).
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
    const refresh = await this.persistRefresh(user.id);
    const base = { refresh_token: refresh.refresh_token, expires_at: refresh.expires_at };
    if (user.isPlatformAdmin) {
      const access = this.jwt.sign({ sub: user.id, email: user.email, isPlatformAdmin: true });
      return { token: access, ...base, user: { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}`, isPlatformAdmin: true }, companies: [], activeCompany: null, permissions: [], roles: [] };
    }
    // Use the user's active company preference if it still exists, else the first membership.
    const m = (preferredCompanyId && user.memberships.find((x) => x.companyId === preferredCompanyId)) || user.memberships[0];
    if (!m) throw new ForbiddenException('No company access');
    await this.ensureMembershipRoles(m.id, m.companyId, m.role);
    const access = this.signMembership(user.id, user.email, m.tenantId, m.companyId, m.role, false);
    // Restore RBAC together with the session so the UI never renders with zero permissions.
    const permUser = { sub: user.id, companyId: m.companyId, email: user.email };
    const [permissions, roles] = await Promise.all([this.permissions.getPermissions(permUser), this.permissions.getRoleNames(permUser)]);
    return {
      token: access, ...base,
      user: { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}`, isPlatformAdmin: false },
      companies: user.memberships.map((x) => ({ id: x.company.id, name: x.company.tradingName || x.company.legalName, tenantId: x.tenantId, role: x.role })),
      activeCompany: { id: m.companyId, name: m.company.tradingName || m.company.legalName, tenantId: m.tenantId, role: m.role },
      permissions, roles,
    };
  }

  // Restore a session from a refresh cookie: validate, rotate, return full context.
  async restoreSession(refreshToken: string, preferredCompanyId?: string) {
    const userId = await this.authSec.getUserIdFromRefresh(refreshToken);
    if (!userId) return { authenticated: false as const };
    const s = await this.issueSession(userId, preferredCompanyId);
    return { authenticated: true as const, token: s.token, refresh_token: s.refresh_token, expires_at: s.expires_at, user: s.user, companies: s.companies, activeCompany: s.activeCompany, permissions: s.permissions, roles: s.roles };
  }

  private async persistRefresh(userId: string) {
    const refresh = randomToken(48);
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const existing = await this.prisma.refreshToken.findMany({ where: { userId, revokedAt: null } });
    for (const r of existing) await this.prisma.refreshToken.update({ where: { id: r.id }, data: { revokedAt: new Date() } });
    await this.prisma.refreshToken.create({ data: { userId, token: sha256(refresh), expiresAt: expires } });
    return { refresh_token: refresh, expires_at: expires };
  }

  signMembership(userId: string, email: string, tenantId: string, companyId: string, role: string, isPlatformAdmin = false) { return this.jwt.sign({ sub: userId, email, tenantId, companyId, role, isPlatformAdmin }); }
  async switchCompany(userId: string, companyId: string, email: string) { const m = await this.prisma.membership.findUnique({ where: { userId_companyId: { userId, companyId } } }); if (!m) throw new ForbiddenException('No access to company'); await this.ensureMembershipRoles(m.id, m.companyId, m.role); return { token: this.signMembership(userId, email, m.tenantId, m.companyId, m.role) }; }
  async ensureMembershipRoles(membershipId: string, companyId: string, legacyRole: string) {
    await this.permissions.ensurePermissions();
    await this.permissions.ensureCompanyRoles(companyId);
    const existing = await this.prisma.membershipRole.findFirst({ where: { membershipId } });
    if (existing) return;
    const defaultRole = (legacyRole || 'ADMIN') === 'ADMIN' ? 'Company Administrator' : 'Read Only';
    const role = await this.prisma.role.findFirst({ where: { companyId, name: defaultRole } });
    if (role) await this.prisma.membershipRole.create({ data: { membershipId, roleId: role.id } });
  }
}
