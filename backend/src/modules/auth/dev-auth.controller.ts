import { Body, Controller, ForbiddenException, NotFoundException, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsEmail } from 'class-validator';
import { AppConfigService } from '../../config/config.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { SessionService } from './session.service.js';

class DevLoginDto {
  @IsEmail()
  email!: string;
}

/**
 * DEV-ONLY convenience login. Issues a real session cookie for a seeded
 * account by email, with no OTP / password / TOTP — so the web console can
 * be exercised locally without the maildev OTP round-trip. It reuses
 * SessionService.create (the same session machinery every real login path
 * uses), so the resulting session is indistinguishable from a normal one.
 *
 * HARD-GATED to non-production: every handler throws ForbiddenException when
 * `config.isProduction`, so this route is inert in any production build even
 * if it somehow ships. Added at the frontend author's request to unblock
 * local review; NOT part of the auth design and must never be relied on in
 * prod. See apps/web login page's dev panel.
 */
@Controller('auth/dev')
export class DevAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly config: AppConfigService,
  ) {}

  @Post('login')
  async login(
    @Body() dto: DevLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; name: string; email: string }> {
    if (this.config.isProduction) {
      throw new ForbiddenException('Dev login is disabled in production');
    }

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new NotFoundException(`No user with email ${dto.email}`);
    }

    const { rawToken } = await this.sessionService.create(user.id, {
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
}
