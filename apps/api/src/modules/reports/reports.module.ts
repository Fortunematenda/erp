import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { CommonModule } from '../../core/common/common.module';
import { ReportsController } from './reports.controller';
import { ReportService } from './report.service';
@Module({ imports: [AuthModule, PrismaModule, CommonModule], controllers: [ReportsController], providers: [ReportService], exports: [ReportService] })
export class ReportsModule {}
