const UNSAFE_JWT_SECRETS = new Set([
  '',
  'secret',
  'changeme',
  'change-me',
  'your-secret-key',
  'your_jwt_secret',
  'jwt-secret',
  'jwt_secret',
  'local-dev-secret',
  'change-this-local-secret-before-any-shared-environment',
]);

export function isUnsafeJwtSecret(secret?: string | null): boolean {
  if (!secret) return true;
  const trimmed = secret.trim();
  if (!trimmed) return true;
  if (UNSAFE_JWT_SECRETS.has(trimmed) || UNSAFE_JWT_SECRETS.has(trimmed.toLowerCase())) return true;
  return trimmed.length < 16;
}

export function resolveJwtSecret(opts?: { production?: boolean }): string {
  const secret = process.env.JWT_SECRET;
  const production = opts?.production ?? process.env.NODE_ENV === 'production';
  if (production && isUnsafeJwtSecret(secret)) {
    throw new Error(
      'JWT_SECRET is missing or uses an unsafe default. Refusing to start in production. Set a unique secret of at least 16 characters.',
    );
  }
  if (!secret || !secret.trim()) return 'local-dev-secret';
  return secret;
}

export function assertJwtSecretForStartup() {
  resolveJwtSecret();
}
