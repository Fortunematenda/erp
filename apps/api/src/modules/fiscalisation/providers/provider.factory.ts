import { Injectable } from '@nestjs/common';
import { MockZimraProvider } from './mock-zimra.provider';
import { FiscalProvider } from './fiscal-provider';
import { ZimraTestProvider, ZimraProductionProvider } from './zimra.provider';

@Injectable()
export class FiscalProviderFactory {
  get(): FiscalProvider {
    const mode = (process.env.ZIMRA_MODE || 'mock').toLowerCase();
    if (mode === 'mock') return new MockZimraProvider();
    if (mode === 'test') return new ZimraTestProvider();
    if (mode === 'production') return new ZimraProductionProvider();
    throw new Error(`Unsupported ZIMRA_MODE "${mode}". Expected mock | test | production.`);
  }
}
