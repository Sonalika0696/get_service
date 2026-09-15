import { randomBytes, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AppConfigService } from '../../config/config.service.js';
import type { SessionModel } from '../../generated/prisma/models.js';

const SESSION_TOKEN_BYTES = 32;
/** Refresh expiresAt when a session is used and less than this fraction of its TTL remains. */
const REFRESH_THRESHOLD_FRACTION = 0.5;

export interface CreateSessionMeta {
  userAgent?: string;
  ip?: string;
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * DB-backed sessions (chosen over stateless JWT so logout/force-revoke
 * works — see SUPERVISOR.md decisions log). The cookie carries a random
 * opaque token; only its SHA-256 hash is ever stored, so a DB read alone
 * can't produce a valid session.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly config: AppConfigService,
  ) {}

  async create(userId: string, meta: CreateSessionMeta = {}): Promise<{ rawToken: string; session: SessionModel }> {
    const rawToken = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt,
        lastSeenAt: now,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });

    return { rawToken, session };
  }

  /** Returns the session if the token is valid and unexpired, else null. Opportunistically slides expiry forward. */
  async validate(rawToken: string): Promise<SessionModel | null> {
    const tokenHash = hashToken(rawToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash } });
    if (!session) return null;

    const now = this.clock.now();
    if (session.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    const ttlMs = this.config.env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
    const remainingMs = session.expiresAt.getTime() - now.getTime();
    if (remainingMs < ttlMs * REFRESH_THRESHOLD_FRACTION) {
      const refreshed = await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(now.getTime() + ttlMs), lastSeenAt: now },
      });
      return refreshed;
    }

    return session;
  }

  async revoke(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }
}
