import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { NumberingService } from './numbering.service';

@Global()
@Module({ providers: [AuditService, NumberingService], exports: [AuditService, NumberingService] })
export class CommonModule {}
