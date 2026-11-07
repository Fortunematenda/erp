import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, RequireScope } from './api-key.guard';
import { ExternalApiService } from './external-api.service';
import { UpsertCustomerDto, UpsertInvoiceDto, UpsertPaymentDto } from './external-api.dto';

/**
 * Server-to-server API (v1), authenticated with an integration API key:
 * `Authorization: Bearer nxk_...` or `X-Api-Key: nxk_...`.
 * PUT endpoints are idempotent per external ID and return 201 on first creation, 200 afterwards.
 */
@ApiTags('Integrations API v1') @ApiBearerAuth() @UseGuards(ApiKeyGuard) @Controller('integrations/v1')
export class ExternalApiController {
  constructor(private api: ExternalApiService) {}

  @Get('me') me(@Req() req: any) {
    const { id, companyId, source, scopes } = req.apiKey;
    return { keyId: id, companyId, source, scopes };
  }

  @Put('customers/:externalId') @RequireScope('customers:write')
  async upsertCustomer(@Req() req: any, @Res({ passthrough: true }) res: any, @Param('externalId') externalId: string, @Body() dto: UpsertCustomerDto) {
    const { created, customer } = await this.api.upsertCustomer(req.apiKey, externalId, dto);
    res.status(created ? 201 : 200);
    return customer;
  }

  @Get('customers/:externalId') @RequireScope('customers:read')
  getCustomer(@Req() req: any, @Param('externalId') externalId: string) {
    return this.api.getCustomer(req.apiKey, externalId);
  }

  @Put('invoices/:externalId') @RequireScope('invoices:write')
  async upsertInvoice(@Req() req: any, @Res({ passthrough: true }) res: any, @Param('externalId') externalId: string, @Body() dto: UpsertInvoiceDto) {
    const { created, invoice } = await this.api.upsertInvoice(req.apiKey, externalId, dto);
    res.status(created ? 201 : 200);
    return invoice;
  }

  @Get('invoices/:externalId') @RequireScope('invoices:read')
  getInvoice(@Req() req: any, @Param('externalId') externalId: string) {
    return this.api.getInvoice(req.apiKey, externalId);
  }

  @Post('invoices/:externalId/post') @HttpCode(200) @RequireScope('invoices:post')
  postInvoice(@Req() req: any, @Param('externalId') externalId: string) {
    return this.api.postInvoice(req.apiKey, externalId);
  }

  @Put('payments/:externalId') @RequireScope('payments:write')
  async upsertPayment(@Req() req: any, @Res({ passthrough: true }) res: any, @Param('externalId') externalId: string, @Body() dto: UpsertPaymentDto) {
    const { created, payment } = await this.api.upsertPayment(req.apiKey, externalId, dto);
    res.status(created ? 201 : 200);
    return payment;
  }

  @Get('payments/:externalId') @RequireScope('payments:read')
  getPayment(@Req() req: any, @Param('externalId') externalId: string) {
    return this.api.getPayment(req.apiKey, externalId);
  }
}
