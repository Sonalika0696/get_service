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
import { OccupancyRole, PricingBasis, PricingCardStatus, RoleKind } from '../src/generated/prisma/enums.js';

/**
 * Phase 8.3 (BACKEND_PLAN.md Phase 8 item 3) Definition of Done: the
 * pooled/assigned/confirmed notification fan-out ServiceRequestsService
 * added is post-commit and best-effort — exactly the same guarantee
 * notifications-postcommit.e2e-spec.ts proves for PollsService, reused
 * here for the NEW ServiceRequest pooling loop's three lifecycle points.
 *
 * With a MailerService stub that throws specifically for the pooled/
 * assigned/confirmed subjects, a request must still: (1) reach POOLED on
 * the join that crosses threshold, (2) reach ASSIGNED on assign, and (3)
 * reach CONFIRMED on confirm WITH its escrow Booking/Commitments/Payments
 * intact — all re-read via a fresh Prisma query after the HTTP call
 * returns, independent of the (still-200) HTTP response. Each stage also
 * proves the mailer was actually invoked, and invoked for exactly the
 * three participating residents, so the guarantee isn't vacuously true
 * because notifications were silently skipped.
 */

const FAILING_SUBJECTS = new Set([
  'Service request pooled — enough neighbours joined',
  'Vendor assigned to your service request',
  'Service request confirmed — contribution due',
]);

class PartlyFailingMailer {
  sent: SendMailInput[] = [];
  attempts: SendMailInput[] = [];

  async send(input: SendMailInput): Promise<void> {
    this.attempts.push(input);
    if (FAILING_SUBJECTS.has(input.subject)) {
      throw new Error(`Simulated mail-provider outage for subject "${input.subject}"`);
    }
    this.sent.push(input);
  }
}

function extractOtpCode(mail: SendMailInput): string {
  const match = mail.text.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured mail: ${mail.text}`);
  return match[1];
}

interface ServiceRequestBody {
  id: string;
  status: 'OPEN' | 'POOLED' | 'ASSIGNED' | 'CONFIRMED' | 'LAPSED';
  title: string;
  participantCount: number;
  bookingId: string | null;
  assignedVendorId: string | null;
  vendorConfirmedContribution: string | number | null;
}

describe('ServiceRequest pooled/assigned/confirmed notifications are post-commit and best-effort (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: PartlyFailingMailer;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const vendorIds: string[] = [];

  async function latestMailTo(email: string, subject: string): Promise<SendMailInput> {
    const matches = mailer.attempts.filter((m) => m.to === email && m.subject === subject);
    const last = matches.at(-1);
    if (!last) throw new Error(`No mail captured for ${email} / "${subject}"`);
    return last;
  }

  function attemptedRecipients(subject: string): string[] {
    return mailer.attempts.filter((m) => m.subject === subject).map((m) => m.to).sort();
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

    // Ratification gate — see service-requests.e2e-spec.ts's identical helper for why this is poked directly.
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: 'RATIFIED', ratificationDecidedAt: new Date() } });
    return { userId, agent, email };
  }

  async function makeRole(userId: string, kind: RoleKind) {
    await prisma.role.create({ data: { societyId, userId, kind } });
  }

  function futureIso(msFromNow: number): string {
    return new Date(Date.now() + msFromNow).toISOString();
  }

  /** Mirrors service-requests.e2e-spec.ts's fixture: a Vendor + VendorSocietyLink + a PUBLISHED PricingCard for a category, entirely via Prisma. */
  async function vendorWithCardFixture(category: string) {
    const vendor = await prisma.vendor.create({ data: { name: `SR Notify Test Vendor ${randomUUID().slice(0, 8)}` } });
    vendorIds.push(vendor.id);
    await prisma.vendorSocietyLink.create({ data: { vendorId: vendor.id, societyId } });

    const card = await prisma.pricingCard.create({
      data: {
        vendorId: vendor.id,
        category,
        version: 1,
        gstRatePct: 18,
        effectiveFrom: new Date(),
        status: PricingCardStatus.PUBLISHED,
        publishedAt: new Date(),
        lines: { create: [{ label: 'Visit charge', basis: PricingBasis.PER_VISIT, rate: 150 }] },
      },
    });
    return { vendorId: vendor.id, cardId: card.id };
  }

  beforeAll(async () => {
    mailer = new PartlyFailingMailer();
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

    const society = await prisma.society.create({ data: { name: `SR Notify Postcommit Society ${randomUUID().slice(0, 8)}`, address: 'n/a' } });
    societyId = society.id;

    for (let i = 0; i < 8; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `SRN-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.payoutAuthorisation.deleteMany({ where: { payout: { booking: { societyId } } } });
    await prisma.payout.deleteMany({ where: { booking: { societyId } } });
    await prisma.jobCard.deleteMany({ where: { booking: { societyId } } });
    await prisma.booking.deleteMany({ where: { societyId } });
    await prisma.commitment.deleteMany({ where: { serviceRequest: { societyId } } });
    await prisma.participation.deleteMany({ where: { serviceRequest: { societyId } } });
    await prisma.serviceRequest.deleteMany({ where: { societyId } });
    await prisma.payment.deleteMany({ where: { societyId } });
    await prisma.idempotencyKey.deleteMany({ where: { societyId } });
    await prisma.pricingLine.deleteMany({ where: { card: { vendorId: { in: vendorIds } } } });
    await prisma.pricingCard.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendorSocietyLink.deleteMany({ where: { societyId } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
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

  it('pools, gets assigned, and confirms (with escrow) even though every one of those three notification mails throws', async () => {
    const committee = await signupAndLogin(`srn-committee-${randomUUID()}@example.com`, flatIds[0], OccupancyRole.OWNER_OCCUPIER);
    await makeRole(committee.userId, RoleKind.COMMITTEE);
    const resident1 = await signupAndLogin(`srn-resident1-${randomUUID()}@example.com`, flatIds[1], OccupancyRole.OWNER_OCCUPIER);
    const resident2 = await signupAndLogin(`srn-resident2-${randomUUID()}@example.com`, flatIds[2], OccupancyRole.OWNER_OCCUPIER);
    const resident3 = await signupAndLogin(`srn-resident3-${randomUUID()}@example.com`, flatIds[3], OccupancyRole.OWNER_OCCUPIER);
    const participantEmails = [resident1.email, resident2.email, resident3.email].sort();

    const { vendorId, cardId } = await vendorWithCardFixture('AC Repair');

    const createRes = await resident1.agent
      .post('/api/v1/service-requests')
      .send({ category: 'AC Repair', title: 'AC not cooling', description: 'Living room unit blowing warm air', closesAt: futureIso(86_400_000) })
      .expect(201);
    const created = createRes.body as ServiceRequestBody;

    // --- Stage 1: threshold-crossing join -> POOLED, despite the "pooled" mail throwing for all three participants.
    await resident1.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201);
    await resident2.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201);
    const afterThirdJoin = (await resident3.agent.post(`/api/v1/service-requests/${created.id}/join`).expect(201)).body as ServiceRequestBody;
    expect(afterThirdJoin.status).toBe('POOLED');
    expect(afterThirdJoin.participantCount).toBe(3);

    // Durable, independent of the (still-successful) HTTP response.
    const persistedAfterPool = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(persistedAfterPool.status).toBe('POOLED');
    expect(persistedAfterPool.pooledAt).not.toBeNull();
    const persistedParticipantsAfterPool = await prisma.participation.count({ where: { serviceRequestId: created.id, status: 'ACTIVE' } });
    expect(persistedParticipantsAfterPool).toBe(3);

    // The audit entry (independent, separately-committed side effect) also survived the mail outage.
    const pooledAudit = await prisma.auditLog.findMany({ where: { subjectId: created.id, action: 'SERVICE_REQUEST_POOLED' } });
    expect(pooledAudit).toHaveLength(1);

    // The mailer really was invoked for exactly the three participants, and every attempt threw.
    expect(attemptedRecipients('Service request pooled — enough neighbours joined')).toEqual(participantEmails);
    expect(mailer.sent.some((m) => m.subject === 'Service request pooled — enough neighbours joined')).toBe(false);

    // --- Stage 2: committee assigns a vendor -> ASSIGNED, despite the "vendor assigned" mail throwing.
    const assignRes = await committee.agent.post(`/api/v1/service-requests/${created.id}/assign`).send({ vendorId }).expect(201);
    const assigned = assignRes.body as ServiceRequestBody;
    expect(assigned.status).toBe('ASSIGNED');
    expect(assigned.assignedVendorId).toBe(vendorId);

    const persistedAfterAssign = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(persistedAfterAssign.status).toBe('ASSIGNED');
    expect(persistedAfterAssign.assignedVendorId).toBe(vendorId);

    const assignedAudit = await prisma.auditLog.findMany({ where: { subjectId: created.id, action: 'SERVICE_REQUEST_ASSIGNED' } });
    expect(assignedAudit).toHaveLength(1);

    expect(attemptedRecipients('Vendor assigned to your service request')).toEqual(participantEmails);
    expect(mailer.sent.some((m) => m.subject === 'Vendor assigned to your service request')).toBe(false);

    // --- Stage 3: committee relays confirmation -> CONFIRMED + escrow created, despite the "confirmed" mail throwing.
    const confirmRes = await committee.agent.post(`/api/v1/service-requests/${created.id}/confirm`).send({ contribution: 1200 }).expect(201);
    const confirmed = confirmRes.body as ServiceRequestBody;
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.bookingId).toBeTruthy();

    // Durable, independent re-read: the money-relevant rows (Booking, Commitments, Payments) are ALL still
    // committed even though the "confirmed" mail threw for every recipient — a mail outage must never be
    // able to roll back or reverse escrow that has already landed.
    const persistedAfterConfirm = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(persistedAfterConfirm.status).toBe('CONFIRMED');
    expect(persistedAfterConfirm.frozenPricingCardId).toBe(cardId);
    expect(Number(persistedAfterConfirm.vendorConfirmedContribution)).toBe(1200);

    const booking = await prisma.booking.findFirst({ where: { sourceType: 'SERVICE_REQUEST', sourceId: created.id } });
    expect(booking).not.toBeNull();
    expect(booking!.status).toBe('ACTIVE');
    expect(booking!.vendorId).toBe(vendorId);

    const commitments = await prisma.commitment.findMany({ where: { serviceRequestId: created.id } });
    expect(commitments).toHaveLength(3);
    for (const c of commitments) {
      expect(c.paymentId).toBeTruthy();
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: c.paymentId! } });
      expect(Number(payment.amount)).toBe(1200);
    }

    const frozenAudit = await prisma.auditLog.findMany({ where: { subjectId: created.id, action: 'SERVICE_REQUEST_CARD_FROZEN' } });
    expect(frozenAudit).toHaveLength(1);

    expect(attemptedRecipients('Service request confirmed — contribution due')).toEqual(participantEmails);
    expect(mailer.sent.some((m) => m.subject === 'Service request confirmed — contribution due')).toBe(false);
  });
});
