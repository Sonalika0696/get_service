import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema.js';

/**
 * Thin, typed wrapper around @nestjs/config so the rest of the app depends
 * on a single `env` shape instead of stringly-typed `configService.get(...)`
 * calls scattered everywhere.
 */
@Injectable()
export class AppConfigService {
  readonly env: Env;

  constructor(configService: ConfigService<Env, true>) {
    this.env = {
      NODE_ENV: configService.get('NODE_ENV', { infer: true }),
      API_PORT: configService.get('API_PORT', { infer: true }),
      API_CORS_ORIGIN: configService.get('API_CORS_ORIGIN', { infer: true }),
      LOG_LEVEL: configService.get('LOG_LEVEL', { infer: true }),
      DATABASE_URL: configService.get('DATABASE_URL', { infer: true }),
      SESSION_COOKIE_NAME: configService.get('SESSION_COOKIE_NAME', { infer: true }),
      SESSION_TTL_DAYS: configService.get('SESSION_TTL_DAYS', { infer: true }),
      SMTP_HOST: configService.get('SMTP_HOST', { infer: true }),
      SMTP_PORT: configService.get('SMTP_PORT', { infer: true }),
      SMTP_FROM: configService.get('SMTP_FROM', { infer: true }),
      API_BASE_URL: configService.get('API_BASE_URL', { infer: true }),
      GSTIN_API_ENABLED: configService.get('GSTIN_API_ENABLED', { infer: true }),
      GSTIN_API_URL: configService.get('GSTIN_API_URL', { infer: true }),
      GSTIN_API_KEY: configService.get('GSTIN_API_KEY', { infer: true }),
      RAZORPAY_ENABLED: configService.get('RAZORPAY_ENABLED', { infer: true }),
      RAZORPAY_KEY_ID: configService.get('RAZORPAY_KEY_ID', { infer: true }),
      RAZORPAY_KEY_SECRET: configService.get('RAZORPAY_KEY_SECRET', { infer: true }),
      RAZORPAY_WEBHOOK_SECRET: configService.get('RAZORPAY_WEBHOOK_SECRET', { infer: true }),
      SMS_ENABLED: configService.get('SMS_ENABLED', { infer: true }),
      TOTP_ISSUER: configService.get('TOTP_ISSUER', { infer: true }),
      THROTTLE_ENABLED: configService.get('THROTTLE_ENABLED', { infer: true }),
    };
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
}
