import { Module } from '@nestjs/common';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';
import { BankProviderRegistry, DemoBankProvider } from './bank-providers';
import { SecretService } from '../../core/common/secret.service';

@Module({
  controllers: [BankingController],
  providers: [BankingService, BankProviderRegistry, DemoBankProvider, SecretService],
  exports: [BankingService, BankProviderRegistry],
})
export class BankingModule {}
