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
import { OccupancyRole, RatificationStatus } from '../src/generated/prisma/enums.js';

/**
 * PATCH /me — self-service profile edit, and the security fix closing an
 * account-takeover path: the phone number is a sign-in credential, so an
 * unverified change must never be written. Before the fix, anyone holding a
 * session could re-point OTP delivery to a phone they control and keep
 * signing in after that session was revoked.
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

const randomPhone = () => `+9198${randomUUID().replace(/\D/g, '').slice(0, 8)}`;

interface MeBody {
  id: string;
  name: string;
  phone: string | null;
}

describe('PATCH /me profile update (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sms: CapturingSms;

  let societyId: string;
  const flatIds: string[] = [];
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

    const society = await prisma.society.create({ data: { name: `Profile Update Test Society ${randomUUID().slice(0, 8)}`, address: 'n/a' } });
    societyId = society.id;
    for (let i = 0; i < 3; i++) {
      const flat = await prisma.flat.create({ data: { societyId, unitNo: `PROF-${i}-${randomUUID().slice(0, 8)}`, maintenanceAmount: 1000 } });
      flatIds.push(flat.id);
    }
  });

  afterAll(async () => {
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
    const phone = randomPhone();
    const signupRes = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Profile Resident', email: `profile-${randomUUID()}@example.com`, phone, societyId, flatId, role: OccupancyRole.OWNER_OCCUPIER })
      .expect(201);
    const userId = (signupRes.body as { userId: string }).userId;
    userIds.push(userId);

    await prisma.occupancy.updateMany({ where: { userId }, data: { ratificationStatus: RatificationStatus.RATIFIED, ratificationDecidedAt: new Date() } });

    const code = extractOtpFromSms(sms.sent.filter((s) => s.to === phone).at(-1)!);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/verify').send({ phone, code }).expect(201);
    return { agent, userId, phone };
  }

  it('updates the name', async () => {
    const resident = await residentFixture(flatIds[0]);

    const res = await resident.agent.patch('/api/v1/me').send({ name: 'Renamed Resident' }).expect(200);

    expect((res.body as MeBody).name).toBe('Renamed Resident');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: resident.userId } })).name).toBe('Renamed Resident');
  });

  it('refuses an unverified phone change, changes nothing, and the new number cannot be used to sign in', async () => {
    const resident = await residentFixture(flatIds[1]);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: resident.userId } });
    const attackerPhone = randomPhone();

    const res = await resident.agent.patch('/api/v1/me').send({ name: 'Should Not Apply', phone: attackerPhone }).expect(400);
    expect((res.body as { message?: string }).message).toMatch(/requires verifying the new number/);

    // Atomic refusal: neither the phone nor the name in the same request was written.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: resident.userId } });
    expect(after.phone).toBe(before.phone);
    expect(after.name).toBe(before.name);
    expect(after.phoneVerifiedAt?.toISOString()).toBe(before.phoneVerifiedAt?.toISOString());

    // The takeover path is closed: no OTP can be requested for the attacker's number.
    sms.sent.length = 0;
    await request(app.getHttpServer()).post('/api/v1/auth/otp').send({ phone: attackerPhone }).expect((r) => {
      expect(r.status).toBeGreaterThanOrEqual(400);
    });
    expect(sms.sent.filter((s) => s.to === attackerPhone)).toHaveLength(0);
  });

  it('accepts the unchanged current phone alongside a name edit, so whole-form clients keep working', async () => {
    const resident = await residentFixture(flatIds[2]);

    const res = await resident.agent.patch('/api/v1/me').send({ name: 'Whole Form Save', phone: resident.phone }).expect(200);

    expect((res.body as MeBody).name).toBe('Whole Form Save');
    expect((res.body as MeBody).phone).toBe(resident.phone);
  });
});
