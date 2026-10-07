import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryMovementService } from './inventory-movement.service';
import { ItemResolverService } from './item-resolver.service';
import { PricingService } from '../sales/pricing.service';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [AuthModule, FinanceModule],
  controllers: [InventoryController],
  providers: [InventoryMovementService, ItemResolverService, PricingService],
  exports: [InventoryMovementService, ItemResolverService],
})
export class InventoryModule {}
