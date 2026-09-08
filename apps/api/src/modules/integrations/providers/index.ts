import { ProviderEnvironment, ProviderState, HealthCheckResult } from './types';

// ---------------------------------------------------------------------------
// Domain provider contracts.
//
// Every provider exposes:
//   - healthCheck(): safe verification that never triggers charges, messages
//     or fiscal receipts. Mock providers always respond CONNECTED locally.
//   - validateConfiguration(config): per-provider required-field validation.
//
// Real providers (paynow, smtp, s3, bull, zimra test/production) throw a
// clear configuration error until official credentials are supplied — they
// NEVER fake success (CONFIGURED ≠ CONNECTED).
// ---------------------------------------------------------------------------

export interface IntegrationProvider {
  healthCheck(): Promise<HealthCheckResult>;
  validateConfiguration(config: Record<string, any>): { ok: boolean; missing: string[] };
}

export interface PaymentProvider extends IntegrationProvider {
  submit(input: any): Promise<any>;
  status?(reference: string): Promise<any>;
}

export interface StorageProvider extends IntegrationProvider {
  put(key: string, data: Buffer, mime?: string): Promise<{ key: string; url: string; mime?: string }>;
  get(key: string): Promise<Buffer>;
  test(): Promise<HealthCheckResult>;
}

export interface MessagingProvider extends IntegrationProvider {
  send(input: any): Promise<any>;
}

export interface QueueProvider extends IntegrationProvider {
  enqueue(type: string, payload: any): Promise<any>;
}

const MOCK_OK = (provider: string, env: ProviderEnvironment = 'MOCK'): HealthCheckResult => ({
  status: 'CONNECTED', environment: env, checkedAt: new Date().toISOString(), latencyMs: 1, message: `${provider} simulation active. No external requests are made.`,
});

const NOT_CONFIGURED = (provider: string, env: ProviderEnvironment): HealthCheckResult => ({
  status: 'NOT_CONFIGURED', environment: env, checkedAt: new Date().toISOString(), latencyMs: 0, message: `${provider} is not configured. Add official credentials before use.`,
});

const CONFIGURED = (provider: string, env: ProviderEnvironment, extra?: string): HealthCheckResult => ({
  status: 'CONFIGURED', environment: env, checkedAt: new Date().toISOString(), latencyMs: 0, message: `${provider} credentials are present. Live transmission is disabled until the adapter is fully activated.${extra ? ' ' + extra : ''}`,
});

export function requiredFields(config: Record<string, any>, fields: string[]): { ok: boolean; missing: string[] } {
  const missing = fields.filter((f) => !config[f] || String(config[f]).trim() === '');
  return { ok: missing.length === 0, missing };
}

// --- Payment providers --------------------------------------------------------

class MockPaymentProvider implements PaymentProvider {
  async healthCheck(): Promise<HealthCheckResult> { return MOCK_OK('Mock payment'); }
  validateConfiguration(_c: Record<string, any>) { return { ok: true, missing: [] }; }
  async submit(i: any) { return { reference: 'MOCK-PAY-' + Math.random().toString(36).slice(2, 8), status: 'PAID', amount: i.amount, currency: i.currency || 'USD', provider: 'mock', environment: 'MOCK' }; }
  async status(ref: string) { return { reference: ref, status: 'PAID', provider: 'mock', environment: 'MOCK' }; }
}

class PaynowProvider implements PaymentProvider {
  async healthCheck(): Promise<HealthCheckResult> {
    const key = process.env.PAYNOW_INTEGRATION_KEY;
    return key ? CONFIGURED('Paynow', 'LIVE', 'Health verification requires the live Paynow integration.') : NOT_CONFIGURED('Paynow', 'LIVE');
  }
  validateConfiguration(c: Record<string, any>) { return requiredFields(c, ['merchantId', 'integrationKey']); }
  async submit() { throw new Error('Paynow requires official credentials and activation. Configure PAYNOW_* secrets before use.'); }
}

class PagoZimbabweProvider implements PaymentProvider {
  async healthCheck(): Promise<HealthCheckResult> {
    const key = process.env.PAGOZIM_API_KEY;
    return key ? CONFIGURED('PagoZimbabwe', 'LIVE', 'Health verification requires the live PagoZimbabwe integration.') : NOT_CONFIGURED('PagoZimbabwe', 'LIVE');
  }
  validateConfiguration(c: Record<string, any>) { return requiredFields(c, ['merchantId', 'integrationKey']); }
  async submit() { throw new Error('PagoZimbabwe requires official credentials and activation. Configure PAGOZIM_* secrets before use.'); }
}

// --- Storage providers --------------------------------------------------------

class LocalObjectStore implements StorageProvider {
  private dir = process.env.UPLOAD_DIR || require('path').join(process.cwd(), 'storage', 'uploads');
  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const fs = require('fs');
      fs.mkdirSync(this.dir, { recursive: true });
      return MOCK_OK('Local disk store', 'TEST');
    } catch (e: any) {
      return { status: 'ERROR', environment: 'TEST', checkedAt: new Date().toISOString(), latencyMs: 0, message: `Local store not writable: ${e.message}` };
    }
  }
  validateConfiguration() { return { ok: true, missing: [] }; }
  async test(): Promise<HealthCheckResult> {
    const fs = require('fs');
    const path = require('path');
    const start = Date.now();
    try {
      const key = `__nexhealth_${Date.now()}`;
      await this.put(key, Buffer.from('health-check'), 'application/octet-stream');
      const buf = await this.get(key);
      fs.unlinkSync(path.join(this.dir, key));
      const ok = buf.toString() === 'health-check';
      return { status: ok ? 'CONNECTED' : 'ERROR', environment: 'TEST', checkedAt: new Date().toISOString(), latencyMs: Date.now() - start, message: ok ? 'Write / read / delete verified.' : 'Read-back mismatch.', details: { writeReadDelete: ok } };
    } catch (e: any) {
      return { status: 'ERROR', environment: 'TEST', checkedAt: new Date().toISOString(), latencyMs: Date.now() - start, message: `Storage test failed: ${e.message}` };
    }
  }
  async put(key: string, data: Buffer, mime?: string) {
    const fs = require('fs');
    const path = require('path');
    await fs.promises.mkdir(this.dir, { recursive: true });
    const p = path.join(this.dir, key);
    await fs.promises.writeFile(p, data);
    return { key, url: `/uploads/${key}`, mime };
  }
  async get(key: string) {
    const fs = require('fs');
    const path = require('path');
    const p = path.join(this.dir, key);
    const exists = await fs.promises.access(p).then(() => true).catch(() => false);
    if (!exists) throw new Error('Object not found');
    return fs.promises.readFile(p);
  }
}

class S3ObjectStore implements StorageProvider {
  async healthCheck(): Promise<HealthCheckResult> {
    const key = process.env.S3_ACCESS_KEY && process.env.S3_BUCKET;
    return key ? CONFIGURED('S3 object store', 'LIVE', 'Health verification requires the live S3 integration.') : NOT_CONFIGURED('S3 object store', 'LIVE');
  }
  validateConfiguration(c: Record<string, any>) { return requiredFields(c, ['bucket', 'accessKey', 'secretKey']); }
  async test(): Promise<HealthCheckResult> { return this.healthCheck(); }
  async put(_key: string, _data: Buffer, _mime?: string): Promise<{ key: string; url: string; mime?: string }> { throw new Error('S3 requires official credentials. Configure S3_BUCKET / S3 creds before use.'); }
  async get(_key: string): Promise<Buffer> { throw new Error('S3 requires official credentials. Configure S3_BUCKET / S3 creds before use.'); }
}

// --- Messaging providers (email / SMS) ----------------------------------------

class MockMessageProvider implements MessagingProvider {
  async healthCheck(): Promise<HealthCheckResult> { return MOCK_OK('Mock messaging'); }
  validateConfiguration() { return { ok: true, missing: [] }; }
  async send(i: any) { return { id: 'MSG-' + Math.random().toString(36).slice(2, 8), status: 'QUEUED', to: i.to, via: i.via, provider: 'mock', environment: 'MOCK' }; }
}

class SmtpProvider implements MessagingProvider {
  async healthCheck(): Promise<HealthCheckResult> {
    const host = process.env.SMTP_HOST, pass = process.env.SMTP_PASSWORD;
    if (!host || !pass) return NOT_CONFIGURED('SMTP', 'LIVE');
    return CONFIGURED('SMTP', 'LIVE', 'Connection verification requires the live SMTP integration.');
  }
  validateConfiguration(c: Record<string, any>) { return requiredFields(c, ['host', 'port', 'fromAddress']); }
  async send() { throw new Error('SMTP requires official credentials. Configure SMTP_HOST / SMTP_PASSWORD before use.'); }
}

class SmsProvider implements MessagingProvider {
  async healthCheck(): Promise<HealthCheckResult> {
    const key = process.env.SMS_API_KEY;
    return key ? CONFIGURED('SMS gateway', 'LIVE', 'Health verification requires the live SMS integration.') : NOT_CONFIGURED('SMS gateway', 'LIVE');
  }
  validateConfiguration(c: Record<string, any>) { return requiredFields(c, ['apiKey']); }
  async send() { throw new Error('SMS requires official credentials. Configure SMS_API_KEY before use.'); }
}

// --- Queue providers ------------------------------------------------------------

class InProcessQueueProvider implements QueueProvider {
  async healthCheck(): Promise<HealthCheckResult> { return MOCK_OK('In-process queue', 'TEST'); }
  validateConfiguration() { return { ok: true, missing: [] }; }
  async enqueue(type: string, payload: any) { return { id: 'TASK-' + Math.random().toString(36).slice(2, 8), type, provider: 'inprocess', accepted: true }; }
}

class BullQueueProvider implements QueueProvider {
  async healthCheck(): Promise<HealthCheckResult> {
    const url = process.env.REDIS_URL;
    return url ? CONFIGURED('Redis / BullMQ', 'LIVE', 'Health verification requires the live BullMQ integration.') : NOT_CONFIGURED('Redis / BullMQ', 'LIVE');
  }
  validateConfiguration(c: Record<string, any>) { return requiredFields(c, ['redisUrl']); }
  async enqueue() { throw new Error('Redis/BullMQ requires REDIS_URL before use.'); }
}

// --- Factory (safe env-driven selection; same defaults as before) ----------------

export class IntegrationProviderFactory {
  payment(): PaymentProvider {
    const m = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
    if (m === 'mock') return new MockPaymentProvider();
    if (m === 'paynow') return new PaynowProvider();
    if (m === 'pagosep' || m === 'pagozim') return new PagoZimbabweProvider();
    throw new Error(`Unsupported PAYMENT_PROVIDER ${m}`);
  }
  store(): StorageProvider {
    const m = (process.env.OBJECT_STORE || 'local').toLowerCase();
    if (m === 'local') return new LocalObjectStore();
    if (m === 's3') return new S3ObjectStore();
    throw new Error(`Unsupported OBJECT_STORE ${m}`);
  }
  message(): MessagingProvider {
    const m = (process.env.MESSAGE_PROVIDER || 'mock').toLowerCase();
    if (m === 'mock') return new MockMessageProvider();
    if (m === 'smtp') return new SmtpProvider();
    if (m === 'sms') return new SmsProvider();
    throw new Error(`Unsupported MESSAGE_PROVIDER ${m}`);
  }
  queue(): QueueProvider {
    const m = (process.env.QUEUE_PROVIDER || 'inprocess').toLowerCase();
    if (m === 'inprocess') return new InProcessQueueProvider();
    if (m === 'bull' || m === 'redis') return new BullQueueProvider();
    throw new Error(`Unsupported QUEUE_PROVIDER ${m}`);
  }
}
