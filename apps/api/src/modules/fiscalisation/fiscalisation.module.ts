import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FiscalisationController } from './fiscalisation.controller';
import { FiscalisationService } from './fiscalisation.service';
import { FiscalisationReadinessService } from './fiscalisation-readiness.service';
import { FiscalCertificateService } from './fiscal-certificate.service';
import { FiscalRateLimitGuard } from './fiscal-rate-limit.guard';
import { FiscalProviderFactory } from './providers/provider.factory';
@Module({ imports: [AuthModule], controllers: [FiscalisationController], providers: [FiscalisationService, FiscalisationReadinessService, FiscalCertificateService, FiscalRateLimitGuard, FiscalProviderFactory] })
export class FiscalisationModule {}
