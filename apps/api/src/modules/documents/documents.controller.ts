import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/auth.guard';
import { companyIdOf } from '../../core/context';
import { DocumentsService } from './documents.service';
import { DocumentPdfService } from './document-pdf.service';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private docs: DocumentsService, private pdf: DocumentPdfService) {}

  @Get(':type/:id') build(@Req() req: any, @Param('type') type: string, @Param('id') id: string) { return this.docs.build(companyIdOf(req.user), type, id); }

  @Get(':type/:id/pdf') async pdfDoc(@Req() req: any, @Param('type') type: string, @Param('id') id: string, @Query() q: any, @Res() res: any) {
    const vm = await this.docs.build(companyIdOf(req.user), type, id);
    const buf = await this.pdf.generate(vm, { format: (q.format || 'A4').toUpperCase() === 'LETTER' ? 'LETTER' : 'A4' });
    const prefix = type === 'quotation' || type === 'quote' ? 'Quote' : this.capitalize(type);
    const name = `${prefix}_${(vm.number || id).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': buf.length });
    res.end(buf);
  }

  private capitalize(s: string) { return s.split('-').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('_'); }
}
