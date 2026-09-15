import { randomInt } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { sha256 } from '../../common/util/hash.js';

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;

function generateCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
}

function hashCode(code: string): string {
  return sha256(Buffer.from(code, 'utf8')).toString('hex');
}

/**
 * 6-digit email OTP: 10-minute expiry, 60-second resend cooldown, 5 wrong
 * attempts invalidate the code (params per explicit instruction — see
 * SUPERVISOR.md). No passwords in v1; this is the only auth factor.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Throws 429 if the last OTP for this user was issued within the cooldown window. */
  async request(userId: string): Promise<string> {
    const now = this.clock.now();

    const mostRecent = await this.prisma.otp.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (mostRecent && now.getTime() - mostRecent.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
      const retryInSeconds = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - (now.getTime() - mostRecent.createdAt.getTime())) / 1000);
      throw new HttpException(`Please wait ${retryInSeconds}s before requesting another code`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = generateCode();
    await this.prisma.otp.create({
      data: {
        userId,
        codeHash: hashCode(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000),
      },
    });

    return code;
  }

  /** Returns true and consumes the OTP on a correct, unexpired, not-yet-exhausted code. */
  async verify(userId: string, code: string): Promise<boolean> {
    const now = this.clock.now();

    const otp = await this.prisma.otp.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) return false;
    if (otp.expiresAt.getTime() <= now.getTime()) return false;
    if (otp.attempts >= MAX_VERIFY_ATTEMPTS) return false;

    if (otp.codeHash !== hashCode(code)) {
      await this.prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return false;
    }

    await this.prisma.otp.update({ where: { id: otp.id }, data: { consumedAt: now } });
    return true;
  }
}
