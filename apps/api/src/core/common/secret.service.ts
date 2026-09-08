import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

// AES-256-GCM encryption for sensitive values (bank access/refresh tokens).
// The key is supplied by environment (BANK_ENC_KEY) — never hard-coded in source.
@Injectable()
export class SecretService {
  private key: Buffer;
  constructor() { this.key = crypto.createHash('sha256').update(process.env.BANK_ENC_KEY || 'local-dev-secret-key' + crypto.randomBytes(4).toString('hex')).digest(); }

  encrypt(plain: string | null | undefined): string | null {
    if (plain == null) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  decrypt(ciphertext: string | null | undefined): string | null {
    if (!ciphertext) return null;
    const [ivh, tagh, enh] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivh, 'hex'));
    decipher.setAuthTag(Buffer.from(tagh, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(enh, 'hex')), decipher.final()]).toString('utf8');
  }
}
