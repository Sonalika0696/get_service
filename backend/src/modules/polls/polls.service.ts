import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PollStatus, PollType } from '../../generated/prisma/enums.js';
import type { PollModel } from '../../generated/prisma/models.js';
import type { CreatePollDto } from './dto/create-poll.dto.js';

/** API-facing shape: the poll row plus its commitment count and the caller's own participation flag. */
export type PollDetail = PollModel & {
  commitmentCount: number;
  hasJoined: boolean;
};

/** Kind of lifecycle transition a poll notification is reporting. */
type NotificationKind = 'fired' | 'expired';

/**
 * What notifyCommitted-style logic needs to dispatch mail AFTER a
 * transaction has committed: just the recipient list plus enough context
 * to pick a template. No DB handles — those only live inside the tx that
 * produced this.
 */
interface PendingNotification {
  pollId: string;
  title: string;
  kind: NotificationKind;
  recipientEmails: string[];
}

/**
 * Poll engine (Phase 3), reduced in the V2.0 scope revision: resident voting
 * — ADVISORY/BINDING polls, Vote, ownership weighting, quorum — is withdrawn
 * (DECISIONS_V2_SCOPE.md §2.4–2.5, SDD invariant I8). What remains is the
 * opt-in "join" mechanic: residents commit, and the poll auto-fires once
 * minCommitments is reached. Phase 8 renames this to
 * ServiceRequest/Participation.
 *
 * Phase 5 reuses the shared Poll/PollCommitment tables for bulk-buy Flow B
 * (PollType.BULK_BUY_RESIDENT), but OWNS that pollType's entire lifecycle
 * from the bulk-buy module — see src/modules/bulk-buy/bulk-buy.service.ts's
 * Flow B section. create/join here reject BULK_BUY_RESIDENT with 400,
 * pointing callers at the bulk-buy routes. GET (list/get) work for any
 * pollType, since read access has no ownership implications.
 *
 * GET routes are read-only by design: nothing here mutates a poll's status
 * as a side effect of reading it. Expiry is only ever applied by
 * processExpired(), invoked by POST /polls/process-expired (committee-only)
 * as a stand-in for a future scheduler. processExpired still applies to
 * BULK_BUY_RESIDENT polls, since expiry is generic lifecycle logic rather
 * than Flow B ownership.
 *
 * Notification dispatch is post-commit and best-effort (BACKEND_PLAN.md
 * Phase 6.5, RoU §5): join()/processExpired() only READ inside the
 * $transaction (via collectRecipients) and return a PendingNotification;
 * the actual mailer calls happen after the transaction has resolved, via
 * dispatchNotifications, which swallows and logs per-recipient failures so
 * a mail hiccup can never roll back or reverse an already-committed
 * FIRED/EXPIRED state change.
 */
@Injectable()
export class PollsService {
  private readonly logger = new Logger(PollsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
  ) {}

  async create(societyId: string, creatorId: string, dto: CreatePollDto): Promise<PollDetail> {
    if (dto.pollType === PollType.BULK_BUY_RESIDENT) {
      throw new BadRequestException('Create resident bulk-buy polls via POST /bulk-buy/polls');
    }

    const closesAt = new Date(dto.closesAt);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('closesAt must be a valid date in the future');
    }

    if (!dto.minCommitments || dto.minCommitments < 1) {
      throw new BadRequestException('minCommitments (>= 1) is required for EVENT polls');
    }

    const poll = await this.prisma.poll.create({
      data: {
        societyId,
        creatorId,
        pollType: dto.pollType,
        title: dto.title,
        description: dto.description,
        minCommitments: dto.minCommitments,
        closesAt,
      },
    });

    return this.toDetail(poll, null);
  }

  async listForSociety(societyId: string, status?: PollStatus): Promise<PollModel[]> {
    return this.prisma.poll.findMany({
      where: { societyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(societyId: string, id: string, callerId: string): Promise<PollDetail> {
    const poll = await this.getInternal(societyId, id);
    return this.toDetail(poll, callerId);
  }

  /**
   * Records the caller's commitment. Triggers the auto-fire check
   * synchronously in the same transaction that inserts the commitment, so
   * firing is deterministic and e2e-testable rather than depending on a
   * background job.
   */
  async join(societyId: string, id: string, callerId: string): Promise<PollDetail> {
    const poll = await this.getInternal(societyId, id);
    if (poll.pollType === PollType.BULK_BUY_RESIDENT) {
      throw new BadRequestException('BULK_BUY_RESIDENT polls are owned by the bulk-buy module — use POST /bulk-buy/polls/:id/join instead');
    }
    if (poll.status !== PollStatus.OPEN) {
      throw new BadRequestException('Poll is not open for joining');
    }

    const isResident = await this.isActiveResident(societyId, callerId);
    if (!isResident) {
      throw new ForbiddenException('Not a resident of this society');
    }

    // The transaction only mutates/reads state and hands back what a
    // post-commit notification would need — it never awaits the mailer
    // itself. That keeps a mail-sender hiccup from being able to roll back
    // a commitment that already legitimately landed (BACKEND_PLAN.md Phase
    // 6.5, RoU §5: notification dispatch must be post-commit and
    // best-effort, never able to reverse committed state).
    const pending = await this.prisma.$transaction(async (tx) => {
      try {
        await tx.pollCommitment.create({ data: { pollId: id, residentId: callerId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Already joined');
        }
        throw error;
      }

      const commitmentCount = await tx.pollCommitment.count({ where: { pollId: id } });
      if (poll.minCommitments !== null && commitmentCount >= poll.minCommitments) {
        const stillOpen = await tx.poll.findUnique({ where: { id }, select: { status: true } });
        if (stillOpen?.status === PollStatus.OPEN) {
          await tx.poll.update({ where: { id }, data: { status: PollStatus.FIRED, firedAt: this.clock.now() } });
          return this.collectRecipients(tx, id, poll.title, 'fired');
        }
      }
      return null;
    });

    if (pending) {
      await this.dispatchNotifications(pending);
    }

    return this.get(societyId, id, callerId);
  }

  /** Creator-only close-early. An already-FIRED poll can't be closed. */
  async closeEarly(societyId: string, id: string, callerId: string): Promise<PollDetail> {
    const poll = await this.getInternal(societyId, id);
    if (poll.creatorId !== callerId) {
      throw new ForbiddenException('Only the poll creator can close it early');
    }
    if (poll.status !== PollStatus.OPEN) {
      throw new BadRequestException(`Poll is already ${poll.status}`);
    }

    await this.prisma.poll.update({ where: { id }, data: { status: PollStatus.CLOSED, closedAt: this.clock.now() } });

    return this.get(societyId, id, callerId);
  }

  /**
   * Expires every OPEN poll in the society whose closesAt has passed (+
   * notifies committed residents). A poll that already auto-fired before
   * expiring is left FIRED, not touched here. This is the method a real
   * scheduler would call periodically; for now it's driven explicitly via
   * POST /polls/process-expired.
   */
  async processExpired(societyId: string): Promise<{ resolved: number }> {
    const now = this.clock.now();
    const expired = await this.prisma.poll.findMany({
      where: { societyId, status: PollStatus.OPEN, closesAt: { lte: now } },
    });

    for (const poll of expired) {
      // Same post-commit split as join(): the transaction only flips the
      // poll's status and reads back who to notify; dispatch happens after
      // it has committed, so a mail failure can't un-expire a poll.
      const pending = await this.prisma.$transaction(async (tx) => {
        await tx.poll.update({ where: { id: poll.id }, data: { status: PollStatus.EXPIRED, closedAt: this.clock.now() } });
        return this.collectRecipients(tx, poll.id, poll.title, 'expired');
      });
      await this.dispatchNotifications(pending);
    }

    return { resolved: expired.length };
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /** Read-only, runs INSIDE the transaction: just gathers who to notify — never calls the mailer. */
  private async collectRecipients(tx: Prisma.TransactionClient, pollId: string, title: string, kind: NotificationKind): Promise<PendingNotification> {
    const commitments = await tx.pollCommitment.findMany({ where: { pollId }, include: { resident: true } });
    return { pollId, title, kind, recipientEmails: commitments.map((commitment) => commitment.resident.email) };
  }

  /**
   * Runs AFTER the transaction has committed. Best-effort: each send is
   * isolated in its own try/catch so one resident's bounced/broken mailbox
   * can't stop the rest of the batch, and any failure is logged rather than
   * thrown — this must never be able to look like the poll itself failed.
   */
  private async dispatchNotifications(pending: PendingNotification): Promise<void> {
    for (const email of pending.recipientEmails) {
      try {
        if (pending.kind === 'fired') {
          await this.notifications.sendPollFired(email, pending.title);
        } else {
          await this.notifications.sendPollExpired(email, pending.title);
        }
      } catch (error) {
        this.logger.error(
          `Post-commit poll-${pending.kind} notification failed for poll ${pending.pollId} -> ${email} (state change already committed)`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /** One active occupancy per user in v1 (see UserContextService). */
  private async isActiveResident(societyId: string, userId: string): Promise<boolean> {
    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId, tenureEndedAt: null, flat: { societyId } },
      select: { id: true },
    });
    return occupancy !== null;
  }

  private async toDetail(poll: PollModel, callerId: string | null): Promise<PollDetail> {
    const [commitmentCount, hasJoined] = await Promise.all([
      this.prisma.pollCommitment.count({ where: { pollId: poll.id } }),
      callerId ? this.prisma.pollCommitment.findUnique({ where: { pollId_residentId: { pollId: poll.id, residentId: callerId } } }).then(Boolean) : Promise.resolve(false),
    ]);

    return { ...poll, commitmentCount, hasJoined };
  }

  private async getInternal(societyId: string, id: string): Promise<PollModel> {
    const poll = await this.prisma.poll.findUnique({ where: { id } });
    if (!poll || poll.societyId !== societyId) {
      throw new NotFoundException('Poll not found');
    }
    return poll;
  }
}
