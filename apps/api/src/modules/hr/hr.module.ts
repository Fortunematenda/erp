import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AuthModule } from '../auth/auth.module';
import { HrController } from './hr.controller';
import { RecruitmentService } from './recruitment.service';
import { HrService } from './hr.service';
@Module({ imports: [FinanceModule, AuthModule], controllers: [HrController], providers: [RecruitmentService, HrService] })
export class HrModule {}
