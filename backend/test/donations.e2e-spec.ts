import { randomUUID, createHmac } from 'node:crypto';
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
 * Phase 12 M10 — donations (campaigns + contributions) and welfare
 * disbursements, end-to-end against real Postgres, RAZORPAY_ENABLED false.
 * Covers this lane's brief DoD:
 *  - INTERNAL: contribute -> capture -> RECEIVED, WELFARE credited;
 *    anonymous masking differs between a plain resident and an officer;
 *  - EXTERNAL: RECORDED, with NO Payment row and NO ledger entry created;
 *  - disbursement: the requester alone doesn't execute; the same officer
 *    re-authorising is rejected; a second officer executes; WELFARE ->
 *    EXTERNAL; balancesIntact true;
 *  - over-disbursing beyond the WELFARE balance is rejected.
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

interface CampaignBody {
  id: string;
  mode: 'INTERNAL_WELFARE' | 'EXTERNAL_PASS_THROUGH';
  status: 'OPEN' | 'CLOSED';
  totalReceived?: string;
  contributorCount?: number;
  contributors?: { flatUnitNo: string | null; residentId: string | null; displayName: string; anonymous: boolean; amount: string | number }[];
}

interface ContributionBody {
  id: string;
  campaignId: string;
  status: 'PENDING' | 'RECEIVED' | 'RECORDED' | 'CANCELLED';
  amount: string | number;
  paymentId: string | null;
  externalReference: string | null;
}

interface DisbursementBody {
  id: string;
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED';
  authorisedCount: number;
  requiredApprovers: number;
  amount: string | number;
}

interface LedgerAggregateBody {
  balances: { kind: AccountKind; accountId: string; balance: string }[];
  balancesIntact: boolean;
}

describe('Donations + welfare disbursements (e2e) — Phase 12 M10', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;
  let webhookSecret: string;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const webhookEventIds: string[] = [];

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
  type Fixture = Awaited<ReturnType<typeof signupAndLogin>>;

  async function makeRole(userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
  }

  function signWebhook(body: string): string {
    return createHmac('sha256', webhookSecret).update(body).digest('hex');
  }

  function postWebhook(body: string, signature: string) {
    return request(app.getHttpServer()).post('/api/v1/payments/webhook').set('content-type', 'application/json').set('x-razorpay-signature', signature).send(body);
  }

  async function captureContribution(paymentId: string, amountRupees: number): Promise<void> {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const eventId = `evt_${randomUUID()}`;
    webhookEventIds.push(eventId);
    const event = {
      id: eventId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_stub_${randomUUID().slice(0, 8)}`, order_id: payment.orderId, amount: Math.round(amountRupees * 100), status: 'captured' } } },
    };
    const bodyStr = JSON.stringify(event);
    await postWebhook(bodyStr, signWebhook(bodyStr)).expect(200);
  }

  /** Funds WELFARE by posting a treasury adjustment EXTERNAL -> WELFARE, so a later disbursement has something to move — mirrors pocket-transfers.e2e-spec.ts's fundPocket. */
  async function fundWelfare(agent: ReturnType<typeof request.agent>, amount: number): Promise<void> {
    await agent
      .post('/api/v1/ledger/adjustments')
      .set('Idempotency-Key', `fund-welfare-${randomUUID()}`)
      .send({ debitKind: AccountKind.EXTERNAL, creditKind: AccountKind.WELFARE, amount, reasonCode: 'TEST_FUND_WELFARE' })
      .expect(201);
  }

  async function ledgerBalances(agent: ReturnType<typeof request.agent>): Promise<LedgerAggregateBody> {
    return (await agent.get('/api/v1/ledger').expect(200)).body as LedgerAggregateBody;
  }

  function balanceOf(ledger: LedgerAggregateBody, kind: AccountKind): number {
    return Number(ledger.balances.find((b) => b.kind === kind)?.balance ?? 0);
  }

  function futureIso(msFromNow: number): string {
    return new Date(Date.now() + msFromNow).toISOString();
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
    const config = app.get(AppConfigService);
    webhookSecret = config.env.RAZORPAY_WEBHOOK_SECRET;
    expect(config.env.RAZORPAY_ENABLED).toBe(false);

    const society = await prisma.society.create({ data: { name: 'Donations Test Society', address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 12; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `DN-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: webhookEventIds } } });
    await prisma.welfareDisbursementAuthorisation.deleteMany({ where: { disbursement: { societyId } } });
    await prisma.welfareDisbursement.deleteMany({ where: { societyId } });
    await prisma.donationContribution.deleteMany({ where: { campaign: { societyId } } });
    await prisma.donationCampaign.deleteMany({ where: { societyId } });
    await prisma.payment.deleteMany({ where: { societyId } });
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

  let committee: Fixture;
  let treasurer: Fixture;
  let deputy: Fixture;
  let resident1: Fixture;
  let resident2: Fixture;

  beforeAll(async () => {
    committee = await signupAndLogin(`dn-committee-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    treasurer = await signupAndLogin(`dn-treasurer-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(treasurer.userId, RoleKind.TREASURER);
    deputy = await signupAndLogin(`dn-deputy-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(deputy.userId, RoleKind.DEPUTY_TREASURER);
    resident1 = await signupAndLogin(`dn-resident1-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    resident2 = await signupAndLogin(`dn-resident2-${randomUUID()}@example.com`, flatIds[4], OccupancyRole.OWNER_OCCUPIER);
  });

  it('INTERNAL_WELFARE: create -> contribute -> capture -> RECEIVED, WELFARE credited; anonymous masking differs between resident and officer', async () => {
    const startLedger = await ledgerBalances(committee.agent);
    const welfareStart = balanceOf(startLedger, AccountKind.WELFARE);

    const createRes = await committee.agent
      .post('/api/v1/donation-campaigns')
      .send({ mode: 'INTERNAL_WELFARE', title: 'Staff Hardship Fund', purpose: 'Support-staff medical emergencies', opensAt: futureIso(-1000) })
      .expect(201);
    const campaign = createRes.body as CampaignBody;
    expect(campaign.status).toBe('OPEN');

    // A plain resident cannot create a campaign.
    await resident1.agent
      .post('/api/v1/donation-campaigns')
      .send({ mode: 'INTERNAL_WELFARE', title: 'Should fail', purpose: 'x', opensAt: futureIso(-1000) })
      .expect(403);

    // INTERNAL rejects recipientOrg* fields.
    await committee.agent
      .post('/api/v1/donation-campaigns')
      .send({ mode: 'INTERNAL_WELFARE', title: 'Bad', purpose: 'x', opensAt: futureIso(-1000), recipientOrgName: 'Should not be allowed' })
      .expect(400);

    const contribRes = await resident1.agent
      .post(`/api/v1/donation-campaigns/${campaign.id}/contributions`)
      .send({ amount: 500, anonymous: true })
      .expect(201);
    const contribution = contribRes.body as ContributionBody;
    expect(contribution.status).toBe('PENDING');
    expect(contribution.paymentId).toBeTruthy();

    // externalReference is rejected on an INTERNAL contribution.
    await resident2.agent
      .post(`/api/v1/donation-campaigns/${campaign.id}/contributions`)
      .send({ amount: 200, externalReference: 'not-allowed' })
      .expect(400);

    const contrib2Res = await resident2.agent.post(`/api/v1/donation-campaigns/${campaign.id}/contributions`).send({ amount: 300 }).expect(201);
    const contribution2 = contrib2Res.body as ContributionBody;

    await captureContribution(contribution.paymentId!, 500);
    await captureContribution(contribution2.paymentId!, 300);

    const afterLedger = await ledgerBalances(committee.agent);
    expect(afterLedger.balancesIntact).toBe(true);
    expect(balanceOf(afterLedger, AccountKind.WELFARE) - welfareStart).toBeCloseTo(800, 6);

    const capturedRow = await prisma.donationContribution.findUniqueOrThrow({ where: { id: contribution.id } });
    expect(capturedRow.status).toBe('RECEIVED');

    // --- Anonymity: a plain resident sees "Anonymous" with no flat/resident; an officer sees the real contributor.
    const detailAsResident = (await resident2.agent.get(`/api/v1/donation-campaigns/${campaign.id}`).expect(200)).body as CampaignBody;
    expect(Number(detailAsResident.totalReceived)).toBe(800);
    expect(detailAsResident.contributorCount).toBe(2);
    const anonAsResident = detailAsResident.contributors!.find((c) => c.anonymous)!;
    expect(anonAsResident.displayName).toBe('Anonymous');
    expect(anonAsResident.flatUnitNo).toBeNull();
    expect(anonAsResident.residentId).toBeNull();

    const detailAsOfficer = (await committee.agent.get(`/api/v1/donation-campaigns/${campaign.id}`).expect(200)).body as CampaignBody;
    const anonAsOfficer = detailAsOfficer.contributors!.find((c) => c.anonymous)!;
    expect(anonAsOfficer.displayName).not.toBe('Anonymous');
    expect(anonAsOfficer.flatUnitNo).toBeTruthy();
    expect(anonAsOfficer.residentId).toBe(resident1.userId);
  });

  it("EXTERNAL_PASS_THROUGH: participation is RECORDED with NO Payment row and NO ledger entry ever created", async () => {
    const createRes = await committee.agent
      .post('/api/v1/donation-campaigns')
      .send({
        mode: 'EXTERNAL_PASS_THROUGH',
        title: 'Flood Relief (Red Cross)',
        purpose: 'Flood relief distribution',
        opensAt: futureIso(-1000),
        recipientOrgName: 'Indian Red Cross Society',
        recipientOrgUrl: 'https://example.org/redcross',
        recipientIssues80G: true,
      })
      .expect(201);
    const campaign = createRes.body as CampaignBody;

    // EXTERNAL requires recipientOrgName.
    await committee.agent
      .post('/api/v1/donation-campaigns')
      .send({ mode: 'EXTERNAL_PASS_THROUGH', title: 'Missing org', purpose: 'x', opensAt: futureIso(-1000) })
      .expect(400);

    // externalReference is required for EXTERNAL.
    await resident1.agent.post(`/api/v1/donation-campaigns/${campaign.id}/contributions`).send({ amount: 1000 }).expect(400);

    const paymentCountBefore = await prisma.payment.count({ where: { societyId } });
    const ledgerCountBefore = await prisma.ledgerEntry.count({ where: { societyId } });

    const contribRes = await resident1.agent
      .post(`/api/v1/donation-campaigns/${campaign.id}/contributions`)
      .send({ amount: 1000, externalReference: 'RXC-RECEIPT-001' })
      .expect(201);
    const contribution = contribRes.body as ContributionBody;
    expect(contribution.status).toBe('RECORDED');
    expect(contribution.paymentId).toBeNull();

    const paymentCountAfter = await prisma.payment.count({ where: { societyId } });
    const ledgerCountAfter = await prisma.ledgerEntry.count({ where: { societyId } });
    expect(paymentCountAfter).toBe(paymentCountBefore);
    expect(ledgerCountAfter).toBe(ledgerCountBefore);

    const detail = (await committee.agent.get(`/api/v1/donation-campaigns/${campaign.id}`).expect(200)).body as CampaignBody;
    expect(Number(detail.totalReceived)).toBe(1000);
    expect(detail.contributorCount).toBe(1);
  });

  describe('welfare disbursements', () => {
    beforeAll(async () => {
      await fundWelfare(committee.agent, 10_000);
    });

    it("the requester alone doesn't execute; the same officer re-authorising is rejected; a second officer executes; WELFARE -> EXTERNAL; balancesIntact true", async () => {
      const startLedger = await ledgerBalances(committee.agent);
      const welfareStart = balanceOf(startLedger, AccountKind.WELFARE);

      const requestRes = await treasurer.agent
        .post('/api/v1/welfare-disbursements')
        .send({ amount: 800, payeeName: 'Support Staff Medical Fund', purpose: 'Emergency surgery assistance' })
        .expect(201);
      const disbursement = requestRes.body as DisbursementBody;
      expect(disbursement.status).toBe('PENDING');
      expect(disbursement.authorisedCount).toBe(1); // requester's own request counts as their signature
      expect(disbursement.requiredApprovers).toBeGreaterThanOrEqual(2);

      const midLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(midLedger, AccountKind.WELFARE)).toBe(welfareStart); // untouched — 1 signature is not enough

      // The requester re-authorising their own request is rejected (repeat identity).
      await treasurer.agent.post(`/api/v1/welfare-disbursements/${disbursement.id}/authorise`).expect(409);

      const secondRes = await deputy.agent.post(`/api/v1/welfare-disbursements/${disbursement.id}/authorise`).expect(201);
      const secondBody = secondRes.body as DisbursementBody;
      expect(secondBody.status).toBe('EXECUTED');
      expect(secondBody.authorisedCount).toBe(2);

      const finalLedger = await ledgerBalances(committee.agent);
      expect(finalLedger.balancesIntact).toBe(true);
      expect(balanceOf(finalLedger, AccountKind.WELFARE)).toBe(welfareStart - 800);

      const entryCount = await prisma.ledgerEntry.count({ where: { linkedEntityType: 'WelfareDisbursement', linkedEntityId: disbursement.id, reasonCode: 'WELFARE_DISBURSEMENT_EXECUTE' } });
      expect(entryCount).toBe(1);

      // Replaying authorise() after EXECUTED is a verified no-op — same idempotent contract as pocket-transfers.
      const replayRes = await deputy.agent.post(`/api/v1/welfare-disbursements/${disbursement.id}/authorise`).expect(201);
      expect((replayRes.body as DisbursementBody).status).toBe('EXECUTED');
    });

    it('over-disbursing beyond the WELFARE balance is rejected', async () => {
      const startLedger = await ledgerBalances(committee.agent);
      const welfareStart = balanceOf(startLedger, AccountKind.WELFARE);

      const requestRes = await treasurer.agent
        .post('/api/v1/welfare-disbursements')
        .send({ amount: welfareStart + 1_000_000, payeeName: 'Too Much', purpose: 'Should be rejected' })
        .expect(201);
      const disbursement = requestRes.body as DisbursementBody;

      await deputy.agent.post(`/api/v1/welfare-disbursements/${disbursement.id}/authorise`).expect(400);

      const afterLedger = await ledgerBalances(committee.agent);
      expect(balanceOf(afterLedger, AccountKind.WELFARE)).toBe(welfareStart);
    });

    it('a PENDING disbursement can be cancelled; a non-officer gets 403', async () => {
      const requestRes = await committee.agent
        .post('/api/v1/welfare-disbursements')
        .send({ amount: 50, payeeName: 'Cancel Me', purpose: 'Test cancel' })
        .expect(201);
      const disbursement = requestRes.body as DisbursementBody;

      await resident1.agent.post('/api/v1/welfare-disbursements').send({ amount: 50, payeeName: 'x', purpose: 'x' }).expect(403);

      const cancelRes = await committee.agent.post(`/api/v1/welfare-disbursements/${disbursement.id}/cancel`).expect(201);
      expect((cancelRes.body as DisbursementBody).status).toBe('CANCELLED');
    });
  });
});
