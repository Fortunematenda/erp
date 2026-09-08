import { AsYouType, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export function normalizePhoneNumber(raw: string, country: CountryCode = 'ZW'): string {
  const parsed = parsePhoneNumberFromString(raw || '', country);
  return parsed?.number || String(raw || '').trim();
}

export function formatPhoneNumber(value?: string, country: CountryCode = 'ZW'): string {
  if (!value) return '';
  const parsed = parsePhoneNumberFromString(value, country);
  return parsed ? parsed.formatNational() : value;
}

export function formatPhoneInput(raw: string, country: CountryCode = 'ZW'): string {
  return new AsYouType(country).input(raw || '');
}
