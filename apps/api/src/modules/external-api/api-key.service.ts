import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { PermissionService } from '../auth/permission.service';
import { RequestUser } from '../../core/context';

export const API_KEY_SCOPES = {
  'customers:read': ['sales.customers.view', 'sales.customers.manage'],
  'customers:write': ['sales.customers.manage'],
  'invoices:read': ['sales.invoices.view', 'sales.invoices.create'],
  'invoices:write': ['sales.invoices.create'],
  'invoices:post': ['sales.invoices.post'],
  'payments:read': ['sales.receipts.view', 'sales.receipts.manage', 'sales.payments.view'],
  'payments:write': ['sales.receipts.create', 'sales.receipts.manage', 'sales.payments.create'],
} as const;

export type ApiKeyScope = keyof typeof API_KEY_SCOPES;

export interface ApiKeyContext {
  id: string;
  companyId: string;
  source: string;
  scopes: string[];
  user: RequestUser;
}

const KEY_PREFIX = 'nxk_';
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class ApiKeyService {
  constructor(private prisma: PrismaService, private permissions: PermissionService, private audit: AuditService) {}

  async create(user: RequestUser, companyId: string, input: { name: string; source: string; scopes: string[]; expiresAt?: string }) {
    const scopes = [...new Set(input.scopes)];
    const unknown = scopes.filter((s) => !(s in API_KEY_SCOPES));
    if (unknown.length) throw new BadRequestException(`Unknown scopes: ${unknown.join(', ')}`);
    // A key can never do more than the person who created it.
    for (const scope of scopes) {
      if (!(await this.permissions.hasAny(user, [...API_KEY_SCOPES[scope as ApiKeyScope]]))) {
        throw new ForbiddenException(`You do not have the permissions required to grant ${scope}`);
      }
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
      throw new BadRequestException('expiresAt must be a future date');
    }

    const prefix = KEY_PREFIX + randomBytes(6).toString('hex');
    const secret = `${prefix}_${randomBytes(32).toString('base64url')}`;
    const key = await this.prisma.apiKey.create({
      data: {
        companyId,
        name: input.name.trim(),
        source: input.source.trim().toLowerCase(),
        prefix,
        keyHash: sha256(secret).toString('hex'),
        scopes,
        createdById: user.sub,
        expiresAt,
      },
    });
    await this.audit.log(companyId, user.sub, 'API_KEY_CREATED', 'ApiKey', key.id, { module: 'integrations', metadata: { prefix, source: key.source, scopes } });
    return { ...this.present(key), key: secret };
  }

  async list(companyId: string) {
    const keys = await this.prisma.apiKey.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
    return keys.map((k) => this.present(k));
  }

  async revoke(user: RequestUser, companyId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, companyId } });
    if (!key) throw new NotFoundException('API key not found');
    if (!key.revokedAt) {
      await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.log(companyId, user.sub, 'API_KEY_REVOKED', 'ApiKey', id, { module: 'integrations', metadata: { prefix: key.prefix } });
    }
    return this.present({ ...key, revokedAt: key.revokedAt ?? new Date() });
  }

  async authenticate(secret: string): Promise<ApiKeyContext> {
    const separator = secret.startsWith(KEY_PREFIX) ? secret.indexOf('_', KEY_PREFIX.length) : -1;
    const prefix = separator > 0 ? secret.slice(0, separator) : '';
    const key = prefix ? await this.prisma.apiKey.findUnique({ where: { prefix } }) : null;
    const expected = key ? Buffer.from(key.keyHash, 'hex') : sha256('');
    const matches = timingSafeEqual(sha256(secret), expected) && !!key;
    if (!key || !matches) throw new UnauthorizedException('Invalid API key');
    if (key.revokedAt) throw new UnauthorizedException('API key has been revoked');
    if (key.expiresAt && key.expiresAt <= new Date()) throw new UnauthorizedException('API key has expired');

    // Keys act on behalf of their creator and stop working if that access is removed.
    const membership = await this.prisma.membership.findUnique({
      where: { userId_companyId: { userId: key.createdById, companyId: key.companyId } },
      include: { user: { select: { email: true, status: true } } },
    });
    if (!membership || membership.status !== 'ACTIVE' || membership.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('API key owner no longer has access to this company');
    }

    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }

    return {
      id: key.id,
      companyId: key.companyId,
      source: key.source,
      scopes: key.scopes,
      user: { sub: key.createdById, email: membership.user.email, tenantId: membership.tenantId, companyId: key.companyId, role: membership.role },
    };
  }

  async ownerStillHas(context: ApiKeyContext, scope: ApiKeyScope) {
    return this.permissions.hasAny(context.user, [...API_KEY_SCOPES[scope]]);
  }

  private present(key: { id: string; name: string; source: string; prefix: string; scopes: string[]; createdById: string; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) {
    return {
      id: key.id,
      name: key.name,
      source: key.source,
      prefix: key.prefix,
      scopes: key.scopes,
      createdById: key.createdById,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
      active: !key.revokedAt && (!key.expiresAt || key.expiresAt > new Date()),
    };
  }
}
