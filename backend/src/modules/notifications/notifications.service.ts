import { Injectable } from '@nestjs/common';
import { MailerService } from '../../infra/mailer/mailer.service.js';

/**
 * Minimal, Phase 1 scope: templated emails only (no in-app/SMS channels
 * yet — those are cross-cutting concerns for a later phase). Each method
 * owns its own copy; there's no templating engine to configure.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly mailer: MailerService) {}

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.mailer.send({
      to,
      subject: 'Your verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
    });
  }

  async sendCompanyEmailVerification(to: string, verifyUrl: string): Promise<void> {
    await this.mailer.send({
      to,
      subject: 'Verify your company email',
      text: `Confirm this hiring post is genuine by visiting: ${verifyUrl}\n\nThis link expires in 24 hours.`,
      html: `<p>Confirm this hiring post is genuine:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
    });
  }
}
