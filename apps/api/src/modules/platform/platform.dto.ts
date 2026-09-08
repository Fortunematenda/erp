import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
export class CreateTenantDto {
  @IsString() tenantName!: string;
  @IsString() slug!: string;
  @IsString() planName!: string;
  @IsString() legalName!: string;
  @IsOptional() @IsString() tradingName?: string;
  @IsString() companyCode!: string;
  @IsOptional() @IsString() tin?: string;
  @IsOptional() @IsString() vatNumber?: string;
  @IsOptional() @IsString() baseCurrency?: string;
  @IsString() branchName!: string;
  @IsString() branchCode!: string;
  @IsEmail() adminEmail!: string;
  @IsString() adminFirstName!: string;
  @IsString() adminLastName!: string;
  @IsString() @MinLength(10) adminPassword!: string;
}
