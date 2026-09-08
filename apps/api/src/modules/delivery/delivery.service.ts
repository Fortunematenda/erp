import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AdaptersService } from '../integrations/adapters.service';

const TEMPLATE_DEFAULTS: Record<string, { subject: string; body: string }> = {
  invoice: { subject: 'Invoice {{number}}', body: 'Dear {{party}},\n\nPlease find your invoice {{number}} for {{total}}.\n\n{{company}}\n{{signature}}' },
  quotation: { subject: 'Quotation {{number}}', body: 'Dear {{party}},\n\nQuotation {{number}} totals {{total}} and is valid until {{due}}.\n\n{{company}}' },
  statement: { subject: 'Statement for {{party}}', body: 'Dear {{party}},\n\nYour current statement balance is {{total}}.\n\n{{company}}' },
  payslip: { subject: 'Payslip {{number}}', body: 'Hello {{party}},\n\nYour payslip {{number}} shows net pay of {{total}}.\n\n{{company}}' },
};

function render(tpl: string, data: Record<string, any>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (data[k] != null ? String(data[k]) : ''));
}

@Injectable()
export class DeliveryService {
  constructor(private prisma: PrismaService, private adapters: AdaptersService) {}

  async templates(companyId: string) {
    const rows = await this.prisma.systemConfig.findMany({ where: { companyId, key: { startsWith: 'email.tpl.' } } });
    const out: Record<string, any> = {};
    for (const code of Object.keys(TEMPLATE_DEFAULTS)) {
      const row = rows.find((r) => r.key === `email.tpl.${code}`);
      const stored = row?.value as any;
      out[code] = { code, subject: stored?.subject || TEMPLATE_DEFAULTS[code].subject, body: stored?.body || TEMPLATE_DEFAULTS[code].body };
    }
    return out;
  }

  async saveTemplate(companyId: string, code: string, body: { subject: string; body: string }) {
    await this.prisma.systemConfig.upsert({
      where: { companyId_key: { companyId, key: `email.tpl.${code}` } },
      update: { value: { subject: body.subject, body: body.body } },
      create: { companyId, key: `email.tpl.${code}`, value: { subject: body.subject, body: body.body }, description: `Email template ${code}` },
    });
    return this.templates(companyId);
  }

  async renderTemplate(companyId: string, code: string, data: any) {
    const tpl = await this.templates(companyId);
    const t = tpl[code] || { subject: '', body: '' };
    return { subject: render(t.subject, data), body: render(t.body, data) };
  }

  async send(companyId: string, code: string, to: string, data: any) {
    const t = await this.renderTemplate(companyId, code, data);
    const res = await this.adapters.sendMessage({ to, via: 'email', subject: t.subject, text: t.body, template: code, data });
    return res;
  }

  async csv(entity: string, companyId: string): Promise<string> {
    const q = (r: any) => (r == null ? '' : String(r)).replace(/"/g, '""');
    const esc = (arr: any[]) => arr.map(q).join(',');
    if (entity === 'customers') {
      const rows = await this.prisma.customer.findMany({ where: { companyId } });
      return [esc(['code', 'name', 'email', 'phone', 'address']), ...rows.map((c) => esc([c.code, c.name, c.email, c.phone, [c.address1, c.city, c.country].filter(Boolean).join(' ')]))].join('\n');
    }
    if (entity === 'items') {
      const rows = await this.prisma.inventoryItem.findMany({ where: { companyId } });
      return [esc(['sku', 'name', 'unit', 'reorderLevel']), ...rows.map((i) => esc([i.sku, i.name, i.unit, i.reorderLevel]))].join('\n');
    }
    if (entity === 'invoices') {
      const rows = await this.prisma.salesInvoice.findMany({ where: { companyId } });
      return [esc(['invoiceNo', 'date', 'customer', 'subtotal', 'tax', 'total', 'status']), ...rows.map((i) => esc([i.invoiceNo, i.invoiceDate, i.customerId, i.subtotal, i.taxTotal, i.total, i.status]))].join('\n');
    }
    if (entity === 'suppliers') {
      const rows = await this.prisma.supplier.findMany({ where: { companyId } });
      return [esc(['code', 'name', 'email', 'phone']), ...rows.map((s) => esc([s.code, s.name, s.email, s.phone]))].join('\n');
    }
    throw new BadRequestException('Unsupported CSV entity ' + entity);
  }

  async importCsv(entity: string, companyId: string, text: string) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV must have a header and at least one row');
    const header = lines[0].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map((l) => {
      const cells: string[] = []; let cur = ''; let inq = false;
      for (const ch of l) { if (ch === '"') inq = !inq; else if (ch === ',' && !inq) { cells.push(cur.trim()); cur = ''; } else cur += ch; }
      cells.push(cur.trim());
      const obj: any = {}; header.forEach((h, i) => (obj[h] = (cells[i] || '').replace(/^"|"$/g, '')));
      return obj;
    });
    const idx = (name: string) => header.indexOf(name);
    if (entity === 'customers') {
      let count = 0;
      for (const r of rows) {
        const code = r.code || r[idx('code')] || r[idx('Code')];
        if (!code) continue;
        await this.prisma.customer.upsert({
          where: { companyId_code: { companyId, code } },
          update: { name: r.name || r.Name, email: r.email || r.Email, phone: r.phone || r.Phone },
          create: { companyId, code, name: r.name || r.Name || code, email: r.email || r.Email, phone: r.phone || r.Phone },
        });
        count++;
      }
      return { entity, imported: count };
    }
    if (entity === 'items') {
      let count = 0;
      for (const r of rows) {
        const sku = r.sku || r[idx('sku')] || r[idx('SKU')];
        if (!sku) continue;
        await this.prisma.inventoryItem.upsert({
          where: { companyId_sku: { companyId, sku } },
          update: { name: r.name || r.Name, unit: r.unit || r.Unit || 'EA', reorderLevel: Number(r.reorderLevel || r.ReorderLevel || 0) },
          create: { companyId, sku, name: r.name || r.Name || sku, unit: r.unit || r.Unit || 'EA', reorderLevel: Number(r.reorderLevel || r.ReorderLevel || 0) },
        });
        count++;
      }
      return { entity, imported: count };
    }
    throw new BadRequestException('Unsupported import entity ' + entity);
  }
}
