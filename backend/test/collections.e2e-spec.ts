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
import { MaintenanceChargeStatus, OccupancyRole, RoleKind } from '../src/generated/prisma/enums.js';

/** Lane b1read — `GET /collections/arrears` and `GET /collections/status`, e2e against real Postgres. */

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

interface ArrearsFlatRowBody {
  flatId: string;
  unitNo: string;
  totalOutstanding: string;
  bucket: string;
  daysOverdueOfOldest: number;
  hasInstalmentPlan: boolean;
}

interface ArrearsPageBody {
  items: ArrearsFlatRowBody[];
  nextCursor: string | null;
  summary?: { totalOutstandingByBucket: Record<string, string>; flatsInArrears: number };
}

interface StatusBody {
  period: string;
  billedTotal: string;
  collectedTotal: string;
  collectionRatePct: number;
  countsByStatus: Record<string, number>;
  waivedTotal: string;
}

describe('Collections & arrears — GET /collections/arrears, /collections/status (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const chargeIds: string[] = [];
  const instalmentPlanIds: string[] = [];
  const period = '2026-06';

  function daysAgo(n: number): Date {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  }

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
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
    await agent.post('/api/v1/auth/verify').send({ email, code }).expect(201);
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

    const society = await prisma.society.create({ data: { name: 'Collections Test Society', address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 8; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `CO-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }

    // One charge per flat, each landing in a different bucket:
    // flat 0: not yet due (+5 days from now)
    // flat 1: 0_30  (10 days overdue)
    // flat 2: 31_60 (45 days overdue)
    // flat 3: 61_90 (75 days overdue)
    // flat 4: 90+   (120 days overdue)
    // flat 5: PAID  (excluded — 50 days overdue but fully paid)
    // flat 6: WAIVED (excluded — 50 days overdue but waived)
    // flat 7: has an InstalmentPlan, 20 days overdue
    const fixtures: { flatId: string; dueDate: Date; status: MaintenanceChargeStatus; paidAmount: number }[] = [
      { flatId: flatIds[0], dueDate: daysAgo(-5), status: MaintenanceChargeStatus.PENDING, paidAmount: 0 },
      { flatId: flatIds[1], dueDate: daysAgo(10), status: MaintenanceChargeStatus.PENDING, paidAmount: 0 },
      { flatId: flatIds[2], dueDate: daysAgo(45), status: MaintenanceChargeStatus.PENDING, paidAmount: 0 },
      { flatId: flatIds[3], dueDate: daysAgo(75), status: MaintenanceChargeStatus.PARTIAL, paidAmount: 200 },
      { flatId: flatIds[4], dueDate: daysAgo(120), status: MaintenanceChargeStatus.PENDING, paidAmount: 0 },
      { flatId: flatIds[5], dueDate: daysAgo(50), status: MaintenanceChargeStatus.PAID, paidAmount: 1000 },
      { flatId: flatIds[6], dueDate: daysAgo(50), status: MaintenanceChargeStatus.WAIVED, paidAmount: 0 },
      { flatId: flatIds[7], dueDate: daysAgo(20), status: MaintenanceChargeStatus.PENDING, paidAmount: 0 },
    ];

    for (const f of fixtures) {
      const charge = await prisma.maintenanceCharge.create({
        data: { societyId, flatId: f.flatId, period, amount: 1000, lateFeeAccrued: 0, paidAmount: f.paidAmount, dueDate: f.dueDate, status: f.status },
      });
      chargeIds.push(charge.id);
      if (f.flatId === flatIds[7]) {
        const plan = await prisma.instalmentPlan.create({ data: { maintenanceChargeId: charge.id, instalments: 3, instalmentAmount: 334 } });
        instalmentPlanIds.push(plan.id);
      }
    }
  });

  afterAll(async () => {
    await prisma.instalmentPlan.deleteMany({ where: { id: { in: instalmentPlanIds } } });
    await prisma.maintenanceCharge.deleteMany({ where: { id: { in: chargeIds } } });
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

  it('a plain resident gets 403 on arrears', async () => {
    const resident = await signupAndLogin(`co-plain-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await resident.agent.get('/api/v1/collections/arrears').expect(403);
  });

  it('buckets each flat correctly, excludes PAID/WAIVED, and reports a whole-society summary on the first page', async () => {
    const officer = await signupAndLogin(`co-officer-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(officer.userId, RoleKind.TREASURER);

    const res = await officer.agent.get('/api/v1/collections/arrears?limit=50').expect(200);
    const body = res.body as ArrearsPageBody;

    const byFlat = Object.fromEntries(body.items.map((r) => [r.flatId, r]));
    expect(byFlat[flatIds[0]].bucket).toBe('NOT_YET_DUE');
    expect(byFlat[flatIds[1]].bucket).toBe('0_30');
    expect(byFlat[flatIds[2]].bucket).toBe('31_60');
    expect(byFlat[flatIds[3]].bucket).toBe('61_90');
    expect(byFlat[flatIds[3]].totalOutstanding).toBe('800.00'); // 1000 - 200 paid
    expect(byFlat[flatIds[4]].bucket).toBe('90_PLUS');
    expect(byFlat[flatIds[7]].hasInstalmentPlan).toBe(true);

    // PAID / WAIVED flats never appear.
    expect(byFlat[flatIds[5]]).toBeUndefined();
    expect(byFlat[flatIds[6]]).toBeUndefined();

    expect(body.summary).toBeDefined();
    expect(body.summary!.flatsInArrears).toBe(5); // every bucket except NOT_YET_DUE
    expect(Number(body.summary!.totalOutstandingByBucket['61_90'])).toBeCloseTo(800, 2);

    // Ordered by days overdue DESC.
    const daysDesc = body.items.map((r) => r.daysOverdueOfOldest);
    const sorted = [...daysDesc].sort((a, b) => b - a);
    expect(daysDesc).toEqual(sorted);
  });

  it('filters by bucket', async () => {
    const officer = await signupAndLogin(`co-officer2-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(officer.userId, RoleKind.COMMITTEE);

    const res = await officer.agent.get('/api/v1/collections/arrears?bucket=90_PLUS').expect(200);
    const body = res.body as ArrearsPageBody;
    expect(body.items.every((r) => r.bucket === '90_PLUS')).toBe(true);
    expect(body.items.some((r) => r.flatId === flatIds[4])).toBe(true);
  });

  it('paginates with cursor/limit (no summary on the second page)', async () => {
    const officer = await signupAndLogin(`co-officer3-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(officer.userId, RoleKind.COMMITTEE);

    const page1 = (await officer.agent.get('/api/v1/collections/arrears?limit=2').expect(200)).body as ArrearsPageBody;
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.summary).toBeDefined();

    const page2 = (await officer.agent.get(`/api/v1/collections/arrears?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`).expect(200)).body as ArrearsPageBody;
    expect(page2.summary).toBeUndefined();
    const page1Ids = new Set(page1.items.map((r) => r.flatId));
    expect(page2.items.every((r) => !page1Ids.has(r.flatId))).toBe(true);
  });

  it('GET /collections/status computes the collection rate correctly and rejects a bad period', async () => {
    const officer = await signupAndLogin(`co-officer4-${randomUUID()}@example.com`, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(officer.userId, RoleKind.TREASURER);

    const res = await officer.agent.get(`/api/v1/collections/status?period=${period}`).expect(200);
    const body = res.body as StatusBody;

    // 8 charges of 1000 each billed = 8000; paid: flat3 200 + flat5 1000 = 1200.
    expect(body.billedTotal).toBe('8000.00');
    expect(body.collectedTotal).toBe('1200.00');
    expect(body.collectionRatePct).toBeCloseTo((1200 / 8000) * 100, 2);
    expect(body.countsByStatus.PAID).toBe(1);
    expect(body.countsByStatus.WAIVED).toBe(1);
    expect(body.countsByStatus.PARTIAL).toBe(1);
    expect(body.waivedTotal).toBe('1000.00');

    await officer.agent.get('/api/v1/collections/status?period=not-a-period').expect(400);
  });

  it('a plain resident gets 403 on status', async () => {
    const resident = await signupAndLogin(`co-plain2-${randomUUID()}@example.com`, flatIds[5], OccupancyRole.OWNER_OCCUPIER);
    await resident.agent.get('/api/v1/collections/status').expect(403);
  });
});
