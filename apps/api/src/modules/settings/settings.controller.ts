import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get() getAll(@Req() req: any) { return this.settings.getSchema().then((schema) => this.settings.get(companyIdOf(req.user)).then((values) => ({ schema, values }))); }
  @Put('groups/:id') saveGroup(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.settings.saveGroup(companyIdOf(req.user), id, body); }
  @Post('groups/:id/test') test(@Req() req: any, @Param('id') id: string) { return this.settings.test(companyIdOf(req.user), id); }
}
