import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { AppConfigService } from '../src/config/config.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { toPrismaBytes } from '../src/common/util/hash.js';
import { OccupancyRole } from '../src/generated/prisma/enums.js';

/**
 * GET /audit/verify (BACKEND_PLAN.md Phase 6.5) — surfaces
 * AuditService.verifyChain() to residents. Proves: (1) a resident gets an
 * "intact" result for a society whose chain is untouched; (2) tampering a
 * row's stored hash directly via Prisma (bypassing the app layer, same
 * technique as test/audit.e2e-spec.ts) is reported back through the
 * endpoint, not swallowed; (3) the route requires auth.
 */
class CapturingMailer {
  sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input);
  }
}

function extractOtpCode(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

describe('GET /audit/verify (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let auditService: AuditService;
  let mailer: CapturingMailer;
  let cookieName: string;

  let societyId: string;
  let flatId: string;
  const userIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  /** Signs a brand-new resident up in the given society/flat, verifies their OTP, and returns a cookie-jar agent logged in as them. */
  async function signupAndLogin(email: string, sId: string, fId: string, role: OccupancyRole) {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Test User ${email}`, email, societyId: sId, flatId: fId, role })
      .expect(201);

    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = await latestMailTo(email, 'Your verification code');
    const code = extractOtpCode(otpMail);

    const agent = request.agent(app.getHttpServer());
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    expect(verifyRes.headers['set-cookie']?.some((c: string) => c.startsWith(`${cookieName}=`))).toBe(true);

    return { userId, agent, email };
  }

  beforeAll(async () => {
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    auditService = app.get(AuditService);
    cookieName = app.get(AppConfigService).env.SESSION_COOKIE_NAME;

    const society = await prisma.society.create({ data: { name: 'Audit Verify Test Society', address: 'n/a' } });
    societyId = society.id;
    const flat = await prisma.flat.create({
      data: { societyId, unitNo: `AV-0-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
    });
    flatId = flat.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });
    await app.close();
  });

  it('requires auth: 401 without a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/audit/verify').expect(401);
  });

  it('reports an intact chain for a resident\'s own society', async () => {
    await auditService.append({ societyId, actorId: null, action: 'TEST_ACTION_ONE', subjectType: 'Test', subjectId: 'a', payload: { n: 1 } });
    await auditService.append({ societyId, actorId: null, action: 'TEST_ACTION_TWO', subjectType: 'Test', subjectId: 'b', payload: { n: 2 } });

    const resident = await signupAndLogin(`audit-verify-intact-${randomUUID()}@example.com`, societyId, flatId, OccupancyRole.OWNER_OCCUPIER);

    const res = await resident.agent.get('/api/v1/audit/verify').expect(200);
    const body = res.body as { ok: boolean; verifiedThrough: number; tailHash: string; firstDivergence: unknown };
    expect(body.ok).toBe(true);
    expect(body.verifiedThrough).toBe(2);
    expect(body.firstDivergence).toBeNull();
    expect(typeof body.tailHash).toBe('string');
    expect(body.tailHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports the first divergent row when a stored hash is tampered directly via Prisma', async () => {
    const tamperSociety = await prisma.society.create({ data: { name: 'Audit Verify Tamper Society', address: 'n/a' } });
    const tamperFlat = await prisma.flat.create({
      data: { societyId: tamperSociety.id, unitNo: `AV-T-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
    });

    await auditService.append({ societyId: tamperSociety.id, actorId: null, action: 'TEST_ACTION_ONE', subjectType: 'Test', subjectId: 'a', payload: { n: 1 } });
    const secondRow = await auditService.append({ societyId: tamperSociety.id, actorId: null, action: 'TEST_ACTION_TWO', subjectType: 'Test', subjectId: 'b', payload: { n: 2 } });

    // Bypass the app layer entirely: overwrite the second row's entryHash
    // with garbage bytes, simulating direct DB tampering.
    await prisma.auditLog.update({
      where: { id: secondRow.id },
      data: { entryHash: toPrismaBytes(Buffer.alloc(32, 0xff)) },
    });

    const resident = await signupAndLogin(`audit-verify-tamper-${randomUUID()}@example.com`, tamperSociety.id, tamperFlat.id, OccupancyRole.OWNER_OCCUPIER);

    const res = await resident.agent.get('/api/v1/audit/verify').expect(200);
    const body = res.body as { ok: boolean; firstDivergence: { id: string; sequence: number } | null };
    expect(body.ok).toBe(false);
    expect(body.firstDivergence?.id).toBe(secondRow.id);

    await prisma.session.deleteMany({ where: { userId: resident.userId } });
    await prisma.otp.deleteMany({ where: { userId: resident.userId } });
    await prisma.role.deleteMany({ where: { userId: resident.userId } });
    await prisma.occupancy.deleteMany({ where: { userId: resident.userId } });
    await prisma.user.delete({ where: { id: resident.userId } });
    await prisma.auditLog.deleteMany({ where: { societyId: tamperSociety.id } });
    await prisma.flat.deleteMany({ where: { societyId: tamperSociety.id } });
    await prisma.society.delete({ where: { id: tamperSociety.id } });
  });
});
