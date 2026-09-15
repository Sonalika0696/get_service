import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OtpService } from './otp.service.js';
import { SessionService, type CreateSessionMeta } from './session.service.js';
import type { SignupDto } from './dto/signup.dto.js';
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
   * Creates the User + Occupancy immediately (self-attested, no committee
   * approval gate in v1 — see SUPERVISOR.md decisions log), then sends the
   * first OTP. The account exists but is unverified/unusable until
   * verify() succeeds.
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
    await this.notifications.sendOtpEmail(user.email, code);

    return { userId: user.id };
  }

  /** Login / resend path for an existing account. */
  async requestOtp(email: string): Promise<void> {
    const user = await this.findUserByEmailOrThrow(email);
    const code = await this.otpService.request(user.id);
    await this.notifications.sendOtpEmail(user.email, code);
  }

  async verify(email: string, code: string, meta: CreateSessionMeta = {}): Promise<{ rawToken: string; user: UserModel }> {
    const user = await this.findUserByEmailOrThrow(email);

    const ok = await this.otpService.verify(user.id, code);
    if (!ok) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (!user.emailVerifiedAt) {
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
}
