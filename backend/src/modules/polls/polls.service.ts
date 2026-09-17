import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ServiceRequestStatus, ServiceRequestType } from '../../generated/prisma/enums.js';
import type { ServiceRequestModel } from '../../generated/prisma/models.js';
import type { CreatePollDto } from './dto/create-poll.dto.js';

/** API-facing shape: the poll row plus its commitment count and the caller's own participation flag. */
export type PollDetail = ServiceRequestModel & {
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
 * Phase 5 reuses the shared ServiceRequest/Participation tables for bulk-buy
 * Flow B (ServiceRequestType.BULK_BUY_RESIDENT), but OWNS that pollType's entire lifecycle
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
    if (dto.pollType === ServiceRequestType.BULK_BUY_RESIDENT) {
      throw new BadRequestException('Create resident bulk-buy polls via POST /bulk-buy/polls');
    }
    // Phase 8.2: same ownership split as BULK_BUY_RESIDENT above — the NEW
    // ServiceRequest pooling loop is owned end-to-end by
    // ServiceRequestsService (threshold-freeze at creation, committee
    // assign/confirm, PricingCard freeze, escrow), never by this generic
    // EVENT-poll path.
    if (dto.pollType === ServiceRequestType.SERVICE_REQUEST) {
      throw new BadRequestException('Create pooling service requests via POST /service-requests instead');
    }

    const closesAt = new Date(dto.closesAt);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('closesAt must be a valid date in the future');
    }

    if (!dto.minCommitments || dto.minCommitments < 1) {
      throw new BadRequestException('minCommitments (>= 1) is required for EVENT polls');
    }

    const poll = await this.prisma.serviceRequest.create({
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

  async listForSociety(societyId: string, status?: ServiceRequestStatus): Promise<ServiceRequestModel[]> {
    return this.prisma.serviceRequest.findMany({
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
    if (poll.pollType === ServiceRequestType.BULK_BUY_RESIDENT) {
      throw new BadRequestException('BULK_BUY_RESIDENT polls are owned by the bulk-buy module — use POST /bulk-buy/polls/:id/join instead');
    }
    if (poll.pollType === ServiceRequestType.SERVICE_REQUEST) {
      throw new BadRequestException('SERVICE_REQUEST requests are owned by the service-requests module — use POST /service-requests/:id/join instead');
    }
    if (poll.status !== ServiceRequestStatus.OPEN) {
      throw new BadRequestException('Poll is not open for joining');
    }

    // Phase 8.1: Participation is now keyed by flatId too — resolve the
    // caller's active occupancy in this society once, up front, both to
    // enforce residency (as before) and to stamp the joining flat.
    const flatId = await this.activeFlatId(societyId, callerId);
    if (!flatId) {
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
        await tx.participation.create({ data: { serviceRequestId: id, residentId: callerId, flatId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('Already joined');
        }
        throw error;
      }

      const commitmentCount = await tx.participation.count({ where: { serviceRequestId: id } });
      if (poll.minCommitments !== null && commitmentCount >= poll.minCommitments) {
        const stillOpen = await tx.serviceRequest.findUnique({ where: { id }, select: { status: true } });
        if (stillOpen?.status === ServiceRequestStatus.OPEN) {
          await tx.serviceRequest.update({ where: { id }, data: { status: ServiceRequestStatus.FIRED, firedAt: this.clock.now() } });
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
    if (poll.status !== ServiceRequestStatus.OPEN) {
      throw new BadRequestException(`Poll is already ${poll.status}`);
    }

    await this.prisma.serviceRequest.update({ where: { id }, data: { status: ServiceRequestStatus.CLOSED, closedAt: this.clock.now() } });

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
    const expired = await this.prisma.serviceRequest.findMany({
      where: { societyId, status: ServiceRequestStatus.OPEN, closesAt: { lte: now } },
    });

    for (const poll of expired) {
      // Same post-commit split as join(): the transaction only flips the
      // poll's status and reads back who to notify; dispatch happens after
      // it has committed, so a mail failure can't un-expire a poll.
      const pending = await this.prisma.$transaction(async (tx) => {
        await tx.serviceRequest.update({ where: { id: poll.id }, data: { status: ServiceRequestStatus.EXPIRED, closedAt: this.clock.now() } });
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
    const commitments = await tx.participation.findMany({ where: { serviceRequestId: pollId }, include: { resident: true } });
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

  /** One active occupancy per user in v1 (see UserContextService). Returns its flatId, or null if the caller isn't a resident of this society. */
  private async activeFlatId(societyId: string, userId: string): Promise<string | null> {
    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId, tenureEndedAt: null, flat: { societyId } },
      select: { flatId: true },
    });
    return occupancy?.flatId ?? null;
  }

  private async toDetail(poll: ServiceRequestModel, callerId: string | null): Promise<PollDetail> {
    const [commitmentCount, hasJoined] = await Promise.all([
      this.prisma.participation.count({ where: { serviceRequestId: poll.id } }),
      callerId ? this.prisma.participation.findUnique({ where: { serviceRequestId_residentId: { serviceRequestId: poll.id, residentId: callerId } } }).then(Boolean) : Promise.resolve(false),
    ]);

    return { ...poll, commitmentCount, hasJoined };
  }

  private async getInternal(societyId: string, id: string): Promise<ServiceRequestModel> {
    const poll = await this.prisma.serviceRequest.findUnique({ where: { id } });
    if (!poll || poll.societyId !== societyId) {
      throw new NotFoundException('Poll not found');
    }
    return poll;
  }
}
