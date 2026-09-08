import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { companyIdOf } from '../../core/context';
import { JwtAuthGuard } from '../auth/auth.guard';
import { BankingService } from './banking.service';

@ApiTags('Banking') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('banking')
export class BankingController {
  constructor(private banking: BankingService) {}

  @Get('providers') providers() { return this.banking.listProviders(); }

  @Get('connections') connections(@Req() req: any) { return this.banking.listConnections(companyIdOf(req.user), req.user.tenantId); }

  @Get('connections/:id/accounts') accounts(@Req() req: any, @Param('id') id: string) { return this.banking.listAccounts(companyIdOf(req.user), id); }

  @Post('connections') async create(@Req() req: any, @Body() body: any) {
    return this.banking.createConnection(companyIdOf(req.user), req.user.tenantId, req.user.sub, { provider: body.provider, institutionName: body.institutionName, authorizeUrl: body.authorizeUrl });
  }

  @Post('connections/:id/sync') sync(@Req() req: any, @Param('id') id: string) { return this.banking.syncConnection(companyIdOf(req.user), id); }

  @Patch('accounts/:id') mapAccount(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.banking.mapAccount(companyIdOf(req.user), id, body); }

  @Get('feed') feed(@Req() req: any, @Query() q: any) { return this.banking.feed(companyIdOf(req.user), q.externalAccountId); }

  @Post('connections/:id/disconnect') disconnect(@Req() req: any, @Param('id') id: string) { return this.banking.disconnect(companyIdOf(req.user), id); }
}
