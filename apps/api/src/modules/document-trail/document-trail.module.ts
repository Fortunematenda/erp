import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { DocumentTrailController } from './document-trail.controller';
import { DocumentTrailService } from './document-trail.service';
import { DocumentEmailService } from './document-email.service';

@Module({ imports: [AuthModule, DocumentsModule], controllers: [DocumentTrailController], providers: [DocumentTrailService, DocumentEmailService], exports: [DocumentTrailService, DocumentEmailService] })
export class DocumentTrailModule {}
