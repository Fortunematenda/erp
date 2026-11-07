import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsISO8601, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { API_KEY_SCOPES } from './api-key.service';

export class CreateApiKeyDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{1,39}$/i, { message: 'source must be 2-40 letters, digits, - or _' }) source!: string;
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(Object.keys(API_KEY_SCOPES), { each: true }) scopes!: string[];
  @IsOptional() @IsISO8601({ strict: true }) expiresAt?: string;
}

export class UpsertCustomerDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(40) mobile?: string;
  @IsOptional() @IsString() @MaxLength(200) address1?: string;
  @IsOptional() @IsString() @MaxLength(200) address2?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsString() @MaxLength(50) tin?: string;
  @IsOptional() @IsString() @MaxLength(50) vatNumber?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ExternalInvoiceLineDto {
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantity!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(100) taxRate!: number;
}

export class UpsertInvoiceDto {
  @IsString() @MinLength(1) @MaxLength(100) customerExternalId!: string;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsISO8601({ strict: true }) invoiceDate?: string;
  @IsOptional() @IsISO8601({ strict: true }) dueDate?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() fiscalRequired?: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ExternalInvoiceLineDto) lines!: ExternalInvoiceLineDto[];
  @IsOptional() @IsBoolean() post?: boolean;
}

export class ExternalAllocationDto {
  @IsString() @MinLength(1) @MaxLength(100) invoiceExternalId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
}

export class UpsertPaymentDto {
  @IsString() @MinLength(1) @MaxLength(100) customerExternalId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @IsOptional() @IsString() @MaxLength(30) method?: string;
  @IsOptional() @IsISO8601({ strict: true }) date?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ExternalAllocationDto) allocations?: ExternalAllocationDto[];
}
