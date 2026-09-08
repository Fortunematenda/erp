import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AuthModule } from '../auth/auth.module';
import { ProcurementController } from './procurement.controller';
@Module({ imports: [FinanceModule, AuthModule], controllers: [ProcurementController] })
export class ProcurementModule {}
