import { BadRequestException } from '@nestjs/common';

export const FONTS = ['Inter', 'Arial', 'Helvetica', 'Roboto', 'Georgia', 'Times New Roman', 'System Default'];
export const LOGO_POSITIONS = ['left', 'center', 'right'];
export const LOGO_SIZES = ['small', 'medium', 'large'];
export const LAYOUT_STYLES = ['classic', 'modern', 'compact'];
export const TABLE_STYLES = ['minimal', 'striped', 'bordered', 'modern'];
export const TOTALS_STYLES = ['simple', 'boxed', 'highlighted'];
export const CUSTOMER_BLOCK_LAYOUTS = ['stacked', 'side-by-side'];
export const DENSITIES = ['normal', 'compact', 'comfortable'];

export const INVOICE_TOKENS = ['companyName', 'invoiceNumber', 'dueDate', 'customerName', 'balanceDue'];
export const QUOTE_TOKENS = ['companyName', 'quoteNumber', 'validUntil', 'validityDays', 'customerName'];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export function isHexColor(s: unknown): s is string { return typeof s === 'string' && HEX_RE.test(s.trim()); }

export function sanitizeText(s: string): string {
  // strip HTML tags, event handlers and protocol handlers; plain text only
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/(on\w+\s*=\s*["'][^"']*["'])/gi, '')
    .replace(/(javascript:|vbscript:|data:text\/html)/gi, '')
    .replace(/[<>]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function allowTokens(s: string, allowed: string[]): string {
  const re = /\{\{(\w+)\}\}/g;
  return String(s || '').replace(re, (m, key) => (allowed.includes(key) ? m : ''));
}

function clampInt(n: unknown, min: number, max: number, def: number) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
}

const LENGTH_MAX: Record<string, number> = { footerMessage: 500, quoteFooterMessage: 500, invoiceTerms: 4000, quoteTerms: 4000, statementMemo: 1000, validityMessage: 500, invoiceTitle: 60, quoteTitle: 60, preparedForLabel: 60 };

export function validateTemplateInput(body: any, type: string) {
  const out: Record<string, any> = {};
  const fromEnum = (key: string, allowed: string[]) => { if (body[key] !== undefined && !allowed.includes(body[key])) throw new BadRequestException(`Invalid ${key}`); if (body[key] !== undefined) out[key] = body[key]; };
  const hex = (key: string) => { if (body[key] !== undefined) { if (!isHexColor(body[key])) throw new BadRequestException(`Invalid ${key} colour`); out[key] = body[key]; } };
  const text = (key: string, max = 4000) => { if (body[key] !== undefined) { const v = sanitizeText(String(body[key])); if (v.length > max) throw new BadRequestException(`${key} too long`); out[key] = v; } };
  const bool = (key: string) => { if (body[key] !== undefined) out[key] = Boolean(body[key]); };
  const json = (key: string) => { if (body[key] !== undefined) out[key] = Array.isArray(body[key]) || typeof body[key] === 'object' ? body[key] : {}; };

  fromEnum('logoPosition', LOGO_POSITIONS);
  fromEnum('logoSize', LOGO_SIZES);
  fromEnum('layoutStyle', LAYOUT_STYLES);
  fromEnum('tableStyle', TABLE_STYLES);
  fromEnum('totalsStyle', TOTALS_STYLES);
  fromEnum('customerBlockLayout', CUSTOMER_BLOCK_LAYOUTS);
  fromEnum('density', DENSITIES);
  fromEnum('stampStyle', ['outlined', 'soft', 'classic']);
  fromEnum('stampSize', ['small', 'medium', 'large']);
  fromEnum('stampPosition', ['top-right', 'top-center', 'center']);
  if (body.stampAngle !== undefined) out.stampAngle = clampInt(body.stampAngle, -20, 20, -12);
  if (body.fontFamily !== undefined) { if (!FONTS.includes(body.fontFamily)) throw new BadRequestException('Invalid font'); out.fontFamily = body.fontFamily; }

  [] .forEach(() => {}); // no-op
  hex('primaryColor'); hex('secondaryColor'); hex('textColor'); hex('mutedColor'); hex('tableHeaderColor'); hex('tableHeaderTextColor');
  if (body.baseFontSize !== undefined) out.baseFontSize = clampInt(body.baseFontSize, 9, 20, 13);
  if (body.validityDays !== undefined) out.validityDays = clampInt(body.validityDays, 1, 365, 30);

  // booleans (common)
  ['isActive', 'showDeliveryAddress', 'hideDuplicateDeliveryAddress', 'showPaymentStatus', 'showBalanceDue', 'showPaymentDetails', 'showFiscalInformation', 'showFiscalQrCode', 'showNotes', 'showStatementMemo', 'showStatusBadge', 'showStatusStamp', 'footerShowPageNumber', 'footerShowCompanyContact', 'footerShowCompanyWebsite', 'showValidity', 'showAcceptanceSection', 'acceptanceNotesAllowed', 'footerAlignment', 'isDefault'].forEach((k) => { if (k === 'footerAlignment') fromEnum('footerAlignment', ['left', 'center', 'right']); else bool(k); });

  json('showCompanyFields'); json('showCustomerFields'); json('columns');

  // text fields with token allowlist
  const tokens = type === 'QUOTE' ? QUOTE_TOKENS : INVOICE_TOKENS;
  const tf = (key: string, max: number) => { if (body[key] !== undefined) out[key] = allowTokens(sanitizeText(String(body[key])), tokens); };

  ['footerMessage', 'quoteFooterMessage', 'invoiceTerms', 'quoteTerms', 'statementMemo', 'validityMessage', 'invoiceTitle', 'quoteTitle', 'preparedForLabel'].forEach((k) => tf(k, LENGTH_MAX[k] ?? 4000));

  if (body.logoUrl !== undefined) out.logoUrl = sanitizeText(String(body.logoUrl)).slice(0, 400);
  return out;
}
