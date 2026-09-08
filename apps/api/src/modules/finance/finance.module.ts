import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceController } from './finance.controller';
import { PostingService } from './posting.service';
import { InvoiceStatusService } from './invoice-status.service';
import { GeneralLedgerService } from './general-ledger.service';
@Module({ imports: [AuthModule], controllers: [FinanceController], providers: [PostingService, InvoiceStatusService, GeneralLedgerService], exports: [PostingService, InvoiceStatusService, GeneralLedgerService] })
export class FinanceModule {}
