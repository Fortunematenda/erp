import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({ imports: [AuthModule, IntegrationsModule], controllers: [DeliveryController], providers: [DeliveryService], exports: [DeliveryService] })
export class DeliveryModule {}
