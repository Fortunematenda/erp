import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { encryptSecret, decryptSecret, maskSecret } from '../../core/common/secret';

type Field = { key: string; label: string; type: 'text' | 'password' | 'select' | 'number' | 'textarea'; options?: string[]; secret?: boolean; envVar?: string; hint?: string; default?: any };
type Group = { id: string; label: string; description: string; fields: Field[] };

const GROUPS: Group[] = [
  {
    id: 'zimra', label: 'ZIMRA Fiscalisation', description: 'FDMS provider mode and credentials. mock is safe; test/production require official ZIMRA credentials + UAT.',
    fields: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['mock', 'test', 'production'], envVar: 'ZIMRA_MODE', hint: 'mock = safe; test/production throw until credentials are set.' },
      { key: 'baseUrl', label: 'Base URL', type: 'text', envVar: 'ZIMRA_TEST_BASE_URL' },
      { key: 'taxCode', label: 'Tax code', type: 'text' },
      { key: 'applicationKey', label: 'Application key', type: 'password', secret: true },
      { key: 'deviceCert', label: 'Device certificate (PEM)', type: 'textarea', secret: true },
      { key: 'certPassword', label: 'Certificate password', type: 'password', secret: true },
    ],
  },
  {
    id: 'payment', label: 'Payment gateway', description: 'Online payment provider. mock approves without real money; Paynow/PagoZimbabwe require credentials.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['mock', 'paynow', 'pagosep'], envVar: 'PAYMENT_PROVIDER' },
      { key: 'integrationKey', label: 'Integration key', type: 'password', secret: true },
      { key: 'merchantId', label: 'Merchant / account id', type: 'text' },
      { key: 'returnUrl', label: 'Return URL', type: 'text' },
    ],
  },
  {
    id: 'messaging', label: 'Email & SMS', description: 'Outbound email/SMS. mock queues locally; SMTP/SMS require credentials.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['mock', 'smtp', 'sms'], envVar: 'MESSAGE_PROVIDER' },
      { key: 'host', label: 'SMTP host', type: 'text' },
      { key: 'port', label: 'SMTP port', type: 'number' },
      { key: 'username', label: 'SMTP username', type: 'text' },
      { key: 'password', label: 'SMTP password', type: 'password', secret: true },
      { key: 'fromAddress', label: 'From address', type: 'text' },
      { key: 'smsApiKey', label: 'SMS API key', type: 'password', secret: true },
    ],
  },
  {
    id: 'storage', label: 'Object storage', description: 'Document/report storage. local writes to disk; S3 requires AWS credentials.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['local', 's3'], envVar: 'OBJECT_STORE' },
      { key: 'bucket', label: 'Bucket', type: 'text' },
      { key: 'region', label: 'Region', type: 'text' },
      { key: 'accessKey', label: 'Access key', type: 'password', secret: true },
      { key: 'secretKey', label: 'Secret key', type: 'password', secret: true },
    ],
  },
  {
    id: 'queue', label: 'Background queue', description: 'Worker runtime. inprocess is local & safe; Redis/BullMQ require REDIS_URL.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', options: ['inprocess', 'bull'], envVar: 'QUEUE_PROVIDER' },
      { key: 'redisUrl', label: 'Redis URL', type: 'text', secret: true, hint: 'Stored encrypted; used when provider = bull.' },
    ],
  },
  {
    id: 'security', label: 'Security & encryption', description: 'Master encryption key for secrets/backups (set via env in production; shown here for confirmation).',
    fields: [
      { key: 'encryptionKey', label: 'Master / encryption key', type: 'password', secret: true, envVar: 'ENCRYPTION_KEY', hint: 'Leave blank to keep the current key; set in env for production.' },
      { key: 'jwtSecret', label: 'JWT secret', type: 'password', secret: true, envVar: 'JWT_SECRET' },
    ],
  },
];

const secretFieldSet = (g: Group) => new Set(g.fields.filter((f) => f.secret).map((f) => f.key));

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getSchema() { return GROUPS; }

  async get(companyId: string) {
    const rows = await this.prisma.systemConfig.findMany({ where: { companyId, key: { startsWith: 'cfg.' } } });
    const map: Record<string, any> = {};
    for (const r of rows) map[r.key] = r.value as any;
    const out: Record<string, any> = {};
    for (const g of GROUPS) {
      const secrets = secretFieldSet(g);
      const values: Record<string, any> = {};
      for (const f of g.fields) {
        const stored = map[`cfg.${g.id}.${f.key}`];
        const raw = stored?.value;
        values[f.key] = f.secret ? { set: raw != null, masked: maskSecret(), insecure: raw?.insecure } : (raw ?? f.default ?? null);
      }
      out[g.id] = { label: g.label, description: g.description, values };
    }
    return out;
  }

  async saveGroup(companyId: string, groupId: string, input: Record<string, any>) {
    const g = GROUPS.find((x) => x.id === groupId);
    if (!g) throw new BadRequestException('Unknown group ' + groupId);
    const secrets = secretFieldSet(g);
    await this.prisma.$transaction(async (tx) => {
      for (const f of g.fields) {
        if (f.secret) {
          const v = input[f.key];
          if (v == null || v === '') continue; // keep existing secret
          if (v === maskSecret()) continue;
          const enc = encryptSecret(String(v));
          await tx.systemConfig.upsert({
            where: { companyId_key: { companyId, key: `cfg.${g.id}.${f.key}` } },
            update: { value: { value: enc } },
            create: { companyId, key: `cfg.${g.id}.${f.key}`, value: { value: enc }, description: `${g.label} ${f.label}` },
          });
        } else {
          if (input[f.key] === undefined) continue;
          await tx.systemConfig.upsert({
            where: { companyId_key: { companyId, key: `cfg.${g.id}.${f.key}` } },
            update: { value: { value: input[f.key] } },
            create: { companyId, key: `cfg.${g.id}.${f.key}`, value: { value: input[f.key] }, description: `${g.label} ${f.label}` },
          });
        }
      }
    });
    return this.get(companyId);
  }

  async test(companyId: string, groupId: string) {
    const g = GROUPS.find((x) => x.id === groupId);
    if (!g) throw new BadRequestException('Unknown group ' + groupId);
    const rows = await this.prisma.systemConfig.findMany({ where: { companyId, key: { startsWith: `cfg.${g.id}.` } } });
    const map: Record<string, any> = {};
    for (const r of rows) map[r.key.replace(`cfg.${g.id}.`, '')] = r.value as any;
    const envMap: Record<string, string> = {};
    for (const f of g.fields) if (f.envVar) envMap[f.key] = process.env[f.envVar] || '';
    const effective = (f: Field) => map[f.key]?.value ?? envMap[f.key] ?? '';
    const liveField = g.fields.find((f) => f.options?.includes('mock'));
    const mode = liveField ? String(effective(liveField) || 'mock') : null;
    const missingSecrets = g.fields.filter((f) => f.secret && f.options === undefined).map((f) => f.label);
    const hasRealProviders = mode && mode !== 'mock';
    return {
      group: g.id, mode: mode || 'mock', hasRealProviders: !!hasRealProviders,
      ok: true,
      message: hasRealProviders ? `${mode} mode active — live transmission requires the configured credentials to be valid.` : `${mode} mode is safe and active.`,
      warnings: missingSecrets.length ? [`Secrets not yet configured: ${missingSecrets.join(', ')}`] : [],
    };
  }
}
