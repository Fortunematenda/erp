import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AssetDto {
  @IsOptional() @IsString() assetNo?: string;
  @IsString() name!: string;
  @IsString() category!: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() purchaseDate?: string;
  @Type(() => Number) @IsNumber() cost!: number;
  @IsOptional() @Type(() => Number) @IsNumber() salvageValue?: number;
  @IsOptional() @Type(() => Number) @IsNumber() usefulLife?: number;
}

export class MaintenanceDto {
  @IsString() assetId!: string;
  @IsString() scheduledDate!: string;
  @IsOptional() @IsString() completedDate?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() cost?: number;
}