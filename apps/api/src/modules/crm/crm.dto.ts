import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class LeadDto {
  @IsString() name!: string;
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @Type(() => Number) @IsNumber() probability?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @Type(() => Number) @IsNumber() estimatedValue?: number;
  @IsOptional() @IsString() expectedCloseDate?: string;
  @IsOptional() @IsString() owner?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() nextFollowUp?: string;
  @IsOptional() @IsString() interestedProducts?: string;
  @IsOptional() @IsString() budget?: string;
  @IsOptional() @IsString() authority?: string;
  @IsOptional() @IsString() need?: string;
  @IsOptional() @IsString() timeline?: string;
  @IsOptional() @Type(() => Number) @IsNumber() score?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @Type(() => Number) @IsNumber() position?: number;
}

export class StageMoveDto {
  @IsString() stage!: string;
  @IsOptional() @IsString() lostReason?: string;
  @IsOptional() @IsString() lostCompetitor?: string;
  @IsOptional() @IsString() closeDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber() dealValue?: number;
  @IsOptional() @IsString() notes?: string;
}

export class WonDto {
  @IsOptional() @Type(() => Number) @IsNumber() dealValue?: number;
  @IsOptional() @IsString() closeDate?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() nextStep?: string;
}

export class LostDto {
  @IsString() lostReason!: string;
  @IsOptional() @IsString() lostCompetitor?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ConvertDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsBoolean() forceCreate?: boolean;
  @IsOptional() @IsBoolean() createOpportunity?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() opportunityValue?: number;
  @IsOptional() @IsString() opportunityStage?: string;
}

export class PositionDto {
  @IsString() stage!: string;
  @IsOptional() @IsString() beforeId?: string;
  @IsOptional() @IsString() afterId?: string;
}

export class OpportunityDto {
  @IsOptional() @IsString() leadId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() stage?: string;
  @IsOptional() @Type(() => Number) @IsNumber() value?: number;
  @IsOptional() @Type(() => Number) @IsNumber() probability?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() expectedClose?: string;
  @IsOptional() @IsString() owner?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() nextAction?: string;
  @IsOptional() @IsString() sourceQuoteId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @Type(() => Number) @IsNumber() position?: number;
}

export class CrmTaskDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() relatedType?: string;
  @IsOptional() @IsString() relatedId?: string;
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsString() notes?: string;
}

export class InteractionDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() leadId?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsString() outcome?: string;
  @IsOptional() @IsString() nextAction?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() interactedAt?: string;
}
