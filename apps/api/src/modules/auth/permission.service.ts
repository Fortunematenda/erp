import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PERMISSIONS, ROLE_DEFS, expandPerms } from './permissions';

@Injectable()
export class PermissionService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensurePermissions();
    // Re-sync system roles for all existing companies so new permission codes
    // (e.g. integrations.*) reach already-provisioned tenants without a reset.
    const companies = await this.prisma.company.findMany({ select: { id: true }, take: 500 });
    for (const c of companies) {
      try { await this.ensureCompanyRoles(c.id); } catch { /* keep going */ }
    }
  }

  async ensurePermissions() {
    for (const p of PERMISSIONS) {
      await this.prisma.permission.upsert({ where: { code: p.code }, update: { name: p.name, module: p.module }, create: p });
    }
  }

  async ensureCompanyRoles(companyId: string) {
    const perms = await this.prisma.permission.findMany();
    const byCode = Object.fromEntries(perms.map((p) => [p.code, p]));
    for (const def of ROLE_DEFS) {
      const role = await this.prisma.role.upsert({
        where: { companyId_name: { companyId, name: def.name } },
        update: { description: def.description, isSystem: true },
        create: { companyId, name: def.name, description: def.description, isSystem: true },
      });
      const valid = expandPerms(def.permissions).filter((c) => byCode[c]).map((c) => byCode[c].id);
      await this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (valid.length) await this.prisma.rolePermission.createMany({ data: valid.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true });
    }
  }

  async getMembership(user: any) {
    if (!user?.companyId) return null;
    return this.prisma.membership.findUnique({
      where: { userId_companyId: { userId: user.sub, companyId: user.companyId } },
      include: { roles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
    });
  }

  async getPermissions(user: any): Promise<string[]> {
    const m = await this.getMembership(user);
    if (!m) return [];
    const set = new Set<string>();
    for (const mr of m.roles) for (const rp of mr.role.rolePermissions) set.add(rp.permission.code);
    return [...set];
  }

  async getRoleNames(user: any): Promise<string[]> {
    const m = await this.getMembership(user);
    if (!m) return [];
    return m.roles.map((r) => r.role.name);
  }

  async hasAny(user: any, required: string[]): Promise<boolean> {
    if (!required?.length) return true;
    const perms = await this.getPermissions(user);
    return required.some((r) => perms.includes(r));
  }

  async assignRoleToMembership(membershipId: string, roleName: string) {
    const memberships = await this.prisma.membershipRole.findMany({
      where: { membershipId }, include: { role: true },
    });
    await this.prisma.membershipRole.deleteMany({ where: { membershipId } });
    const membershipsByRole = await this.prisma.membership.findUnique({ where: { id: membershipId } });
    if (!membershipsByRole) return;
    const role = await this.prisma.role.findFirst({ where: { companyId: membershipsByRole.companyId, name: roleName } });
    if (role) await this.prisma.membershipRole.create({ data: { membershipId, roleId: role.id } });
  }
}
