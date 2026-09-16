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
import { MailerService, type SendMailInput } from '../src/infra/mailer/mailer.service.js';
import { SmsService, type SendSmsInput, type SmsSendResult } from '../src/infra/sms/sms.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { AccountKind, OccupancyRole, PrincipalKind, RatificationStatus, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Dashboard KPI aggregate — web-console follow-up to give the top-row
 * counts in one call. Two routes, two different principal kinds:
 *  - GET /dashboard/society/:sid — committee/treasurer resident, exact
 *    counts asserted against a dedicated, fully-known fixture society;
 *  - GET /dashboard/operator — platform operator, cross-society counts.
 *    Because Postgres is shared with every other e2e suite (potentially
 *    running concurrently), the operator assertions only check plausible
 *    lower bounds and shape, never exact platform totals — matching how
 *    operator-console.e2e-spec.ts's own society-listing assertions work
 *    (`.some(...)`, not exact array equality).
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

interface SocietyDashboardBody {
  flats: number;
  residents: number;
  vendors: number;
  pendingRatifications: number;
  accountBalances: { kind: AccountKind; balance: string }[];
}

interface OperatorDashboardBody {
  societies: { active: number; total: number };
  flats: number;
  residents: number;
  vendors: number;
  pendingRatifications: number;
}

describe('Dashboard KPI aggregate (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let sms: CapturingSms;

  let societyId: string;
  const flatIds: string[] = [];
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

    const society = await prisma.society.create({ data: { name: 'Dashboard KPI Test Society', address: 'n/a' } });
    societyId = society.id;
    for (let i = 0; i < 5; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `DASH-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { societyId } });
    await prisma.account.deleteMany({ where: { societyId } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.vendorCategory.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });

    await app.close();
  });

  /** Signs up a resident by phone+SMS OTP. Leaves ratificationStatus PENDING unless `ratify` is true. */
  async function residentFixture(flatId: string, ratify: boolean) {
    const phone = `+9196${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `dashboard-resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Dashboard Resident', email, phone, societyId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    if (ratify) {
      await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });
    }

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    // A still-PENDING occupancy can't authenticate at all (Phase 6.3 gate —
    // see ratification.e2e-spec.ts); only attempt /auth/verify for the
    // already-ratified fixtures that actually need a working session.
    if (ratify) {
      await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    }
    return { agent, userId };
  }

  /** A ratified resident who also holds `kind` in this society. */
  async function officerFixture(flatId: string, kind: RoleKind) {
    const { agent, userId } = await residentFixture(flatId, true);
    await prisma.role.create({ data: { societyId, userId, kind } });
    return { agent, userId };
  }

  async function bootstrapOperatorAgent() {
    const email = `dashboard-operator-${randomUUID()}@example.com`;
    const password = 'dashboard operator passphrase';
    const user = await prisma.user.create({ data: { name: 'Bootstrap Operator', email, principalKind: PrincipalKind.OPERATOR } });
    userIds.push(user.id);

    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
    const startCode = extractOtpFromEmail(mailer.sent.filter((m) => m.to === email).at(-1)!);
    const completeRes = await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/complete').send({ email, code: startCode, password }).expect(201);
    const { totpSecret } = completeRes.body as { totpSecret: string };
    const enrollCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollCode }).expect(204);

    const loginCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: loginCode }).expect(201);
    return { agent, userId: user.id };
  }

  it('a committee officer gets society KPIs with exact, known counts; a non-officer resident gets 403', async () => {
    // Known fixture: 5 flats (from beforeAll).
    // Residents: 1 committee officer + 2 plain ratified residents = 3.
    const committee = await officerFixture(flatIds[0], RoleKind.COMMITTEE);
    const plainA = await residentFixture(flatIds[1], true);
    await residentFixture(flatIds[2], true);

    // 1 still-pending (self-registered, not yet decided) occupancy.
    await residentFixture(flatIds[3], false);

    // 1 rejected occupancy — decided, so NOT pending, and never counted as
    // a resident either.
    const rejected = await residentFixture(flatIds[4], false);
    await prisma.occupancy.updateMany({ where: { userId: rejected.userId }, data: { ratificationStatus: RatificationStatus.REJECTED, ratificationDecidedAt: new Date() } });

    // 2 vendors in this society.
    const vendorA = await prisma.vendor.create({ data: { societyId, name: `Dashboard Vendor A ${randomUUID()}` } });
    const vendorB = await prisma.vendor.create({ data: { societyId, name: `Dashboard Vendor B ${randomUUID()}` } });
    vendorIds.push(vendorA.id, vendorB.id);

    // One ledger adjustment so accountBalances is non-trivial (mirrors
    // ledger.e2e-spec.ts's sign convention: debit goes negative, credit
    // goes positive).
    await committee.agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', randomUUID())
      .send({ debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.DISPUTE, amount: 750, reasonCode: 'TEST_DASHBOARD_KPI' })
      .expect(201);

    const dashRes = await committee.agent.get(`/api/v1/dashboard/society/${societyId}`).expect(200);
    const dash = dashRes.body as SocietyDashboardBody;

    expect(dash.flats).toBe(5);
    expect(dash.residents).toBe(3);
    expect(dash.vendors).toBe(2);
    expect(dash.pendingRatifications).toBe(1);

    const masterBalance = dash.accountBalances.find((b) => b.kind === AccountKind.SOCIETY_MASTER);
    const disputeBalance = dash.accountBalances.find((b) => b.kind === AccountKind.DISPUTE);
    expect(Number(masterBalance?.balance)).toBe(-750);
    expect(Number(disputeBalance?.balance)).toBe(750);

    // A ratified resident with no COMMITTEE/TREASURER role is 403'd.
    await plainA.agent.get(`/api/v1/dashboard/society/${societyId}`).expect(403);

    // Wrong-society :sid is scoped out even for a genuine officer.
    const otherSociety = await prisma.society.create({ data: { name: 'Dashboard Other Society', address: 'n/a' } });
    await committee.agent.get(`/api/v1/dashboard/society/${otherSociety.id}`).expect(403);
    await prisma.society.delete({ where: { id: otherSociety.id } });
  });

  it('an operator gets platform-wide KPIs; a resident gets 403 on the operator route', async () => {
    const { agent: operatorAgent } = await bootstrapOperatorAgent();
    const resident = await residentFixture(flatIds[0], true);

    const dashRes = await operatorAgent.get('/api/v1/dashboard/operator').expect(200);
    const dash = dashRes.body as OperatorDashboardBody;

    // Platform-wide: at least this suite's own society (and, once the
    // society-KPI test above has run, its 2 vendors / 3 residents / 5
    // flats / 1 pending ratification) must be reflected — but other e2e
    // suites' data may coexist in the shared database, so these are lower
    // bounds, not exact totals.
    // NOTE: `active` and `total` are two independent COUNT queries (see
    // DashboardService.operatorKpis), not one atomic snapshot — under the
    // shared Postgres this suite runs against, a concurrent e2e file can
    // create a society between the two counts, so `active` and `total`
    // are each asserted independently rather than cross-checked against
    // each other.
    expect(dash.societies.total).toBeGreaterThanOrEqual(1);
    expect(dash.societies.active).toBeGreaterThanOrEqual(1);
    expect(dash.flats).toBeGreaterThanOrEqual(5);
    expect(dash.vendors).toBeGreaterThanOrEqual(2);
    expect(dash.residents).toBeGreaterThanOrEqual(1);
    expect(dash.pendingRatifications).toBeGreaterThanOrEqual(0);

    await resident.agent.get('/api/v1/dashboard/operator').expect(403);
  });
});
