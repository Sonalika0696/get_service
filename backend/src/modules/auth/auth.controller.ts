import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/config.service.js';
import { AuthService } from './auth.service.js';
import { RequestOtpDto, SignupDto, VerifyOtpDto } from './dto/signup.dto.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Phase 6.5: 5 signups/min per IP. Loose enough for a legitimate resident
   * onboarding session, tight enough to blunt bulk account-creation spam.
   */
  @Post('signup')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signup(@Body() dto: SignupDto): Promise<{ userId: string }> {
    return this.authService.signup(dto);
  }

  /**
   * Phase 6.5: 5 OTP requests/min per IP — the tightest limit in this
   * controller, since this is the direct OTP-pumping / SMS-bombing vector
   * (an attacker requesting codes for many phone numbers from one IP).
   */
  @Post('otp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestOtp(@Body() dto: RequestOtpDto): Promise<void> {
    await this.authService.requestOtp(dto);
  }

  /**
   * Phase 6.5: 10 verify attempts/min per IP. Looser than /otp since a
   * normal signup-then-verify flow already spends one call here, but still
   * bounded — OtpService's own 5-wrong-attempts-per-code lockout handles
   * guessing a single code; this bounds an attacker cycling through many
   * accounts/codes from one IP.
   */
  @Post('verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(@Body() dto: VerifyOtpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ id: string; name: string; email: string }> {
    const { rawToken, user } = await this.authService.verify(dto, {
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

    return { id: user.id, name: user.name, email: user.email };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = req.cookies?.[this.config.env.SESSION_COOKIE_NAME] as string | undefined;
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie(this.config.env.SESSION_COOKIE_NAME, { path: '/' });
  }
}
