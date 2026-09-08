import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { FinanceModule } from '../finance/finance.module';
import { DocumentTrailModule } from '../document-trail/document-trail.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomerPaymentsService } from './customer-payments.service';
import { PricingService } from './pricing.service';
import { QuotationStatusService } from './quotation-status.service';
import { SalesIntegrityService } from './sales-integrity.service';

@Module({
  imports: [AuthModule, FinanceModule, DocumentTrailModule, InventoryModule],
  controllers: [SalesController],
  providers: [CustomerPaymentsService, PricingService, QuotationStatusService, SalesIntegrityService],
  exports: [CustomerPaymentsService, PricingService, QuotationStatusService, SalesIntegrityService],
})
export class SalesModule {}
