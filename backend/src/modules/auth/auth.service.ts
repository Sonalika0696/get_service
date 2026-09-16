import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OtpService } from './otp.service.js';
import { SessionService, type CreateSessionMeta } from './session.service.js';
import type { RequestOtpDto, SignupDto, VerifyOtpDto } from './dto/signup.dto.js';
import type { UserModel } from '../../generated/prisma/models.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly sessionService: SessionService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Creates the User + Occupancy immediately (self-attested) and sends the
   * first OTP. The account exists but is unusable until verify() succeeds
   * AND — Phase 6.3 (DECISIONS_V2_SCOPE.md §7.3, SDD §5.3 phantom-resident
   * threat) — a committee/treasurer officer ratifies the occupancy. The
   * Occupancy row created here relies entirely on the schema's
   * `ratificationStatus @default(PENDING)` (see RatificationStatus's doc
   * comment on the schema) rather than setting it explicitly, so this stays
   * the one place self-registration happens and PENDING is never
   * accidentally bypassed. UserContextService.load() treats a
   * PENDING/REJECTED occupancy as no active occupancy at all — a resident
   * who has verified their OTP but isn't yet ratified still gets 401 on
   * every authenticated route. See RatificationService (modules/society)
   * for the committee's queue/ratify/reject endpoints.
   *
   * Phase 6.2: when a phone is supplied, the first OTP is delivered by SMS
   * (the resident credential anchor going forward — DECISIONS_V2_SCOPE.md
   * §7.1) rather than email; email-only signups (every pre-6.2 test and
   * caller) are unaffected.
   */
  async signup(dto: SignupDto): Promise<{ userId: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists — log in instead');
    }

    const flat = await this.prisma.flat.findUnique({ where: { id: dto.flatId } });
    if (!flat || flat.societyId !== dto.societyId) {
      throw new NotFoundException('Flat not found in the given society');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: dto.name, email: dto.email, phone: dto.phone },
      });
      await tx.occupancy.create({
        data: { flatId: dto.flatId, userId: created.id, role: dto.role },
      });
      return created;
    });

    const code = await this.otpService.request(user.id);
    if (user.phone) {
      await this.notifications.sendOtpSms(user.phone, code);
    } else {
      await this.notifications.sendOtpEmail(user.email, code);
    }

    return { userId: user.id };
  }

  /** Login / resend path for an existing account — by email or by phone (Phase 6.2), never both. */
  async requestOtp(dto: RequestOtpDto): Promise<void> {
    const user = await this.resolveResidentCredentialUser(dto);
    const code = await this.otpService.request(user.id);
    if (dto.phone) {
      await this.notifications.sendOtpSms(user.phone!, code);
    } else {
      await this.notifications.sendOtpEmail(user.email, code);
    }
  }

  async verify(dto: VerifyOtpDto, meta: CreateSessionMeta = {}): Promise<{ rawToken: string; user: UserModel }> {
    const user = await this.resolveResidentCredentialUser(dto);

    const ok = await this.otpService.verify(user.id, dto.code);
    if (!ok) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (dto.phone && !user.phoneVerifiedAt) {
      await this.prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
    } else if (dto.email && !user.emailVerifiedAt) {
      await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }

    const { rawToken } = await this.sessionService.create(user.id, meta);
    return { rawToken, user };
  }

  async logout(rawToken: string): Promise<void> {
    await this.sessionService.revoke(rawToken);
  }

  private async findUserByEmailOrThrow(email: string): Promise<UserModel> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('No account with this email');
    }
    return user;
  }

  /**
   * Resolves the account an OTP request/verify is for, from exactly one of
   * dto.email / dto.phone (Phase 6.2 — see RequestOtpDto/VerifyOtpDto's doc
   * comment). Both resident credential paths — kept as ONE resolver rather
   * than branching the two call sites separately, so the "exactly one"
   * invariant can't drift between request() and verify().
   */
  private async resolveResidentCredentialUser(dto: { email?: string; phone?: string }): Promise<UserModel> {
    if (dto.email && dto.phone) {
      throw new BadRequestException('Provide either email or phone, not both');
    }
    if (dto.email) {
      return this.findUserByEmailOrThrow(dto.email);
    }
    if (dto.phone) {
      const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
      if (!user) {
        throw new NotFoundException('No account with this phone number');
      }
      return user;
    }
    throw new BadRequestException('Provide either email or phone');
  }
}
