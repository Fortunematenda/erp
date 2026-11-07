import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesModule } from '../sales/sales.module';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { ApiKeysController } from './api-keys.controller';
import { ExternalApiController } from './external-api.controller';
import { ExternalApiService } from './external-api.service';

@Module({
  imports: [AuthModule, SalesModule],
  controllers: [ApiKeysController, ExternalApiController],
  providers: [ApiKeyService, ApiKeyGuard, ExternalApiService],
})
export class ExternalApiModule {}
