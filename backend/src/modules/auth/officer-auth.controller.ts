import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/config.service.js';
import { OfficerAuthService } from './officer-auth.service.js';
import { OfficerEnrollCompleteDto, OfficerEnrollStartDto, OfficerEnrollVerifyTotpDto, OfficerLoginDto } from './dto/officer-auth.dto.js';

/** Password + mandatory TOTP 2FA for committee officers and vendors — see OfficerAuthService's class doc comment. */
@Controller('auth/officer')
export class OfficerAuthController {
  constructor(
    private readonly officerAuth: OfficerAuthService,
    private readonly config: AppConfigService,
  ) {}

  /** Phase 6.5: 5/min per IP — sends an email OTP, same OTP-pumping vector as /auth/otp. */
  @Post('enroll/start')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async enrollStart(@Body() dto: OfficerEnrollStartDto): Promise<void> {
    await this.officerAuth.enrollStart(dto);
  }

  /** Phase 6.5: 10/min per IP — consumes the enroll OTP and sets the password; bounded but looser than the OTP-send step. */
  @Post('enroll/complete')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async enrollComplete(@Body() dto: OfficerEnrollCompleteDto): Promise<{ totpSecret: string; otpauthUrl: string }> {
    return this.officerAuth.enrollComplete(dto);
  }

  /** Phase 6.5: 10/min per IP — TOTP brute-force vector on enrollment. */
  @Post('enroll/verify-totp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async enrollVerifyTotp(@Body() dto: OfficerEnrollVerifyTotpDto): Promise<void> {
    await this.officerAuth.enrollVerifyTotp(dto);
  }

  /**
   * Phase 6.5: 5/min per IP — the tightest limit here, since this is a
   * combined password + TOTP brute-force target (officer/vendor/operator
   * login).
   */
  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: OfficerLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; name: string; email: string; principalKind: string }> {
    const { rawToken, user } = await this.officerAuth.login(dto, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    res.cookie(this.config.env.SESSION_COOKIE_NAME, rawToken, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      maxAge: this.config.env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return { id: user.id, name: user.name, email: user.email, principalKind: user.principalKind };
  }
}
