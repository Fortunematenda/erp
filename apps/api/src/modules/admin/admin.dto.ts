import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsObject, IsOptional, IsString, IsEmail } from 'class-validator';

export enum AccessScopeEnum {
  SINGLE_BRANCH = 'SINGLE_BRANCH',
  SELECTED_BRANCHES = 'SELECTED_BRANCHES',
  COMPANY_WIDE = 'COMPANY_WIDE',
  PLATFORM_WIDE = 'PLATFORM_WIDE',
}

export enum UserStatusEnum {
  ACTIVE = 'ACTIVE',
  INVITED = 'INVITED',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  LOCKED = 'LOCKED',
}

// ----- Users -----
export class CreateUserDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() companyId?: string; // platform admin may pick a company
  @IsOptional() @IsEnum(AccessScopeEnum) accessScope?: AccessScopeEnum;
  @IsOptional() @IsString() primaryBranchId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) additionalBranchIds?: string[];
  @IsOptional() @IsEnum(UserStatusEnum) status?: UserStatusEnum;
  @IsOptional() @IsBoolean() sendInvitation?: boolean;
  @IsOptional() @IsBoolean() isPlatformAdmin?: boolean;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() reason?: string;
}

export class UpdateUserAccessDto {
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsEnum(AccessScopeEnum) accessScope?: AccessScopeEnum;
  @IsOptional() @IsString() primaryBranchId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) additionalBranchIds?: string[];
  @IsOptional() @IsString() reason?: string;
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatusEnum) status!: UserStatusEnum;
  @IsOptional() @IsString() reason?: string;
}

export class InviteUserDto {
  @IsOptional() @IsString() reason?: string;
}

export class RevokeSessionDto {
  @IsOptional() @IsString() sessionId?: string; // omit = revoke all
}

// ----- Memberships -----
export class MembershipDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsEnum(AccessScopeEnum) accessScope?: AccessScopeEnum;
  @IsOptional() @IsString() primaryBranchId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) additionalBranchIds?: string[];
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() reason?: string;
}

export class UpdateMembershipDto {
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsEnum(AccessScopeEnum) accessScope?: AccessScopeEnum;
  @IsOptional() @IsString() primaryBranchId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) additionalBranchIds?: string[];
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() reason?: string;
}

// ----- Branches -----
export class BranchDto {
  @IsString() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() managerName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() defaultCurrency?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class BranchStatusDto {
  @IsBoolean() active!: boolean;
  @IsOptional() @IsString() reason?: string;
}

// ----- Audit -----
export class AuditFilterDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() module?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsString() result?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @Type(() => Number) from?: number;
  @IsOptional() @Type(() => Number) to?: number;
  @IsOptional() @Type(() => Number) page?: number;
  @IsOptional() @Type(() => Number) pageSize?: number;
}

// ----- Config -----
export class ConfigDto {
  @IsOptional() @IsString() key?: string;
  @IsOptional() @IsObject() value?: any;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() group?: string;
}

export class SaveConfigGroupDto {
  @IsObject() values!: Record<string, any>;
  @IsOptional() @IsString() reason?: string;
}

export class CreateTenantUserDto {
  @IsString() email!: string;
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @Type(() => Number) companyCount?: number;
}

export class AccessReviewDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() status?: string;
}
