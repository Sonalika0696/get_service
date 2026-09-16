import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { AppConfigService } from '../src/config/config.service.js';
import type { Env } from '../src/config/env.schema.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { SmsService, type SendSmsInput, type SmsSendResult } from '../src/infra/sms/sms.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole } from '../src/generated/prisma/enums.js';

/**
 * Phase 6.5 (BACKEND_PLAN.md) — rate limiting on the auth/OTP endpoints.
 *
 * Every OTHER e2e suite runs with THROTTLE_ENABLED=false (see backend/.env
 * and env.schema.ts's doc comment on the flag) precisely so the
 * @nestjs/throttler guard wired onto AuthController/OfficerAuthController
 * (see auth.module.ts) never interferes with their fixture helpers, which
 * sign up / verify / enroll far more than any of the per-endpoint limits
 * chosen below over the course of a run.
 *
 * This is the ONE suite that turns throttling on — by overriding
 * AppConfigService for its own compiled Nest application only (see
 * beforeAll's `.overrideProvider(AppConfigService)`), never by mutating
 * process.env, so nothing here can leak into another test file's app
 * instance even if vitest runs files in the same worker.
 */

class CapturingMailer {
  sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input);
  }
}

class CapturingSms {
  sent: SendSmsInput[] = [];
  async send(input: SendSmsInput): Promise<SmsSendResult> {
    this.sent.push(input);
    return { id: `test_${randomUUID()}`, status: 'stub_logged' };
  }
}

describe('Rate limiting — Phase 6.5 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let societyId: string;
  let flatId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const mailer = new CapturingMailer();
    const sms = new CapturingSms();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .overrideProvider(SmsService)
      .useValue(sms)
      // Build a REAL AppConfigService from the REAL ConfigService (so
      // DATABASE_URL and everything else every other module depends on is
      // untouched), then force just THROTTLE_ENABLED on for this one
      // compiled app instance. Everything else in this file's process
      // (other test files' already-compiled or yet-to-compile apps) keeps
      // reading THROTTLE_ENABLED=false from the real .env.
      .overrideProvider(AppConfigService)
      .useFactory({
        factory: (configService: ConfigService<Env, true>) => {
          const real = new AppConfigService(configService);
          return { env: { ...real.env, THROTTLE_ENABLED: true }, isProduction: real.isProduction };
        },
        inject: [ConfigService],
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    expect(app.get(AppConfigService).env.THROTTLE_ENABLED).toBe(true);

    const society = await prisma.society.create({ data: { name: 'Rate Limit Test Society', address: 'n/a' } });
    societyId = society.id;
    const flat = await prisma.flat.create({
      data: { societyId, unitNo: `RL-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
    });
    flatId = flat.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });
    await app.close();
  });

  it('requests under the /auth/signup limit succeed; the request that exceeds it gets 429, keyed per-IP not per-account', async () => {
    // Must match @Throttle({ default: { limit: 5, ttl: 60_000 } }) on
    // AuthController#signup (auth.controller.ts) — if that limit ever
    // changes, this test's loop bound documents exactly what to update.
    const SIGNUP_LIMIT = 5;

    for (let i = 0; i < SIGNUP_LIMIT; i++) {
      const email = `rate-limit-${randomUUID()}@example.com`;
      const phone = `+9196${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ name: 'Rate Limit Test', email, phone, societyId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
        .expect(201);
      userIds.push((res.body as { userId: string }).userId);
    }

    // One more — a well-formed, distinct-account request that would
    // otherwise succeed exactly like the five above. It's blocked purely on
    // request COUNT from this IP within the window (the guard runs before
    // the handler), proving the key is per-IP, not per-email/phone.
    const email = `rate-limit-${randomUUID()}@example.com`;
    const phone = `+9196${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Rate Limit Test', email, phone, societyId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(429);
    expect(blocked.body).toHaveProperty('message');

    // Never created — the blocked signup must not have reached AuthService.
    const shouldNotExist = await prisma.user.findUnique({ where: { email } });
    expect(shouldNotExist).toBeNull();
  });
});
