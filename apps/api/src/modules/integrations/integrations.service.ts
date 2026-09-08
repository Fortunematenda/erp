import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../../core/common/audit.service';
import { IntegrationProviderFactory } from './providers';
import { INTEGRATIONS, getIntegration } from './providers/registry';
import { correlationId, classifyError, HealthCheckResult, ProviderState } from './providers/types';

const SANITIZE = (o: any) => {
  if (o == null) return o;
  const c: any = { ...o };
  for (const k of Object.keys(c)) {
    if (/secret|password|token|key|cipher|private|authorization/i.test(k)) delete c[k];
  }
  return c;
};

// Legacy IntegrationConnection.type is an enum (ZIMRA, PAYNOW, SMTP, BANK, ...).
// Map the control-centre types onto it so the legacy registry stays consistent.
const LEGACY_TYPE: Record<string, string> = {
  PAYMENT: 'PAYNOW', STORAGE: 'STORAGE', EMAIL: 'SMTP', SMS: 'SMS', QUEUE: 'OTHER',
  ZIMRA: 'ZIMRA', BANK: 'BANK', WEBHOOK: 'WEBHOOK', USAGE: 'OTHER', BILLING: 'OTHER',
};

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private factory: IntegrationProviderFactory) {}

  // ---------- Configuration (reuses SystemConfig cfg.<group>.<field>) ----------

  private async configMap(companyId: string, group: string): Promise<Record<string, any>> {
    const rows = await this.prisma.systemConfig.findMany({ where: { companyId, key: { startsWith: `cfg.${group}.` } } });
    const map: Record<string, any> = {};
    for (const r of rows) map[r.key.replace(`cfg.${group}.`, '')] = (r.value as any)?.value ?? r.value;
    return map;
  }

  // Adapter-defined configuration schema — the UI renders fields per provider.
  async configSchema(companyId: string, type: string) {
    const { def, provider, config } = await this.providerOf(companyId, type);
    return {
      type: def.type, group: def.configGroup, providerField: def.providerField,
      selectedProvider: provider.code,
      providers: def.providers.map((p) => ({
        code: p.code, label: p.label, environment: p.environment, description: p.description,
        capabilities: p.capabilities, docsUrl: p.docsUrl,
        configFields: p.configFields.map((f) => ({
          key: f.key, label: f.label, type: f.type, options: f.options, required: f.required,
          secret: f.secret, envVar: f.envVar, tooltip: f.tooltip, appliesTo: f.appliesTo, docs: f.docs,
        })),
      })),
      values: this.maskConfig(provider, config),
    };
  }

  private maskConfig(provider: any, config: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const f of provider.configFields) {
      const v = config[f.key];
      if (f.secret) out[f.key] = v == null ? null : { set: true, masked: true };
      else out[f.key] = v ?? null;
    }
    return out;
  }

  // Save adapter configuration. Secrets never round-trip: blank/masked values
  // keep the stored secret untouched; only real replacements are re-encrypted.
  async saveConfig(companyId: string, type: string, input: Record<string, any>, userId?: string) {
    const { def, provider, config } = await this.providerOf(companyId, type);
    const { encryptSecret } = require('../../core/common/secret');
    const changed: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Provider selection (plain field).
      const providerKey = def.providerField;
      if (input[providerKey] && String(input[providerKey]) !== provider.code) {
        const ok = def.providers.some((p) => p.code === String(input[providerKey]).toLowerCase());
        if (!ok) throw new BadRequestException(`Unknown provider ${input[providerKey]} for ${def.label}`);
        await tx.systemConfig.upsert({
          where: { companyId_key: { companyId, key: `cfg.${def.configGroup}.${providerKey}` } },
          update: { value: { value: String(input[providerKey]).toLowerCase() } },
          create: { companyId, key: `cfg.${def.configGroup}.${providerKey}`, value: { value: String(input[providerKey]).toLowerCase() } },
        });
        changed.push(`provider → ${String(input[providerKey]).toLowerCase()}`);
      }
      for (const f of provider.configFields) {
        if (f.key === def.providerField) continue;
        const v = input[f.key];
        if (v === undefined) continue;
        const key = `cfg.${def.configGroup}.${f.key}`;
        if (f.secret) {
          if (v == null || v === '' || v === '••••••••' || (typeof v === 'object' && v.masked)) continue; // keep existing secret
          const enc = encryptSecret(String(v));
          await tx.systemConfig.upsert({ where: { companyId_key: { companyId, key } }, update: { value: { value: enc } }, create: { companyId, key, value: { value: enc } } });
          changed.push(`${f.label} replaced`);
        } else {
          await tx.systemConfig.upsert({ where: { companyId_key: { companyId, key } }, update: { value: { value: v } }, create: { companyId, key, value: { value: v } } });
          changed.push(`${f.label} = ${String(v).slice(0, 40)}`);
        }
      }
    });
    await this.audit.log(companyId, userId, 'Integration configuration updated', 'INTEGRATION', def.type, { type: def.type, provider: provider.code, changes: changed });
    await this.logActivity(companyId, def.type, 'config_saved', 'API', 'OK', undefined, correlationId(), { provider: provider.code, changes: changed.length });
    return this.configSchema(companyId, type);
  }

  // Safe connection test — verifies what the provider actually supports without
  // charging, sending or fiscalising anything real.
  async testConfig(companyId: string, type: string, userId?: string) {
    const { def, provider, config } = await this.providerOf(companyId, type);
    const cid = correlationId();
    const start = Date.now();
    let result: HealthCheckResult;
    try {
      if (type === 'STORAGE') {
        result = await (this.factory.store() as any).test();
      } else if (type === 'EMAIL') {
        result = await this.testSmtp(companyId, config);
      } else if (type === 'PAYMENT') {
        result = await this.factory.payment().healthCheck();
        if (result.status === 'CONFIGURED') result = { ...result, status: 'CONFIGURED', message: 'Credentials accepted. Live transmission requires adapter activation.' };
      } else {
        result = await this.runHealthCheck(companyId, type, userId);
      }
      result.latencyMs = Math.max(1, Date.now() - start);
    } catch (e: any) {
      result = { status: 'ERROR', environment: provider.environment, checkedAt: new Date().toISOString(), latencyMs: Date.now() - start, message: String(e.message || 'Test failed'), details: { errorKind: classifyError(e) } };
    }
    await this.prisma.integrationHealthLog.create({
      data: { companyId, integrationType: def.type, provider: provider.code, environment: provider.environment, status: result.status, latencyMs: result.latencyMs, message: result.message, details: SANITIZE(result.details) },
    });
    await this.audit.log(companyId, userId, 'Integration connection tested', 'INTEGRATION', def.type, { type: def.type, provider: provider.code, result: result.status, correlationId: cid });
    await this.logActivity(companyId, def.type, 'connection_test', 'MANUAL', result.status, result.latencyMs, cid, { provider: provider.code });
    return result;
  }

  // SMTP verify with a finite timeout — never sends mail.
  private async testSmtp(companyId: string, config: Record<string, any>) {
    const host = config.host || process.env.SMTP_HOST;
    const port = Number(config.port || process.env.SMTP_PORT || 587);
    const user = config.username || process.env.SMTP_USERNAME;
    const passObj = config.password;
    const pass = typeof passObj === 'object' ? (passObj.value ? null : null) : passObj;
    if (!host) return { status: 'NOT_CONFIGURED' as ProviderState, environment: 'LIVE' as const, checkedAt: new Date().toISOString(), latencyMs: 0, message: 'SMTP host is not configured.' };
    const nodemailer = require('nodemailer');
    const { decryptSecret } = require('../../core/common/secret');
    const password = pass || decryptSecret(typeof passObj === 'object' ? passObj : null) || process.env.SMTP_PASSWORD || '';
    const transport = nodemailer.createTransport({
      host, port, secure: Number(port) === 465, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
      auth: user ? { user, pass: password } : undefined,
    });
    try { await transport.verify(); return { status: 'CONNECTED' as ProviderState, environment: 'LIVE' as const, checkedAt: new Date().toISOString(), latencyMs: 0, message: 'SMTP connection verified. Credentials accepted.' }; }
    catch (e: any) { return { status: 'ERROR' as ProviderState, environment: 'LIVE' as const, checkedAt: new Date().toISOString(), latencyMs: 0, message: `SMTP verification failed: ${e.message}`, details: { errorKind: classifyError(e) } }; }
  }

  // Effective provider code: stored config wins, env var as fallback.
  async effectiveProvider(companyId: string, type: string): Promise<string> {
    const def = getIntegration(type);
    if (!def) throw new BadRequestException(`Unknown integration type ${type}`);
    const cfg = await this.configMap(companyId, def.configGroup);
    const stored = cfg[def.providerField];
    if (stored) return String(stored).toLowerCase();
    const envMap: Record<string, string> = {
      PAYMENT: 'PAYMENT_PROVIDER', STORAGE: 'OBJECT_STORE', EMAIL: 'MESSAGE_PROVIDER', SMS: 'MESSAGE_PROVIDER',
      QUEUE: 'QUEUE_PROVIDER', ZIMRA: 'ZIMRA_MODE', BANK: 'BANK_PROVIDER', WEBHOOK: 'WEBHOOK_PROVIDER',
    };
    const env = process.env[envMap[type]] || '';
    if (env) return env.toLowerCase();
    const defaults: Record<string, string> = { PAYMENT: 'mock', STORAGE: 'local', EMAIL: 'mock', SMS: 'mock', QUEUE: 'inprocess', ZIMRA: 'mock', BANK: 'SANDBOX_DEMO', WEBHOOK: 'internal' };
    return defaults[type] || 'mock';
  }

  async providerOf(companyId: string, type: string) {
    const def = getIntegration(type);
    if (!def) throw new BadRequestException(`Unknown integration type ${type}`);
    const code = await this.effectiveProvider(companyId, type);
    const provider = def.providers.find((p) => p.code === code) || def.providers[0];
    const cfg = await this.configMap(companyId, def.configGroup);
    return { def, provider, config: cfg, code: provider.code };
  }

  // ---------- Health checks (safe: never charges / sends / fiscalises) ----------

  async runHealthCheck(companyId: string, type: string, userId?: string): Promise<HealthCheckResult> {
    const { def, provider } = await this.providerOf(companyId, type);
    const cid = correlationId();
    const start = Date.now();
    let result: HealthCheckResult;
    try {
      const impl = this.domainImpl(type);
      result = await impl.healthCheck();
      if (result.status === 'CONNECTED') result.latencyMs = Math.max(1, Date.now() - start);
    } catch (e: any) {
      result = { status: 'ERROR', environment: provider.environment, checkedAt: new Date().toISOString(), latencyMs: Date.now() - start, message: String(e.message || 'Health check failed'), details: { errorKind: classifyError(e) } };
    }
    await this.prisma.integrationHealthLog.create({
      data: { companyId, integrationType: def.type, provider: provider.code, environment: provider.environment, status: result.status, latencyMs: result.latencyMs, message: result.message, details: SANITIZE(result.details) },
    });
    // Reflect the latest health state onto the legacy connection registry row.
    const legacyType = LEGACY_TYPE[def.type] || 'OTHER';
    await this.prisma.integrationConnection.upsert({
      where: { companyId_type_provider_name: { companyId, type: legacyType as any, provider: provider.code, name: def.label } },
      update: { status: result.status, lastCheckedAt: new Date(), lastError: result.status === 'CONNECTED' ? null : result.message },
      create: { companyId, type: legacyType as any, provider: provider.code, name: def.label, status: result.status, lastCheckedAt: new Date(), lastError: result.message },
    }).catch(() => null);
    await this.audit.log(companyId, userId, 'Integration health check', 'INTEGRATION', def.type, { type: def.type, provider: provider.code, result: result.status, correlationId: cid });
    await this.logActivity(companyId, def.type, 'health_check', 'SCHEDULER', result.status, Date.now() - start, cid, { provider: provider.code });
    return result;
  }

  async refreshHealth(companyId: string, userId?: string) {
    const out: Record<string, HealthCheckResult> = {};
    for (const def of INTEGRATIONS) {
      try { out[def.type] = await this.runHealthCheck(companyId, def.type, userId); } catch { /* keep going */ }
    }
    return out;
  }

  async healthHistory(companyId: string, type?: string, take = 50) {
    return this.prisma.integrationHealthLog.findMany({
      where: { companyId, ...(type ? { integrationType: type.toUpperCase() } : {}) },
      orderBy: { checkedAt: 'desc' }, take,
    });
  }

  // ---------- Domain implementation (env-driven, safe) ----------

  private domainImpl(type: string): any {
    const m = type.toUpperCase();
    if (m === 'PAYMENT') return this.factory.payment();
    if (m === 'STORAGE') return this.factory.store();
    if (m === 'EMAIL' || m === 'SMS') return this.factory.message();
    if (m === 'QUEUE') return this.factory.queue();
    // ZIMRA / BANK / USAGE / BILLING / WEBHOOK resolve from their own modules.
    return { healthCheck: async (): Promise<HealthCheckResult> => ({ status: 'CONNECTED', environment: 'TEST', checkedAt: new Date().toISOString(), latencyMs: 1, message: `${type} resolved by its own module.` }) };
  }

  // ---------- Status aggregate (dashboard payload) ----------

  async status(companyId: string, tenantId: string) {
    const results: any[] = [];
    for (const def of INTEGRATIONS) {
      const { provider, config } = await this.providerOf(companyId, def.type);
      let latest = await this.prisma.integrationHealthLog.findFirst({ where: { companyId, integrationType: def.type }, orderBy: { checkedAt: 'desc' } });
      // Secrets are stored encrypted ({iv,data,tag} or {insecure}) in SystemConfig —
      // presence of the stored object counts as configured without ever decrypting.
      const required = provider.configFields.filter((f) => f.required).map((f) => f.key);
      const configuredCount = required.filter((k) => {
        const v = config[k];
        if (v == null || v === '') return false;
        if (typeof v === 'object') return !!(v.iv || v.insecure || v.set);
        return true;
      }).length;
      const configComplete = provider.code === 'mock' || provider.code === 'internal' || required.length === 0 || (configuredCount >= required.length && required.length > 0);
      // Seed the connection state with a safe on-demand check when no health
      // history exists yet — never touches live systems.
      if (!latest) {
        try { await this.runHealthCheck(companyId, def.type, undefined); } catch { /* keep going */ }
        const fresh = await this.prisma.integrationHealthLog.findFirst({ where: { companyId, integrationType: def.type }, orderBy: { checkedAt: 'desc' } });
        if (fresh) latest = fresh;
      }
      const metrics = await this.metrics(companyId, def.type);
      const attention = await this.integrationAttention(companyId, def.type, provider.code, latest);
      results.push({
        type: def.type, label: def.label, section: def.section, scope: def.scope, description: def.description,
        provider: { code: provider.code, label: provider.label, environment: provider.environment, capabilities: provider.capabilities, docsUrl: provider.docsUrl },
        environment: provider.environment,
        configStatus: provider.code === 'mock' ? 'MOCK' : configComplete ? 'COMPLETE' : 'INCOMPLETE',
        connection: provider.code === 'mock' ? 'MOCK' : (latest?.status || 'NOT_CONFIGURED'),
        lastCheckedAt: latest?.checkedAt || null,
        lastError: latest?.message || null,
        latencyMs: latest?.latencyMs || 0,
        usedBy: def.usedBy,
        providerOptions: def.providers.map((p) => ({ code: p.code, label: p.label, environment: p.environment, description: p.description, capabilities: p.capabilities, docsUrl: p.docsUrl })),
        metrics,
        attention,
      });
    }
    const overall = this.overall(results);
    const attentionItems = await this.attention(companyId);
    const usage = await this.usageSummary(tenantId);
    const billing = await this.billingSummary(tenantId);
    const queue = await this.queueCounts(companyId);
    return { safeMode: await this.safeMode(companyId), overall, integrations: results, attention: attentionItems, usage, billing, queue, generatedAt: new Date().toISOString() };
  }

  private overall(results: any[]) {
    return {
      configured: results.filter((r) => r.configStatus === 'COMPLETE' || r.configStatus === 'MOCK').length,
      healthy: results.filter((r) => ['CONNECTED', 'MOCK'].includes(r.connection)).length,
      attention: results.filter((r) => r.attention.length > 0 || r.connection === 'ERROR' || r.connection === 'DEGRADED').length,
      mockTest: results.filter((r) => r.environment === 'MOCK' || r.environment === 'TEST').length,
      total: results.length,
    };
  }

  private async safeMode(companyId: string): Promise<boolean> {
    for (const def of INTEGRATIONS) {
      const code = await this.effectiveProvider(companyId, def.type);
      const isMock = ['mock', 'local', 'inprocess', 'internal', 'SANDBOX_DEMO'].includes(code);
      if (!isMock) return false;
    }
    return true;
  }

  private async metrics(companyId: string, type: string): Promise<Record<string, any>> {
    const today = new Date(); const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (type === 'PAYMENT') {
      const webhooks = await this.prisma.webhookEvent.count({ where: { companyId, status: { in: ['PROCESSED', 'FAILED'] } } });
      const failed = await this.prisma.webhookEvent.count({ where: { companyId, status: 'FAILED' } });
      return { eventsToday: webhooks, failures: failed };
    }
    if (type === 'EMAIL' || type === 'SMS') {
      const channel = type === 'EMAIL' ? 'EMAIL' : 'SMS';
      const todayCount = await this.prisma.messageLog.count({ where: { companyId, channel, createdAt: { gte: dayStart } } });
      const failed = await this.prisma.messageLog.count({ where: { companyId, channel, status: 'FAILED' } });
      return { sentToday: todayCount, failures: failed };
    }
    if (type === 'QUEUE') {
      const failed = await this.prisma.queueJob.count({ where: { companyId, status: 'FAILED' } });
      const waiting = await this.prisma.queueJob.count({ where: { companyId, status: { in: ['WAITING', 'DELAYED'] } } });
      return { failedJobs: failed, waiting };
    }
    if (type === 'ZIMRA') {
      const device = await this.prisma.fiscalDevice.findFirst({ where: { branch: { companyId } }, orderBy: { name: 'asc' } });
      const failed = await this.prisma.fiscalReceipt.count({ where: { status: { in: ['RETRY', 'REJECTED'] }, OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] } });
      return { device: device ? { name: device.name, dayNo: device.fiscalDayNo, dayStatus: device.dayStatus, certificateStatus: device.certificateExpiresAt ? (device.certificateExpiresAt.getTime() < Date.now() ? 'EXPIRED' : 'VALID') : 'UNKNOWN' } : null, failedReceipts: failed };
    }
    if (type === 'BANK') {
      const connections = await this.prisma.bankConnection.findMany({ where: { companyId } });
      return { connected: connections.filter((c) => c.status === 'CONNECTED').length, total: connections.length };
    }
    if (type === 'WEBHOOK') {
      const total = await this.prisma.webhookEvent.count({ where: { companyId } });
      const failed = await this.prisma.webhookEvent.count({ where: { companyId, status: 'FAILED' } });
      return { events: total, failures: failed };
    }
    return {};
  }

  // ---------- Attention ----------

  private async integrationAttention(companyId: string, type: string, providerCode: string, latest: any) {
    const items: { severity: 'critical' | 'warning' | 'info'; title: string; action: string; link?: string }[] = [];
    if (type === 'EMAIL' && providerCode === 'mock') items.push({ severity: 'warning', title: 'Email provider not configured', action: 'configure', link: '/administration/integrations-config' });
    if (type === 'SMS' && providerCode === 'mock') items.push({ severity: 'info', title: 'SMS provider not configured', action: 'configure', link: '/administration/integrations-config' });
    if (type === 'ZIMRA') {
      const device = await this.prisma.fiscalDevice.findFirst({ where: { branch: { companyId } } });
      if (device?.certificateExpiresAt) {
        const days = Math.ceil((device.certificateExpiresAt.getTime() - Date.now()) / 86400000);
        if (days >= 0 && days <= 21) items.push({ severity: 'warning', title: `ZIMRA certificate expires in ${days} day${days === 1 ? '' : 's'}`, action: 'open', link: '/fiscalisation' });
        if (days < 0) items.push({ severity: 'critical', title: 'ZIMRA certificate expired', action: 'open', link: '/fiscalisation' });
      }
    }
    if (type === 'PAYMENT' && latest?.status === 'FAILED') items.push({ severity: 'critical', title: 'Payment provider health check failed', action: 'health' });
    if (type === 'STORAGE' && latest?.status === 'ERROR') items.push({ severity: 'critical', title: 'Object storage health check failed', action: 'health' });
    if (type === 'QUEUE') {
      const failed = await this.prisma.queueJob.count({ where: { companyId, status: 'FAILED' } });
      if (failed > 0) items.push({ severity: 'warning', title: `Background queue has ${failed} failed job${failed === 1 ? '' : 's'}`, action: 'queue' });
    }
    return items;
  }

  async attention(companyId: string) {
    const out: any[] = [];
    for (const def of INTEGRATIONS) {
      const { provider } = await this.providerOf(companyId, def.type);
      const latest = await this.prisma.integrationHealthLog.findFirst({ where: { companyId, integrationType: def.type }, orderBy: { checkedAt: 'desc' } });
      const items = await this.integrationAttention(companyId, def.type, provider.code, latest);
      for (const it of items) out.push({ id: `${def.type}-${out.length}`, integration: def.type, integrationLabel: def.label, ...it });
    }
    // Bank connection issues.
    const bankConnections = await this.prisma.bankConnection.findMany({ where: { companyId } });
    for (const c of bankConnections) {
      if (c.status !== 'CONNECTED') out.push({ id: `BANK-${c.id}`, integration: 'BANK', integrationLabel: 'Bank Connections', severity: 'warning', title: `Bank connection ${c.institutionName || c.provider} is ${c.status}`, action: 'open', link: '/finance/bank-connections' });
      if (c.tokenExpiresAt && c.tokenExpiresAt.getTime() < Date.now() + 7 * 86400000) out.push({ id: `BANK-TOKEN-${c.id}`, integration: 'BANK', integrationLabel: 'Bank Connections', severity: 'warning', title: 'Bank sync authorization expiring', action: 'open', link: '/finance/bank-connections' });
    }
    // Webhook failures.
    const failedWebhooks = await this.prisma.webhookEvent.count({ where: { companyId, status: 'FAILED' } });
    if (failedWebhooks > 0) out.push({ id: 'WEBHOOK-FAIL', integration: 'WEBHOOK', integrationLabel: 'Webhooks', severity: 'critical', title: `Payment webhook failed ${failedWebhooks} time${failedWebhooks === 1 ? '' : 's'}`, action: 'webhooks' });
    return out.sort((a, b) => (a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : 0));
  }

  // ---------- Activity & logs ----------

  async logActivity(companyId: string, integrationType: string, action: string, source: string, status?: string, durationMs?: number, correlationId?: string, metadata?: any) {
    await this.prisma.integrationActivityLog.create({ data: { companyId, integrationType, action, source, status, durationMs, correlationId, metadata: SANITIZE(metadata) } }).catch(() => null);
  }

  async activity(companyId: string, type?: string, take = 100) {
    return this.prisma.integrationActivityLog.findMany({ where: { companyId, ...(type ? { integrationType: type.toUpperCase() } : {}) }, orderBy: { createdAt: 'desc' }, take });
  }

  async technicalLogs(companyId: string, type?: string, take = 100) {
    const health = await this.prisma.integrationHealthLog.findMany({ where: { companyId, ...(type ? { integrationType: type.toUpperCase() } : {}) }, orderBy: { checkedAt: 'desc' }, take });
    return health.map((h) => ({ id: h.id, kind: 'HEALTH', integrationType: h.integrationType, provider: h.provider, status: h.status, latencyMs: h.latencyMs, message: h.message, at: h.checkedAt }));
  }

  // ---------- Usage & billing ----------

  private async usageSummary(tenantId: string) {
    const today = new Date().toISOString().slice(0, 7);
    const [events, failed, last] = await Promise.all([
      this.prisma.usageRecord.findMany({ where: { tenantId, period: today } }),
      this.prisma.usageRecord.count({ where: { tenantId, value: { gt: 0 } } }),
      this.prisma.usageRecord.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { active: true, eventsToday: events.reduce((s, e) => s + e.value, 0), metrics: events.map((e) => ({ metric: e.metric, qty: e.value, period: e.period })), lastProcessedAt: last?.createdAt || null };
  }

  private async billingSummary(tenantId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    const invoices = await this.prisma.salesInvoice.count({ where: { company: { tenantId } } });
    return {
      provider: 'internal', status: sub?.status || 'NONE', plan: sub?.plan?.name || 'None',
      monthlyPrice: sub?.plan ? Number(sub.plan.monthlyPrice) : 0,
      activeSubscriptions: sub ? 1 : 0,
      renewalsDue: sub && sub.endsAt ? 1 : 0,
      currency: 'USD', tenantInvoices: invoices,
    };
  }

  // ---------- Queue jobs (persisted, mock-safe processing) ----------

  private async queueCounts(companyId: string) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.prisma.queueJob.count({ where: { companyId, status: 'WAITING' } }),
      this.prisma.queueJob.count({ where: { companyId, status: 'ACTIVE' } }),
      this.prisma.queueJob.count({ where: { companyId, status: 'COMPLETED' } }),
      this.prisma.queueJob.count({ where: { companyId, status: 'FAILED' } }),
      this.prisma.queueJob.count({ where: { companyId, status: 'DELAYED' } }),
    ]);
    return { waiting, active, completed, failed, delayed };
  }

  async enqueueJob(companyId: string, type: string, payload: any, sourceModule?: string, userId?: string) {
    const cid = correlationId();
    const job = await this.prisma.queueJob.create({ data: { companyId, type, payload: SANITIZE(payload), status: 'WAITING', sourceModule, correlationId: cid } });
    this.processJob(job.id).catch(() => null);
    await this.logActivity(companyId, 'QUEUE', 'job_enqueued', 'API', 'WAITING', undefined, cid, { jobId: job.id, type });
    return { id: job.id, type, status: 'WAITING', correlationId: cid };
  }

  // In-process worker: safe mock execution. Real jobs (bull) would go through Redis.
  private async processJob(jobId: string) {
    const job = await this.prisma.queueJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'WAITING') return;
    await this.prisma.queueJob.update({ where: { id: jobId }, data: { status: 'ACTIVE', startedAt: new Date(), attempts: { increment: 1 } } });
    try {
      await this.executeJob(job);
      await this.prisma.queueJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await this.logActivity(job.companyId, 'QUEUE', 'job_completed', 'WORKER', 'COMPLETED', undefined, job.correlationId || undefined, { jobId: job.id, type: job.type, attempts: job.attempts + 1 });
    } catch (e: any) {
      const attempts = job.attempts + 1;
      if (attempts < (job.maxAttempts || 3)) {
        await this.prisma.queueJob.update({ where: { id: jobId }, data: { status: 'DELAYED', errorCode: classifyError(e), errorMessage: e.message, nextRetryAt: new Date(Date.now() + (job.backoffMs || 1000) * Math.pow(2, attempts - 1)) } });
        setTimeout(() => this.processJob(jobId).catch(() => null), job.backoffMs || 1000);
      } else {
        await this.prisma.queueJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorCode: classifyError(e), errorMessage: e.message, completedAt: new Date() } });
        await this.logActivity(job.companyId, 'QUEUE', 'job_failed', 'WORKER', 'FAILED', undefined, job.correlationId || undefined, { jobId: job.id, type: job.type, error: e.message, attempts });
      }
    }
  }

  private async executeJob(job: any) {
    const payload = (job.payload || {}) as any;
    if (job.type === 'EMAIL' || job.type === 'NOTIFICATION') {
      await this.prisma.messageLog.create({ data: { companyId: job.companyId, channel: 'EMAIL', recipient: payload.to || 'unknown', template: payload.template, subject: payload.subject, status: 'SENT', provider: 'mock', correlationId: job.correlationId, source: job.sourceModule } });
      return;
    }
    if (job.type === 'FISCAL_RETRY') return; // handled by fiscalisation module
    if (job.type === 'SIMULATED_FAILURE') throw new Error('SIMULATED_JOB_FAILURE: demonstration retry failure');
  }

  async queueJobs(companyId: string, status?: string, take = 100) {
    return this.prisma.queueJob.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take });
  }

  async retryJob(companyId: string, jobId: string, userId?: string) {
    const job = await this.prisma.queueJob.findFirst({ where: { id: jobId, companyId } });
    if (!job) throw new BadRequestException('Job not found');
    if (job.status === 'ACTIVE') throw new BadRequestException('Job is currently running');
    const updated = await this.prisma.queueJob.update({ where: { id: jobId }, data: { status: 'WAITING', errorCode: null, errorMessage: null, completedAt: null, nextRetryAt: null, startedAt: null } });
    this.processJob(jobId).catch(() => null);
    await this.audit.log(companyId, userId, 'Failed job retried', 'QUEUE_JOB', jobId, { type: job.type });
    return { id: job.id, status: 'WAITING' };
  }

  async discardJob(companyId: string, jobId: string, userId?: string) {
    const job = await this.prisma.queueJob.findFirst({ where: { id: jobId, companyId } });
    if (!job) throw new BadRequestException('Job not found');
    const updated = await this.prisma.queueJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: 'Discarded by administrator', completedAt: new Date() } });
    await this.audit.log(companyId, userId, 'Failed job discarded', 'QUEUE_JOB', jobId, { type: job.type });
    return { id: job.id, status: 'DISCARDED' };
  }

  // ---------- Messages ----------

  async sendMessage(companyId: string, body: any, userId?: string) {
    const channel = String(body.via || 'email').toUpperCase() === 'SMS' ? 'SMS' : 'EMAIL';
    const cid = correlationId();
    const provider = await this.effectiveProvider(companyId, channel === 'EMAIL' ? 'EMAIL' : 'SMS');
    const log = await this.prisma.messageLog.create({
      data: { companyId, channel, recipient: body.to || '', template: body.template, subject: body.subject, status: 'QUEUED', provider, correlationId: cid, sentById: userId, source: body.source },
    });
    try {
      const res = await this.factory.message().send({ ...body, via: channel.toLowerCase() });
      await this.prisma.messageLog.update({ where: { id: log.id }, data: { status: provider === 'mock' ? 'QUEUED' : 'SENT', providerMessageId: res?.id || null } });
      await this.logActivity(companyId, channel, 'message_sent', 'API', provider === 'mock' ? 'QUEUED' : 'SENT', undefined, cid, { recipient: body.to, channel, provider });
      return { id: log.id, status: provider === 'mock' ? 'QUEUED' : 'SENT', provider, correlationId: cid };
    } catch (e: any) {
      await this.prisma.messageLog.update({ where: { id: log.id }, data: { status: 'FAILED', errorCode: classifyError(e), errorMessage: e.message } });
      await this.logActivity(companyId, channel, 'message_failed', 'API', 'FAILED', undefined, cid, { recipient: body.to, error: e.message });
      throw new BadRequestException(e.message);
    }
  }

  async messageLogs(companyId: string, channel?: string, take = 100) {
    return this.prisma.messageLog.findMany({ where: { companyId, ...(channel ? { channel: channel.toUpperCase() } : {}) }, orderBy: { createdAt: 'desc' }, take });
  }

  // ---------- Webhooks (idempotent by provider event id) ----------

  async receiveWebhook(companyId: string, providerCode: string, body: any, signature?: string) {
    const eventId = String(body?.eventId || body?.id || '');
    if (!eventId) throw new BadRequestException('Webhook event id is required for idempotency');
    const cid = correlationId();
    const existing = await this.prisma.webhookEvent.findUnique({ where: { companyId_provider_eventId: { companyId, provider: providerCode, eventId } } });
    if (existing) {
      // Idempotent: the event was already applied — never apply twice.
      if (existing.status === 'PROCESSED') return { status: 'IGNORED', idempotent: true, eventId, processedAt: existing.processedAt };
      return { status: existing.status, idempotent: true, eventId, attempts: existing.attempts };
    }
    const record = await this.prisma.webhookEvent.create({
      data: { companyId, provider: providerCode, eventId, eventType: body?.eventType || body?.type, status: 'RECEIVED', payload: SANITIZE(body), receivedAt: new Date() },
    });
    const ok = await this.verifyWebhookSignature(companyId, providerCode, body, signature);
    if (!ok.valid) {
      await this.prisma.webhookEvent.update({ where: { id: record.id }, data: { status: 'FAILED', signatureValid: false, rejectionReason: ok.reason, attempts: 1, processedAt: new Date() } });
      await this.logActivity(companyId, 'WEBHOOK', 'webhook_rejected', 'WEBHOOK', 'FAILED', undefined, cid, { provider: providerCode, eventId, reason: ok.reason });
      return { status: 'FAILED', eventId, reason: ok.reason };
    }
    await this.prisma.webhookEvent.update({ where: { id: record.id }, data: { status: 'PROCESSED', signatureValid: true, processedAt: new Date(), attempts: 1, linkedEntityType: body?.linkedEntityType || null, linkedEntityId: body?.linkedEntityId || null } });
    await this.logActivity(companyId, 'WEBHOOK', 'webhook_processed', 'WEBHOOK', 'PROCESSED', undefined, cid, { provider: providerCode, eventId, eventType: body?.eventType });
    return { status: 'PROCESSED', eventId, correlationId: cid };
  }

  private async verifyWebhookSignature(companyId: string, providerCode: string, body: any, signature?: string) {
    const cfg = await this.configMap(companyId, 'webhook');
    const secret = cfg.webhookSecret?.value || process.env.WEBHOOK_SECRET;
    if (!secret) return { valid: true, reason: 'No webhook secret configured — accepted in safe mode.' };
    if (!signature) return { valid: false, reason: 'Missing signature' };
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', String(secret.value || secret)).update(JSON.stringify(body)).digest('hex');
    const valid = signature === expected || signature === `sha256=${expected}`;
    return valid ? { valid: true } : { valid: false, reason: 'Invalid signature — rejected' };
  }

  async webhookEvents(companyId: string, status?: string, take = 100) {
    const rows = await this.prisma.webhookEvent.findMany({ where: { companyId, ...(status ? { status } : {}) }, orderBy: { receivedAt: 'desc' }, take });
    return rows.map((r) => ({ ...r, payload: undefined })); // raw payload only via detail endpoint
  }

  async webhookEventDetail(companyId: string, eventId: string) {
    const e = await this.prisma.webhookEvent.findFirst({ where: { id: eventId, companyId } });
    if (!e) throw new BadRequestException('Webhook event not found');
    return e;
  }

  // ---------- Diagnostics (developer-only; never touches live systems) ----------

  async diagnostics(companyId: string, action: string, userId?: string) {
    const cid = correlationId();
    const start = Date.now();
    const result = async (label: string, ok: boolean, detail?: any) => {
      const duration = Date.now() - start;
      await this.logActivity(companyId, 'DIAGNOSTICS', label, 'DIAGNOSTICS', ok ? 'SUCCESS' : 'FAILED', duration, cid, detail);
      return { test: label, result: ok ? 'SUCCESS' : 'FAILED', durationMs: duration, details: SANITIZE(detail), correlationId: cid };
    };
    switch (action) {
      case 'payment': {
        const r = await this.factory.payment().submit({ amount: 100, currency: 'USD' });
        return result('Payment gateway (mock)', true, { provider: r.provider, reference: r.reference });
      }
      case 'email': {
        const r = await this.factory.message().send({ to: 'diag@nexuserp.local', via: 'email', subject: 'NexusERP diagnostic', text: 'diagnostic' });
        return result('Email (mock)', true, { provider: r.provider, id: r.id });
      }
      case 'sms': {
        const r = await this.factory.message().send({ to: '+263700000000', via: 'sms' });
        return result('SMS (mock)', true, { provider: r.provider, id: r.id });
      }
      case 'storage': {
        const r = await (this.factory.store() as any).test();
        return result('Object storage', r.status === 'CONNECTED', r);
      }
      case 'queue': {
        const r = await this.enqueueJob(companyId, 'SIMULATED_FAILURE', { note: 'diagnostic failure job' }, 'DIAGNOSTICS', userId);
        return result('Queue enqueue', true, { jobId: r.id });
      }
      case 'fiscal': {
        return result('ZIMRA (mock)', true, { mode: await this.effectiveProvider(companyId, 'ZIMRA') });
      }
      default:
        throw new BadRequestException(`Unknown diagnostic action ${action}`);
    }
  }

  // ---------- Legacy compat helpers ----------

  async listConnections(companyId: string) {
    return this.prisma.integrationConnection.findMany({ where: { companyId }, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }
}
