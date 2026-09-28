import { Injectable } from '@nestjs/common';
import { MockZimraProvider } from './mock-zimra.provider';
import { FiscalProvider } from './fiscal-provider';
import { ZimraHttpProvider } from './zimra-http.provider';

@Injectable()
export class FiscalProviderFactory {
  get(): FiscalProvider {
    const mode = (process.env.ZIMRA_MODE || 'mock').toLowerCase();
    if (mode === 'mock') return new MockZimraProvider();
    if (mode === 'test' || mode === 'sandbox') return new ZimraHttpProvider('SANDBOX');
    if (mode === 'production') return new ZimraHttpProvider('PRODUCTION');
    throw new Error(`Unsupported ZIMRA_MODE "${mode}". Expected mock | sandbox | production.`);
  }

  // Resolve the provider from the environment recorded on the device/profile.
  // SANDBOX and PRODUCTION never fall back to the mock provider.
  getForEnvironment(environment?: string | null): FiscalProvider {
    switch ((environment || 'MOCK').toUpperCase()) {
      case 'MOCK':
        return new MockZimraProvider();
      case 'SANDBOX':
        return new ZimraHttpProvider('SANDBOX');
      case 'PRODUCTION':
        return new ZimraHttpProvider('PRODUCTION');
      default:
        throw new Error(`Unsupported fiscal environment "${environment}".`);
    }
  }
}
