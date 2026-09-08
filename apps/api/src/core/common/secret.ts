import * as crypto from 'crypto';

// Encrypts/decrypts configuration secrets at rest (AES-256-GCM) using the app
// encryption key (BACKUP_ENCRYPTION_KEY/ENCRYPTION_KEY). If no key is configured
// (dev), values are stored with an `insecure` flag rather than in plaintext-free.

export function hasConfigKey(): boolean { return !!(process.env.ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY || process.env.MASTER_KEY); }

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY || process.env.BACKUP_ENCRYPTION_KEY || process.env.MASTER_KEY || 'local-dev-encryption-key';
  return crypto.createHash('sha256').update(k).digest();
}

export function encryptSecret(plain: string) {
  if (!hasConfigKey()) return { insecure: true, value: crypto.createHash('sha256').update(plain).digest('hex') };
  const keyBuf = key();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), data: enc.toString('base64'), tag: tag.toString('base64') };
}

export function decryptSecret(stored: any): string | null {
  if (!stored) return null;
  if (stored.insecure) return null; // hash-only; cannot recover plaintext
  try {
    const keyBuf = key();
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch { return null; }
}

export function maskSecret(): string { return '••••••••'; }
