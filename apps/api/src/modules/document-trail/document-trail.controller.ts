import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { PermissionService } from '../auth/permission.service';
import { companyIdOf } from '../../core/context';
import { DocumentTrailService } from './document-trail.service';
import { DocumentEmailService } from './document-email.service';

@ApiTags('Document Trail')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentTrailController {
  constructor(private trail: DocumentTrailService, private email: DocumentEmailService, private permissions: PermissionService) {}

  private norm(type: string): string { const t = String(type || '').toUpperCase().replace(/-/g, '_'); if (t === 'QUOTE' || t === 'QUOTATION') return 'QUOTE'; if (t === 'SALES_ORDER' || t === 'ORDER') return 'SALES_ORDER'; if (t === 'DELIVERY' || t === 'DELIVERY_NOTE') return 'DELIVERY'; if (t === 'RECEIPT') return 'RECEIPT'; if (t === 'CREDIT_NOTE') return 'CREDIT_NOTE'; if (t === 'DEBIT_NOTE') return 'DEBIT_NOTE'; return 'INVOICE'; }
  private async requireAny(user: any, perms: string[]) {
    const have = await this.permissions.getPermissions(user);
    if (!perms.some((p) => have.includes(p))) throw new ForbiddenException();
  }

  @UseGuards(PermissionsGuard) @RequirePermissions('sales.invoices.view', 'sales.quotes.view', 'sales.orders.view', 'sales.deliveries.view', 'sales.receipts.view', 'sales.credit_notes.view', 'sales.debit_notes.view') @Get(':type/:id/trail') trailList(@Req() req: any, @Param('type') type: string, @Param('id') id: string, @Query() q: any) {
    return this.trail.list(companyIdOf(req.user), this.norm(type), id, { limit: q.limit, cursor: q.cursor });
  }

  @Post(':type/:id/notes') async addNote(@Req() req: any, @Param('type') type: string, @Param('id') id: string, @Body() body: any) {
    const t = this.norm(type);
    const perms = t === 'QUOTE' ? ['sales.quotes.notes.create'] : t === 'SALES_ORDER' ? ['sales.orders.edit', 'sales.orders.manage'] : t === 'DELIVERY' ? ['sales.deliveries.edit', 'sales.deliveries.create'] : t === 'RECEIPT' ? ['sales.receipts.create', 'sales.receipts.view'] : t === 'CREDIT_NOTE' ? ['sales.credit_notes.edit', 'sales.credit_notes.create'] : t === 'DEBIT_NOTE' ? ['sales.debit_notes.edit', 'sales.debit_notes.create'] : ['sales.invoices.notes.create'];
    await this.requireAny(req.user, perms);
    return this.trail.addNote(companyIdOf(req.user), t, id, body.note, req.user.sub);
  }

  @Post(':type/:id/email') async sendEmail(@Req() req: any, @Param('type') type: string, @Param('id') id: string, @Body() body: any) {
    const t = this.norm(type) as 'INVOICE' | 'QUOTE';
    await this.requireAny(req.user, t === 'QUOTE' ? ['sales.quotes.email'] : ['sales.invoices.email', 'sales.invoices.create']);
    return this.email.send(companyIdOf(req.user), req.user.sub, { documentType: t, documentId: id, to: Array.isArray(body.to) ? body.to : [body.to], cc: body.cc, bcc: body.bcc, subject: body.subject, message: body.message });
  }
}
