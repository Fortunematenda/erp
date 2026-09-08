import dayjs from 'dayjs';

export function fmtMoney(value: any, currency = 'USD') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export function fmtNumber(value: any, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function fmtDate(value: any) {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.format('DD MMM YYYY') : '—';
}

export function fmtDateTime(value: any) {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.format('DD MMM YYYY HH:mm') : '—';
}
