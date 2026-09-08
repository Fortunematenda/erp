import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentTemplateModule } from '../document-templates/document-template.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentPdfService } from './document-pdf.service';

@Module({ imports: [AuthModule, DocumentTemplateModule], controllers: [DocumentsController], providers: [DocumentsService, DocumentPdfService], exports: [DocumentsService, DocumentPdfService] })
export class DocumentsModule {}
