import { IsEmail, IsOptional, IsString } from 'class-validator';
export class LoginDto { @IsEmail() email!:string; @IsString() password!:string }
export class SwitchCompanyDto { @IsString() companyId!:string }
export class RefreshDto { @IsString() refreshToken!:string }
export class MfaSetupDto { @IsString() code?:string }
export class MfaVerifyDto { @IsString() userId!:string; @IsString() code!:string; @IsOptional() @IsString() companyId?:string }
export class EmailDto { @IsEmail() email!:string }
export class ResetPasswordDto { @IsString() token!:string; @IsString() newPassword!:string }
