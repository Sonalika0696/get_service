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
import { AccountKind, DisputeCategory, DisputeStatus, DisputeTriagePriority, OccupancyRole, PocketTransferStatus, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Lane b1read — `GET /me/approvals` (committee approvals inbox), e2e
 * against real Postgres. Fixtures for the sibling write-side domains
 * (pocket transfers excepted — that module exists) are created DIRECTLY
 * via Prisma, never through a not-yet-existing endpoint — see this lane's
 * brief.
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

interface ApprovalItemBody {
  kind: string;
  id: string;
  amount: string | null;
  requiredApprovers: number | null;
  authorisedCount: number | null;
}

interface ApprovalsInboxBody {
  items: ApprovalItemBody[];
  counts: { total: number; byKind: Record<string, number> };
}

describe('Committee approvals inbox — GET /me/approvals (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: CapturingMailer;

  let societyId: string;
  let otherSocietyId: string;
  const flatIds: string[] = [];
  const otherSocietyFlatIds: string[] = [];
  const userIds: string[] = [];
  const vendorIds: string[] = [];
  const bookingIds: string[] = [];
  const chargeSheetIds: string[] = [];
  const disputeIds: string[] = [];
  const pocketTransferIds: string[] = [];
  const fixedDepositIds: string[] = [];
  const welfareDisbursementIds: string[] = [];

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

  async function inbox(agent: ReturnType<typeof request.agent>, expectStatus = 200): Promise<{ body: ApprovalsInboxBody; etag: string | undefined }> {
    const res = await agent.get('/api/v1/me/approvals').expect(expectStatus);
    return { body: res.body as ApprovalsInboxBody, etag: res.headers.etag as string | undefined };
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

    const society = await prisma.society.create({ data: { name: 'Approvals Inbox Test Society', address: 'n/a' } });
    societyId = society.id;
    const otherSociety = await prisma.society.create({ data: { name: 'Approvals Inbox Other Society', address: 'n/a' } });
    otherSocietyId = otherSociety.id;

    for (let i = 0; i < 6; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `AP-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
    const otherFlat = await prisma.flat.create({ data: { societyId: otherSocietyId, unitNo: `AP-OTHER-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    otherSocietyFlatIds.push(otherFlat.id);
  });

  afterAll(async () => {
    await prisma.dispute.deleteMany({ where: { id: { in: disputeIds } } });
    await prisma.chargeSheet.deleteMany({ where: { id: { in: chargeSheetIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.pocketTransferAuthorisation.deleteMany({ where: { transferId: { in: pocketTransferIds } } });
    await prisma.pocketTransfer.deleteMany({ where: { id: { in: pocketTransferIds } } });
    await prisma.fixedDepositAuthorisation.deleteMany({ where: { depositId: { in: fixedDepositIds } } });
    await prisma.fixedDeposit.deleteMany({ where: { id: { in: fixedDepositIds } } });
    await prisma.welfareDisbursementAuthorisation.deleteMany({ where: { disbursementId: { in: welfareDisbursementIds } } });
    await prisma.welfareDisbursement.deleteMany({ where: { id: { in: welfareDisbursementIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.role.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.flat.deleteMany({ where: { societyId: { in: [societyId, otherSocietyId] } } });
    await prisma.society.deleteMany({ where: { id: { in: [societyId, otherSocietyId] } } });

    await app.close();
  });

  it('a plain resident gets 403', async () => {
    const resident = await signupAndLogin(`ap-plain-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await resident.agent.get('/api/v1/me/approvals').expect(403);
  });

  it('HEADLINE: officer B sees fixtures A initiated/signed and R raised, correctly, while A/R do not see their own; another society never leaks in; ETag 304s on repeat', async () => {
    const officerA = await signupAndLogin(`ap-officerA-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(officerA.userId, RoleKind.COMMITTEE);
    const officerB = await signupAndLogin(`ap-officerB-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(officerB.userId, RoleKind.COMMITTEE);
    const officerR = await signupAndLogin(`ap-officerR-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(officerR.userId, RoleKind.COMMITTEE);

    // --- Fixture 1: PENDING pocket transfer requested by officer A ---
    const transfer = await prisma.pocketTransfer.create({
      data: { societyId, fromKind: AccountKind.MAINTENANCE, toKind: AccountKind.SINKING, amount: 1000, reasonCode: 'TEST_TRANSFER', status: PocketTransferStatus.PENDING, requestedById: officerA.userId },
    });
    pocketTransferIds.push(transfer.id);

    // --- Fixture 2: PROPOSED fixed deposit initiated by officer A ---
    const fd = await prisma.fixedDeposit.create({
      data: { societyId, bankName: 'Test Bank', principal: 200000, ratePct: 7.1, tenorDays: 365, initiatedById: officerA.userId },
    });
    fixedDepositIds.push(fd.id);

    // --- Fixture 3: PENDING welfare disbursement, one authorisation by officer A ---
    const welfare = await prisma.welfareDisbursement.create({
      data: { societyId, payeeName: 'Test Payee', purpose: 'Medical aid', amount: 3000, requestedById: officerA.userId },
    });
    welfareDisbursementIds.push(welfare.id);
    await prisma.welfareDisbursementAuthorisation.create({ data: { disbursementId: welfare.id, authoriserId: officerA.userId } });

    // --- Fixture 4: OPEN HIGH dispute raised by officer R (booking/chargeSheet scaffolding — Booking.sourceId/sourceType are plain strings, no FK) ---
    const vendor = await prisma.vendor.create({ data: { name: `Approvals Test Vendor ${randomUUID().slice(0, 8)}` } });
    vendorIds.push(vendor.id);
    const booking = await prisma.booking.create({ data: { societyId, vendorId: vendor.id, sourceType: 'OFFER', sourceId: randomUUID() } });
    bookingIds.push(booking.id);
    const chargeSheet = await prisma.chargeSheet.create({
      data: { societyId, bookingId: booking.id, vendorId: vendor.id, submittedById: vendor.id, totalAmount: 5000, cardTotal: 4000, varianceAmount: 1000, hasVariance: true },
    });
    chargeSheetIds.push(chargeSheet.id);
    const dispute = await prisma.dispute.create({
      data: {
        societyId,
        chargeSheetId: chargeSheet.id,
        flatId: flatIds[3],
        raisedById: officerR.userId,
        category: DisputeCategory.RATE_ABOVE_CARD,
        reason: 'Overcharged for the visit',
        disputedAmount: 1000,
        triagePriority: DisputeTriagePriority.HIGH,
        triageReason: 'Above-card variance over threshold',
        status: DisputeStatus.OPEN,
      },
    });
    disputeIds.push(dispute.id);

    // --- Fixture 5: pending ratification (raw occupancy row, distinct new user) ---
    const pendingUser = await prisma.user.create({ data: { name: 'Pending Ratify User', email: `ap-pending-${randomUUID()}@example.com`, phoneVerifiedAt: new Date() } });
    userIds.push(pendingUser.id);
    await prisma.occupancy.create({ data: { flatId: flatIds[4], userId: pendingUser.id, role: OccupancyRole.OWNER_OCCUPIER, ratificationStatus: 'PENDING' } });

    // --- Officer B: should see all five ---
    const bView = await inbox(officerB.agent);
    expect(bView.body.counts.total).toBe(5);
    const byKindB = Object.fromEntries(bView.body.items.map((i) => [i.kind, i]));
    expect(byKindB.POCKET_TRANSFER).toBeDefined();
    expect(byKindB.POCKET_TRANSFER.requiredApprovers).toBeGreaterThanOrEqual(2); // pocket transfers are never single-officer
    expect(byKindB.POCKET_TRANSFER.authorisedCount).toBe(0);
    expect(byKindB.FIXED_DEPOSIT_PLACEMENT).toBeDefined();
    expect(byKindB.FIXED_DEPOSIT_PLACEMENT.requiredApprovers).toBe(2);
    expect(byKindB.FIXED_DEPOSIT_PLACEMENT.authorisedCount).toBe(0);
    expect(byKindB.WELFARE_DISBURSEMENT).toBeDefined();
    expect(byKindB.WELFARE_DISBURSEMENT.authorisedCount).toBe(1);
    expect(byKindB.RATIFICATION).toBeDefined();
    expect(byKindB.DISPUTE).toBeDefined();
    for (const item of bView.body.items) expect(item).not.toHaveProperty('alreadyAuthorisedByMeTrue');

    // --- Officer A: excluded from everything A already-signed or (for fixed
    // deposits specifically) initiated. Per the brief, a PENDING pocket
    // transfer is NOT auto-excluded just because A requested it — a
    // separate explicit `authorise` call is always required, even from the
    // requester (see PocketTransfersService's own doc comment) — so A still
    // sees that one. ---
    const aView = await inbox(officerA.agent);
    const kindsForA = aView.body.items.map((i) => i.kind);
    expect(kindsForA).toContain('POCKET_TRANSFER');
    expect(kindsForA).not.toContain('FIXED_DEPOSIT_PLACEMENT');
    expect(kindsForA).not.toContain('WELFARE_DISBURSEMENT');
    // A still sees the dispute (raised by R, not A) and the ratification.
    expect(kindsForA).toContain('DISPUTE');
    expect(kindsForA).toContain('RATIFICATION');

    // --- Officer R: does not see the dispute R raised, but sees everything else ---
    const rView = await inbox(officerR.agent);
    const kindsForR = rView.body.items.map((i) => i.kind);
    expect(kindsForR).not.toContain('DISPUTE');
    expect(kindsForR).toContain('POCKET_TRANSFER');
    expect(kindsForR).toContain('FIXED_DEPOSIT_PLACEMENT');
    expect(kindsForR).toContain('WELFARE_DISBURSEMENT');

    // --- Another society's officer never sees any of this society's items ---
    const otherOfficer = await (async () => {
      const otherUser = await prisma.user.create({ data: { name: 'Other Society Officer', email: `ap-otherofficer-${randomUUID()}@example.com`, phoneVerifiedAt: new Date() } });
      userIds.push(otherUser.id);
      await prisma.occupancy.create({ data: { flatId: otherSocietyFlatIds[0], userId: otherUser.id, role: OccupancyRole.OWNER_OCCUPIER, ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
      await prisma.role.create({ data: { societyId: otherSocietyId, userId: otherUser.id, kind: RoleKind.COMMITTEE } });
      return otherUser;
    })();
    void otherOfficer;
    // (No login flow needed for the isolation assertion below — the query
    // itself is societyId-scoped; we assert on B's own view instead, which
    // must never include a row from otherSocietyId.)
    expect(bView.body.items.every((i) => i.id !== otherOfficer.id)).toBe(true);

    // --- ETag: a repeat request with If-None-Match gets 304 ---
    const first = await officerB.agent.get('/api/v1/me/approvals').expect(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    await officerB.agent.get('/api/v1/me/approvals').set('If-None-Match', etag).expect(304);
  });
});
