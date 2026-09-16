import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
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

  @Post('enroll/start')
  @HttpCode(HttpStatus.NO_CONTENT)
  async enrollStart(@Body() dto: OfficerEnrollStartDto): Promise<void> {
    await this.officerAuth.enrollStart(dto);
  }

  @Post('enroll/complete')
  async enrollComplete(@Body() dto: OfficerEnrollCompleteDto): Promise<{ totpSecret: string; otpauthUrl: string }> {
    return this.officerAuth.enrollComplete(dto);
  }

  @Post('enroll/verify-totp')
  @HttpCode(HttpStatus.NO_CONTENT)
  async enrollVerifyTotp(@Body() dto: OfficerEnrollVerifyTotpDto): Promise<void> {
    await this.officerAuth.enrollVerifyTotp(dto);
  }

  @Post('login')
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
