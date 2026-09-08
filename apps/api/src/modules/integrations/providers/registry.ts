import { IntegrationDef, ProviderDef, ProviderEnvironment } from './types';

// ---------------------------------------------------------------------------
// Integration registry — the single source of truth for which providers exist
// per integration, their capabilities, required configuration schema and the
// NexusERP modules that depend on them.
//
// Rules:
//  - Only providers with actual integration code appear here.
//  - Mock providers are always available and are the safe default.
//  - A provider that has no live implementation yet is still listed but its
//    connection can never be CONNECTED until real integration code exists.
// ---------------------------------------------------------------------------

const MOCK_CAPS = { supportsWebhooks: false, supportsHealthCheck: true, supportsSandbox: false, supportsTestConnection: true };
const TEST_CAPS = { supportsWebhooks: true, supportsHealthCheck: true, supportsSandbox: true, supportsTestConnection: true };
const LIVE_CAPS = { supportsWebhooks: true, supportsHealthCheck: true, supportsSandbox: false, supportsTestConnection: true, supportsRefunds: true };

export const PAYMENT_PROVIDERS: ProviderDef[] = [
  {
    code: 'mock', label: 'Mock Provider', environment: 'MOCK', description: 'Safe simulation — no external payment requests are sent.',
    capabilities: MOCK_CAPS,
    configFields: [
      { key: 'currency', label: 'Currency', type: 'select', options: ['USD', 'ZWL', 'ZAR', 'GBP', 'EUR'], required: true, tooltip: 'Currency used for simulated payments. Mock never contacts a live gateway.' },
    ],
  },
  {
    code: 'paynow', label: 'Paynow', environment: 'LIVE', description: 'Paynow (Zimbabwe) online payments.',
    capabilities: { ...LIVE_CAPS, supportsRefunds: false },
    docsUrl: 'https://developers.paynow.co.zw/',
    configFields: [
      { key: 'merchantId', label: 'Merchant ID', type: 'text', required: true, envVar: 'PAYNOW_MERCHANT_ID', tooltip: 'Provided by Paynow after merchant onboarding. Used in every payment request.' },
      { key: 'integrationKey', label: 'Integration Key', type: 'password', required: true, secret: true, envVar: 'PAYNOW_INTEGRATION_KEY', tooltip: 'Secret integration key issued by Paynow. Stored server-side only, never returned or logged.' },
      { key: 'returnUrl', label: 'Return URL', type: 'url', required: true, tooltip: 'Customer is redirected here after completing payment on the Paynow portal.' },
      { key: 'resultUrl', label: 'Result / Webhook URL', type: 'url', tooltip: 'Paynow posts payment results here. Must be publicly reachable.' },
      { key: 'currency', label: 'Currency', type: 'select', options: ['USD', 'ZWL', 'ZAR'], required: true, tooltip: 'Currency for Paynow transactions.' },
    ],
  },
  {
    code: 'pagozim', label: 'PagoZimbabwe', environment: 'LIVE', description: 'PagoZimbabwe online payments.',
    capabilities: { ...LIVE_CAPS, supportsRefunds: false },
    docsUrl: 'https://pagosep.com/',
    configFields: [
      { key: 'merchantId', label: 'Merchant / Account ID', type: 'text', required: true, envVar: 'PAGOZIM_MERCHANT_ID', tooltip: 'Account identifier from PagoZimbabwe.' },
      { key: 'integrationKey', label: 'API Key', type: 'password', required: true, secret: true, envVar: 'PAGOZIM_API_KEY', tooltip: 'Secret API key issued by PagoZimbabwe. Stored server-side only.' },
      { key: 'returnUrl', label: 'Return URL', type: 'url', required: true, tooltip: 'Customer return URL after payment.' },
      { key: 'resultUrl', label: 'Result / Webhook URL', type: 'url', tooltip: 'PagoZimbabwe posts payment results here.' },
      { key: 'currency', label: 'Currency', type: 'select', options: ['USD', 'ZWL'], required: true, tooltip: 'Transaction currency.' },
    ],
  },
];

export const STORAGE_PROVIDERS: ProviderDef[] = [
  {
    code: 'local', label: 'Local Disk', environment: 'TEST', description: 'Files stored on the NexusERP server disk. Safe for development and single-server deployments.',
    capabilities: MOCK_CAPS,
    configFields: [
      { key: 'pathPrefix', label: 'Path Prefix', type: 'text', tooltip: 'Optional sub-folder under the uploads directory for namespacing attachments.' },
      { key: 'publicUrl', label: 'Public URL', type: 'url', tooltip: 'Base URL where files are served, if exposed publicly.' },
    ],
  },
  {
    code: 's3', label: 'S3 Compatible (AWS / MinIO / R2)', environment: 'LIVE', description: 'S3-compatible object storage.',
    capabilities: { ...LIVE_CAPS, supportsWebhooks: false },
    docsUrl: 'https://docs.aws.amazon.com/s3/',
    configFields: [
      { key: 'endpoint', label: 'Endpoint', type: 'url', envVar: 'S3_ENDPOINT', tooltip: 'S3 API endpoint. Leave empty for AWS, or set e.g. MinIO / Cloudflare R2 endpoint.' },
      { key: 'region', label: 'Region', type: 'text', envVar: 'S3_REGION', tooltip: 'AWS region (e.g. eu-west-1) or the region your bucket lives in.' },
      { key: 'bucket', label: 'Bucket', type: 'text', required: true, envVar: 'S3_BUCKET', tooltip: 'Name of the S3 bucket used for attachments.' },
      { key: 'accessKey', label: 'Access Key', type: 'password', required: true, secret: true, envVar: 'S3_ACCESS_KEY', tooltip: 'Programmatic access key. Never returned to the browser.' },
      { key: 'secretKey', label: 'Secret Key', type: 'password', required: true, secret: true, envVar: 'S3_SECRET_KEY', tooltip: 'Programmatic secret key. Stored encrypted server-side.' },
      { key: 'publicUrl', label: 'Public URL', type: 'url', tooltip: 'Public base URL for objects, e.g. CloudFront or bucket website endpoint.' },
    ],
  },
];

export const EMAIL_PROVIDERS: ProviderDef[] = [
  {
    code: 'mock', label: 'Mock Provider', environment: 'MOCK', description: 'Safe simulation — emails are recorded in the message log, nothing is transmitted.',
    capabilities: MOCK_CAPS,
    configFields: [
      { key: 'fromAddress', label: 'From Address', type: 'text', tooltip: 'Sender shown on simulated emails. No real email is sent in mock mode.' },
    ],
  },
  {
    code: 'smtp', label: 'SMTP', environment: 'LIVE', description: 'Direct SMTP delivery (any provider: Gmail, Outlook, Zoho, dedicated SMTP).',
    capabilities: { ...LIVE_CAPS, supportsWebhooks: false },
    configFields: [
      { key: 'host', label: 'Host', type: 'text', required: true, envVar: 'SMTP_HOST', tooltip: 'SMTP server hostname, e.g. smtp.example.com.' },
      { key: 'port', label: 'Port', type: 'number', required: true, envVar: 'SMTP_PORT', tooltip: 'SMTP port. 587 with STARTTLS or 465 with implicit TLS.' },
      { key: 'username', label: 'Username', type: 'text', envVar: 'SMTP_USERNAME', tooltip: 'SMTP account username / email.' },
      { key: 'password', label: 'Password', type: 'password', secret: true, envVar: 'SMTP_PASSWORD', tooltip: 'SMTP account password or app-specific password. Stored encrypted.' },
      { key: 'encryption', label: 'Encryption', type: 'select', options: ['TLS', 'SSL', 'NONE'], required: true, tooltip: 'TLS = STARTTLS on 587, SSL = implicit TLS on 465, NONE = plaintext (avoid).' },
      { key: 'fromAddress', label: 'From Address', type: 'text', required: true, tooltip: 'From email address shown to recipients.' },
      { key: 'fromName', label: 'From Name', type: 'text', tooltip: 'Display name shown as the sender.' },
      { key: 'replyTo', label: 'Reply-To', type: 'text', tooltip: 'Optional address recipients reply to.' },
    ],
  },
];

export const SMS_PROVIDERS: ProviderDef[] = [
  {
    code: 'mock', label: 'Mock Provider', environment: 'MOCK', description: 'Safe simulation — SMS are recorded in the message log, nothing is transmitted.',
    capabilities: MOCK_CAPS,
    configFields: [],
  },
  {
    code: 'sms', label: 'SMS Gateway (SMSAPI-compatible)', environment: 'LIVE', description: 'HTTP SMS gateway.',
    capabilities: { ...LIVE_CAPS, supportsWebhooks: false },
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true, secret: true, envVar: 'SMS_API_KEY', tooltip: 'Gateway API key. Stored encrypted server-side.' },
      { key: 'senderId', label: 'Sender ID', type: 'text', envVar: 'SMS_SENDER_ID', tooltip: 'Alphanumeric sender ID shown on the recipient phone.' },
      { key: 'defaultCountry', label: 'Default Country', type: 'text', tooltip: 'ISO country code (e.g. ZW) used when a phone number has no prefix.' },
      { key: 'endpoint', label: 'Gateway Endpoint', type: 'url', envVar: 'SMS_ENDPOINT', tooltip: 'HTTP endpoint for sending SMS. Only set if your gateway differs from the default.' },
    ],
  },
];

export const QUEUE_PROVIDERS: ProviderDef[] = [
  {
    code: 'inprocess', label: 'In-Process Queue', environment: 'TEST', description: 'Jobs run inside the API process. Safe default for single-node deployments.',
    capabilities: MOCK_CAPS,
    configFields: [
      { key: 'maxAttempts', label: 'Maximum Attempts', type: 'number', required: true, tooltip: 'How many times a failed job is retried before it stays FAILED. 1 disables retries.' },
      { key: 'backoffStrategy', label: 'Backoff Strategy', type: 'select', options: ['FIXED', 'EXPONENTIAL'], required: true, tooltip: 'FIXED = constant delay between attempts. EXPONENTIAL = growing delay (2^n x initial).' },
      { key: 'initialDelay', label: 'Initial Delay (ms)', type: 'number', required: true, tooltip: 'Delay before the first retry, in milliseconds.' },
      { key: 'retentionHours', label: 'Failed Job Retention (h)', type: 'number', required: true, tooltip: 'How long completed/failed jobs are kept before cleanup.' },
    ],
  },
  {
    code: 'bull', label: 'Redis / BullMQ', environment: 'LIVE', description: 'Redis-backed queue for multi-node deployments.',
    capabilities: { ...LIVE_CAPS, supportsWebhooks: false },
    docsUrl: 'https://docs.bullmq.io/',
    configFields: [
      { key: 'redisUrl', label: 'Redis URL', type: 'text', required: true, secret: true, envVar: 'REDIS_URL', tooltip: 'redis:// URL. Stored encrypted. BullMQ support activates only with a reachable Redis.' },
      { key: 'maxAttempts', label: 'Maximum Attempts', type: 'number', required: true, tooltip: 'How many times a failed job is retried.' },
      { key: 'backoffStrategy', label: 'Backoff Strategy', type: 'select', options: ['FIXED', 'EXPONENTIAL'], required: true, tooltip: 'Retry backoff strategy.' },
      { key: 'initialDelay', label: 'Initial Delay (ms)', type: 'number', required: true, tooltip: 'Delay before the first retry, in milliseconds.' },
    ],
  },
];

export const ZIMRA_PROVIDERS: ProviderDef[] = [
  {
    code: 'mock', label: 'Mock Provider', environment: 'MOCK', description: 'Safe simulation of the ZIMRA FDMS. No fiscal receipts are submitted.',
    capabilities: MOCK_CAPS,
    configFields: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['mock'], required: true, tooltip: 'Mock never contacts ZIMRA.' },
    ],
  },
  {
    code: 'test', label: 'ZIMRA Test (UAT)', environment: 'TEST', description: 'ZIMRA FDMS testing environment.',
    capabilities: TEST_CAPS,
    configFields: [
      { key: 'baseUrl', label: 'Base URL', type: 'url', envVar: 'ZIMRA_TEST_BASE_URL', tooltip: 'ZIMRA test environment endpoint.' },
      { key: 'applicationKey', label: 'Application Key', type: 'password', secret: true, envVar: 'ZIMRA_APP_KEY', tooltip: 'ZIMRA application key for the test environment.' },
      { key: 'deviceCert', label: 'Device Certificate (PEM)', type: 'textarea', secret: true, tooltip: 'Device certificate issued by ZIMRA for this VFD.' },
      { key: 'certPassword', label: 'Certificate Password', type: 'password', secret: true, tooltip: 'Password protecting the device certificate.' },
    ],
  },
  {
    code: 'production', label: 'ZIMRA Production', environment: 'LIVE', description: 'ZIMRA FDMS production environment.',
    capabilities: LIVE_CAPS,
    configFields: [
      { key: 'baseUrl', label: 'Base URL', type: 'url', envVar: 'ZIMRA_PRODUCTION_BASE_URL', tooltip: 'ZIMRA production endpoint.' },
      { key: 'applicationKey', label: 'Application Key', type: 'password', secret: true, envVar: 'ZIMRA_APP_KEY', tooltip: 'ZIMRA application key.' },
      { key: 'deviceCert', label: 'Device Certificate (PEM)', type: 'textarea', secret: true, tooltip: 'Device certificate issued by ZIMRA.' },
      { key: 'certPassword', label: 'Certificate Password', type: 'password', secret: true, tooltip: 'Password protecting the device certificate.' },
    ],
  },
];

export const BANK_PROVIDERS: ProviderDef[] = [
  {
    code: 'SANDBOX_DEMO', label: 'Demo Bank (Sandbox)', environment: 'TEST', description: 'Synthetic sandbox feed demonstrating account import, sync and reconciliation.',
    capabilities: { ...TEST_CAPS, supportsWebhooks: false },
    configFields: [],
  },
];

export const WEBHOOK_PROVIDERS: ProviderDef[] = [
  {
    code: 'internal', label: 'Internal Webhooks', environment: 'TEST', description: 'Provider callbacks received and verified by NexusERP (idempotent by event id).',
    capabilities: { supportsWebhooks: true, supportsHealthCheck: true, supportsSandbox: true, supportsTestConnection: true },
    configFields: [
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', secret: true, tooltip: 'Shared secret used to verify provider signatures (HMAC). Copy the same value into the provider portal.' },
      { key: 'endpoint', label: 'Endpoint Path', type: 'text', tooltip: 'Path where providers post events, e.g. /api/integrations/webhooks/paynow.' },
    ],
  },
];

export const USAGE_PROVIDERS: ProviderDef[] = [
  {
    code: 'internal', label: 'Internal Metering', environment: 'TEST', description: 'Product metrics recorded for subscription billing.',
    capabilities: MOCK_CAPS,
    configFields: [],
  },
];

export const BILLING_PROVIDERS: ProviderDef[] = [
  {
    code: 'internal', label: 'Internal Billing', environment: 'TEST', description: 'Plan-based subscription billing managed inside NexusERP.',
    capabilities: MOCK_CAPS,
    configFields: [],
  },
];

// --- Registry -----------------------------------------------------------------

export const INTEGRATIONS: IntegrationDef[] = [
  {
    type: 'PAYMENT', label: 'Payment Gateway', section: 'core', scope: 'company',
    description: 'Accept external customer payments online.',
    usedBy: ['Sales', 'Receipts', 'Subscription Billing'],
    providers: PAYMENT_PROVIDERS, configGroup: 'payment', providerField: 'provider',
  },
  {
    type: 'STORAGE', label: 'Object Storage', section: 'core', scope: 'platform',
    description: 'Central attachment storage for documents, HR, assets, projects and more.',
    usedBy: ['Documents', 'HR', 'Recruitment', 'Assets', 'Expenses', 'Fiscalisation', 'Payslips'],
    providers: STORAGE_PROVIDERS, configGroup: 'storage', providerField: 'provider',
  },
  {
    type: 'EMAIL', label: 'Email', section: 'core', scope: 'company',
    description: 'Transactional email delivery.',
    usedBy: ['Sales', 'CRM', 'Recruitment', 'HR', 'Notifications', 'Fiscalisation alerts'],
    providers: EMAIL_PROVIDERS, configGroup: 'messaging', providerField: 'provider',
  },
  {
    type: 'SMS', label: 'SMS', section: 'core', scope: 'company',
    description: 'SMS notifications.',
    usedBy: ['Payment Reminders', 'CRM', 'Recruitment', 'Alerts'],
    providers: SMS_PROVIDERS, configGroup: 'messaging', providerField: 'smsProvider',
  },
  {
    type: 'QUEUE', label: 'Background Queue', section: 'platform', scope: 'platform',
    description: 'Background job execution with retries.',
    usedBy: ['Email', 'Reports', 'Fiscalisation retry', 'Exports', 'Notifications'],
    providers: QUEUE_PROVIDERS, configGroup: 'queue', providerField: 'provider',
  },
  {
    type: 'ZIMRA', label: 'ZIMRA Fiscalisation', section: 'compliance', scope: 'company',
    description: 'Fiscalisation of sales documents via ZIMRA FDMS.',
    usedBy: ['Sales', 'Tax', 'Fiscalisation'],
    providers: ZIMRA_PROVIDERS, configGroup: 'zimra', providerField: 'mode',
  },
  {
    type: 'BANK', label: 'Bank Connections', section: 'compliance', scope: 'company',
    description: 'Bank feed connections feeding Cash & Bank reconciliation.',
    usedBy: ['Cash & Bank', 'Bank Reconciliation'],
    providers: BANK_PROVIDERS, configGroup: 'bank', providerField: 'provider',
  },
  {
    type: 'USAGE', label: 'Usage Metering', section: 'platform', scope: 'platform',
    description: 'Product usage metrics for subscription billing.',
    usedBy: ['Subscription Billing'],
    providers: USAGE_PROVIDERS, configGroup: 'usage', providerField: 'provider',
  },
  {
    type: 'BILLING', label: 'Subscription Billing', section: 'platform', scope: 'platform',
    description: 'Plan and subscription management.',
    usedBy: ['Administration', 'Platform Admin'],
    providers: BILLING_PROVIDERS, configGroup: 'billing', providerField: 'provider',
  },
  {
    type: 'WEBHOOK', label: 'Webhooks', section: 'platform', scope: 'company',
    description: 'Provider callbacks — verified, idempotent and audited.',
    usedBy: ['Payments', 'Fiscalisation'],
    providers: WEBHOOK_PROVIDERS, configGroup: 'webhook', providerField: 'provider',
  },
];

export function getIntegration(type: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.type === type.toUpperCase());
}

export function getProvider(type: string, code: string): ProviderDef | undefined {
  return getIntegration(type)?.providers.find((p) => p.code === code);
}

export function providerEnvironment(type: string, code: string): ProviderEnvironment {
  return getProvider(type, code)?.environment || 'MOCK';
}
