import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/config.service.js';

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Thin SMTP wrapper — Maildev in dev (localhost:1025, inbox at
 * localhost:1080), a real SMTP relay in production. No templating engine:
 * callers (notifications/) own their own copy.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter!: Transporter;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit() {
    this.transporter = createTransport({
      host: this.config.env.SMTP_HOST,
      port: this.config.env.SMTP_PORT,
      secure: false,
    });
  }

  async send(input: SendMailInput): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    this.logger.debug(`Sent "${input.subject}" to ${input.to}`);
  }
}
