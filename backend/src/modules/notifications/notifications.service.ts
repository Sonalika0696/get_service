import { Injectable } from '@nestjs/common';
import { MailerService } from '../../infra/mailer/mailer.service.js';
import { SmsService } from '../../infra/sms/sms.service.js';

/**
 * Templated notifications. Phase 1 shipped email only; Phase 6.2 adds SMS
 * for the phone-OTP resident credential (DECISIONS_V2_SCOPE.md §7.1) via
 * the stubbed SmsService (src/infra/sms/sms.service.ts). No templating
 * engine: each method owns its own copy.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly mailer: MailerService,
    private readonly sms: SmsService,
  ) {}

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.mailer.send({
      to,
      subject: 'Your verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
    });
  }

  /** Phase 6.2 — resident phone-OTP signup/login, delivered via the (stubbed) SMS sender. */
  async sendOtpSms(to: string, code: string): Promise<void> {
    await this.sms.send({
      to,
      body: `Your Society FinTech verification code is ${code}. It expires in 10 minutes.`,
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

  /** Sent to every committed resident the moment an EVENT/BULK_BUY poll auto-fires (reaches minCommitments). */
  async sendPollFired(to: string, pollTitle: string): Promise<void> {
    await this.mailer.send({
      to,
      subject: 'Poll fired — enough residents joined',
      text: `"${pollTitle}" has reached the minimum number of commitments and is now FIRED.`,
      html: `<p><strong>"${pollTitle}"</strong> has reached the minimum number of commitments and is now <strong>FIRED</strong>.</p>`,
    });
  }

  /** Sent to every committed resident when an EVENT/BULK_BUY poll expires without reaching minCommitments. */
  async sendPollExpired(to: string, pollTitle: string): Promise<void> {
    await this.mailer.send({
      to,
      subject: 'Poll expired — not enough commitments',
      text: `"${pollTitle}" closed without reaching the minimum number of commitments and has EXPIRED.`,
      html: `<p><strong>"${pollTitle}"</strong> closed without reaching the minimum number of commitments and has <strong>EXPIRED</strong>.</p>`,
    });
  }
}
