import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { AppConfigService } from '../src/config/config.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, RoleKind, JobBlogKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 1 Definition of Done, end-to-end against real Postgres:
 *   signup -> OTP verify -> login session -> create HIRING post ->
 *   company-email verify -> post visible in list -> committee flags ->
 *   post hidden from list.
 *
 * Plus the other high-value Phase 1 contracts: a SEEKING post needs no
 * company-email gate, the per-resident monthly rate limit 429s, and only a
 * COMMITTEE role can flag (a plain resident gets 403).
 *
 * OTP codes and the company-email verification token are only ever
 * persisted as SHA-256 hashes (see OtpService / JobBlogService) and are
 * never returned over HTTP — the raw values only ever reach
 * NotificationsService -> MailerService.send(). We override MailerService
 * with an in-memory capturing fake so the test can read them, while still
 * exercising the real NotificationsService/OtpService/JobBlogService code
 * paths end-to-end.
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

function extractVerifyToken(mail: SendMailInput): string {
  const match = mail.text.match(/[?&]token=([^\s&]+)/);
  if (!match) throw new Error(`Could not find a verify token in captured mail: ${mail.text}`);
  return match[1];
}

describe('Job Blog (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let cookieName: string;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  /** Signs a brand-new resident up, verifies their OTP, and returns a cookie-jar agent logged in as them. */
  async function signupAndLogin(email: string, flatId: string, role: OccupancyRole) {
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: `Test User ${email}`, email, societyId, flatId, role })
      .expect(201);

    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const otpMail = await latestMailTo(email, 'Your verification code');
    const code = extractOtpCode(otpMail);

    const agent = request.agent(app.getHttpServer());
    const verifyRes = await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
    expect((verifyRes.body as { id: string }).id).toBe(userId);
    expect(verifyRes.headers['set-cookie']?.some((c: string) => c.startsWith(`${cookieName}=`))).toBe(true);


    // Phase 6.3 ratification gate: a self-registered occupancy starts
    // PENDING and UserContextService blocks it entirely (401) until a
    // committee officer ratifies it. This fixture helper isn't testing
    // the ratification gate itself (see ratification.e2e-spec.ts for
    // that) — it's standing up a normal, already-approved resident for
    // every other suite, so ratify directly via Prisma, matching how
    // other suites poke fixture state directly (e.g. identity.e2e-spec.ts
    // backdating otp.createdAt).
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  beforeAll(async () => {
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts bootstrap so cookies/prefix/validation behave exactly
    // like production (audit.e2e-spec.ts doesn't need this — it calls
    // services directly rather than over HTTP).
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    cookieName = app.get(AppConfigService).env.SESSION_COOKIE_NAME;

    const society = await prisma.society.create({ data: { name: 'Job Blog Test Society', address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 3; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `JB-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    // FK-respecting cleanup, children before parents. AuditLog.society is
    // onDelete: Restrict (an audit trail should never silently vanish with
    // its society), so it must be cleared before the society itself.
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.jobBlogPost.deleteMany({ where: { societyId } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.delete({ where: { id: societyId } });

    await app.close();
  });

  it('signup creates a user + occupancy and sends an OTP; a wrong code is rejected, the correct code logs in', async () => {
    const email = `resident-a-${randomUUID()}@example.com`;

    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Resident A', email, societyId, flatId: flatIds[0], role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    const occupancy = await prisma.occupancy.findFirst({ where: { userId, flatId: flatIds[0] } });
    expect(occupancy).not.toBeNull();
    expect(occupancy?.role).toBe(OccupancyRole.OWNER_OCCUPIER);

    const otpMail = await latestMailTo(email, 'Your verification code');
    const correctCode = extractOtpCode(otpMail);
    const wrongCode = correctCode === '000000' ? '111111' : '000000';

    await request(app.getHttpServer()).post('/api/v1/auth/verify').send({ email, code: wrongCode }).expect(401);

    const verifyRes = await request(app.getHttpServer()).post('/api/v1/auth/verify').send({ email, code: correctCode }).expect(201);
    expect((verifyRes.body as { id: string; email: string }).email).toBe(email);
    const setCookie = verifyRes.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie?.some((c) => c.startsWith(`${cookieName}=`))).toBe(true);
  });

  it('a SEEKING post needs no company-email gate: it is visible in the list immediately', async () => {
    const { agent } = await signupAndLogin(`resident-seeking-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);

    const createRes = await agent
      .post('/api/v1/jobs')
      .send({ kind: JobBlogKind.SEEKING, title: 'Looking for a plumber', body: 'Need someone reliable, weekends only.' })
      .expect(201);
    const postId = (createRes.body as { id: string }).id;

    const listRes = await agent.get('/api/v1/jobs').expect(200);
    const ids = (listRes.body as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(postId);
  });

  it('a second post within the same month from the same resident is rate limited (429)', async () => {
    const { agent } = await signupAndLogin(`resident-ratelimit-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.TENANT);

    await agent
      .post('/api/v1/jobs')
      .send({ kind: JobBlogKind.SEEKING, title: 'First post this month', body: 'Body text for the first post.' })
      .expect(201);

    await agent
      .post('/api/v1/jobs')
      .send({ kind: JobBlogKind.SEEKING, title: 'Second post this month', body: 'This one should be rate limited.' })
      .expect(429);
  });

  it('HIRING -> company-email verify -> visible -> committee flag -> hidden (the Phase 1 happy path)', async () => {
    const poster = await signupAndLogin(`resident-hiring-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    const companyEmail = `hr-${randomUUID()}@employer.example.com`;

    const createRes = await poster.agent
      .post('/api/v1/jobs')
      .send({ kind: JobBlogKind.HIRING, title: 'Hiring a site engineer', body: 'Full-time, immediate joining.', companyEmail })
      .expect(201);
    const postId = (createRes.body as { id: string }).id;
    expect((createRes.body as { companyEmailVerifiedAt: string | null }).companyEmailVerifiedAt).toBeNull();

    // Not yet visible: the company email hasn't been verified.
    const listBefore = await poster.agent.get('/api/v1/jobs').expect(200);
    expect((listBefore.body as { id: string }[]).map((p) => p.id)).not.toContain(postId);

    const verifyMail = await latestMailTo(companyEmail, 'Verify your company email');
    const token = extractVerifyToken(verifyMail);

    // Public route — no session cookie needed, the token is the credential.
    await request(app.getHttpServer())
      .get(`/api/v1/jobs/${postId}/verify-company-email`)
      .query({ token })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ verified: true });
      });

    // Now visible.
    const listAfter = await poster.agent.get('/api/v1/jobs').expect(200);
    expect((listAfter.body as { id: string }[]).map((p) => p.id)).toContain(postId);

    // A non-committee resident cannot flag.
    await poster.agent.post(`/api/v1/jobs/${postId}/flag`).expect(403);

    // A committee member can, and the post disappears from the list.
    const committee = await signupAndLogin(`resident-committee-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await prisma.role.create({ data: { societyId, userId: committee.userId, kind: RoleKind.COMMITTEE } });

    const flagRes = await committee.agent.post(`/api/v1/jobs/${postId}/flag`).expect(201);
    expect((flagRes.body as { status: string }).status).toBe('FLAGGED');

    const listFinal = await poster.agent.get('/api/v1/jobs').expect(200);
    expect((listFinal.body as { id: string }[]).map((p) => p.id)).not.toContain(postId);
  });
});
