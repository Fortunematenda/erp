import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { BackupService } from './backup.service';
import { JobsService } from './jobs.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AuthModule],
  controllers: [SystemController],
  providers: [SystemService, BackupService, JobsService, SchedulerService],
  exports: [BackupService, JobsService],
})
export class SystemModule {}
