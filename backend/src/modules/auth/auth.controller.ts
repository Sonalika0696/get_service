import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
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

  @Post('signup')
  async signup(@Body() dto: SignupDto): Promise<{ userId: string }> {
    return this.authService.signup(dto);
  }

  @Post('otp')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestOtp(@Body() dto: RequestOtpDto): Promise<void> {
    await this.authService.requestOtp(dto.email);
  }

  @Post('verify')
  async verify(@Body() dto: VerifyOtpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ id: string; name: string; email: string }> {
    const { rawToken, user } = await this.authService.verify(dto.email, dto.code, {
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
