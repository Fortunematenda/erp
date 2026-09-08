import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateProjectDto {
  @IsOptional() @IsString() projectCode?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() budget?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() startDate?: string;
}
