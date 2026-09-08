import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class EmployeeDto {
  @IsOptional() @IsString() employeeNo?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsString() firstName!: string;
  @IsOptional() @IsString() middleName?: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString() preferredName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() workEmail?: string;
  @IsOptional() @IsString() personalEmail?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsString() hireDate!: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() idType?: string;
  @IsOptional() @IsString() idNumber?: string;
  @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() addressLine1?: string;
  @IsOptional() @IsString() addressLine2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @Type(() => Number) @IsNumber() basicSalary!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() contractType?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() employmentStatus?: string;
  @IsOptional() @IsString() workCalendarId?: string;
  @IsOptional() @IsDateString() probationEndDate?: string;
  @IsOptional() @IsDateString() contractEndDate?: string;
  @IsOptional() @IsString() payFrequency?: string;
  @IsOptional() @IsString() compensationType?: string;
  @IsOptional() @IsObject() bankDetails?: any;
  @IsOptional() @IsObject() taxDetails?: any;
  @IsOptional() @IsObject() emergencyContact?: any;
  @IsOptional() @IsObject() allowances?: any;
  @IsOptional() @IsObject() deductions?: any;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class LeaveDto {
  @IsString() employeeId!: string;
  @IsOptional() @IsString() leaveType?: string;
  @IsOptional() @IsString() leaveTypeId?: string;
  @IsString() startDate!: string;
  @IsString() endDate!: string;
  @IsOptional() @IsString() halfDay?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() attachment?: string;
  @IsOptional() @IsString() approverId?: string;
}

export class CompensationDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsDateString() effectiveDate!: string;
  @Type(() => Number) @IsNumber() baseSalary!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() payFrequency?: string;
  @IsOptional() @IsString() compensationType?: string;
  @IsOptional() @IsString() reason?: string;
}

export class PerformanceReviewDto {
  @IsString() employeeId!: string;
  @IsOptional() @IsString() cycleId?: string;
  @IsOptional() @IsObject() selfReview?: any;
  @IsOptional() @IsObject() managerReview?: any;
  @IsOptional() @IsArray() goals?: any;
  @IsOptional() @Type(() => Number) @IsNumber() overallRating?: number;
  @IsOptional() @IsString() comments?: string;
}

export class QaAssessmentDto {
  @IsString() employeeId!: string;
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() reviewerId?: string;
  @IsOptional() @IsString() workReference?: string;
  @IsOptional() @IsArray() scores?: any;
  @IsOptional() @IsString() findings?: string;
  @IsOptional() @IsString() comments?: string;
  @IsOptional() @IsString() correctiveActions?: string;
}

export class QaTemplateDto {
  @IsString() name!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() jobRole?: string;
  @IsOptional() @IsString() frequency?: string;
  @IsOptional() @Type(() => Number) @IsNumber() passThreshold?: number;
  @IsOptional() @IsObject() criteria?: any;
}

export class IncentiveDto {
  @IsString() employeeId!: string;
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsString() period?: string;
  @Type(() => Number) @IsNumber() amount!: number;
  @IsOptional() @IsString() notes?: string;
}

export class AttendanceDto {
  @IsString() employeeId!: string;
  @IsString() date!: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() checkIn?: string;
  @IsOptional() @IsString() checkOut?: string;
  @IsOptional() @IsString() note?: string;
}

export class PayrollRunDto {
  @Type(() => Number) @IsInt() period!: number;
  @Type(() => Number) @IsInt() year!: number;
  @IsOptional() @IsDateString() payDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class StatutoryDto {
  @IsString() country!: string;
  @IsString() authority!: string;
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() validFrom!: string;
  @IsOptional() @IsString() validTo?: string;
  @IsObject() configuration!: any;
}