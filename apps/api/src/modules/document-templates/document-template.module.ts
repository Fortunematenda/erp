import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentTemplateController } from './document-template.controller';
import { DocumentTemplateService } from './document-template.service';

@Module({ imports: [AuthModule], controllers: [DocumentTemplateController], providers: [DocumentTemplateService], exports: [DocumentTemplateService] })
export class DocumentTemplateModule {}
