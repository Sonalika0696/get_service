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
import { CampRegistrationStatus, EventRegistrationStatus, OccupancyRole, RatificationStatus } from '../src/generated/prisma/enums.js';

/**
 * GET /me/bills — the EVENT and HEALTH_CAMP arms (Phase 11 M8 / Phase 12 M9).
 * Rows are seeded directly via Prisma so every inclusion rule is exercised
 * explicitly: a line appears while it is an obligation, or once money has
 * moved (statement history); unpaid waitlisted places, free events and
 * another flat's rows never appear.
 */

class CapturingSms {
  sent: SendSmsInput[] = [];
  async send(input: SendSmsInput): Promise<SmsSendResult> {
    this.sent.push(input);
    return { id: `test_${randomUUID()}`, status: 'stub_logged' };
  }
}

class CapturingMailer {
  async send(_input: SendMailInput): Promise<void> {}
}

function extractOtpFromSms(sms: SendSmsInput): string {
  const match = sms.body.match(/verification code is (\d{6})/);
  if (!match) throw new Error(`Could not find a 6-digit OTP code in captured SMS: ${sms.body}`);
  return match[1];
}

interface BillLineBody {
  id: string;
  kind: string;
  title: string;
  label: string;
  amountDue: string;
  amountPaid: string;
  status: string;
  dueDate: string | null;
  evidenceType: string;
  evidenceId: string;
}

interface BillsPageBody {
  items: BillLineBody[];
  nextCursor: string | null;
}

describe('GET /me/bills — EVENT and HEALTH_CAMP arms (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sms: CapturingSms;

  let societyId: string;
  let flatAId: string;
  let flatBId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    sms = new CapturingSms();
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsService)
      .useValue(sms)
      .overrideProvider(MailerService)
      .useValue(new CapturingMailer())
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();

    prisma = app.get(PrismaService);

    const society = await prisma.society.create({ data: { name: `Bills Events Camps Society ${randomUUID().slice(0, 8)}`, address: 'n/a' } });
    societyId = society.id;
    flatAId = (await prisma.flat.create({ data: { societyId, unitNo: `BEC-A-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } })).id;
    flatBId = (await prisma.flat.create({ data: { societyId, unitNo: `BEC-B-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } })).id;
  });

  afterAll(async () => {
    await prisma.campRegistration.deleteMany({ where: { camp: { societyId } } });
    await prisma.healthCampSlot.deleteMany({ where: { camp: { societyId } } });
    await prisma.healthCamp.deleteMany({ where: { societyId } });
    await prisma.eventRegistration.deleteMany({ where: { event: { societyId } } });
    await prisma.event.deleteMany({ where: { societyId } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.occupancy.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { societyId } });
    await prisma.flat.deleteMany({ where: { societyId } });
    await prisma.society.deleteMany({ where: { id: societyId } });
    await app.close();
  });

  async function residentFixture(flatId: string) {
    const phone = `+9199${randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Bills Resident', email: `bec-${randomUUID()}@example.com`, phone, societyId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);
    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    return { agent, userId };
  }

  const day = (offset: number) => new Date(Date.UTC(2026, 10, 1 + offset, 10, 0, 0));

  async function seedEvent(title: string, startsOffset: number, chargePerFlat: number) {
    return prisma.event.create({
      data: {
        societyId,
        createdById: 'committee-fixture',
        title,
        description: `${title} description`,
        startsAt: day(startsOffset),
        registrationOpensAt: day(startsOffset - 20),
        registrationClosesAt: day(startsOffset - 2),
        chargePerFlat,
      },
    });
  }

  it('shows event obligations and money history for the resident\'s own flat only, with payment-derived statuses', async () => {
    const resident = await residentFixture(flatAId);
    const r = resident.userId;

    const unpaid = await seedEvent('Diwali dinner', 10, 500);
    const paid = await seedEvent('Holi brunch', 12, 500);
    const refunded = await seedEvent('Movie night', 14, 500);
    const waitlisted = await seedEvent('Garba night', 16, 500);
    const free = await seedEvent('Clean-up drive', 18, 0);
    const withdrawnUnpaid = await seedEvent('Quiz night', 20, 500);
    const neighbours = await seedEvent('Neighbour only', 22, 500);

    await prisma.eventRegistration.createMany({
      data: [
        { eventId: unpaid.id, flatId: flatAId, residentId: r, status: EventRegistrationStatus.CONFIRMED, amountDue: 500 },
        { eventId: paid.id, flatId: flatAId, residentId: r, status: EventRegistrationStatus.CONFIRMED, amountDue: 500, paidAmount: 500 },
        { eventId: refunded.id, flatId: flatAId, residentId: r, status: EventRegistrationStatus.WITHDRAWN, amountDue: 500, paidAmount: 500, refundedAmount: 500 },
        { eventId: waitlisted.id, flatId: flatAId, residentId: r, status: EventRegistrationStatus.WAITLISTED, waitlistPosition: 1, amountDue: 500 },
        { eventId: free.id, flatId: flatAId, residentId: r, status: EventRegistrationStatus.CONFIRMED, amountDue: 0 },
        { eventId: withdrawnUnpaid.id, flatId: flatAId, residentId: r, status: EventRegistrationStatus.WITHDRAWN, amountDue: 500 },
        { eventId: neighbours.id, flatId: flatBId, residentId: 'neighbour-fixture', status: EventRegistrationStatus.CONFIRMED, amountDue: 500 },
      ],
    });

    const res = await resident.agent.get('/api/v1/me/bills').query({ kind: 'EVENT' }).expect(200);
    const items = (res.body as BillsPageBody).items;

    const byLabel = Object.fromEntries(items.map((i) => [i.label, i]));
    expect(Object.keys(byLabel).sort()).toEqual(['Diwali dinner', 'Holi brunch', 'Movie night'].sort());

    expect(byLabel['Diwali dinner'].status).toBe('PENDING');
    expect(byLabel['Holi brunch'].status).toBe('PAID');
    expect(byLabel['Movie night'].status).toBe('REFUNDED');
    expect(byLabel['Diwali dinner']).toMatchObject({ kind: 'EVENT', title: 'Event – Diwali dinner', evidenceType: 'EventRegistration' });
    expect(Number(byLabel['Diwali dinner'].amountDue)).toBe(500);
    expect(Number(byLabel['Holi brunch'].amountPaid)).toBe(500);
    expect(byLabel['Diwali dinner'].dueDate).toBe(day(10).toISOString());

    // Ordered by dueDate DESC, like every other arm.
    expect(items.map((i) => i.label)).toEqual(['Movie night', 'Holi brunch', 'Diwali dinner']);
  });

  it('shows paid or open health-camp registrations for the resident\'s own flat, and never another flat\'s', async () => {
    const resident = await residentFixture(flatAId);
    const r = resident.userId;

    const camp = await prisma.healthCamp.create({
      data: {
        societyId,
        createdById: 'committee-fixture',
        providerName: 'City Diagnostics',
        title: 'Eye check-up',
        campDate: day(30),
        registrationClosesAt: day(28),
        chargePerRegistration: 200,
      },
    });
    const slot = await prisma.healthCampSlot.create({ data: { campId: camp.id, startsAt: day(30), endsAt: new Date(day(30).getTime() + 3_600_000), capacity: 10 } });

    await prisma.campRegistration.createMany({
      data: [
        { campId: camp.id, slotId: slot.id, flatId: flatAId, residentId: r, attendeeName: 'Open Attendee', amountDue: 200 },
        { campId: camp.id, slotId: slot.id, flatId: flatAId, residentId: r, attendeeName: 'Cancelled Paid', status: CampRegistrationStatus.CANCELLED, amountDue: 200, paidAmount: 200 },
        { campId: camp.id, slotId: slot.id, flatId: flatAId, residentId: r, attendeeName: 'Cancelled Unpaid', status: CampRegistrationStatus.CANCELLED, amountDue: 200 },
        { campId: camp.id, slotId: slot.id, flatId: flatBId, residentId: 'neighbour-fixture', attendeeName: 'Neighbour Attendee', amountDue: 200 },
      ],
    });

    const res = await resident.agent.get('/api/v1/me/bills').query({ kind: 'HEALTH_CAMP' }).expect(200);
    const items = (res.body as BillsPageBody).items;

    const byLabel = Object.fromEntries(items.map((i) => [i.label, i]));
    expect(Object.keys(byLabel).sort()).toEqual(['Cancelled Paid', 'Open Attendee'].sort());
    expect(byLabel['Open Attendee']).toMatchObject({ kind: 'HEALTH_CAMP', status: 'PENDING', title: 'Health camp – Eye check-up', evidenceType: 'CampRegistration' });
    expect(byLabel['Cancelled Paid'].status).toBe('CANCELLED');
    expect(byLabel['Open Attendee'].dueDate).toBe(day(30).toISOString());

    // The unfiltered hub carries both new kinds together with the existing arms.
    const all = await resident.agent.get('/api/v1/me/bills').expect(200);
    const kinds = new Set((all.body as BillsPageBody).items.map((i) => i.kind));
    expect(kinds.has('HEALTH_CAMP')).toBe(true);
    expect(kinds.has('EVENT')).toBe(true);
  });

  it('accepts the new kinds and lists them in the 400 for an unknown kind', async () => {
    const resident = await residentFixture(flatBId);
    await resident.agent.get('/api/v1/me/bills').query({ kind: 'EVENT' }).expect(200);
    await resident.agent.get('/api/v1/me/bills').query({ kind: 'HEALTH_CAMP' }).expect(200);
    const bad = await resident.agent.get('/api/v1/me/bills').query({ kind: 'NOT_A_KIND' }).expect(400);
    expect((bad.body as { message: string }).message).toContain('EVENT');
    expect((bad.body as { message: string }).message).toContain('HEALTH_CAMP');
  });
});
