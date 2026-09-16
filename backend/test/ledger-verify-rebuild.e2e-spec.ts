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
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import { AccountKind, OccupancyRole, PrincipalKind, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 6.5 Invariant I6 (BACKEND_PLAN.md Phase 6.5; DECISIONS_V2_SCOPE.md
 * §8.1) — balance-cache assertion worker + verify endpoint + rebuild.
 * Definition of Done exercised here, end to end against real Postgres:
 *  - GET /ledger/verify reports an intact cache for a healthy society, open
 *    to any resident (mirrors GET /audit/verify's authorization shape);
 *  - tampering an Account.balance directly via Prisma (bypassing the app
 *    layer, same technique as audit-verify.e2e-spec.ts) is reported back
 *    through GET /ledger/verify as a divergence, not swallowed;
 *  - POST /ledger/rebuild (TREASURER-only) rewrites every Account.balance
 *    in the society from LedgerEntry truth, restoring GET /ledger/verify to
 *    intact, and preserves conservation (the sum of every account's cached
 *    balance across a closed set of non-EXTERNAL transfers);
 *  - authz: a plain resident and a COMMITTEE-only member (no TREASURER
 *    role) are both 403'd off POST /ledger/rebuild;
 *  - POST /ledger/assert-balances (the I6 assertion worker's manual
 *    trigger) is OPERATOR-only and reports the divergence its cross-society
 *    sweep finds; a resident is 403'd off it.
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

/** GET /ledger/verify — integrity only, no amounts (resident-callable). */
interface VerifySummaryBody {
  ok: boolean;
  accounts: { kind: AccountKind; intact: boolean }[];
}

/** POST /ledger/rebuild's embedded report — unchanged, still full detail (TREASURER-only). */
interface FullVerificationReportBody {
  ok: boolean;
  accounts: { kind: AccountKind; accountId: string; cached: string; recomputed: string; intact: boolean }[];
}

interface RebuildBody {
  societyId: string;
  accounts: { kind: AccountKind; accountId: string; balance: string }[];
  report: FullVerificationReportBody;
}

interface AssertBalancesBody {
  societiesChecked: number;
  accountsChecked: number;
  divergentAccounts: number;
}

describe('Ledger balance-cache integrity — Phase 6.5 I6 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let cookieName: string;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const societyIds: string[] = [];

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

    // Phase 6.3 ratification gate — same fixture convention as ledger.e2e-spec.ts.
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });

    return { userId, agent, email };
  }

  async function makeRole(userId: string, sId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId: sId, userId, kind } });
  }

  /** Bootstraps a platform-operator session directly via Prisma + the officer-auth endpoints — same technique as operator-console.e2e-spec.ts. */
  async function bootstrapOperatorAgent() {
    const email = `bootstrap-operator-ledger-${randomUUID()}@example.com`;
    const password = 'bootstrap operator passphrase';
    const user = await prisma.user.create({ data: { name: 'Bootstrap Operator', email, principalKind: PrincipalKind.OPERATOR } });
    userIds.push(user.id);

    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/start').send({ email }).expect(204);
    const startCode = extractOtpCode(mailer.sent.filter((m) => m.to === email).at(-1)!);
    const completeRes = await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/complete').send({ email, code: startCode, password }).expect(201);
    const { totpSecret } = completeRes.body as { totpSecret: string };
    const enrollCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    await request(app.getHttpServer()).post('/api/v1/auth/officer/enroll/verify-totp').send({ email, code: enrollCode }).expect(204);

    const loginCode = await generateTotpCode({ secret: totpSecret, strategy: 'totp' });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/officer/login').send({ email, password, totpCode: loginCode }).expect(201);
    return { agent, userId: user.id };
  }

  async function sumBalances(sId: string): Promise<number> {
    const accounts = await prisma.account.findMany({ where: { societyId: sId } });
    return accounts.reduce((total, a) => total + Number(a.balance), 0);
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
    cookieName = app.get(AppConfigService).env.SESSION_COOKIE_NAME;

    const society = await prisma.society.create({ data: { name: 'Ledger I6 Test Society', address: 'n/a' } });
    societyId = society.id;
    societyIds.push(societyId);
    for (let i = 0; i < 4; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `I6-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.ledgerEntry.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.account.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: societyIds } } });
    await prisma.society.deleteMany({ where: { id: { in: societyIds } } });

    await app.close();
  });

  it('GET /ledger/verify reports an intact cache for a healthy society, visible to any resident', async () => {
    const committee = await signupAndLogin(`i6-vfy-healthy-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, societyId, RoleKind.COMMITTEE);

    await committee.agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', randomUUID())
      .send({ debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.DISPUTE, amount: 300, reasonCode: 'TEST_I6_HEALTHY' })
      .expect(201);

    // A plain resident (no committee/treasurer role) can still read /ledger/verify.
    const resident = await signupAndLogin(`i6-verify-healthy-resident-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.TENANT);
    const res = await resident.agent.get('/api/v1/ledger/verify').expect(200);
    const body = res.body as VerifySummaryBody;

    expect(body.ok).toBe(true);
    expect(body.accounts.length).toBeGreaterThan(0);
    expect(body.accounts.every((a) => a.intact)).toBe(true);
    // Integrity only — no cached/recomputed amounts or accountId leak to a resident.
    for (const row of body.accounts) {
      expect(Object.keys(row).sort()).toEqual(['intact', 'kind']);
    }
  });

  it('requires auth: 401 without a session', async () => {
    await request(app.getHttpServer()).get('/api/v1/ledger/verify').expect(401);
  });

  it('GET /ledger/verify reports a divergence when Account.balance is tampered directly via Prisma; POST /ledger/rebuild restores it and preserves conservation', async () => {
    const treasurer = await signupAndLogin(`i6-rebuild-treasurer-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, societyId, RoleKind.TREASURER);

    // Post a small closed loop of transfers between non-EXTERNAL accounts so
    // the sum of every account balance is conserved (should sum to 0).
    const posts = [
      { debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.DISPUTE, amount: 120, reasonCode: 'TEST_I6_REBUILD_1' },
      { debitKind: AccountKind.DISPUTE, creditKind: AccountKind.RETENTION, amount: 45, reasonCode: 'TEST_I6_REBUILD_2' },
      { debitKind: AccountKind.RETENTION, creditKind: AccountKind.SOCIETY_MASTER, amount: 15, reasonCode: 'TEST_I6_REBUILD_3' },
    ];
    for (const post of posts) {
      await treasurer.agent.post('/api/v1/ledger/adjustments').set('Idempotency-Key', randomUUID()).send(post).expect(201);
    }

    const conservedSum = await sumBalances(societyId);
    expect(conservedSum).toBeCloseTo(0, 6);

    const preTamperVerify = await treasurer.agent.get('/api/v1/ledger/verify').expect(200);
    expect((preTamperVerify.body as VerifySummaryBody).ok).toBe(true);

    // Bypass the app layer entirely: directly corrupt one account's cached
    // balance, simulating drift (a crash mid-post, a bad manual UPDATE, ...).
    // Captured before the tamper, so disputeAccount.balance is the known-good
    // (ledger-true) value — used below instead of GET /ledger/verify's
    // `recomputed` field, which the integrity-only response no longer exposes.
    const disputeAccount = await prisma.account.findFirstOrThrow({ where: { societyId, kind: AccountKind.DISPUTE } });
    await prisma.account.update({ where: { id: disputeAccount.id }, data: { balance: { increment: 999 } } });

    const tamperedSum = await sumBalances(societyId);
    expect(tamperedSum).not.toBeCloseTo(conservedSum, 6);

    const tamperedVerify = await treasurer.agent.get('/api/v1/ledger/verify').expect(200);
    const tamperedBody = tamperedVerify.body as VerifySummaryBody;
    expect(tamperedBody.ok).toBe(false);
    const divergentRow = tamperedBody.accounts.find((a) => a.kind === AccountKind.DISPUTE);
    expect(divergentRow?.intact).toBe(false);
    // No accountId/cached/recomputed on this response — every other account kind must still report intact.
    expect(tamperedBody.accounts.filter((a) => a.kind !== AccountKind.DISPUTE).every((a) => a.intact)).toBe(true);

    // The rebuild rewrites the cache from ledger truth and restores conservation.
    const rebuildRes = await treasurer.agent.post('/api/v1/ledger/rebuild').expect(201);
    const rebuildBody = rebuildRes.body as RebuildBody;
    expect(rebuildBody.societyId).toBe(societyId);
    expect(rebuildBody.report.ok).toBe(true);
    const rebuiltDisputeRow = rebuildBody.accounts.find((a) => a.accountId === disputeAccount.id);
    expect(rebuiltDisputeRow).toBeDefined();

    const rebuiltAccount = await prisma.account.findUniqueOrThrow({ where: { id: disputeAccount.id } });
    expect(Number(rebuiltAccount.balance)).toBe(Number(disputeAccount.balance));

    const postRebuildSum = await sumBalances(societyId);
    expect(postRebuildSum).toBeCloseTo(conservedSum, 6);

    const postRebuildVerify = await treasurer.agent.get('/api/v1/ledger/verify').expect(200);
    expect((postRebuildVerify.body as VerifySummaryBody).ok).toBe(true);

    // The rebuild wrote its own audit entry (LedgerService.rebuildBalances -> AuditService.appendBestEffort).
    const auditRow = await prisma.auditLog.findFirst({ where: { societyId, action: 'LEDGER_BALANCE_REBUILD' }, orderBy: { sequence: 'desc' } });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorId).toBe(treasurer.userId);
  });

  it('authz: a plain resident and a COMMITTEE-only member (no TREASURER role) are 403d off POST /ledger/rebuild', async () => {
    const resident = await signupAndLogin(`i6-rb-forbid-res-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.TENANT);
    await resident.agent.post('/api/v1/ledger/rebuild').expect(403);

    const committeeOnlyFlat = await prisma.flat.create({ data: { societyId, unitNo: `I6-CO-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    const committeeOnly = await signupAndLogin(`i6-rb-forbid-com-${randomUUID()}@example.com`, societyId, committeeOnlyFlat.id, OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committeeOnly.userId, societyId, RoleKind.COMMITTEE);
    await committeeOnly.agent.post('/api/v1/ledger/rebuild').expect(403);
  });

  it('POST /ledger/assert-balances is OPERATOR-only, sweeps every ACTIVE society, and surfaces a divergence it finds', async () => {
    const assertSociety = await prisma.society.create({ data: { name: 'Ledger I6 Assert-Worker Society', address: 'n/a' } });
    societyIds.push(assertSociety.id);
    const assertFlat = await prisma.flat.create({ data: { societyId: assertSociety.id, unitNo: `I6A-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });

    const committee = await signupAndLogin(`i6-assert-committee-${randomUUID()}@example.com`, assertSociety.id, assertFlat.id, OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, assertSociety.id, RoleKind.COMMITTEE);
    await committee.agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', randomUUID())
      .send({ debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.DISPUTE, amount: 50, reasonCode: 'TEST_I6_ASSERT_WORKER' })
      .expect(201);

    // Tamper this society's cached balance directly, same technique as the rebuild test.
    const account = await prisma.account.findFirstOrThrow({ where: { societyId: assertSociety.id, kind: AccountKind.DISPUTE } });
    await prisma.account.update({ where: { id: account.id }, data: { balance: { increment: 42 } } });

    // A resident (no matter their role) is forbidden — this route is platform-operator-only.
    await committee.agent.post('/api/v1/ledger/assert-balances').expect(403);
    await request(app.getHttpServer()).post('/api/v1/ledger/assert-balances').expect(401);

    const { agent: operatorAgent } = await bootstrapOperatorAgent();
    const res = await operatorAgent.post('/api/v1/ledger/assert-balances').expect(201);
    const body = res.body as AssertBalancesBody;

    expect(body.societiesChecked).toBeGreaterThanOrEqual(2); // at least the main I6 society + this one
    expect(body.accountsChecked).toBeGreaterThan(0);
    expect(body.divergentAccounts).toBeGreaterThanOrEqual(1); // the tampered DISPUTE account above
  });
});
