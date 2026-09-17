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
import { SmsService, type SendSmsInput, type SmsSendResult } from '../src/infra/sms/sms.service.js';
import { createGlobalValidationPipe } from '../src/common/pipes/validation.pipe.js';
import {
  BookingStatus,
  CommitmentStatus,
  JobCardStatus,
  JobCardTier,
  MaintenanceChargeStatus,
  OccupancyRole,
  PaymentStatus,
  RatificationStatus,
} from '../src/generated/prisma/enums.js';

/**
 * Phase 9.3 — `GET /me/bills`: unified, derived-on-read bills list. Per this
 * phase's brief, fixtures read/write the underlying tables directly via
 * Prisma (MaintenanceCharge for the MAINTENANCE arm; Booking/Commitment/
 * JobCard/Payment for the PROCUREMENT arm) rather than driving the full
 * bulk-buy/service-request lifecycle through their own controllers — this
 * suite must not depend on any sibling module's service code.
 */

class CapturingSms {
  sent: SendSmsInput[] = [];
  async send(input: SendSmsInput): Promise<SmsSendResult> {
    this.sent.push(input);
    return { id: `test_${randomUUID()}`, status: 'stub_logged' };
  }
}

class CapturingMailer {
  sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<void> {
    this.sent.push(input);
  }
}

function extractOtpFromSms(sms: SendSmsInput): string {
  const match = sms.body.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured SMS: ${sms.body}`);
  return match[1];
}

interface BillLineBody {
  id: string;
  kind: 'MAINTENANCE' | 'PROCUREMENT';
  title: string;
  label: string;
  amountDue: string;
  amountPaid: string;
  status: string;
  dueDate: string | null;
  basis: string;
  evidenceType: string;
  evidenceId: string;
}

interface BillsPageBody {
  items: BillLineBody[];
  nextCursor: string | null;
}

describe('GET /me/bills (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sms: CapturingSms;
  let mailer: CapturingMailer;

  let societyId: string;
  let vendorId: string;
  let flatAId: string;
  let flatBId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    sms = new CapturingSms();
    mailer = new CapturingMailer();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsService)
      .useValue(sms)
      .overrideProvider(MailerService)
      .useValue(mailer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);

    const society = await prisma.society.create({ data: { name: 'Bills Test Society', address: 'n/a' } });
    societyId = society.id;
    const flatA = await prisma.flat.create({ data: { societyId, unitNo: `BILL-A-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    const flatB = await prisma.flat.create({ data: { societyId, unitNo: `BILL-B-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
    flatAId = flatA.id;
    flatBId = flatB.id;

    const vendor = await prisma.vendor.create({ data: { name: `Bills Test Vendor ${randomUUID()}` } });
    vendorId = vendor.id;
    await prisma.vendorSocietyLink.create({ data: { vendorId, societyId } });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { societyId } });
    await prisma.jobCard.deleteMany({ where: { booking: { societyId } } });
    await prisma.commitment.deleteMany({ where: { flatId: { in: [flatAId, flatBId] } } });
    await prisma.booking.deleteMany({ where: { societyId } });
    await prisma.instalmentPlan.deleteMany({ where: { maintenanceCharge: { societyId } } });
    await prisma.maintenanceCharge.deleteMany({ where: { societyId } });
    await prisma.vendorSocietyLink.deleteMany({ where: { societyId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
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

  /** Signs up + verifies a resident by phone OTP, then ratifies the occupancy directly (see this phase's hard rule: an un-ratified occupancy 401s everywhere). */
  async function residentFixture(flatId: string) {
    const phone = `+9197${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `bills-resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Bills Resident', email, phone, societyId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    return { agent, userId };
  }

  /** Directly inserts one PROCUREMENT contribution (Booking + Commitment + JobCard + escrow Payment) for `residentId`/`flatId`, bypassing BulkBuyService/ServiceRequestsService entirely — see this file's doc comment. */
  async function procurementFixture(residentId: string, flatId: string, opts: { unitPrice: number; captured: boolean; scope: string }) {
    const booking = await prisma.booking.create({
      data: { societyId, vendorId, sourceType: 'TEST', sourceId: randomUUID(), status: BookingStatus.ACTIVE, tier: JobCardTier.SMALL },
    });
    const commitment = await prisma.commitment.create({
      data: { residentId, flatId, status: opts.captured ? CommitmentStatus.FUNDED : CommitmentStatus.PENDING },
    });
    const jobCard = await prisma.jobCard.create({
      data: {
        bookingId: booking.id,
        commitmentId: commitment.id,
        residentId,
        flatId,
        scope: opts.scope,
        unitPrice: opts.unitPrice,
        appliedDiscountPct: 0,
        status: JobCardStatus.PENDING,
        tier: JobCardTier.SMALL,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        societyId,
        residentId,
        orderId: `order_${randomUUID()}`,
        amount: opts.unitPrice,
        status: opts.captured ? PaymentStatus.CAPTURED : PaymentStatus.CREATED,
        purpose: `Bulk-buy: ${opts.scope}`,
        linkedEntityType: 'Commitment',
        linkedEntityId: commitment.id,
      },
    });
    await prisma.commitment.update({ where: { id: commitment.id }, data: { paymentId: payment.id } });
    return { bookingId: booking.id, commitmentId: commitment.id, jobCardId: jobCard.id, paymentId: payment.id };
  }

  it('unions MaintenanceCharge + procurement contributions, paginates via nextCursor, and honors If-None-Match with a 304', async () => {
    const resident = await residentFixture(flatAId);

    // MAINTENANCE arm: two periods, different due dates/status.
    const chargeJan = await prisma.maintenanceCharge.create({
      data: {
        societyId,
        flatId: flatAId,
        period: '2026-01',
        amount: 1000,
        lateFeeAccrued: 50,
        paidAmount: 0,
        dueDate: new Date('2026-01-10T00:00:00.000Z'),
        status: MaintenanceChargeStatus.PENDING,
      },
    });
    const chargeFeb = await prisma.maintenanceCharge.create({
      data: {
        societyId,
        flatId: flatAId,
        period: '2026-02',
        amount: 1000,
        lateFeeAccrued: 0,
        paidAmount: 1000,
        dueDate: new Date('2026-02-10T00:00:00.000Z'),
        status: MaintenanceChargeStatus.PAID,
      },
    });

    // PROCUREMENT arm: one captured contribution.
    const procurement = await procurementFixture(resident.userId, flatAId, { unitPrice: 500, captured: true, scope: `Bills Test Procurement ${randomUUID().slice(0, 6)}` });

    // A maintenance charge for a DIFFERENT flat/resident must never leak in.
    const otherResident = await residentFixture(flatBId);
    await prisma.maintenanceCharge.create({
      data: { societyId, flatId: flatBId, period: '2026-01', amount: 777, dueDate: new Date('2026-01-10T00:00:00.000Z'), status: MaintenanceChargeStatus.PENDING },
    });

    // --- Full page: both arms present, in dueDate DESC NULLS LAST, id DESC order (PROCUREMENT, having no dueDate, sorts last).
    const fullRes = await resident.agent.get('/api/v1/me/bills').expect(200);
    const full = fullRes.body as BillsPageBody;
    expect(full.items).toHaveLength(3);
    expect(full.items.map((i) => i.evidenceId)).toEqual([chargeFeb.id, chargeJan.id, procurement.jobCardId]);
    expect(full.nextCursor).toBeNull();

    const maintenanceFeb = full.items.find((i) => i.evidenceId === chargeFeb.id)!;
    expect(maintenanceFeb.kind).toBe('MAINTENANCE');
    expect(maintenanceFeb.evidenceType).toBe('MaintenanceCharge');
    expect(maintenanceFeb.label).toBe('2026-02');
    expect(Number(maintenanceFeb.amountDue)).toBe(1000);
    expect(Number(maintenanceFeb.amountPaid)).toBe(1000);
    expect(maintenanceFeb.status).toBe('PAID');
    expect(maintenanceFeb.dueDate).toBe('2026-02-10T00:00:00.000Z');

    const maintenanceJan = full.items.find((i) => i.evidenceId === chargeJan.id)!;
    expect(Number(maintenanceJan.amountDue)).toBe(1050); // amount + lateFeeAccrued
    expect(Number(maintenanceJan.amountPaid)).toBe(0);
    expect(maintenanceJan.status).toBe('PENDING');

    const procLine = full.items.find((i) => i.evidenceId === procurement.jobCardId)!;
    expect(procLine.kind).toBe('PROCUREMENT');
    expect(procLine.evidenceType).toBe('JobCard');
    expect(procLine.dueDate).toBeNull();
    expect(Number(procLine.amountDue)).toBe(500);
    expect(Number(procLine.amountPaid)).toBe(500); // Payment CAPTURED -> fully paid
    expect(procLine.status).toBe('PAID');

    // --- kind filter.
    const maintenanceOnly = await resident.agent.get('/api/v1/me/bills').query({ kind: 'MAINTENANCE' }).expect(200);
    expect((maintenanceOnly.body as BillsPageBody).items).toHaveLength(2);
    const procurementOnly = await resident.agent.get('/api/v1/me/bills').query({ kind: 'PROCUREMENT' }).expect(200);
    expect((procurementOnly.body as BillsPageBody).items).toHaveLength(1);

    // --- Pagination: limit=1 advances page-by-page via nextCursor and covers the same 3 rows, same order.
    const seenIds: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const pageRes = await resident.agent
        .get('/api/v1/me/bills')
        .query(cursor ? { limit: 1, cursor } : { limit: 1 })
        .expect(200);
      const page = pageRes.body as BillsPageBody;
      expect(page.items.length).toBeLessThanOrEqual(1);
      seenIds.push(...page.items.map((i) => i.evidenceId));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seenIds).toEqual([chargeFeb.id, chargeJan.id, procurement.jobCardId]);

    // --- ETag / If-None-Match -> 304, no body.
    const etag = fullRes.headers['etag'];
    expect(etag).toBeTruthy();
    const notModifiedRes = await resident.agent.get('/api/v1/me/bills').set('If-None-Match', etag).expect(304);
    expect(notModifiedRes.body).toEqual({});
    expect(notModifiedRes.headers['etag']).toBe(etag);

    // A stale If-None-Match still returns the full 200 body.
    const staleRes = await resident.agent.get('/api/v1/me/bills').set('If-None-Match', '"stale-etag-value"').expect(200);
    expect((staleRes.body as BillsPageBody).items).toHaveLength(3);

    // --- A resident with no bills at all gets an empty page, not an error.
    const emptyRes = await otherResident.agent.get('/api/v1/me/bills').expect(200);
    const empty = emptyRes.body as BillsPageBody;
    expect(empty.items.some((i) => i.evidenceId === chargeJan.id || i.evidenceId === chargeFeb.id || i.evidenceId === procurement.jobCardId)).toBe(false);
  });

  it('rejects a malformed cursor and an invalid kind with 400', async () => {
    const resident = await residentFixture(flatAId);
    await resident.agent.get('/api/v1/me/bills').query({ cursor: 'not-a-real-cursor' }).expect(400);
    await resident.agent.get('/api/v1/me/bills').query({ kind: 'NOT_A_KIND' }).expect(400);
  });

  it('an un-ratified occupancy gets 401 on GET /me/bills even with a valid session (Phase 6.3 ratification gate)', async () => {
    const phone = `+9197${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `bills-pending-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Pending Resident', email, phone, societyId, flatId: flatAId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    userIds.push((signupRes.body as { userId: string }).userId);

    // /auth/verify itself succeeds (issues a session) even for a still-PENDING
    // occupancy — the ratification gate is enforced downstream, in
    // UserContextService's principal resolution (see its doc comment): a
    // resident with no RATIFIED occupancy resolves to no principal at all,
    // so every AuthGuard-protected route 401s exactly like an
    // occupancy-less resident always did.
    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);

    await agent.get('/api/v1/me/bills').expect(401);
  });
});
