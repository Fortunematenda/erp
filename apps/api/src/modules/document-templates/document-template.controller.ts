import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { companyIdOf } from '../../core/context';
import { DocumentTemplateService } from './document-template.service';

@ApiTags('Document Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('document-templates')
export class DocumentTemplateController {
  constructor(private svc: DocumentTemplateService) {}

  @UseGuards(PermissionsGuard) @RequirePermissions('sales.invoice_templates.view', 'sales.quote_templates.view') @Get() list(@Req() req: any) { return this.svc.list(companyIdOf(req.user)); }
  @UseGuards(PermissionsGuard) @RequirePermissions('sales.invoice_templates.view', 'sales.quote_templates.view') @Get(':type') one(@Req() req: any, @Param('type') type: string) { return this.svc.getFor(companyIdOf(req.user), type); }
  @UseGuards(PermissionsGuard) @RequirePermissions('sales.invoice_templates.manage', 'sales.quote_templates.manage') @Put(':type') save(@Req() req: any, @Param('type') type: string, @Body() body: any) { return this.svc.save(companyIdOf(req.user), type, body, req.user.sub); }
  @UseGuards(PermissionsGuard) @RequirePermissions('sales.invoice_templates.manage', 'sales.quote_templates.manage') @Post(':type/reset') reset(@Req() req: any, @Param('type') type: string) { return this.svc.reset(companyIdOf(req.user), type, req.user.sub); }
  @UseGuards(PermissionsGuard) @RequirePermissions('sales.invoice_templates.manage', 'sales.quote_templates.manage') @Post('default/:type/:id') setDefault(@Req() req: any, @Param('type') type: string, @Param('id') id: string) { return this.svc.setDefault(companyIdOf(req.user), type, id, req.user.sub); }
  @UseGuards(PermissionsGuard) @RequirePermissions('sales.invoice_templates.manage', 'sales.quote_templates.manage') @Post(':type/duplicate') duplicate(@Req() req: any, @Param('type') type: string, @Body() body: any) { return this.svc.duplicate(companyIdOf(req.user), type, body, req.user.sub); }
}
