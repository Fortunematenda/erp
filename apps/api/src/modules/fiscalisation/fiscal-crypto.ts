import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// Device activation keys are secrets. They are stored encrypted at rest and are
// never returned in ordinary API responses or logs. The key material is derived
// from FISCAL_ENCRYPTION_KEY (falling back to JWT_SECRET in dev) so that rotating
// the platform secret also rotates fiscal credential protection.
const SALT = 'nexus-fiscal-v1';

function key(): Buffer {
  const secret = process.env.FISCAL_ENCRYPTION_KEY || process.env.JWT_SECRET || 'nexus-dev-fiscal-key';
  return scryptSync(secret, SALT, 32);
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(payload?: string | null): string | null {
  if (!payload) return null;
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// Safe representation for the UI: never expose the full key.
export function maskSecret(payload?: string | null): string | null {
  const plain = decryptSecret(payload);
  if (!plain) return null;
  if (plain.length <= 4) return '••••';
  return `••••••••${plain.slice(-4)}`;
}

export function hasSecret(payload?: string | null): boolean {
  return !!payload && !!decryptSecret(payload);
}
