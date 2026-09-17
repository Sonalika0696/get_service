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
import { AccountKind, FixedDepositAction, FixedDepositStatus, OccupancyRole, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 12 (M12) — corpus treasury: fixed deposits, sweep rule, maturity
 * ladder, end-to-end against real Postgres. Mirrors
 * pocket-transfers.e2e-spec.ts's fixture shape (society + flats + officers
 * signed up and RATIFIED, roles granted via `Role` rows) but exercises
 * TreasuryService — propose auto-counts the initiator's own PLACE
 * signature (unlike pocket-transfers' request, which never does), so a
 * SINGLE distinct second officer completes placement; the initiator can
 * never be that second officer (403); a repeat call by the same
 * non-initiator officer before completion is a 409 (exercised on the
 * withdrawal path, where it's actually reachable — see that describe
 * block's comment for why it's unreachable on the placement path by
 * construction).
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

interface DepositBody {
  id: string;
  societyId: string;
  bankName: string;
  principal: string | number;
  ratePct: string | number;
  tenorDays: number;
  status: keyof typeof FixedDepositStatus;
  proposedBySweep: boolean;
  initiatedById: string;
  placedAt: string | null;
  maturesAt: string | null;
  maturityAmount: string | number | null;
  interestEarned: string | number | null;
  closedAt: string | null;
  closeReason: string | null;
  renewedFromId: string | null;
  placeAuthorisedCount: number;
  withdrawAuthorisedCount: number;
}

interface SweepProposeBody {
  proposed: DepositBody | null;
  reason?: string;
}

interface TreasuryConfigBody {
  operatingFloatFloor: number;
  minTenorDays: number;
  defaultTenorDays: number;
  defaultRatePct: number;
  defaultBankName: string;
  isDefault: boolean;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('Treasury — corpus fixed deposits (e2e) — Phase 12 (M12)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

  const societyIds: string[] = [];
  const userIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.sent.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  async function signupAndLogin(email: string, societyId: string, flatId: string, role: OccupancyRole) {
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
  type Officer = Awaited<ReturnType<typeof signupAndLogin>>;

  async function makeRole(societyId: string, userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
  }

  async function createSocietyWithFlats(name: string, flatCount: number): Promise<{ societyId: string; flatIds: string[] }> {
    const society = await prisma.society.create({ data: { name, address: 'n/a' } });
    societyIds.push(society.id);
    const flatIds: string[] = [];
    for (let i = 0; i < flatCount; i++) {
      const flat = await prisma.flat.create({ data: { societyId: society.id, unitNo: `TR-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
    return { societyId: society.id, flatIds };
  }

  /** Funds CORPUS by posting a treasury adjustment EXTERNAL -> CORPUS, exactly like pocket-transfers.e2e-spec.ts's fundPocket. */
  async function fundCorpus(agent: ReturnType<typeof request.agent>, amount: number): Promise<void> {
    await agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', `fund-corpus-${randomUUID()}`)
      .send({ debitKind: AccountKind.EXTERNAL, creditKind: AccountKind.CORPUS, amount, reasonCode: 'TEST_FUND_CORPUS' })
      .expect(201);
  }

  async function ledgerBalances(agent: ReturnType<typeof request.agent>): Promise<LedgerAggregateBody> {
    return (await agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
  }

  function balanceOf(ledger: LedgerAggregateBody, kind: AccountKind): number {
    return Number(ledger.balances.find((b) => b.kind === kind)?.balance ?? 0);
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
  });

  afterAll(async () => {
    await prisma.fixedDepositAuthorisation.deleteMany({ where: { deposit: { societyId: { in: societyIds } } } });
    await prisma.fixedDeposit.deleteMany({ where: { societyId: { in: societyIds } } });
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

  describe('config: defaults, PUT merge preserving other keys', () => {
    let societyId: string;
    let committee: Officer;

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Treasury Config Society', 3);
      societyId = stood.societyId;
      committee = await signupAndLogin(`tr-cfg-committee-${randomUUID()}@example.com`, societyId, stood.flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
    });

    it('GET returns documented defaults, flagged isDefault, when unset', async () => {
      const res = await committee.agent.get('/api/v1/treasury/config').expect(200);
      const body = res.body as TreasuryConfigBody;
      expect(body.isDefault).toBe(true);
      expect(body.minTenorDays).toBeGreaterThanOrEqual(7);
      expect(body.defaultTenorDays).toBeGreaterThanOrEqual(body.minTenorDays);
    });

    it('PUT validates bounds', async () => {
      await committee.agent
        .put('/api/v1/treasury/config')
        .send({ operatingFloatFloor: -1, minTenorDays: 30, defaultTenorDays: 90, defaultRatePct: 6, defaultBankName: 'Bank' })
        .expect(400);
      await committee.agent
        .put('/api/v1/treasury/config')
        .send({ operatingFloatFloor: 1000, minTenorDays: 3, defaultTenorDays: 90, defaultRatePct: 6, defaultBankName: 'Bank' })
        .expect(400);
      await committee.agent
        .put('/api/v1/treasury/config')
        .send({ operatingFloatFloor: 1000, minTenorDays: 30, defaultTenorDays: 90, defaultRatePct: 25, defaultBankName: 'Bank' })
        .expect(400);
    });

    it('PUT merges the treasury key without clobbering an unrelated existing Society.config key', async () => {
      await prisma.society.update({ where: { id: societyId }, data: { config: { unrelatedFeatureFlag: 'keep-me' } } });

      const res = await committee.agent
        .put('/api/v1/treasury/config')
        .send({ operatingFloatFloor: 50_000, minTenorDays: 30, defaultTenorDays: 180, defaultRatePct: 7, defaultBankName: 'HDFC Bank' })
        .expect(200);
      const body = res.body as TreasuryConfigBody;
      expect(body.isDefault).toBe(false);
      expect(body.defaultBankName).toBe('HDFC Bank');

      const society = await prisma.society.findUniqueOrThrow({ where: { id: societyId } });
      const config = society.config as Record<string, unknown>;
      expect(config.unrelatedFeatureFlag).toBe('keep-me');
      expect(config.treasury).toBeDefined();

      const getRes = await committee.agent.get('/api/v1/treasury/config').expect(200);
      expect((getRes.body as TreasuryConfigBody).isDefault).toBe(false);
      expect((getRes.body as TreasuryConfigBody).operatingFloatFloor).toBe(50_000);
    });
  });

  describe('propose -> dual authorisation -> ACTIVE; over-commit rejected; maturity; I4 enforcement', () => {
    let societyId: string;
    let flatIds: string[];
    let committee: Officer; // initiator
    let treasurer: Officer; // second officer
    let deputy: Officer; // third officer, unused signer for most tests

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Treasury Main Society', 10);
      societyId = stood.societyId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`tr-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
      treasurer = await signupAndLogin(`tr-treasurer-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);
      deputy = await signupAndLogin(`tr-deputy-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, deputy.userId, RoleKind.DEPUTY_TREASURER);

      await committee.agent
        .put('/api/v1/treasury/config')
        .send({ operatingFloatFloor: 100_000, minTenorDays: 30, defaultTenorDays: 365, defaultRatePct: 6.5, defaultBankName: 'Default Bank' })
        .expect(200);

      await fundCorpus(committee.agent, 1_000_000);
    });

    let activeDepositId: string;

    it('propose creates PROPOSED with the initiator already counted as the first PLACE signature', async () => {
      const res = await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: 200_000, ratePct: 7, tenorDays: 30, bankName: 'Test Bank' })
        .expect(201);
      const body = res.body as DepositBody;
      expect(body.status).toBe('PROPOSED');
      expect(body.placeAuthorisedCount).toBe(1);
      expect(body.initiatedById).toBe(committee.userId);
      activeDepositId = body.id;

      const ledger = await ledgerBalances(committee.agent);
      // request never posts to the ledger.
      expect(balanceOf(ledger, AccountKind.FIXED_DEPOSIT)).toBe(0);
    });

    it('rejects tenorDays below the society minTenorDays', async () => {
      await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: 10_000, ratePct: 7, tenorDays: 10, bankName: 'Test Bank' })
        .expect(400);
    });

    it('the initiator authorising their own placement is rejected (403)', async () => {
      await committee.agent.post(`/api/v1/treasury/deposits/${activeDepositId}/authorise-placement`).expect(403);
    });

    it('a plain resident (no officer role) is rejected outright', async () => {
      const plain = await signupAndLogin(`tr-plain-${randomUUID()}@example.com`, societyId, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
      await plain.agent.post(`/api/v1/treasury/deposits/${activeDepositId}/authorise-placement`).expect(403);
    });

    it('a second DISTINCT officer completes placement -> ACTIVE, CORPUS -> FIXED_DEPOSIT posted, maturityAmount computed', async () => {
      const startLedger = await ledgerBalances(committee.agent);
      const corpusStart = balanceOf(startLedger, AccountKind.CORPUS);

      const res = await treasurer.agent.post(`/api/v1/treasury/deposits/${activeDepositId}/authorise-placement`).expect(201);
      const body = res.body as DepositBody;
      expect(body.status).toBe('ACTIVE');
      expect(body.placeAuthorisedCount).toBe(2);
      expect(body.placedAt).not.toBeNull();
      expect(body.maturesAt).not.toBeNull();
      // 200000 * 7% * 30/365 = 1150.6849... -> 1150.68; maturityAmount = 201150.68
      expect(Number(body.maturityAmount)).toBeCloseTo(201_150.68, 2);

      const endLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(endLedger, AccountKind.CORPUS)).toBe(corpusStart - 200_000);
      expect(balanceOf(endLedger, AccountKind.FIXED_DEPOSIT)).toBe(200_000);
      expect(endLedger.balancesIntact).toBe(true);

      const entryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'FixedDeposit', linkedEntityId: activeDepositId, reasonCode: 'TREASURY_DEPOSIT_PLACE' } });
      expect(entryCount).toBe(1);
    });

    it('replaying authorise-placement after ACTIVE is a verified no-op (no double posting)', async () => {
      const res = await deputy.agent.post(`/api/v1/treasury/deposits/${activeDepositId}/authorise-placement`).expect(201);
      expect((res.body as DepositBody).status).toBe('ACTIVE');

      const entryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'FixedDeposit', linkedEntityId: activeDepositId, reasonCode: 'TREASURY_DEPOSIT_PLACE' } });
      expect(entryCount).toBe(1);
    });

    it('proposing beyond (CORPUS balance - floor - already-proposed) is rejected with 400', async () => {
      const ledger = await ledgerBalances(committee.agent);
      const corpus = balanceOf(ledger, AccountKind.CORPUS); // 800,000 after the previous placement
      // available = corpus - 100,000 floor; ask for more than that.
      await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: corpus, ratePct: 7, tenorDays: 30, bankName: 'Over Bank' })
        .expect(400);
    });

    it('two PROPOSED deposits cannot jointly over-commit the same CORPUS money', async () => {
      const ledger = await ledgerBalances(committee.agent);
      const corpus = balanceOf(ledger, AccountKind.CORPUS);
      const available = corpus - 100_000;
      const half = Math.floor(available / 2) + 1000; // two of these exceed `available`

      const first = await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: half, ratePct: 7, tenorDays: 30, bankName: 'Split Bank' })
        .expect(201);

      // The second proposal must now account for the first's still-PROPOSED principal.
      await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: half, ratePct: 7, tenorDays: 30, bankName: 'Split Bank' })
        .expect(400);

      // Cancelling the first frees the money back up.
      await committee.agent.post(`/api/v1/treasury/deposits/${(first.body as DepositBody).id}/cancel`).expect(201);
      const secondNowOk = await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: half, ratePct: 7, tenorDays: 30, bankName: 'Split Bank' })
        .expect(201);
      await committee.agent.post(`/api/v1/treasury/deposits/${(secondNowOk.body as DepositBody).id}/cancel`).expect(201);
    });

    it('maturity via process-maturities: principal back to CORPUS, interest to INTEREST_INCOME, idempotent, I4 holds', async () => {
      // Fast-forward: set maturesAt into the past directly (LANE_RULES §7 —
      // "set maturesAt in the past via Prisma, as other specs push time").
      await prisma.fixedDeposit.update({ where: { id: activeDepositId }, data: { maturesAt: new Date(Date.now() - MS_PER_DAY) } });

      const startLedger = await ledgerBalances(committee.agent);
      const corpusStart = balanceOf(startLedger, AccountKind.CORPUS);
      const fdStart = balanceOf(startLedger, AccountKind.FIXED_DEPOSIT);
      const interestStart = balanceOf(startLedger, AccountKind.INTEREST_INCOME);

      const res = await committee.agent.post('/api/v1/treasury/deposits/process-maturities').expect(201);
      expect((res.body as { maturedIds: string[] }).maturedIds).toContain(activeDepositId);

      const deposit = await committee.agent.get(`/api/v1/treasury/deposits/${activeDepositId}`).expect(200);
      const body = deposit.body as DepositBody;
      expect(body.status).toBe('MATURED');
      expect(body.closedAt).not.toBeNull();
      expect(Number(body.interestEarned)).toBeCloseTo(1150.68, 2); // full-tenor simple interest, 200000 @ 7% for 30 days

      const endLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(endLedger, AccountKind.FIXED_DEPOSIT)).toBe(fdStart - 200_000);
      expect(balanceOf(endLedger, AccountKind.CORPUS)).toBe(corpusStart + 200_000);
      expect(balanceOf(endLedger, AccountKind.INTEREST_INCOME)).toBeCloseTo(interestStart + 1150.68, 2);
      expect(endLedger.balancesIntact).toBe(true);

      // Idempotent: a second call matures nothing more for this deposit.
      const replay = await committee.agent.post('/api/v1/treasury/deposits/process-maturities').expect(201);
      expect((replay.body as { maturedIds: string[] }).maturedIds).not.toContain(activeDepositId);
      const replayDirect = await committee.agent.post(`/api/v1/treasury/deposits/${activeDepositId}/mature`).expect(201);
      expect((replayDirect.body as DepositBody).status).toBe('MATURED');

      const finalLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(finalLedger, AccountKind.CORPUS)).toBe(corpusStart + 200_000); // unchanged by the replay

      // I4: every interest-reason ledger entry for this society credits ONLY INTEREST_INCOME, never a flat/other account.
      const interestAccount = await prisma.account.findUniqueOrThrow({ where: { societyId_kind: { societyId, kind: AccountKind.INTEREST_INCOME } } });
      const interestEntries = await prisma.ledgerEntry.findMany({ where: { societyId, reasonCode: { in: ['TREASURY_DEPOSIT_MATURE_INTEREST', 'TREASURY_DEPOSIT_WITHDRAW_INTEREST'] } } });
      expect(interestEntries.length).toBeGreaterThan(0);
      expect(interestEntries.every((e) => e.creditAccountId === interestAccount.id)).toBe(true);
      expect(interestEntries.every((e) => e.linkedEntityType === 'FixedDeposit')).toBe(true);
    });
  });

  describe('premature withdrawal: two distinct officers, penalty interest, 409 on repeat by the same officer', () => {
    let societyId: string;
    let flatIds: string[];
    let committee: Officer;
    let treasurer: Officer;
    let deputy: Officer;
    let depositId: string;

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Treasury Withdrawal Society', 6);
      societyId = stood.societyId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`tr-w-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
      treasurer = await signupAndLogin(`tr-w-treasurer-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);
      deputy = await signupAndLogin(`tr-w-deputy-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, deputy.userId, RoleKind.DEPUTY_TREASURER);

      await fundCorpus(committee.agent, 1_000_000);

      const proposeRes = await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: 300_000, ratePct: 8, tenorDays: 90, bankName: 'Withdraw Bank' })
        .expect(201);
      depositId = (proposeRes.body as DepositBody).id;
      await treasurer.agent.post(`/api/v1/treasury/deposits/${depositId}/authorise-placement`).expect(201);

      // Backdate placedAt by 10 days so the withdrawal has a non-trivial "days held" to price.
      await prisma.fixedDeposit.update({ where: { id: depositId }, data: { placedAt: new Date(Date.now() - 10 * MS_PER_DAY) } });
    });

    it('first officer records the WITHDRAW authorisation without moving money', async () => {
      const startLedger = await ledgerBalances(committee.agent);
      const fdStart = balanceOf(startLedger, AccountKind.FIXED_DEPOSIT);

      const res = await treasurer.agent.post(`/api/v1/treasury/deposits/${depositId}/withdraw`).send({ reason: 'Emergency roof repair' }).expect(201);
      const body = res.body as DepositBody;
      expect(body.status).toBe('ACTIVE'); // still active — only 1 of 2 signatures
      expect(body.withdrawAuthorisedCount).toBe(1);

      const authRows = await prisma.fixedDepositAuthorisation.findMany({ where: { depositId, action: FixedDepositAction.WITHDRAW } });
      expect(authRows).toHaveLength(1);

      const endLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(endLedger, AccountKind.FIXED_DEPOSIT)).toBe(fdStart); // untouched
    });

    it('the SAME officer calling withdraw again is rejected (409) before completion', async () => {
      await treasurer.agent.post(`/api/v1/treasury/deposits/${depositId}/withdraw`).send({ reason: 'trying again' }).expect(409);
    });

    it('a second DISTINCT officer completes the withdrawal with penalty interest (rate - 1.00pp)', async () => {
      const startLedger = await ledgerBalances(committee.agent);
      const corpusStart = balanceOf(startLedger, AccountKind.CORPUS);
      const fdStart = balanceOf(startLedger, AccountKind.FIXED_DEPOSIT);
      const interestStart = balanceOf(startLedger, AccountKind.INTEREST_INCOME);

      const res = await deputy.agent.post(`/api/v1/treasury/deposits/${depositId}/withdraw`).send({ reason: 'Emergency roof repair' }).expect(201);
      const body = res.body as DepositBody;
      expect(body.status).toBe('WITHDRAWN');
      expect(body.closeReason).toBe('Emergency roof repair');
      // 300000 @ (8 - 1)% for 10 days = 300000*0.07*10/365 = 575.3424... -> 575.34
      expect(Number(body.interestEarned)).toBeCloseTo(575.34, 2);

      const endLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(endLedger, AccountKind.CORPUS)).toBe(corpusStart + 300_000);
      expect(balanceOf(endLedger, AccountKind.FIXED_DEPOSIT)).toBe(fdStart - 300_000);
      expect(balanceOf(endLedger, AccountKind.INTEREST_INCOME)).toBeCloseTo(interestStart + 575.34, 2);
      expect(endLedger.balancesIntact).toBe(true);
    });

    it('replaying withdraw after WITHDRAWN is a verified no-op', async () => {
      const res = await treasurer.agent.post(`/api/v1/treasury/deposits/${depositId}/withdraw`).send({ reason: 'replay' }).expect(201);
      expect((res.body as DepositBody).status).toBe('WITHDRAWN');
    });
  });

  describe('sweep rule: respects the operating float floor and existing PROPOSED principal', () => {
    let societyId: string;
    let flatIds: string[];
    let committee: Officer;

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Treasury Sweep Society', 4);
      societyId = stood.societyId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`tr-sweep-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);

      await committee.agent
        .put('/api/v1/treasury/config')
        .send({ operatingFloatFloor: 100_000, minTenorDays: 30, defaultTenorDays: 200, defaultRatePct: 6.5, defaultBankName: 'Sweep Bank' })
        .expect(200);

      await fundCorpus(committee.agent, 500_000);
    });

    it('returns null with a reason when nothing is available (floor not yet cleared)', async () => {
      const highFloorSociety = await createSocietyWithFlats('Treasury Sweep Zero Society', 2);
      const zeroCommittee = await signupAndLogin(`tr-sweep0-${randomUUID()}@example.com`, highFloorSociety.societyId, highFloorSociety.flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(highFloorSociety.societyId, zeroCommittee.userId, RoleKind.COMMITTEE);
      await zeroCommittee.agent
        .put('/api/v1/treasury/config')
        .send({ operatingFloatFloor: 1_000_000, minTenorDays: 30, defaultTenorDays: 200, defaultRatePct: 6.5, defaultBankName: 'Zero Bank' })
        .expect(200);
      await fundCorpus(zeroCommittee.agent, 500_000); // below the floor

      const res = await zeroCommittee.agent.post('/api/v1/treasury/sweep/propose').expect(201);
      const body = res.body as SweepProposeBody;
      expect(body.proposed).toBeNull();
      expect(body.reason).toBeTruthy();
    });

    it('proposes CORPUS - floor - already-PROPOSED, using config defaults for rate/bank', async () => {
      // Lock up 50,000 with a manual proposal first — the sweep must not double-count it.
      await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: 50_000, ratePct: 7, tenorDays: 30, bankName: 'Manual Bank' })
        .expect(201);

      const res = await committee.agent.post('/api/v1/treasury/sweep/propose').expect(201);
      const body = res.body as SweepProposeBody;
      expect(body.proposed).not.toBeNull();
      const proposed = body.proposed!;
      expect(proposed.proposedBySweep).toBe(true);
      expect(proposed.status).toBe('PROPOSED');
      expect(Number(proposed.principal)).toBe(500_000 - 100_000 - 50_000); // 350,000
      expect(Number(proposed.ratePct)).toBe(6.5);
      expect(proposed.bankName).toBe('Sweep Bank');
      expect(proposed.tenorDays).toBeGreaterThanOrEqual(30);
      expect(proposed.tenorDays).toBeLessThanOrEqual(365);
      expect(proposed.placeAuthorisedCount).toBe(1); // the caller is the initiator
      expect(proposed.initiatedById).toBe(committee.userId);
    });

    it('a second sweep proposal call now has nothing left to sweep', async () => {
      const res = await committee.agent.post('/api/v1/treasury/sweep/propose').expect(201);
      expect((res.body as SweepProposeBody).proposed).toBeNull();
    });
  });

  describe('ladder view and paginated listing', () => {
    let societyId: string;
    let committee: Officer;

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Treasury Ladder Society', 2);
      societyId = stood.societyId;
      committee = await signupAndLogin(`tr-ladder-${randomUUID()}@example.com`, societyId, stood.flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
    });

    it('GET /treasury/ladder returns 12 rolling monthly buckets', async () => {
      const res = await committee.agent.get('/api/v1/treasury/ladder').expect(200);
      const body = res.body as { buckets: { month: string; count: number; principal: string; maturityAmount: string }[] };
      expect(body.buckets).toHaveLength(12);
      expect(body.buckets.every((b) => /^\d{4}-\d{2}$/.test(b.month))).toBe(true);
    });

    it('GET /treasury/deposits supports status filter, cursor pagination, and ETag 304', async () => {
      await fundCorpus(committee.agent, 200_000);
      await committee.agent.post('/api/v1/treasury/deposits').send({ principal: 10_000, ratePct: 6, tenorDays: 30, bankName: 'List Bank' }).expect(201);

      const listRes = await committee.agent.get('/api/v1/treasury/deposits').query({ status: 'PROPOSED' }).expect(200);
      const listBody = listRes.body as { items: DepositBody[]; nextCursor: string | null };
      expect(listBody.items.every((i) => i.status === 'PROPOSED')).toBe(true);
      expect(listRes.headers.etag).toBeDefined();

      const etag = listRes.headers.etag as string;
      await committee.agent.get('/api/v1/treasury/deposits').query({ status: 'PROPOSED' }).set('If-None-Match', etag).expect(304);
    });
  });

  describe('renewal: rolls a matured deposit forward through the same dual authorisation', () => {
    let societyId: string;
    let flatIds: string[];
    let committee: Officer;
    let treasurer: Officer;
    let deputy: Officer;
    let sourceId: string;

    beforeAll(async () => {
      const stood = await createSocietyWithFlats('Treasury Renewal Society', 6);
      societyId = stood.societyId;
      flatIds = stood.flatIds;

      committee = await signupAndLogin(`tr-renew-committee-${randomUUID()}@example.com`, societyId, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, committee.userId, RoleKind.COMMITTEE);
      treasurer = await signupAndLogin(`tr-renew-treasurer-${randomUUID()}@example.com`, societyId, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, treasurer.userId, RoleKind.TREASURER);
      deputy = await signupAndLogin(`tr-renew-deputy-${randomUUID()}@example.com`, societyId, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
      await makeRole(societyId, deputy.userId, RoleKind.DEPUTY_TREASURER);

      await fundCorpus(committee.agent, 1_000_000);

      const proposeRes = await committee.agent
        .post('/api/v1/treasury/deposits')
        .send({ principal: 100_000, ratePct: 6, tenorDays: 30, bankName: 'Renew Bank' })
        .expect(201);
      sourceId = (proposeRes.body as DepositBody).id;
      await treasurer.agent.post(`/api/v1/treasury/deposits/${sourceId}/authorise-placement`).expect(201);
      await prisma.fixedDeposit.update({ where: { id: sourceId }, data: { maturesAt: new Date(Date.now() - MS_PER_DAY) } });
    });

    it('renew() creates a PROPOSED deposit linked via renewedFromId, which matures the source at placement execution', async () => {
      const renewRes = await committee.agent.post(`/api/v1/treasury/deposits/${sourceId}/renew`).send({}).expect(201);
      const renewal = renewRes.body as DepositBody;
      expect(renewal.status).toBe('PROPOSED');
      expect(renewal.renewedFromId).toBe(sourceId);
      // 100000 @ 6% for 30 days = 493.1506... -> 493.15; principal = 100493.15
      expect(Number(renewal.principal)).toBeCloseTo(100_493.15, 2);

      const startLedger = await ledgerBalances(committee.agent);
      const corpusStart = balanceOf(startLedger, AccountKind.CORPUS);
      const interestStart = balanceOf(startLedger, AccountKind.INTEREST_INCOME);

      const executeRes = await treasurer.agent.post(`/api/v1/treasury/deposits/${renewal.id}/authorise-placement`).expect(201);
      expect((executeRes.body as DepositBody).status).toBe('ACTIVE');

      const source = await committee.agent.get(`/api/v1/treasury/deposits/${sourceId}`).expect(200);
      expect((source.body as DepositBody).status).toBe('MATURED');

      const endLedger = await ledgerBalances(committee.agent);
      // Source matured (principal back to CORPUS, interest to INTEREST_INCOME), then the
      // interest was reinvested INTEREST_INCOME -> CORPUS, then CORPUS -> FIXED_DEPOSIT for
      // the renewal's full principal (source principal + interest) — net CORPUS change is 0,
      // and INTEREST_INCOME nets back to its starting balance (booked then reinvested).
      expect(balanceOf(endLedger, AccountKind.CORPUS)).toBe(corpusStart);
      expect(balanceOf(endLedger, AccountKind.INTEREST_INCOME)).toBeCloseTo(interestStart, 2);
      expect(endLedger.balancesIntact).toBe(true);
    });
  });
});
