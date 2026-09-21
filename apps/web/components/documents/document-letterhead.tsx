'use client';

/**
 * Shared company letterhead for all printable sales documents.
 * Used by DocumentPreview, PrintDocument, and list/iframe print HTML.
 */

export type LetterheadCompany = {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  tin?: string | null;
  vatNumber?: string | null;
  website?: string | null;
  code?: string | null;
};

export type LetterheadTemplate = {
  logoUrl?: string | null;
  logoPosition?: string | null;
  logoSize?: string | null;
  primaryColor?: string | null;
  mutedColor?: string | null;
  showCompanyFields?: Record<string, boolean> | null;
  /** Optional tagline / letterhead line from company prefs (pdfHeader). */
  pdfHeader?: string | null;
};

export function logoHeightPx(size?: string | null): number {
  return size === 'large' ? 64 : size === 'small' ? 32 : 48;
}

function showField(t: LetterheadTemplate | undefined, key: string): boolean {
  if (!t?.showCompanyFields) return true;
  return (t.showCompanyFields as any)[key] !== false;
}

function escapeHtml(v: any): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build letterhead HTML for iframe / window.print paths (no React). */
export function letterheadHtml(company: LetterheadCompany, template?: LetterheadTemplate): string {
  const primary = template?.primaryColor || '#003366';
  const muted = template?.mutedColor || '#6b7280';
  const pos = template?.logoPosition || 'left';
  const align = pos === 'center' ? 'center' : pos === 'right' ? 'right' : 'left';
  const h = logoHeightPx(template?.logoSize);
  const logo = template?.logoUrl
    ? `<div style="margin-bottom:8px"><img src="${escapeHtml(template.logoUrl)}" alt="logo" style="height:${h}px;object-fit:contain;max-width:220px" /></div>`
    : '';
  const name = escapeHtml(company?.name || 'Company');
  const address = showField(template, 'address') && company?.address
    ? `<div style="font-size:12px;color:${muted}">${escapeHtml(company.address)}</div>`
    : '';
  const contact = [company?.phone, company?.email].filter(Boolean).join(' • ');
  const contactLine = contact ? `<div style="font-size:12px;color:#64748b">${escapeHtml(contact)}</div>` : '';
  const tax = showField(template, 'tax') && (company?.tin || company?.vatNumber)
    ? `<div style="font-size:11px;color:${muted}">TIN ${escapeHtml(company.tin || '')}${company?.vatNumber ? ` · VAT ${escapeHtml(company.vatNumber)}` : ''}</div>`
    : '';
  const website = showField(template, 'website') && company?.website
    ? `<div style="font-size:11px;color:${muted}">${escapeHtml(company.website)}</div>`
    : '';
  const headerLine = template?.pdfHeader
    ? `<div style="font-size:11px;color:${muted};margin-top:2px">${escapeHtml(template.pdfHeader)}</div>`
    : '';

  return `<div style="text-align:${align};margin-bottom:16px;font-family:Inter,system-ui,sans-serif">
    ${logo}
    <div style="font-size:20px;font-weight:700;color:${primary}">${name}</div>
    ${headerLine}${address}${contactLine}${tax}${website}
  </div>`;
}

export function DocumentLetterhead({
  company,
  template,
  className,
}: {
  company?: LetterheadCompany | null;
  template?: LetterheadTemplate | null;
  className?: string;
}) {
  const c = company || {};
  const t = template || {};
  const primary = t.primaryColor || '#003366';
  const muted = t.mutedColor || '#6b7280';
  const pos = t.logoPosition || 'left';
  const alignCls = pos === 'center' ? 'text-center' : pos === 'right' ? 'text-right' : '';

  return (
    <div className={`${alignCls} ${className || ''}`.trim()}>
      {t.logoUrl ? (
        <div className="mb-2">
          <img
            src={t.logoUrl}
            alt="logo"
            style={{ height: logoHeightPx(t.logoSize), objectFit: 'contain', maxWidth: 220 }}
          />
        </div>
      ) : null}
      <div className="text-xl font-bold" style={{ color: primary }}>{c.name || 'Company'}</div>
      {t.pdfHeader ? (
        <div className="text-[11px]" style={{ color: muted }}>{t.pdfHeader}</div>
      ) : null}
      {showField(t, 'address') && c.address ? (
        <div className="text-[12px]" style={{ color: muted }}>{c.address}</div>
      ) : null}
      {[c.phone, c.email].filter(Boolean).length > 0 ? (
        <div className="text-[12px] text-slate-500">{[c.phone, c.email].filter(Boolean).join(' • ')}</div>
      ) : null}
      {showField(t, 'tax') && (c.tin || c.vatNumber) ? (
        <div className="text-[11px]" style={{ color: muted }}>
          TIN {c.tin}{c.vatNumber ? ` · VAT ${c.vatNumber}` : ''}
        </div>
      ) : null}
      {showField(t, 'website') && c.website ? (
        <div className="text-[11px]" style={{ color: muted }}>{c.website}</div>
      ) : null}
    </div>
  );
}
