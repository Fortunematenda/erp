import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionService } from './permission.service';
import * as bcrypt from 'bcryptjs';
import { generateSecret, verifyTotp, otpauthUrl, randomToken, sha256 } from '../../core/common/totp';

@Injectable()
export class AuthSecurityService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private permissions: PermissionService) {}

  private async issueTokens(user: any) {
    const access = this.jwt.sign({ sub: user.id, email: user.email, isPlatformAdmin: user.isPlatformAdmin });
    const refresh = randomToken(48);
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const existing = await this.prisma.refreshToken.findMany({ where: { userId: user.id, revokedAt: null } });
    for (const r of existing) await this.prisma.refreshToken.update({ where: { id: r.id }, data: { revokedAt: new Date() } });
    await this.prisma.refreshToken.create({ data: { userId: user.id, token: sha256(refresh), expiresAt: expires } });
    return { access_token: access, refresh_token: refresh, token: access, expires_at: expires };
  }

  async refresh(refreshToken: string) {
    const hash = sha256(refreshToken);
    const rt = await this.prisma.refreshToken.findUnique({ where: { token: hash }, include: { user: { include: { memberships: true } } } });
    if (!rt || rt.revokedAt || rt.expiresAt < new Date()) throw new UnauthorizedException('Invalid or expired refresh token');
    const user = rt.user;
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Account disabled');
    const newRefresh = randomToken(48);
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({ where: { id: rt.id }, data: { revokedAt: new Date(), replacedById: sha256(newRefresh) } });
      await tx.refreshToken.create({ data: { userId: user.id, token: sha256(newRefresh), expiresAt: expires } });
    });
    let access: string;
    if (user.isPlatformAdmin) access = this.jwt.sign({ sub: user.id, email: user.email, isPlatformAdmin: true });
    else {
      const m = user.memberships?.[0];
      if (!m) throw new ForbiddenException('No company access');
      access = this.jwt.sign({ sub: user.id, email: user.email, tenantId: m.tenantId, companyId: m.companyId, role: m.role, isPlatformAdmin: false });
    }
    return { token: access, refresh_token: newRefresh };
  }

  async getUserIdFromRefresh(refreshToken: string): Promise<string | null> {
    const hash = sha256(refreshToken);
    const rt = await this.prisma.refreshToken.findUnique({ where: { token: hash }, include: { user: true } });
    if (!rt || rt.revokedAt || rt.expiresAt < new Date() || rt.user.status !== 'ACTIVE') return null;
    return rt.userId;
  }

  async logout(userId: string, refreshToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, token: sha256(refreshToken) }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  async setupMfa(userId: string, account: string) {
    const secret = generateSecret();
    await this.prisma.mfaMethod.upsert({
      where: { userId_method: { userId, method: 'TOTP' } },
      update: { secret, verified: false, verifiedAt: null },
      create: { userId, method: 'TOTP', secret, verified: false },
    });
    return { secret, otpauthUrl: otpauthUrl(account, secret) };
  }

  async verifyMfaSetup(userId: string, code: string) {
    const m = await this.prisma.mfaMethod.findUnique({ where: { userId_method: { userId, method: 'TOTP' } } });
    if (!m || !m.secret) throw new BadRequestException('MFA not set up');
    if (!verifyTotp(m.secret, code)) throw new UnauthorizedException('Invalid code');
    await this.prisma.mfaMethod.update({ where: { id: m.id }, data: { verified: true, verifiedAt: new Date() } });
    return { mfa: true };
  }

  async disableMfa(userId: string) {
    await this.prisma.mfaMethod.deleteMany({ where: { userId } });
    return { mfa: false };
  }

  async requiresMfa(userId: string) {
    const m = await this.prisma.mfaMethod.findUnique({ where: { userId_method: { userId, method: 'TOTP' } } });
    return m?.verified === true;
  }

  async verifyMfaCode(userId: string, code: string) {
    const m = await this.prisma.mfaMethod.findUnique({ where: { userId_method: { userId, method: 'TOTP' } } });
    if (!m || !m.verified || !m.secret) throw new ForbiddenException('MFA not enabled');
    if (!verifyTotp(m.secret, code)) throw new UnauthorizedException('Invalid MFA code');
    await this.prisma.mfaMethod.update({ where: { id: m.id }, data: { lastUsedAt: new Date() } });
    return true;
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid email');
    const token = randomToken(32);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    // Mail is mocked in dev: return the token so a local build can proceed without a mail server.
    return { message: 'Reset token issued', reset_token: process.env.NODE_ENV === 'production' ? undefined : token };
  }

  async resetPassword(token: string, newPassword: string) {
    const hash = sha256(token);
    const user = await this.prisma.user.findFirst({ where: { passwordResetTokenHash: hash, passwordResetExpiresAt: { gt: new Date() } } });
    if (!user) throw new UnauthorizedException('Invalid or expired reset token');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null } });
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    return { reset: true };
  }

  async sendEmailVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid email');
    if (user.emailVerifiedAt) throw new BadRequestException('Email already verified');
    const token = randomToken(32);
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerificationTokenHash: sha256(token) } });
    return { message: 'Verification sent', token: process.env.NODE_ENV === 'production' ? undefined : token };
  }

  async verifyEmail(token: string) {
    const hash = sha256(token);
    const user = await this.prisma.user.findFirst({ where: { emailVerificationTokenHash: hash } });
    if (!user) throw new UnauthorizedException('Invalid verification token');
    await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null } });
    return { verified: true };
  }
}
