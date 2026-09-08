import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { SalesModule } from '../sales/sales.module';
import { DocumentTrailModule } from '../document-trail/document-trail.module';

@Module({ imports: [SalesModule, DocumentTrailModule], controllers: [CrmController], providers: [CrmService] })
export class CrmModule {}
