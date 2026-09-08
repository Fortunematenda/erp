import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthSecurityService } from './auth-security.service';
import { LoginDto, SwitchCompanyDto, MfaSetupDto, MfaVerifyDto, RefreshDto, ResetPasswordDto, EmailDto } from './auth.dto';
import { JwtAuthGuard } from './auth.guard';
import { PermissionService } from './permission.service';

const COOKIE = 'nexuserp_refresh';
async function setRefreshCookie(res: Response, token: string) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${30 * 24 * 3600}`);
}
async function clearRefreshCookie(res: Response) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`);
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private authSec: AuthSecurityService, private permissions: PermissionService) {}

  @Post('login') async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result: any = await this.auth.login(dto.email, dto.password);
    if (result.requiresMfa) return result;
    if (result.refresh_token) await setRefreshCookie(res, result.refresh_token);
    delete result.refresh_token; delete result.expires_at;
    return result;
  }
  @Post('login-mfa') async loginMfa(@Body() dto: MfaVerifyDto, @Res({ passthrough: true }) res: Response) {
    await this.authSec.verifyMfaCode(dto.userId, dto.code);
    const result: any = await this.auth.issueSession(dto.userId, dto.companyId);
    if (result.refresh_token) await setRefreshCookie(res, result.refresh_token);
    delete result.refresh_token; delete result.expires_at;
    return result;
  }
  // Session restoration (called by the frontend on load / new tab / browser restart).
  @Get('session') async session(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const token = this.readCookie(req);
    if (!token) return { authenticated: false };
    const preferred = (req.query?.companyId as string) || (req.body as any)?.companyId;
    const result: any = await this.auth.restoreSession(token, preferred);
    if (!result.authenticated) return { authenticated: false };
    if (result.refresh_token) await setRefreshCookie(res, result.refresh_token);
    delete result.refresh_token; delete result.expires_at;
    return result;
  }
  @Post('refresh') async refresh(@Body() dto: any, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const token = dto?.refreshToken || this.readCookie(req);
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const result: any = await this.authSec.refresh(token);
    if (result.refresh_token) await setRefreshCookie(res, result.refresh_token);
    return { token: result.token, refresh_token: result.refresh_token };
  }

  @Post('forgot-password') forgot(@Body() dto: EmailDto) { return this.authSec.forgotPassword(dto.email); }
  @Post('reset-password') reset(@Body() dto: ResetPasswordDto) { return this.authSec.resetPassword(dto.token, dto.newPassword); }
  @Post('verify-email/send') sendVerify(@Body() dto: EmailDto) { return this.authSec.sendEmailVerification(dto.email); }
  @Post('verify-email') verifyEmail(@Body() dto: { token: string }) { return this.authSec.verifyEmail(dto.token); }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('me') me(@Req() req: any) { return req.user; }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('permissions') async permissionsItself(@Req() req: any) { const user = req.user; const [permissions, roles] = await Promise.all([this.permissions.getPermissions(user), this.permissions.getRoleNames(user)]); return { permissions, roles }; }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('switch-company') switch(@Req() req: any, @Body() dto: SwitchCompanyDto) { return this.auth.switchCompany(req.user.sub, dto.companyId, req.user.email); }

  @Post('logout') async logout(@Req() req: any, @Body() dto: any, @Res({ passthrough: true }) res: Response) {
    const token = dto?.refreshToken || this.readCookie(req);
    if (token) {
      const userId = await this.authSec.getUserIdFromRefresh(token);
      if (userId) await this.authSec.logout(userId, token);
    }
    await clearRefreshCookie(res);
    return { ok: true };
  }

  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('mfa/setup') mfaSetup(@Req() req: any) { return this.authSec.setupMfa(req.user.sub, req.user.email); }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('mfa/verify') mfaVerify(@Req() req: any, @Body() dto: { code: string }) { return this.authSec.verifyMfaSetup(req.user.sub, dto.code); }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Post('mfa/disable') mfaDisable(@Req() req: any) { return this.authSec.disableMfa(req.user.sub); }
  @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Get('mfa/status') mfaStatus(@Req() req: any) { return this.authSec.requiresMfa(req.user.sub); }

  private readCookie(req: any): string | null {
    const c = req.headers?.cookie || '';
    const m = String(c).match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
}
