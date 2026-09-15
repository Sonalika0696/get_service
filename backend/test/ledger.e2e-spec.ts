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
import { AccountKind, OccupancyRole, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 4A (escrow ledger foundation) Definition of Done, end-to-end
 * against real Postgres:
 *  - a committee (or treasurer) member can post a manual adjustment, which
 *    moves the posted amount between the two accounts' cached balances and
 *    is reflected in GET /ledger's aggregates, with balancesIntact true;
 *  - POST /ledger/adjustments is idempotent: replaying the identical
 *    request with the same Idempotency-Key returns the exact same response
 *    and does NOT create a second LedgerEntry; a different key does;
 *  - a missing Idempotency-Key header is rejected with 400;
 *  - role gates: only COMMITTEE/TREASURER may post adjustments or read
 *    /ledger, and only TREASURER may read /ledger/reconciliation;
 *  - /ledger/reconciliation returns the Phase 4A stub shape;
 *  - conservation: posting several transfers between non-EXTERNAL accounts
 *    never changes the sum of every account's balance in the society.
 *
 * No Razorpay/payments/offers/bookings/payouts are exercised here — those
 * are Phase 4B/4C.
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

interface LedgerEntryBody {
  id: string;
  societyId: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string | number;
  reasonCode: string;
  linkedEntityType: string | null;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

interface ReconciliationBody {
  date: string;
  ledgerEntryCount: number;
  ledgerNetExternal: string;
  settlementRows: unknown[];
  matched: unknown[];
  unmatched: unknown[];
  note: string;
}

describe('Ledger (e2e)', () => {
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

  /** Signs a brand-new resident up in the shared test society, verifies their OTP, and returns a cookie-jar agent logged in as them. */
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

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);
    cookieName = app.get(AppConfigService).env.SESSION_COOKIE_NAME;

    const society = await prisma.society.create({ data: { name: 'Ledger Test Society', address: 'n/a' } });
    societyId = society.id;
    for (let i = 0; i < 6; i++) {
      const flat = await prisma.flat.create({
        data: { societyId, unitNo: `L-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 },
      });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    // FK-ordered cleanup: ledger rows before accounts, accounts/idempotency
    // keys before the society, then the usual identity/audit teardown.
    await prisma.ledgerEntry.deleteMany({ where: { societyId } });
    await prisma.account.deleteMany({ where: { societyId } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId } });
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

  it('a committee member posts an adjustment, moving the two accounts\' balances and keeping balancesIntact true', async () => {
    const committee = await signupAndLogin(`ledger-committee-basic-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);

    const postRes = await committee.agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', randomUUID())
      .send({ debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.COMMISSION_SINK, amount: 500, reasonCode: 'TEST_ADJUSTMENT_BASIC' })
      .expect(201);
    const entry = postRes.body as LedgerEntryBody;
    expect(entry.reasonCode).toBe('TEST_ADJUSTMENT_BASIC');
    expect(Number(entry.amount)).toBe(500);
    expect(entry.debitAccountId).not.toBe(entry.creditAccountId);

    const ledgerRes = await committee.agent.get('/api/v1/ledger').expect(200);
    const ledger = ledgerRes.body as LedgerAggregateBody;
    expect(ledger.balancesIntact).toBe(true);

    const masterBalance = ledger.balances.find((b) => b.kind === AccountKind.SOCIETY_MASTER);
    const sinkBalance = ledger.balances.find((b) => b.kind === AccountKind.COMMISSION_SINK);
    expect(Number(masterBalance?.balance)).toBe(-500);
    expect(Number(sinkBalance?.balance)).toBe(500);
  });

  it('is idempotent: replaying the same request + Idempotency-Key returns the same response and creates no second entry; a different key creates a new one', async () => {
    const committee = await signupAndLogin(`ledger-committee-idem-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);

    const idempotencyKey = randomUUID();
    const body = { debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.BULK_BUY, amount: 250, reasonCode: 'TEST_ADJUSTMENT_IDEMPOTENT' };

    const first = await committee.agent.post('/api/v1/ledger/adjustments').set('Idempotency-Key', idempotencyKey).send(body).expect(201);
    const countAfterFirst = await prisma.ledgerEntry.count({ where: { societyId, reasonCode: 'TEST_ADJUSTMENT_IDEMPOTENT' } });
    expect(countAfterFirst).toBe(1);

    const replay = await committee.agent.post('/api/v1/ledger/adjustments').set('Idempotency-Key', idempotencyKey).send(body).expect(201);
    expect(replay.body).toEqual(first.body);
    const countAfterReplay = await prisma.ledgerEntry.count({ where: { societyId, reasonCode: 'TEST_ADJUSTMENT_IDEMPOTENT' } });
    expect(countAfterReplay).toBe(1); // replay did not create a second row

    const differentKey = randomUUID();
    const second = await committee.agent.post('/api/v1/ledger/adjustments').set('Idempotency-Key', differentKey).send(body).expect(201);
    expect((second.body as LedgerEntryBody).id).not.toBe((first.body as LedgerEntryBody).id);
    const countAfterSecondKey = await prisma.ledgerEntry.count({ where: { societyId, reasonCode: 'TEST_ADJUSTMENT_IDEMPOTENT' } });
    expect(countAfterSecondKey).toBe(2);
  });

  it('rejects an adjustment with no Idempotency-Key header', async () => {
    const committee = await signupAndLogin(`ledger-committee-noheader-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);

    await committee.agent
      .post('/api/v1/ledger/adjustments')
      .send({ debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.COMMISSION_SINK, amount: 10, reasonCode: 'TEST_NO_HEADER' })
      .expect(400);
  });

  it('role gates: a plain resident is forbidden from posting adjustments or reading /ledger; a non-treasurer is forbidden from /ledger/reconciliation', async () => {
    const resident = await signupAndLogin(`ledger-resident-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.TENANT);

    await resident.agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', randomUUID())
      .send({ debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.COMMISSION_SINK, amount: 10, reasonCode: 'TEST_FORBIDDEN' })
      .expect(403);
    await resident.agent.get('/api/v1/ledger').expect(403);
    await resident.agent.get('/api/v1/ledger/reconciliation').expect(403);

    // A committee member (not a treasurer) is also locked out of reconciliation.
    const committeeOnly = await signupAndLogin(`ledger-committee-only-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committeeOnly.userId, RoleKind.COMMITTEE);
    await committeeOnly.agent.get('/api/v1/ledger/reconciliation').expect(403);
    // ...but a committee member CAN post adjustments and read /ledger.
    await committeeOnly.agent.get('/api/v1/ledger').expect(200);
  });

  it('the reconciliation endpoint returns the Phase 4A stub shape for a treasurer', async () => {
    const treasurer = await signupAndLogin(`ledger-treasurer-${randomUUID()}@example.com`, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);

    // A treasurer (without COMMITTEE) can also post adjustments — the route allows either role.
    await treasurer.agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', randomUUID())
      .send({ debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.VOUCHER, amount: 20, reasonCode: 'TEST_TREASURER_CAN_POST' })
      .expect(201);

    const recRes = await treasurer.agent.get('/api/v1/ledger/reconciliation').expect(200);
    const rec = recRes.body as ReconciliationBody;
    expect(rec.settlementRows).toEqual([]);
    expect(rec.matched).toEqual([]);
    expect(rec.unmatched).toEqual([]);
    expect(rec.note).toMatch(/stub/i);
    expect(typeof rec.ledgerEntryCount).toBe('number');
    expect(typeof rec.ledgerNetExternal).toBe('string');
    expect(typeof rec.date).toBe('string');
  });

  it('conserves the sum of every account balance across a chain of postings between non-EXTERNAL accounts', async () => {
    const committee = await signupAndLogin(`ledger-committee-conserve-${randomUUID()}@example.com`, flatIds[5], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);

    const sumBalances = async (): Promise<number> => {
      const accounts = await prisma.account.findMany({ where: { societyId } });
      return accounts.reduce((total, a) => total + Number(a.balance), 0);
    };

    const before = await sumBalances();

    const posts = [
      { debitKind: AccountKind.SOCIETY_MASTER, creditKind: AccountKind.DISPUTE, amount: 75, reasonCode: 'TEST_CONSERVE_1' },
      { debitKind: AccountKind.DISPUTE, creditKind: AccountKind.LENDING_SIM, amount: 30, reasonCode: 'TEST_CONSERVE_2' },
      { debitKind: AccountKind.LENDING_SIM, creditKind: AccountKind.SOCIETY_MASTER, amount: 10, reasonCode: 'TEST_CONSERVE_3' },
    ];
    for (const post of posts) {
      await committee.agent.post('/api/v1/ledger/adjustments').set('Idempotency-Key', randomUUID()).send(post).expect(201);
    }

    const after = await sumBalances();
    expect(after).toBeCloseTo(before, 6);

    const verifyRes = await committee.agent.get('/api/v1/ledger').expect(200);
    expect((verifyRes.body as LedgerAggregateBody).balancesIntact).toBe(true);
  });
});
