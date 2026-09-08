// ---------------------------------------------------------------------------
// Integration Control Centre — shared provider types.
// States are consistent across every adapter: MOCK | NOT_CONFIGURED |
// CONFIGURED | CONNECTED | DEGRADED | ERROR | DISABLED.
// Environment (MOCK/TEST/LIVE) is kept separate from connection status.
// ---------------------------------------------------------------------------

export type ProviderEnvironment = 'MOCK' | 'TEST' | 'LIVE';

export type ProviderState =
  | 'MOCK'
  | 'NOT_CONFIGURED'
  | 'CONFIGURED'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'ERROR'
  | 'DISABLED';

export type IntegrationType =
  | 'PAYMENT'
  | 'STORAGE'
  | 'EMAIL'
  | 'SMS'
  | 'QUEUE'
  | 'ZIMRA'
  | 'BANK'
  | 'USAGE'
  | 'BILLING'
  | 'WEBHOOK';

export interface HealthCheckResult {
  status: ProviderState;
  environment: ProviderEnvironment;
  checkedAt: string; // ISO
  latencyMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface ConfigFieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'number' | 'textarea' | 'url';
  options?: string[];
  secret?: boolean;
  required?: boolean;
  envVar?: string;
  tooltip?: string;
  appliesTo?: ProviderEnvironment[]; // environments this field applies to (default: all)
  placeholder?: string;
  docs?: string; // official provider documentation URL
}

export interface ProviderCapabilities {
  supportsWebhooks: boolean;
  supportsHealthCheck: boolean;
  supportsSandbox: boolean;
  supportsTestConnection: boolean;
  supportsRefunds?: boolean;
}

export interface ProviderDef {
  code: string; // e.g. 'mock' | 'paynow'
  label: string; // e.g. 'Paynow'
  environment: ProviderEnvironment;
  description?: string;
  capabilities: ProviderCapabilities;
  configFields: ConfigFieldDef[];
  docsUrl?: string;
}

export interface IntegrationDef {
  type: IntegrationType;
  label: string;
  section: 'core' | 'compliance' | 'platform';
  scope: 'platform' | 'company';
  description: string;
  usedBy: string[];
  providers: ProviderDef[];
  configGroup: string; // SettingsModule group id (cfg.<group>.*)
  providerField: string; // key inside the group selecting the provider
}

// Every external request carries a correlation id connecting the ERP source
// transaction, request, retry and webhook for troubleshooting.
export function correlationId(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const seq = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `INT-REQ-${stamp}-${seq}`;
}

// Error classification so users understand what action is needed.
export type ErrorKind =
  | 'CONFIGURATION'
  | 'AUTHENTICATION'
  | 'VALIDATION'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'PROVIDER'
  | 'WEBHOOK'
  | 'UNKNOWN';

export function classifyError(e: unknown): ErrorKind {
  const msg = String((e as any)?.message || e || '').toLowerCase();
  if (msg.includes('auth') || msg.includes('credential') || msg.includes('401') || msg.includes('403')) return 'AUTHENTICATION';
  if (msg.includes('econnrefused') || msg.includes('eai_again') || msg.includes('network') || msg.includes('socket')) return 'NETWORK';
  if (msg.includes('timeout') || msg.includes('etimedout')) return 'TIMEOUT';
  if (msg.includes('rate') || msg.includes('429')) return 'RATE_LIMIT';
  if (msg.includes('config') || msg.includes('not configured') || msg.includes('credentials')) return 'CONFIGURATION';
  if (msg.includes('valid') || msg.includes('required')) return 'VALIDATION';
  if (msg.includes('webhook') || msg.includes('signature')) return 'WEBHOOK';
  if (msg.includes('provider') || msg.includes('remote')) return 'PROVIDER';
  return 'UNKNOWN';
}
