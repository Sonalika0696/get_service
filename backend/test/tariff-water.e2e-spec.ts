import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { OccupancyRole, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 10 (utility config plane) Definition of Done, end-to-end against
 * real Postgres:
 *  - POST /tariffs validates `slabs`/`fixedCharges`/`dutyCess` via
 *    parseTariffConfig and rejects a malformed slab array with 400 WITHOUT
 *    persisting anything;
 *  - GET /tariffs lists a society's schedules newest-effectiveFrom-first;
 *  - GET /tariffs/current?utility=&period= picks the schedule with the
 *    greatest effectiveFrom <= the first day of `period` — verified across
 *    TWO effectiveFrom dates so the "latest one <= period" rule is actually
 *    exercised, not just "the only one that exists";
 *  - POST /water-sources records a source for a period; GET /water-sources
 *    lists/filters them;
 *  - a non-committee resident is forbidden (403) from every route above.
 *
 * Society/flats are created fresh in beforeAll and every query below is
 * scoped to this suite's own societyId, so this suite is safe to run
 * concurrently with sibling agents' e2e suites against the same shared
 * Postgres instance.
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

interface TariffScheduleBody {
  id: string;
  societyId: string;
  utility: 'ELECTRICITY' | 'WATER';
  effectiveFrom: string;
  slabs: unknown;
  fixedCharges: unknown;
  dutyCess: unknown;
  note: string | null;
  createdById: string;
}

interface WaterSourceBody {
  id: string;
  societyId: string;
  billingCycleId: string | null;
  kind: 'MUNICIPAL' | 'TANKER' | 'BOREWELL';
  kilolitres: string;
  cost: string;
  period: string;
}

describe('Tariff schedules + water sources config (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const last = mailer.sent.filter((m) => m.to === email && m.subject === subject).at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

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

    // Phase 6.3 ratification gate — standing up an already-approved
    // resident, not testing ratification itself (see bank-statements.e2e-spec.ts's
    // identical helper doc comment).
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  async function makeRole(userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
  }

  beforeAll(async () => {
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);

    const society = await prisma.society.create({ data: { name: 'Tariff/Water Test Society', address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 2; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `TW-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.waterSource.deleteMany({ where: { societyId } });
    await prisma.tariffSchedule.deleteMany({ where: { societyId } });
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

  it('(a) POST /tariffs rejects a malformed slab array with 400 and persists nothing', async () => {
    const treasurer = await signupAndLogin(`tw-treasurer-a-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    const before = await prisma.tariffSchedule.count({ where: { societyId } });

    // upTo not strictly ascending -> validateSlabs rejects it.
    await treasurer.agent
      .post('/api/v1/tariffs')
      .send({
        utility: 'ELECTRICITY',
        effectiveFrom: '2026-01-01',
        slabs: [
          { upTo: 100, rate: 3.5 },
          { upTo: 50, rate: 4.5 },
        ],
      })
      .expect(400);

    const after = await prisma.tariffSchedule.count({ where: { societyId } });
    expect(after).toBe(before);
  });

  it('(b) creates and lists tariff schedules newest-effectiveFrom-first; current() picks the latest effectiveFrom <= period', async () => {
    const treasurer = await signupAndLogin(`tw-treasurer-b-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE);

    const early = (
      await treasurer.agent
        .post('/api/v1/tariffs')
        .send({
          utility: 'ELECTRICITY',
          effectiveFrom: '2026-01-01',
          slabs: [
            { upTo: 100, rate: 3.5 },
            { upTo: null, rate: 5.0 },
          ],
          fixedCharges: { perConnection: 50 },
          note: 'Early 2026 tariff',
        })
        .expect(201)
    ).body as TariffScheduleBody;
    expect(early.societyId).toBe(societyId);
    expect(early.utility).toBe('ELECTRICITY');

    const later = (
      await treasurer.agent
        .post('/api/v1/tariffs')
        .send({
          utility: 'ELECTRICITY',
          effectiveFrom: '2026-04-01',
          slabs: [
            { upTo: 100, rate: 4.0 },
            { upTo: null, rate: 5.5 },
          ],
        })
        .expect(201)
    ).body as TariffScheduleBody;

    const listed = (await treasurer.agent.get('/api/v1/tariffs?utility=ELECTRICITY').expect(200)).body as TariffScheduleBody[];
    expect(listed.length).toBeGreaterThanOrEqual(2);
    const ids = listed.map((s) => s.id);
    expect(ids.indexOf(later.id)).toBeLessThan(ids.indexOf(early.id)); // newest first

    // A period before ANY effectiveFrom -> 404.
    await treasurer.agent.get('/api/v1/tariffs/current?utility=ELECTRICITY&period=2025-12').expect(404);

    // A period between the two effectiveFrom dates -> picks the EARLY one.
    const currentBeforeLater = (await treasurer.agent.get('/api/v1/tariffs/current?utility=ELECTRICITY&period=2026-02').expect(200)).body as TariffScheduleBody;
    expect(currentBeforeLater.id).toBe(early.id);

    // A period on/after the later effectiveFrom -> picks the LATER one.
    const currentAfterLater = (await treasurer.agent.get('/api/v1/tariffs/current?utility=ELECTRICITY&period=2026-04').expect(200)).body as TariffScheduleBody;
    expect(currentAfterLater.id).toBe(later.id);

    const currentWellAfter = (await treasurer.agent.get('/api/v1/tariffs/current?utility=ELECTRICITY&period=2026-12').expect(200)).body as TariffScheduleBody;
    expect(currentWellAfter.id).toBe(later.id);
  });

  it('(c) records water sources for a period and lists/filters them', async () => {
    const treasurer = await signupAndLogin(`tw-treasurer-c-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE);

    const municipal = (
      await treasurer.agent
        .post('/api/v1/water-sources')
        .send({ kind: 'MUNICIPAL', kilolitres: 200, cost: 8000, period: '2026-03' })
        .expect(201)
    ).body as WaterSourceBody;
    expect(municipal.societyId).toBe(societyId);
    expect(municipal.kind).toBe('MUNICIPAL');

    const tanker = (
      await treasurer.agent
        .post('/api/v1/water-sources')
        .send({ kind: 'TANKER', kilolitres: 30, cost: 3000, period: '2026-03' })
        .expect(201)
    ).body as WaterSourceBody;

    // Different period, should not show up in the '2026-03' filter below.
    await treasurer.agent.post('/api/v1/water-sources').send({ kind: 'BOREWELL', kilolitres: 10, cost: 500, period: '2026-04' }).expect(201);

    // Negative kilolitres/cost are rejected.
    await treasurer.agent.post('/api/v1/water-sources').send({ kind: 'MUNICIPAL', kilolitres: -1, cost: 100, period: '2026-03' }).expect(400);
    await treasurer.agent.post('/api/v1/water-sources').send({ kind: 'MUNICIPAL', kilolitres: 1, cost: -100, period: '2026-03' }).expect(400);

    const marchOnly = (await treasurer.agent.get('/api/v1/water-sources?period=2026-03').expect(200)).body as WaterSourceBody[];
    const marchIds = marchOnly.map((s) => s.id);
    expect(marchIds).toEqual(expect.arrayContaining([municipal.id, tanker.id]));
    expect(marchOnly.every((s) => s.period === '2026-03')).toBe(true);
  });

  it('(d) a non-committee resident is forbidden from every tariff/water route', async () => {
    const resident = await signupAndLogin(`tw-plain-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);

    await resident.agent
      .post('/api/v1/tariffs')
      .send({ utility: 'ELECTRICITY', effectiveFrom: '2026-01-01', slabs: [{ upTo: null, rate: 5 }] })
      .expect(403);
    await resident.agent.get('/api/v1/tariffs').expect(403);
    await resident.agent.get('/api/v1/tariffs/current?utility=ELECTRICITY&period=2026-01').expect(403);
    await resident.agent.post('/api/v1/water-sources').send({ kind: 'MUNICIPAL', kilolitres: 1, cost: 1, period: '2026-01' }).expect(403);
    await resident.agent.get('/api/v1/water-sources').expect(403);
  });
});
