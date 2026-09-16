import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PasswordService } from '../../infra/security/password.service.js';
import { TotpService } from '../../infra/security/totp.service.js';
import { OtpService } from './otp.service.js';
import { SessionService, type CreateSessionMeta } from './session.service.js';
import { PrincipalKind } from '../../generated/prisma/enums.js';
import type { UserModel } from '../../generated/prisma/models.js';
import type { OfficerEnrollCompleteDto, OfficerEnrollStartDto, OfficerEnrollVerifyTotpDto, OfficerLoginDto } from './dto/officer-auth.dto.js';

/**
 * Password + mandatory TOTP 2FA for VENDOR/OPERATOR principals
 * (SDD §5.1 / DECISIONS_V2_SCOPE.md §7.2) — a credential path entirely
 * separate from resident phone/email OTP (AuthService). There is no
 * self-serve account creation here: a VENDOR/OPERATOR User row (email set,
 * principalKind set, no passwordHash/totpSecret yet) is provisioned
 * directly — real admin/operator-console account-management CRUD is
 * Phase 6.3's job (BACKEND_PLAN.md Phase 6.3). What this service owns is
 * turning that bare row into a real, 2FA-enforced login:
 *
 *   1. enrollStart  — proves the caller owns the account's inbox by
 *      re-using the existing email-OTP machinery (OtpService), exactly
 *      like a resident's first OTP.
 *   2. enrollComplete — consumes that OTP, sets passwordHash (argon2, via
 *      PasswordService) and generates a TOTP secret, returning its
 *      provisioning URI. totpEnabledAt stays null — enrollment isn't
 *      "on" until a real code from that secret is verified.
 *   3. enrollVerifyTotp — proves the caller's authenticator app actually
 *      has the secret (not just that enrollComplete's response was read)
 *      by checking a live code, then flips totpEnabledAt.
 *   4. login — password, THEN TOTP, in that order; a session is only
 *      issued once both pass. Requires totpEnabledAt (2FA is mandatory,
 *      not optional, for this principal kind — a mid-enrollment account
 *      cannot log in via this path at all).
 */
@Injectable()
export class OfficerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly notifications: NotificationsService,
    private readonly sessionService: SessionService,
    private readonly passwordService: PasswordService,
    private readonly totpService: TotpService,
  ) {}

  async enrollStart(dto: OfficerEnrollStartDto): Promise<void> {
    const user = await this.findOfficerUserOrThrow(dto.email);
    if (user.totpEnabledAt) {
      throw new ConflictException('Account already enrolled — use POST /auth/officer/login');
    }
    const code = await this.otpService.request(user.id);
    await this.notifications.sendOtpEmail(user.email, code);
  }

  async enrollComplete(dto: OfficerEnrollCompleteDto): Promise<{ totpSecret: string; otpauthUrl: string }> {
    const user = await this.findOfficerUserOrThrow(dto.email);
    if (user.totpEnabledAt) {
      throw new ConflictException('Account already enrolled — use POST /auth/officer/login');
    }

    const ok = await this.otpService.verify(user.id, dto.code);
    if (!ok) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const totpSecret = await this.totpService.generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, totpSecret } });

    const otpauthUrl = await this.totpService.provisioningUri(totpSecret, user.email);
    return { totpSecret, otpauthUrl };
  }

  async enrollVerifyTotp(dto: OfficerEnrollVerifyTotpDto): Promise<void> {
    const user = await this.findOfficerUserOrThrow(dto.email);
    if (user.totpEnabledAt) {
      throw new ConflictException('Account already enrolled — use POST /auth/officer/login');
    }
    if (!user.passwordHash || !user.totpSecret) {
      throw new UnauthorizedException('Complete password enrollment first (POST /auth/officer/enroll/complete)');
    }

    const ok = await this.totpService.verify(user.totpSecret, dto.code);
    if (!ok) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
  }

  async login(dto: OfficerLoginDto, meta: CreateSessionMeta = {}): Promise<{ rawToken: string; user: UserModel }> {
    const user = await this.findOfficerUserOrThrow(dto.email);
    if (!user.passwordHash || !user.totpSecret || !user.totpEnabledAt) {
      throw new UnauthorizedException('2FA enrollment is not complete for this account');
    }

    const passwordOk = await this.passwordService.verify(user.passwordHash, dto.password);
    if (!passwordOk) {
      // Deliberately the same message as a bad TOTP code below — don't leak which factor failed.
      throw new UnauthorizedException('Invalid credentials');
    }

    const totpOk = await this.totpService.verify(user.totpSecret, dto.totpCode);
    if (!totpOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { rawToken } = await this.sessionService.create(user.id, meta);
    return { rawToken, user };
  }

  private async findOfficerUserOrThrow(email: string): Promise<UserModel> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || (user.principalKind !== PrincipalKind.VENDOR && user.principalKind !== PrincipalKind.OPERATOR)) {
      throw new NotFoundException('No vendor/operator account with this email');
    }
    return user;
  }
}
