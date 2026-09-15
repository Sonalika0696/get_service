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
    };
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
}
