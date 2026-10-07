import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { AuthModule } from '../auth/auth.module';
import { HrController } from './hr.controller';
import { Employee360Controller } from './employee-360.controller';
import { Department360Controller } from './department-360.controller';
import { LeaveController } from './leave.controller';
import { PayrollController } from './payroll.controller';
import { PayrollSettingsController } from './payroll-settings.controller';
import { RecruitmentService } from './recruitment.service';
import { HrService } from './hr.service';
import { Employee360Service } from './employee-360.service';
import { Department360Service } from './department-360.service';
import { LeaveService } from './leave.service';
import { PayrollService } from './payroll.service';
import { PayrollSettingsService } from './payroll-settings.service';
@Module({ imports: [FinanceModule, AuthModule], controllers: [HrController, Employee360Controller, Department360Controller, LeaveController, PayrollController, PayrollSettingsController], providers: [RecruitmentService, HrService, Employee360Service, Department360Service, LeaveService, PayrollService, PayrollSettingsService] })
export class HrModule {}
