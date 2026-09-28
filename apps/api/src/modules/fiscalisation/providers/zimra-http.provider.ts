import { FiscalProvider } from './fiscal-provider';
import * as https from 'https';

// Real ZIMRA FDMS (Fiscal Device Gateway) transport.
//
// The exact endpoint paths and payload contract must always be confirmed against
// the current official specification:
//   https://www.zimra.co.zw/downloads/category/9-domestic-taxes
// Endpoint paths can be overridden with ZIMRA_ENDPOINTS (JSON) so a contract
// change never requires a code change. Authentication is mutual TLS using the
// device certificate/key issued by ZIMRA; credentials are supplied via
// environment variables and are never hard-coded.
//
// SANDBOX  -> https://fdmsapitest.zimra.co.zw
// PRODUCTION -> https://fdmsapi.zimra.co.zw
//
// This provider never simulates success. If credentials are not configured it
// throws, so an environment can never silently fall back to mock behaviour.

type ZimraEnvironment = 'SANDBOX' | 'PRODUCTION';

const DEFAULT_ENDPOINTS: Record<string, string> = {
  verifyTaxpayer: '/Device/VerifyTaxpayer',
  registerDevice: '/Device/RegisterDevice',
  getConfig: '/Device/GetConfig',
  openDay: '/Device/OpenDay',
  submitReceipt: '/Device/SubmitReceipt',
  closeDay: '/Device/CloseDay',
};

const DEFAULT_BASE: Record<ZimraEnvironment, string> = {
  SANDBOX: 'https://fdmsapitest.zimra.co.zw',
  PRODUCTION: 'https://fdmsapi.zimra.co.zw',
};

function notConfigured(env: ZimraEnvironment, detail: string): never {
  throw new Error(
    `ZIMRA ${env} mode is not configured (${detail}). Set the official ZIMRA_* credentials and, for ${env === 'SANDBOX' ? 'test' : 'production'}, complete ZIMRA onboarding. NexusERP will not simulate a ${env} fiscal response.`,
  );
}

export class ZimraHttpProvider implements FiscalProvider {
  constructor(private environment: ZimraEnvironment) {}

  private endpoints(): Record<string, string> {
    const raw = process.env.ZIMRA_ENDPOINTS;
    if (raw) {
      try {
        return { ...DEFAULT_ENDPOINTS, ...JSON.parse(raw) };
      } catch {
        throw new Error('ZIMRA_ENDPOINTS must be valid JSON.');
      }
    }
    return DEFAULT_ENDPOINTS;
  }

  private baseUrl(): string {
    const key = this.environment === 'SANDBOX' ? 'ZIMRA_SANDBOX_BASE_URL' : 'ZIMRA_PRODUCTION_BASE_URL';
    return process.env[key] || DEFAULT_BASE[this.environment];
  }

  private tlsOptions() {
    const cert = process.env.ZIMRA_CLIENT_CERT_PEM;
    const key = process.env.ZIMRA_CLIENT_KEY_PEM;
    if (!cert || !key) notConfigured(this.environment, 'missing ZIMRA_CLIENT_CERT_PEM / ZIMRA_CLIENT_KEY_PEM');
    return {
      cert,
      key,
      rejectUnauthorized: process.env.ZIMRA_TLS_REJECT_UNAUTHORIZED !== 'false',
      ca: process.env.ZIMRA_CA_PEM || undefined,
    };
  }

  private call(operation: keyof typeof DEFAULT_ENDPOINTS, body: any): Promise<any> {
    const path = this.endpoints()[operation];
    if (!path) notConfigured(this.environment, `no endpoint configured for "${operation}"`);
    const url = new URL(path, this.baseUrl());
    const payload = JSON.stringify(body ?? {});
    const tls = this.tlsOptions();
    const timeout = Number(process.env.ZIMRA_TIMEOUT_MS || 30000);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            Accept: 'application/json',
          },
          cert: tls.cert,
          key: tls.key,
          ca: tls.ca,
          rejectUnauthorized: tls.rejectUnauthorized,
          timeout,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            let parsed: any = data;
            try { parsed = data ? JSON.parse(data) : null; } catch { /* keep raw */ }
            const status = res.statusCode || 0;
            if (status >= 200 && status < 300) return resolve(parsed);
            reject(new Error(`ZIMRA ${this.environment} ${operation} failed (HTTP ${status}): ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`));
          });
        },
      );
      req.on('timeout', () => { req.destroy(new Error(`ZIMRA ${this.environment} ${operation} timed out after ${timeout}ms`)); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  verifyTaxpayer(input: any) { return this.call('verifyTaxpayer', input); }
  registerDevice(input: any) { return this.call('registerDevice', input); }
  getConfig(input: any) { return this.call('getConfig', input); }
  openDay(input: any) { return this.call('openDay', input); }
  submitReceipt(input: any) { return this.call('submitReceipt', input); }
  closeDay(input: any) { return this.call('closeDay', input); }
}
