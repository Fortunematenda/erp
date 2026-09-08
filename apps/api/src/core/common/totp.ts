import * as crypto from 'crypto';

// RFC 6238 TOTP (HMAC-SHA1, 30s window, 6 digits). No external dependency.

function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | alphabet.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secretBuf: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1000000;
  return String(code).padStart(6, '0');
}

export function generateSecret(): string { return base32Encode(crypto.randomBytes(20)); }

export function hotpFromCounter(secretB32: string, counter: number): string {
  return hotp(base32Decode(secretB32), counter);
}

export function totpAtTime(secretB32: string, timestampMs = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(timestampMs / 1000 / 30));
}

export function verifyTotp(secretB32: string, token: string, window = 1): boolean {
  try {
    const secret = base32Decode(secretB32);
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let w = -window; w <= window; w++) if (hotp(secret, counter + w) === token) return true;
    return false;
  } catch { return false; }
}

export function totpFor(secretB32: string): string {
  return hotp(base32Decode(secretB32), Math.floor(Date.now() / 1000 / 30));
}

export function otpauthUrl(account: string, secretB32: string, issuer = 'NexusERP'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function randomToken(bytes = 40): string { return crypto.randomBytes(bytes).toString('hex'); }
export function sha256(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }
