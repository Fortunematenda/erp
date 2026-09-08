import { Body, Controller, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { DeliveryService } from './delivery.service';

@ApiTags('Delivery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delivery')
export class DeliveryController {
  constructor(private delivery: DeliveryService) {}

  @Get('templates') templates(@Req() req: any) { return this.delivery.templates(companyIdOf(req.user)); }
  @Put('templates/:code') saveTemplate(@Req() req: any, @Param('code') code: string, @Body() body: any) { return this.delivery.saveTemplate(companyIdOf(req.user), code, body); }
  @Post('templates/:code/render') render(@Req() req: any, @Param('code') code: string, @Body() body: any) { return this.delivery.renderTemplate(companyIdOf(req.user), code, body); }
  @Post('templates/:code/send') send(@Req() req: any, @Param('code') code: string, @Body() body: { to: string; data: any }) { return this.delivery.send(companyIdOf(req.user), code, body.to, body.data); }

  @Get('export/:entity') async export(@Req() req: any, @Param('entity') entity: string, @Res() res: any) {
    const csv = await this.delivery.csv(entity, companyIdOf(req.user));
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${entity}.csv"` });
    res.send(csv);
  }

  @Post('import/:entity') async import(@Req() req: any, @Param('entity') entity: string, @Body() body: { csv: string }) {
    return this.delivery.importCsv(entity, companyIdOf(req.user), body.csv);
  }
}
