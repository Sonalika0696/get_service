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
  MaintenanceChargeStatus,
  OccupancyRole,
  ParticipationStatus,
  RatificationStatus,
  ServiceRequestOrigin,
  ServiceRequestStatus,
  ServiceRequestType,
} from '../src/generated/prisma/enums.js';

/**
 * Phase 9.4 — GET /me/home mobile home-tab aggregate. Seeds
 * MaintenanceCharge and ServiceRequest/Participation rows directly via
 * Prisma (per this phase's brief) rather than through the 9.2/9.3
 * services/routes, which are being built concurrently in sibling
 * worktrees and may not exist yet — HomeService itself reads these tables
 * directly for the same reason (see its class doc comment).
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

interface HomeBody {
  amountDue: string;
  overdueCount: number;
  actionsNeeded: number;
  joinableServiceRequests: { id: string; title: string; status: string; participantCount: number; threshold: number | null }[];
  upcomingEvents: unknown[];
}

describe('GET /me/home (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sms: CapturingSms;
  let mailer: CapturingMailer;

  let societyId: string;
  const flatIds: string[] = [];
  const userIds: string[] = [];
  const serviceRequestIds: string[] = [];

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

    const society = await prisma.society.create({ data: { name: 'Home Aggregate Test Society', address: 'n/a' } });
    societyId = society.id;
    for (let i = 0; i < 2; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `HOME-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 2000 } });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
    await prisma.participation.deleteMany({ where: { serviceRequestId: { in: serviceRequestIds } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { in: serviceRequestIds } } });
    await prisma.maintenanceCharge.deleteMany({ where: { societyId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });

    await app.close();
  });

  /** Signs up + verifies a resident, then ratifies the occupancy (required or the resident 401s — see this phase's fixture rule). */
  async function residentFixture(flatId: string) {
    const phone = `+9197${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const email = `home-resident-${randomUUID()}@example.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Home Resident', email, phone, societyId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    return { agent, userId };
  }

  it('aggregates amountDue/overdueCount from the resident\'s own flat and lists a joinable service request; upcomingEvents is []', async () => {
    const resident = await residentFixture(flatIds[0]);
    // A neighbour on the other flat — used only to seed a Participation on
    // the joinable request below, so it isn't a lone-flat pool of 1.
    const neighbour = await residentFixture(flatIds[1]);

    const now = new Date();
    const overdueDue = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const notYetDue = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);

    // Overdue, unpaid: amount 2000 + lateFee 150 - paid 0 = 2150 due, and counts toward overdueCount.
    await prisma.maintenanceCharge.create({
      data: {
        societyId,
        flatId: flatIds[0],
        period: '2026-07',
        amount: 2000,
        lateFeeAccrued: 150,
        paidAmount: 0,
        dueDate: overdueDue,
        status: MaintenanceChargeStatus.PENDING,
      },
    });
    // Not yet due, partially paid: amount 2000 - paid 500 = 1500 due, does NOT count toward overdueCount.
    await prisma.maintenanceCharge.create({
      data: {
        societyId,
        flatId: flatIds[0],
        period: '2026-08',
        amount: 2000,
        lateFeeAccrued: 0,
        paidAmount: 500,
        dueDate: notYetDue,
        status: MaintenanceChargeStatus.PARTIAL,
      },
    });
    // PAID charge on the same flat: must be excluded entirely from amountDue/overdueCount.
    await prisma.maintenanceCharge.create({
      data: {
        societyId,
        flatId: flatIds[0],
        period: '2026-06',
        amount: 2000,
        lateFeeAccrued: 0,
        paidAmount: 2000,
        dueDate: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
        status: MaintenanceChargeStatus.PAID,
      },
    });
    // A charge on the NEIGHBOUR's flat must never leak into this resident's aggregate.
    await prisma.maintenanceCharge.create({
      data: {
        societyId,
        flatId: flatIds[1],
        period: '2026-07',
        amount: 9999,
        lateFeeAccrued: 0,
        paidAmount: 0,
        dueDate: overdueDue,
        status: MaintenanceChargeStatus.PENDING,
      },
    });

    // A joinable request: OPEN, closesAt in the future, threshold 3, one
    // ACTIVE participation already from the neighbour's flat.
    const joinableSr = await prisma.serviceRequest.create({
      data: {
        societyId,
        creatorId: neighbour.userId,
        pollType: ServiceRequestType.SERVICE_REQUEST,
        title: 'Lift AMC renewal',
        closesAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        status: ServiceRequestStatus.OPEN,
        origin: ServiceRequestOrigin.RESIDENT,
        raisedByFlatId: flatIds[1],
        threshold: 3,
      },
    });
    serviceRequestIds.push(joinableSr.id);
    await prisma.participation.create({
      data: { serviceRequestId: joinableSr.id, residentId: neighbour.userId, flatId: flatIds[1], status: ParticipationStatus.ACTIVE },
    });

    // A CLOSED request in the same society must NOT appear as joinable.
    const closedSr = await prisma.serviceRequest.create({
      data: {
        societyId,
        creatorId: neighbour.userId,
        pollType: ServiceRequestType.SERVICE_REQUEST,
        title: 'Already closed request',
        closesAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        status: ServiceRequestStatus.CLOSED,
        closedAt: now,
        origin: ServiceRequestOrigin.RESIDENT,
        raisedByFlatId: flatIds[1],
        threshold: 3,
      },
    });
    serviceRequestIds.push(closedSr.id);

    // An OPEN but already-expired (closesAt in the past) request must NOT
    // appear as joinable either — mirrors ServiceRequestsService.join's own
    // closesAt guard.
    const expiredSr = await prisma.serviceRequest.create({
      data: {
        societyId,
        creatorId: neighbour.userId,
        pollType: ServiceRequestType.SERVICE_REQUEST,
        title: 'Expired but still OPEN request',
        closesAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
        status: ServiceRequestStatus.OPEN,
        origin: ServiceRequestOrigin.RESIDENT,
        raisedByFlatId: flatIds[1],
        threshold: 3,
      },
    });
    serviceRequestIds.push(expiredSr.id);

    const res = await resident.agent.get('/api/v1/me/home').expect(200);
    const body = res.body as HomeBody;

    expect(body.amountDue).toBe('3650.00'); // 2150 (overdue) + 1500 (partial) — PAID and neighbour's charge excluded
    expect(body.overdueCount).toBe(1);
    expect(body.actionsNeeded).toBe(1);
    expect(body.upcomingEvents).toEqual([]);

    expect(body.joinableServiceRequests.some((sr) => sr.id === closedSr.id)).toBe(false);
    expect(body.joinableServiceRequests.some((sr) => sr.id === expiredSr.id)).toBe(false);
    const joinable = body.joinableServiceRequests.find((sr) => sr.id === joinableSr.id);
    expect(joinable).toBeDefined();
    expect(joinable?.title).toBe('Lift AMC renewal');
    expect(joinable?.status).toBe(ServiceRequestStatus.OPEN);
    expect(joinable?.threshold).toBe(3);
    expect(joinable?.participantCount).toBe(1);

    // Unauthenticated caller: 401.
    await request(app.getHttpServer()).get('/api/v1/me/home').expect(401);
  });
});
