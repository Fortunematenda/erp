import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { CommonModule } from '../../core/common/common.module';
import { PerformanceController } from './performance.controller';
import { KpiTemplateService } from './kpi-template.service';
import { PerformanceCycleService } from './performance-cycle.service';
import { PerformanceAssessmentService } from './performance-assessment.service';
import { PerformanceIncentiveService } from './performance-incentive.service';
import { PerformanceDashboardService } from './performance-dashboard.service';
import { PerformanceCalculationService } from './performance-calculation.service';
import { SystemKpiSourceService } from './system-kpi-source.service';

@Module({
  imports: [AuthModule, PrismaModule, CommonModule],
  controllers: [PerformanceController],
  providers: [
    KpiTemplateService,
    PerformanceCycleService,
    PerformanceAssessmentService,
    PerformanceIncentiveService,
    PerformanceDashboardService,
    PerformanceCalculationService,
    SystemKpiSourceService,
  ],
  exports: [PerformanceCalculationService],
})
export class PerformanceModule {}
