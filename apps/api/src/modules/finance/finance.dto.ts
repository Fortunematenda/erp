import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class AccountDto {
  @IsOptional() @IsString() code?: string;
  @IsString() name!: string;
  @IsString() type!: string;
  @IsOptional() @IsString() subtype?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() taxCode?: string;
  @IsOptional() @IsBoolean() isSystem?: boolean;
  @IsOptional() @IsString() customTypeName?: string;
  @IsOptional() @IsBoolean() isGroup?: boolean;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() openingBalance?: number;
  @IsOptional() @IsString() openingDate?: string;
  @IsOptional() @IsString() openingOffsetAccountId?: string;
}

export class JournalLineDto {
  @IsString() accountId!: string;
  @Type(() => Number) @IsNumber() debit!: number;
  @Type(() => Number) @IsNumber() credit!: number;
  @IsOptional() @IsString() description?: string;
}

export class CreateJournalDto {
  @IsOptional() @IsString() date?: string;
  @IsString() description!: string;
  @IsOptional() @IsString() reference?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => JournalLineDto) lines!: JournalLineDto[];
}

export class BudgetDto {
  @Type(() => Number) @IsNumber() fiscalYear!: number;
  @Type(() => Number) @IsNumber() period!: number;
  @IsString() accountId!: string;
  @Type(() => Number) @IsNumber() amount!: number;
}

export class TaxRateDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() name!: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) rate!: number;
  @IsOptional() @IsIn(['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']) treatment?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsString() taxCode?: string;
  @IsOptional() @IsString() authority?: string;
}