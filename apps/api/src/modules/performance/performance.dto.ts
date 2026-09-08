import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class KpiLineDto {
  @IsOptional() @IsString() code?: string;
  @IsString() name!: string;
  @IsString() description!: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() categoryLabel?: string;
  @Type(() => Number) @IsNumber() weight!: number;
  @IsOptional() @IsString() measurementType?: string;
  @IsOptional() @IsString() direction?: string;
  @IsOptional() @IsString() scoringMethod?: string;
  @IsOptional() @IsString() targetType?: string;
  @IsOptional() @IsNumber() targetValue?: number;
  @IsOptional() @IsString() targetText?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() dataSource?: string;
  @IsOptional() @IsString() dataSourceLabel?: string;
  @IsOptional() @IsBoolean() critical?: boolean;
  @IsOptional() @IsNumber() minimumAcceptable?: number;
  @IsOptional() @IsNumber() stretchTarget?: number;
  @IsOptional() @IsBoolean() evidenceRequired?: boolean;
  @IsOptional() @IsBoolean() employeeCommentRequired?: boolean;
  @IsOptional() @IsBoolean() reviewerCommentRequired?: boolean;
  @IsOptional() @IsNumber() position?: number;
}

export class KpiTemplateDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() departmentId!: string;
  @IsOptional() @IsString() jobRole?: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsOptional() @Type(() => Number) @IsNumber() passMark?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxAchievement?: number;
  @IsOptional() @Type(() => Number) @IsNumber() criticalMin?: number;
  @IsOptional() @IsBoolean() selfAssessment?: boolean;
  @IsOptional() @IsBoolean() qaRequired?: boolean;
  @IsOptional() @IsBoolean() managerQaDistinct?: boolean;
  @IsOptional() @IsArray() kpis?: KpiLineDto[];
}

export class CycleDto {
  @IsString() name!: string;
  @IsOptional() @IsString() cycleType?: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsDateString() submissionOpens!: string;
  @IsDateString() employeeDeadline!: string;
  @IsDateString() managerDeadline!: string;
  @IsOptional() @IsDateString() qaDeadline?: string;
  @IsOptional() @IsDateString() approvalDeadline?: string;
  @IsOptional() @IsString() includeNewHires?: string;
  @IsOptional() @IsArray() departmentIds?: string[];
  @IsOptional() @IsArray() employeeIds?: string[];
}

export class KpiSubmissionLineDto {
  @IsString() kpiId!: string;
  @IsOptional() actual?: any;
  @IsOptional() @IsString() actualText?: string;
  @IsOptional() @IsNumber() score?: number;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() evidence?: string;
}
