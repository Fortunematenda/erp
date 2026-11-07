import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { companyIdOf } from '../../core/context';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { API_KEY_SCOPES, ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './external-api.dto';

@ApiTags('Integrations') @ApiBearerAuth() @UseGuards(JwtAuthGuard, PermissionsGuard) @Controller('integrations/api-keys')
export class ApiKeysController {
  constructor(private keys: ApiKeyService) {}

  @Get('scopes') @RequirePermissions('integrations.api_keys.manage')
  scopes() {
    return Object.entries(API_KEY_SCOPES).map(([scope, permissions]) => ({ scope, permissions }));
  }

  @Get() @RequirePermissions('integrations.api_keys.manage')
  list(@Req() req: any) {
    return this.keys.list(companyIdOf(req.user));
  }

  /** The plaintext key is only returned in this response. */
  @Post() @RequirePermissions('integrations.api_keys.manage')
  create(@Req() req: any, @Body() dto: CreateApiKeyDto) {
    return this.keys.create(req.user, companyIdOf(req.user), dto);
  }

  @Post(':id/revoke') @HttpCode(200) @RequirePermissions('integrations.api_keys.manage')
  revoke(@Req() req: any, @Param('id') id: string) {
    return this.keys.revoke(req.user, companyIdOf(req.user), id);
  }
}
