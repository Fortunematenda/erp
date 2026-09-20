import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcurementController } from './procurement.controller';
@Module({ imports: [FinanceModule, AuthModule, ApprovalsModule, InventoryModule], controllers: [ProcurementController] })
export class ProcurementModule {}
