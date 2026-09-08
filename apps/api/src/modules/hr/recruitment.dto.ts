import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

// ---- Requisition ----
export class RequisitionDto {
  @IsOptional() @IsString() requisitionNo?: string;
  @IsString() position!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() hiringManagerId?: string;
  @IsOptional() @IsString() requestedById?: string;
  @IsOptional() @IsString() projectId?: string;
  @Type(() => Number) @IsInt() @Min(1) openings!: number;
  @IsOptional() @IsString() employmentType?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsObject() primarySkills?: any;
  @IsOptional() @IsDateString() targetStartDate?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() replacementFor?: string;
  @IsOptional() @IsString() costCentre?: string;
  @IsOptional() @Type(() => Number) @IsNumber() salaryMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() salaryMax?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() jobDescription?: string;
  @IsOptional() @IsObject() requiredSkills?: any;
  @IsOptional() @IsString() qualifications?: string;
  @IsOptional() @Type(() => Number) @IsInt() experienceYears?: number;
  @IsOptional() @IsString() notes?: string;
}

// ---- Vacancy ----
export class VacancyDto {
  @IsOptional() @IsString() vacancyNo?: string;
  @IsOptional() @IsString() requisitionId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() hiringManagerId?: string;
  @IsOptional() @IsString() recruiterId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) openings?: number;
  @IsOptional() @IsString() employmentType?: string;
  @IsOptional() @IsDateString() targetStartDate?: string;
  @IsOptional() @IsDateString() closingDate?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() jobSummary?: string;
  @IsOptional() @IsArray() responsibilities?: string[];
  @IsOptional() @IsArray() requiredSkills?: string[];
  @IsOptional() @IsArray() preferredSkills?: string[];
  @IsOptional() @IsString() qualifications?: string;
  @IsOptional() @Type(() => Number) @IsInt() experienceYears?: number;
  @IsOptional() @IsString() workingConditions?: string;
  @IsOptional() @Type(() => Number) @IsNumber() salaryMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() salaryMax?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() payFrequency?: string;
  @IsOptional() @IsBoolean() internalOnly?: boolean;
}

// ---- Candidate (structured, no raw JSON) ----
export class CandidateDto {
  @IsOptional() @IsString() candidateNo?: string;
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() currentPosition?: string;
  @IsOptional() @IsString() currentEmployer?: string;
  @IsOptional() @Type(() => Number) @IsInt() yearsExperience?: number;
  @IsOptional() @IsString() noticePeriod?: string;
  @IsOptional() @Type(() => Number) @IsNumber() expectedCompensation?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() availability?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() referralId?: string;
  @IsOptional() @IsString() agencyId?: string;
  @IsOptional() @IsArray() skills?: string[];
  @IsOptional() @IsArray() education?: any[];
  @IsOptional() @IsArray() experience?: any[];
  @IsOptional() @IsArray() certifications?: string[];
  @IsOptional() @IsArray() languages?: string[];
  @IsOptional() @IsString() portfolio?: string;
  @IsOptional() @IsString() resumeUrl?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() talentPoolId?: string;
}

// ---- Application ----
export class ApplicationDto {
  @IsOptional() @IsString() applicationNo?: string;
  @IsString() vacancyId!: string;
  @IsString() candidateId!: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() notes?: string;
}

export class MoveStageDto {
  @IsString() stage!: string;
  @IsOptional() @IsString() comment?: string;
}

export class RejectApplicationDto {
  @IsString() reason!: string;
  @IsOptional() @IsString() notes?: string;
}

// ---- Interview ----
export class InterviewDto {
  @IsOptional() @IsString() interviewNo?: string;
  @IsString() applicationId!: string;
  @IsOptional() @IsString() interviewType?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsArray() interviewers?: string[];
  @IsOptional() @IsString() agenda?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() result?: string;
  @IsOptional() @IsString() decision?: string;
}

export class ScorecardDto {
  @IsOptional() @IsString() reviewerId?: string;
  @IsOptional() @IsArray() competencies?: any[];
  @IsOptional() @Type(() => Number) @IsNumber() overall?: number;
  @IsOptional() @IsString() recommendation?: string;
  @IsOptional() @IsString() comments?: string;
}

// ---- Offer ----
export class OfferDto {
  @IsOptional() @IsString() offerNo?: string;
  @IsString() applicationId!: string;
  @IsOptional() @IsString() candidateId?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() baseSalary?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() payFrequency?: string;
  @IsOptional() @IsString() employmentType?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() probationPeriod?: number;
  @IsOptional() @IsString() bonusPlan?: string;
  @IsOptional() @IsString() benefits?: string;
  @IsOptional() @IsString() workLocation?: string;
  @IsOptional() @IsString() workingHours?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsString() conditions?: string;
  @IsOptional() @IsString() notes?: string;
}

export class DeclineDto {
  @IsOptional() @IsString() reason?: string;
}

export class HireCandidateDto {
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() contractType?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber() basicSalary?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() payFrequency?: string;
  @IsOptional() @IsObject() bankDetails?: any;
  @IsOptional() @IsObject() taxDetails?: any;
}
