import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsController } from './integrations.controller';
import { AdaptersService } from './adapters.service';
import { IntegrationsService } from './integrations.service';
import { IntegrationProviderFactory } from './providers';

@Module({ imports: [AuthModule], controllers: [IntegrationsController], providers: [AdaptersService, IntegrationsService, IntegrationProviderFactory], exports: [AdaptersService, IntegrationsService] })
export class IntegrationsModule {}
