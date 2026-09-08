import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryMovementService } from './inventory-movement.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryMovementService],
  exports: [InventoryMovementService],
})
export class InventoryModule {}
