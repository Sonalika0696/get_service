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
 * Phase 10 metering data plane (meters + readings) Definition of Done, e2e
 * against real Postgres:
 *  - POST /meters registers a FLAT meter (requires an in-society flatId) and
 *    a COMMON meter (must NOT carry a flatId); a duplicate serial in the
 *    same society is rejected 409;
 *  - POST /meters/:id/readings captures a reading AND audit-chains it
 *    atomically at capture (ReadingsService.capture — see its doc comment);
 *    GET /audit/verify stays `ok: true` throughout;
 *  - POST /readings/:id/reverse posts a NEW reversing reading (append-only:
 *    the original row is never mutated);
 *  - POST /readings/ingest bulk-imports a CSV, reporting per-row errors and
 *    unmatched serials without dropping the valid rows;
 *  - a plain resident (no TREASURER/COMMITTEE role) is rejected 403.
 *
 * Society/flat fixtures are created fresh in beforeAll and scoped to this
 * suite's own societyId, so this suite is safe to run concurrently with
 * sibling agents' e2e suites against the same shared Postgres instance.
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

interface MeterBody {
  id: string;
  societyId: string;
  flatId: string | null;
  utility: 'ELECTRICITY' | 'WATER';
  kind: 'FLAT' | 'COMMON' | 'BULK';
  serial: string;
  multiplier: string;
  status: 'ACTIVE' | 'RETIRED' | 'FLAGGED';
  retiredAt: string | null;
}

interface ReadingBody {
  id: string;
  meterId: string;
  value: string;
  capturedById: string;
  source: 'MANUAL' | 'CSV';
  reversesReadingId: string | null;
}

interface IngestReadingsBody {
  created: number;
  errors: { line: number; message: string }[];
  unmatchedSerials: string[];
}

interface VerifyChainBody {
  ok: boolean;
}

describe('Electricity metering — meters + readings (e2e)', () => {
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

  async function verifyChain(agent: ReturnType<typeof request.agent>): Promise<VerifyChainBody> {
    return (await agent.get('/api/v1/audit/verify').expect(200)).body as VerifyChainBody;
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

    const society = await prisma.society.create({ data: { name: 'Electricity Metering Test Society', address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 2; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `EM-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    const meterIds = (await prisma.meter.findMany({ where: { societyId }, select: { id: true } })).map((m) => m.id);
    await prisma.reading.deleteMany({ where: { meterId: { in: meterIds } } });
    await prisma.meter.deleteMany({ where: { societyId } });
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

  it('(a) registers a FLAT meter and a COMMON meter; rejects a duplicate serial and a FLAT meter without flatId', async () => {
    const treasurer = await signupAndLogin(`em-treasurer-a-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    await makeRole(treasurer.userId, RoleKind.COMMITTEE); // GET /audit/verify has no role gate, but keeps the principal consistent with the other tests

    const flatSerial = `FLAT-${randomUUID()}`;
    const flatMeter = (
      await treasurer.agent
        .post('/api/v1/meters')
        .send({ utility: 'ELECTRICITY', kind: 'FLAT', serial: flatSerial, flatId: flatIds[0] })
        .expect(201)
    ).body as MeterBody;
    expect(flatMeter.flatId).toBe(flatIds[0]);
    expect(flatMeter.kind).toBe('FLAT');
    expect(flatMeter.status).toBe('ACTIVE');
    expect(Number(flatMeter.multiplier)).toBe(1);

    const commonSerial = `COMMON-${randomUUID()}`;
    const commonMeter = (
      await treasurer.agent
        .post('/api/v1/meters')
        .send({ utility: 'ELECTRICITY', kind: 'COMMON', serial: commonSerial })
        .expect(201)
    ).body as MeterBody;
    expect(commonMeter.flatId).toBeNull();
    expect(commonMeter.kind).toBe('COMMON');

    // Duplicate serial within the same society -> 409.
    await treasurer.agent
      .post('/api/v1/meters')
      .send({ utility: 'ELECTRICITY', kind: 'FLAT', serial: flatSerial, flatId: flatIds[1] })
      .expect(409);

    // FLAT without flatId -> 400.
    await treasurer.agent.post('/api/v1/meters').send({ utility: 'ELECTRICITY', kind: 'FLAT', serial: `BAD-${randomUUID()}` }).expect(400);

    // COMMON WITH a flatId -> 400.
    await treasurer.agent
      .post('/api/v1/meters')
      .send({ utility: 'ELECTRICITY', kind: 'COMMON', serial: `BAD2-${randomUUID()}`, flatId: flatIds[0] })
      .expect(400);

    // A plain resident (no TREASURER/COMMITTEE role) may not register a meter.
    const resident = await signupAndLogin(`em-plain-a-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await resident.agent.post('/api/v1/meters').send({ utility: 'ELECTRICITY', kind: 'COMMON', serial: `PLAIN-${randomUUID()}` }).expect(403);
  });

  it('(b) captures a reading, audit-chains it atomically, reverses it (append-only), and retires the meter idempotently', async () => {
    const treasurer = await signupAndLogin(`em-treasurer-b-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    const serial = `CAP-${randomUUID()}`;
    const meter = (
      await treasurer.agent.post('/api/v1/meters').send({ utility: 'ELECTRICITY', kind: 'FLAT', serial, flatId: flatIds[0] }).expect(201)
    ).body as MeterBody;

    const chainBefore = await verifyChain(treasurer.agent);
    expect(chainBefore.ok).toBe(true);

    const reading = (await treasurer.agent.post(`/api/v1/meters/${meter.id}/readings`).send({ value: 100 }).expect(201)).body as ReadingBody;
    expect(reading.meterId).toBe(meter.id);
    expect(Number(reading.value)).toBe(100);
    expect(reading.source).toBe('MANUAL');
    expect(reading.capturedById).toBe(treasurer.userId);

    // Persisted.
    const persisted = await prisma.reading.findUniqueOrThrow({ where: { id: reading.id } });
    expect(Number(persisted.value)).toBe(100);

    // An audit row was appended for this exact reading, chained atomically at capture.
    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { societyId, subjectType: 'Reading', subjectId: reading.id, action: 'READING_CAPTURED' } });
    expect(auditRow.actorId).toBe(treasurer.userId);

    // The chain still verifies after the capture.
    const chainAfterCapture = await verifyChain(treasurer.agent);
    expect(chainAfterCapture.ok).toBe(true);

    // Reverse it: a NEW row is posted, the original is untouched.
    const reversing = (await treasurer.agent.post(`/api/v1/readings/${reading.id}/reverse`).expect(201)).body as ReadingBody;
    expect(reversing.id).not.toBe(reading.id);
    expect(reversing.reversesReadingId).toBe(reading.id);
    expect(Number(reversing.value)).toBe(100); // mirrors the original so consumption nets out

    const originalStillThere = await prisma.reading.findUniqueOrThrow({ where: { id: reading.id } });
    expect(Number(originalStillThere.value)).toBe(100);
    expect(originalStillThere.reversesReadingId).toBeNull();

    const reverseAuditRow = await prisma.auditLog.findFirstOrThrow({ where: { societyId, subjectType: 'Reading', subjectId: reversing.id, action: 'READING_REVERSED' } });
    expect(reverseAuditRow.actorId).toBe(treasurer.userId);

    const chainAfterReverse = await verifyChain(treasurer.agent);
    expect(chainAfterReverse.ok).toBe(true);

    // GET /meters/:id/readings lists both rows.
    const list = (await treasurer.agent.get(`/api/v1/meters/${meter.id}/readings`).expect(200)).body as ReadingBody[];
    expect(list.map((r) => r.id).sort()).toEqual([reading.id, reversing.id].sort());

    // Retire is idempotent.
    const retired = (await treasurer.agent.post(`/api/v1/meters/${meter.id}/retire`).expect(201)).body as MeterBody;
    expect(retired.status).toBe('RETIRED');
    expect(retired.retiredAt).not.toBeNull();
    const retiredAgain = (await treasurer.agent.post(`/api/v1/meters/${meter.id}/retire`).expect(201)).body as MeterBody;
    expect(retiredAgain.status).toBe('RETIRED');

    // A RETIRED meter can't accept a new reading.
    await treasurer.agent.post(`/api/v1/meters/${meter.id}/readings`).send({ value: 200 }).expect(400);

    // A plain resident (no TREASURER/COMMITTEE role) may not capture a reading.
    const resident = await signupAndLogin(`em-plain-b-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    const otherSerial = `CAP2-${randomUUID()}`;
    const otherMeter = (
      await treasurer.agent.post('/api/v1/meters').send({ utility: 'ELECTRICITY', kind: 'COMMON', serial: otherSerial }).expect(201)
    ).body as MeterBody;
    await resident.agent.post(`/api/v1/meters/${otherMeter.id}/readings`).send({ value: 1 }).expect(403);
  });

  it('(c) CSV ingest creates one reading per valid+matched row, reports errors and unmatched serials, and never throws on a bad row', async () => {
    const treasurer = await signupAndLogin(`em-treasurer-c-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    const serialA = `CSV-A-${randomUUID()}`;
    const serialB = `CSV-B-${randomUUID()}`;
    const meterA = (
      await treasurer.agent.post('/api/v1/meters').send({ utility: 'ELECTRICITY', kind: 'COMMON', serial: serialA }).expect(201)
    ).body as MeterBody;
    const meterB = (
      await treasurer.agent.post('/api/v1/meters').send({ utility: 'ELECTRICITY', kind: 'COMMON', serial: serialB }).expect(201)
    ).body as MeterBody;

    const unknownSerial = `UNKNOWN-${randomUUID()}`;
    const csv = ['serial,value', `${serialA},150`, `${serialB},75.5`, `${unknownSerial},10`, 'not-enough-columns'].join('\n');

    const result = (await treasurer.agent.post('/api/v1/readings/ingest').send({ csv }).expect(201)).body as IngestReadingsBody;
    expect(result.created).toBe(2);
    expect(result.unmatchedSerials).toEqual([unknownSerial]);
    // One syntax error (too few columns) + one unmatched-serial error.
    expect(result.errors.length).toBe(2);
    expect(result.errors.some((e) => /expected 2 or 3 columns/.test(e.message))).toBe(true);
    expect(result.errors.some((e) => e.message.includes(unknownSerial))).toBe(true);

    const readingA = await prisma.reading.findFirstOrThrow({ where: { meterId: meterA.id } });
    expect(Number(readingA.value)).toBe(150);
    expect(readingA.source).toBe('CSV');
    const readingB = await prisma.reading.findFirstOrThrow({ where: { meterId: meterB.id } });
    expect(Number(readingB.value)).toBe(75.5);

    // Each ingested row is audit-chained too.
    const auditRowA = await prisma.auditLog.findFirstOrThrow({ where: { societyId, subjectType: 'Reading', subjectId: readingA.id, action: 'READING_CAPTURED' } });
    expect(auditRowA.actorId).toBe(treasurer.userId);

    const chainAfterIngest = await verifyChain(treasurer.agent);
    expect(chainAfterIngest.ok).toBe(true);

    // A plain resident (no TREASURER/COMMITTEE role) may not ingest.
    const resident = await signupAndLogin(`em-plain-c-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await resident.agent.post('/api/v1/readings/ingest').send({ csv: 'serial,value\nx,1\n' }).expect(403);
  });
});
