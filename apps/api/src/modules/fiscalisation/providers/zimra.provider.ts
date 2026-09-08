import { FiscalProvider } from './fiscal-provider';

// Explicit stubs — they never fake success. Live/test activation requires official
// ZIMRA credentials + UAT approval, so these throw a clear configuration error.

function notConfigured(env: string): never {
  throw new Error(`ZIMRA ${env} mode requires official credentials and UAT approval. Configure ZIMRA_* secrets and set ZIMRA_MODE=${env}.`);
}

export class ZimraTestProvider implements FiscalProvider {
  async verifyTaxpayer(_p: any) { notConfigured('test'); }
  async registerDevice(_p: any) { notConfigured('test'); }
  async getConfig(_p: any) { notConfigured('test'); }
  async openDay(_p: any) { notConfigured('test'); }
  async submitReceipt(_p: any) { notConfigured('test'); }
  async closeDay(_p: any) { notConfigured('test'); }
}

export class ZimraProductionProvider implements FiscalProvider {
  async verifyTaxpayer(_p: any) { notConfigured('production'); }
  async registerDevice(_p: any) { notConfigured('production'); }
  async getConfig(_p: any) { notConfigured('production'); }
  async openDay(_p: any) { notConfigured('production'); }
  async submitReceipt(_p: any) { notConfigured('production'); }
  async closeDay(_p: any) { notConfigured('production'); }
}
