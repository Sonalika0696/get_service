import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { generate as generateTotpCode } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { AppConfigService } from '../src/config/config.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { SmsService, type SendSmsInput, type SmsSendResult } from '../src/infra/sms/sms.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, PrincipalKind } from '../src/generated/prisma/enums.js';

/**
 * `GET /auth/session` — the principal-agnostic "who am I" the web console
 * uses instead of a localStorage principal-kind hint. Guarded by AuthGuard
 * alone (no PrincipalGuard), so it must serve all three principal kinds and
 * echo back which one authenticated, plus that kind's own identity fields
 * (see common/types/current-user.ts). Fixture patterns (phone-OTP resident
 * signup + ratification, password+TOTP officer enrol/login) copied from
 * identity.e2e-spec.ts.
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

function extractOtpFromEmail(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

function extractOtpFromSms(sms: SendSmsInput): string {
  const match = sms.body.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured SMS: ${sms.body}`);
  return match[1];
}

describe('GET /auth/session — principal-agnostic "who am I" (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let sms: CapturingSms;

  let societyId: string;
  const userIds: string[] = [];
  const vendorIds: string[] = [];

  beforeAll(async () => {
    mailer = new CapturingMailer();
    sms = new CapturingSms();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .overrideProvider(SmsService)
      .useValue(sms)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    expect(app.get(AppConfigService).env.SMS_ENABLED).toBe(false);

    const society = await prisma.society.create({ data: { name: 'Session Test Society', address: 'n/a' } });
    societyId = society.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });

    await app.close();
  });

  it('no session at all is 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/session').expect(401);
  });

  it('a RESIDENT session reports principalKind RESIDENT plus society/occupancy fields', async () => {
    const flat = await prisma.flat.create({ data: { societyId, unitNo: `SESS-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    const phone = `+9196${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `resident-session-${randomUUID()}@example.com`;

    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Session Resident', email, phone, societyId, flatId: flat.id, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);

    // Phase 6.3 ratification gate: a fresh occupancy is PENDING and blocked
    // (401) by UserContextService until ratified — poke it directly via
    // Prisma, same technique every other suite's fixtures use.
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });

    const sessionRes = await agent.get('/api/v1/auth/session').expect(200);
    expect(sessionRes.body).toEqual({
      principalKind: PrincipalKind.RESIDENT,
      id: userId,
      name: 'Session Resident',
      email,
      societyId,
      occupancyRole: OccupancyRole.OWNER_OCCUPIER,
      roleKinds: [],
    });
  });

  it('a VENDOR session reports principalKind VENDOR plus vendorId/societyId', async () => {
    const vendor = await prisma.vendor.create({ data: { societyId, name: `Session Vendor Co ${randomUUID()}` } });
    vendorIds.push(vendor.id);

    const email = `vendor-session-${randomUUID()}@example.com`;
    const password = 'a reasonably long fixture password';
    const user = await prisma.user.create({ data: { name: 'Session Vendor', email, principalKind: 'VENDOR', vendorId: vendor.id } });
    userIds.push(user.id);

    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
    const startCode = extractOtpFromEmail(mailer.sent.filter((m) => m.to === email).at(-1)!);
    const completeRes = await request(app.getHttpServer())
      .post('/api/v1/auth/officer/enroll/complete')
      .send({ email, code: startCode, password })
      .expect(201);
    const { totpSecret } = completeRes.body as { totpSecret: string };
    const enrollCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollCode }).expect(204);

    const loginCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: loginCode }).expect(201);

    const sessionRes = await agent.get('/api/v1/auth/session').expect(200);
    expect(sessionRes.body).toEqual({
      principalKind: PrincipalKind.VENDOR,
      id: user.id,
      name: 'Session Vendor',
      email,
      vendorId: vendor.id,
      societyId,
    });
  });

  it('an OPERATOR session reports principalKind OPERATOR with no society/vendor fields', async () => {
    const email = `operator-session-${randomUUID()}@example.com`;
    const password = 'operator super secret passphrase';
    const user = await prisma.user.create({ data: { name: 'Session Operator', email, principalKind: 'OPERATOR' } });
    userIds.push(user.id);

    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
    const startCode = extractOtpFromEmail(mailer.sent.filter((m) => m.to === email).at(-1)!);
    const completeRes = await request(app.getHttpServer())
      .post('/api/v1/auth/officer/enroll/complete')
      .send({ email, code: startCode, password })
      .expect(201);
    const { totpSecret } = completeRes.body as { totpSecret: string };
    const enrollCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollCode }).expect(204);

    const loginCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: loginCode }).expect(201);

    const sessionRes = await agent.get('/api/v1/auth/session').expect(200);
    expect(sessionRes.body).toEqual({
      principalKind: PrincipalKind.OPERATOR,
      id: user.id,
      name: 'Session Operator',
      email,
    });
  });
});
