import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { promises as fs } from 'fs';
import * as path from 'path';

// Provider contracts — mock implementations are safe; production/real providers throw
// a clear configuration error until official credentials are supplied (never fake success).

function notConfigured(name: string, env: string): never {
  throw new Error(`${name} requires official credentials (or infrastructure). Configure ${env} and restart.`);
}

// --- Payment ---
interface PaymentProvider { submit(input: any): Promise<any>; status?(reference: string): Promise<any>; }
class MockPaymentProvider implements PaymentProvider {
  async submit(i: any) { return { reference: 'MOCK-PAY-' + Math.random().toString(36).slice(2, 8), status: 'PAID', amount: i.amount, currency: i.currency || 'USD', provider: 'mock' }; }
  async status(ref: string) { return { reference: ref, status: 'PAID', provider: 'mock' }; }
}
class PaynowProvider implements PaymentProvider { async submit() { notConfigured('Paynow', 'PAYNOW_INTEGRATION_KEY'); } async status() { notConfigured('Paynow', 'PAYNOW_INTEGRATION_KEY'); } }
class PagoZimbabweProvider implements PaymentProvider { async submit() { notConfigured('PagoZimbabwe', 'PAGOZIM_API_KEY'); } async status() { notConfigured('PagoZimbabwe', 'PAGOZIM_API_KEY'); } }

// --- Object storage ---
interface ObjectStore { put(key: string, data: Buffer, mime?: string): Promise<{ key: string; url: string }>; get(key: string): Promise<Buffer>; }
class LocalObjectStore implements ObjectStore {
  private dir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'storage', 'uploads');
  async put(key: string, data: Buffer, mime?: string) { await fs.mkdir(this.dir, { recursive: true }); const p = path.join(this.dir, key); await fs.writeFile(p, data); return { key, url: `/uploads/${key}`, mime }; }
  async get(key: string) { const p = path.join(this.dir, key); const exists = await fs.access(p).then(() => true).catch(() => false); if (!exists) throw new BadRequestException('Object not found'); return fs.readFile(p); }
}
class S3ObjectStore implements ObjectStore { async put(): Promise<any> { notConfigured('S3 object store', 'S3_BUCKET / AWS creds'); } async get(): Promise<any> { notConfigured('S3 object store', 'S3_BUCKET / AWS creds'); } }

// --- Messaging (email/SMS) ---
interface MessageProvider { send(input: any): Promise<any>; }
class MockMessageProvider implements MessageProvider { async send(i: any) { return { id: 'MSG-' + Math.random().toString(36).slice(2, 8), status: 'QUEUED', to: i.to, via: i.via }; } }
class SmtpProvider implements MessageProvider { async send(): Promise<any> { notConfigured('SMTP', 'SMTP_HOST / SMTP_PASSWORD'); } }
class SmsProvider implements MessageProvider { async send(): Promise<any> { notConfigured('SMS', 'SMS_API_KEY'); } }

// --- Queue (workers) ---
interface QueueService { enqueue(type: string, payload: any): Promise<any>; }
class InProcessQueueService implements QueueService { async enqueue(type: string, payload: any) { setImmediate(async () => { /* worker hook */ }); return { id: 'TASK-' + Math.random().toString(36).slice(2, 8), type, provider: 'inprocess', accepted: true }; } }
class BullQueueService implements QueueService { async enqueue(): Promise<any> { notConfigured('Redis/BullMQ', 'REDIS_URL'); } }

@Injectable()
export class AdaptersService {
  constructor(private prisma: PrismaService) {}

  private payment(): PaymentProvider {
    const m = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
    if (m === 'mock') return new MockPaymentProvider();
    if (m === 'paynow') return new PaynowProvider();
    if (m === 'pagosep' || m === 'pagozim') return new PagoZimbabweProvider();
    throw new Error(`Unsupported PAYMENT_PROVIDER ${m}`);
  }
  private store(): ObjectStore {
    const m = (process.env.OBJECT_STORE || 'local').toLowerCase();
    if (m === 'local') return new LocalObjectStore();
    if (m === 's3') return new S3ObjectStore();
    throw new Error(`Unsupported OBJECT_STORE ${m}`);
  }
  private message(): MessageProvider {
    const m = (process.env.MESSAGE_PROVIDER || 'mock').toLowerCase();
    if (m === 'mock') return new MockMessageProvider();
    if (m === 'smtp') return new SmtpProvider();
    if (m === 'sms') return new SmsProvider();
    throw new Error(`Unsupported MESSAGE_PROVIDER ${m}`);
  }
  private queue(): QueueService {
    const m = (process.env.QUEUE_PROVIDER || 'inprocess').toLowerCase();
    if (m === 'inprocess') return new InProcessQueueService();
    if (m === 'bull' || m === 'redis') return new BullQueueService();
    throw new Error(`Unsupported QUEUE_PROVIDER ${m}`);
  }

  providers() {
    return {
      payment: process.env.PAYMENT_PROVIDER || 'mock',
      objectStore: process.env.OBJECT_STORE || 'local',
      message: process.env.MESSAGE_PROVIDER || 'mock',
      queue: process.env.QUEUE_PROVIDER || 'inprocess',
      zimra: (process.env.ZIMRA_MODE || 'mock').toLowerCase(),
    };
  }

  async charge(input: any) { return this.payment().submit(input); }
  async paymentStatus(reference: string) { return this.payment().status!(reference); }
  async upload(key: string, dataUrl: string, mime?: string) { const buf = Buffer.from(dataUrl.split(',')[1] || dataUrl, 'base64'); return this.store().put(key, buf, mime); }
  async download(key: string) { return this.store().get(key); }
  async sendMessage(input: any) { return this.message().send(input); }
  async enqueue(type: string, payload: any) { return this.queue().enqueue(type, payload); }

  async recordUsage(tenantId: string, metric: string, value: number, period: string) {
    await this.prisma.usageRecord.upsert({ where: { tenantId_metric_period: { tenantId, metric, period } }, update: { value: { increment: value } }, create: { tenantId, metric, period, value } });
    return { tenantId, metric, period, value };
  }

  async usage(tenantId: string) { return this.prisma.usageRecord.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }); }

  async billing(tenantId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    const usage = await this.prisma.usageRecord.groupBy({ by: ['metric'], where: { tenantId }, _sum: { value: true } });
    const metered = usage.map((u) => ({ metric: u.metric, qty: u._sum.value || 0 }));
    const mrr = sub?.plan?.monthlyPrice || 0;
    return { plan: sub?.plan?.name || 'None', mrr, metered, currency: 'USD' };
  }
}
