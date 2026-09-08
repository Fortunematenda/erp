import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class RiskDto {
  @IsOptional() @IsString() code?: string;
  @IsString() title!: string;
  @IsString() category!: string;
  @IsOptional() @Type(() => Number) @IsNumber() likelihood?: number;
  @IsOptional() @Type(() => Number) @IsNumber() impact?: number;
  @IsOptional() @IsString() owner?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() mitigation?: string;
}

export class ObligationDto {
  @IsString() authority!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() frequency?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() notes?: string;
}