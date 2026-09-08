import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FiscalisationController } from './fiscalisation.controller';
import { FiscalisationService } from './fiscalisation.service';
import { FiscalProviderFactory } from './providers/provider.factory';
@Module({ imports: [AuthModule], controllers: [FiscalisationController], providers: [FiscalisationService, FiscalProviderFactory] })
export class FiscalisationModule {}
