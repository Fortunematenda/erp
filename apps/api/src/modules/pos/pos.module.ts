import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { FiscalisationModule } from '../fiscalisation/fiscalisation.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [AuthModule, FinanceModule, InventoryModule, SalesModule, FiscalisationModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
