import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { sha256 } from '../../common/util/hash.js';
import { Prisma } from '../../generated/prisma/client.js';
import { OccupancyRole, PollStatus, PollType, PollWeightMode, RoleKind } from '../../generated/prisma/enums.js';
import type { PollModel } from '../../generated/prisma/models.js';
import { computeTally, type TallyResult } from './poll-tally.util.js';
import type { CreatePollDto } from './dto/create-poll.dto.js';
import type { VotePollDto } from './dto/vote-poll.dto.js';

/** API-facing shape: the poll row plus a live tally readout and the caller's own participation flags. */
export type PollDetail = PollModel & {
  tally: TallyResult;
  commitmentCount: number;
  hasVoted: boolean;
  hasJoined: boolean;
};

// BULK_BUY_RESIDENT deliberately excluded: create()/join() both reject it
// outright (see the ownership-split doc comment above) before ever
// consulting this set, so it only ever needs to describe EVENT here.
const JOINABLE_TYPES = new Set<PollType>([PollType.EVENT]);
const OWNER_ROLES = new Set<OccupancyRole>([OccupancyRole.OWNER_OCCUPIER, OccupancyRole.OWNER_ABSENTEE]);

type VoterOccupancy = { role: OccupancyRole; flat: { ownershipShare: Prisma.Decimal } };

/**
 * Reusable poll engine (Phase 3: event polls, no money). Phase 5 reuses the
 * shared Poll/PollCommitment tables for bulk-buy Flow B
 * (PollType.BULK_BUY_RESIDENT), but OWNS that pollType's entire lifecycle
 * from the bulk-buy module instead — see
 * src/modules/bulk-buy/bulk-buy.service.ts's Flow B section
 * (createResidentPoll/vendorConfirm/vendorDecline/joinResidentPoll). This
 * module stays governance/event only: create/vote/join all reject
 * BULK_BUY_RESIDENT with 400, pointing callers at the bulk-buy routes
 * instead. GET (list/get) still work for any pollType, including
 * BULK_BUY_RESIDENT, since read access has no ownership implications.
 *
 * GET routes are read-only by design: they report a poll's *current*
 * persisted status plus a live tally computed on the fly. Nothing here
 * mutates a poll's status as a side effect of reading it. Expiry is only
 * ever applied by processExpired(), which today is invoked by
 * POST /polls/process-expired (committee-only) as a stand-in for a future
 * scheduler (@nestjs/schedule was deliberately not added in this phase).
 * processExpired still applies to BULK_BUY_RESIDENT polls (an unconfirmed
 * or under-subscribed tagged-vendor poll should still expire), since that's
 * generic EVENT-shaped lifecycle logic, not Flow B ownership.
 */
@Injectable()
export class PollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
  ) {}

  async create(societyId: string, creatorId: string, callerRoleKinds: RoleKind[], dto: CreatePollDto): Promise<PollDetail> {
    if (dto.pollType === PollType.BULK_BUY_RESIDENT) {
      throw new BadRequestException('Create resident bulk-buy polls via POST /bulk-buy/polls');
    }
    if (dto.pollType === PollType.BINDING && !callerRoleKinds.includes(RoleKind.COMMITTEE)) {
      throw new ForbiddenException('Only committee members can create binding polls');
    }

    const closesAt = new Date(dto.closesAt);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('closesAt must be a valid date in the future');
    }

    if (JOINABLE_TYPES.has(dto.pollType) && (!dto.minCommitments || dto.minCommitments < 1)) {
      throw new BadRequestException('minCommitments (>= 1) is required for EVENT/BULK_BUY_RESIDENT polls');
    }

    const poll = await this.prisma.poll.create({
      data: {
        societyId,
        creatorId,
        pollType: dto.pollType,
        weightMode: dto.weightMode ?? PollWeightMode.UNIFORM,
        title: dto.title,
        description: dto.description,
        quorumPct: dto.quorumPct ?? 60,
        passingPct: dto.passingPct ?? 50,
        minCommitments: JOINABLE_TYPES.has(dto.pollType) ? dto.minCommitments : null,
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
   * Casts a vote for the authenticated caller. Eligibility and weight are
   * derived server-side from the caller's occupancy — never from client
   * input. voterHash is likewise computed server-side (see Vote.voterHash
   * doc comment in schema.prisma) so the anonymity guarantee can't be
   * bypassed by a client claiming someone else's hash.
   */
  async vote(societyId: string, id: string, callerId: string, dto: VotePollDto): Promise<PollDetail> {
    const poll = await this.getInternal(societyId, id);
    if (poll.pollType === PollType.BULK_BUY_RESIDENT) {
      throw new BadRequestException('BULK_BUY_RESIDENT polls are owned by the bulk-buy module — use POST /bulk-buy/polls/:id/join instead of voting');
    }
    if (poll.status !== PollStatus.OPEN) {
      throw new BadRequestException('Poll is not open for voting');
    }

    const occupancy = await this.loadVoterOccupancy(societyId, callerId);
    if (!occupancy) {
      throw new ForbiddenException('Not a resident of this society');
    }
    const weight = this.eligibleVoterWeight(poll, occupancy);

    const voterHash = this.computeVoterHash(id, callerId);

    try {
      await this.prisma.vote.create({ data: { pollId: id, voterHash, choice: dto.choice, weight } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Already voted');
      }
      throw error;
    }

    return this.get(societyId, id, callerId);
  }

  /**
   * Records the caller's commitment (EVENT "join", or a future bulk-buy
   * commitment). Triggers the auto-fire check synchronously in the same
   * transaction that inserts the commitment, so firing is deterministic
   * and e2e-testable rather than depending on a background job.
   */
  async join(societyId: string, id: string, callerId: string): Promise<PollDetail> {
    const poll = await this.getInternal(societyId, id);
    if (poll.pollType === PollType.BULK_BUY_RESIDENT) {
      throw new BadRequestException('BULK_BUY_RESIDENT polls are owned by the bulk-buy module — use POST /bulk-buy/polls/:id/join instead');
    }
    if (!JOINABLE_TYPES.has(poll.pollType)) {
      throw new BadRequestException(`${poll.pollType} polls don't support joining — use vote instead`);
    }
    if (poll.status !== PollStatus.OPEN) {
      throw new BadRequestException('Poll is not open for joining');
    }

    const occupancy = await this.loadVoterOccupancy(societyId, callerId);
    if (!occupancy) {
      throw new ForbiddenException('Not a resident of this society');
    }

    await this.prisma.$transaction(async (tx) => {
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
          await this.notifyCommitted(tx, id, poll.title, 'fired');
        }
      }
    });

    return this.get(societyId, id, callerId);
  }

  /** Creator-only close-early. ADVISORY/BINDING resolve immediately by tally; EVENT/BULK_BUY_RESIDENT close (or are already FIRED). */
  async closeEarly(societyId: string, id: string, callerId: string): Promise<PollDetail> {
    const poll = await this.getInternal(societyId, id);
    if (poll.creatorId !== callerId) {
      throw new ForbiddenException('Only the poll creator can close it early');
    }
    if (poll.status !== PollStatus.OPEN) {
      throw new BadRequestException(`Poll is already ${poll.status}`);
    }

    if (poll.pollType === PollType.ADVISORY || poll.pollType === PollType.BINDING) {
      await this.resolveDecisivePoll(poll);
    } else {
      await this.prisma.poll.update({ where: { id }, data: { status: PollStatus.CLOSED, closedAt: this.clock.now() } });
    }

    return this.get(societyId, id, callerId);
  }

  /**
   * Resolves every OPEN poll in the society whose closesAt has passed:
   * ADVISORY/BINDING -> PASSED/FAILED by tally; EVENT/BULK_BUY_RESIDENT
   * with commitments still short of minCommitments -> EXPIRED (+ notify
   * committed residents). A poll that already auto-fired before expiring
   * is left FIRED, not touched here. This is the method a real scheduler
   * would call periodically; for now it's driven explicitly via
   * POST /polls/process-expired.
   */
  async processExpired(societyId: string): Promise<{ resolved: number }> {
    const now = this.clock.now();
    const expired = await this.prisma.poll.findMany({
      where: { societyId, status: PollStatus.OPEN, closesAt: { lte: now } },
    });

    for (const poll of expired) {
      if (poll.pollType === PollType.ADVISORY || poll.pollType === PollType.BINDING) {
        await this.resolveDecisivePoll(poll);
      } else {
        await this.prisma.$transaction(async (tx) => {
          await tx.poll.update({ where: { id: poll.id }, data: { status: PollStatus.EXPIRED, closedAt: this.clock.now() } });
          await this.notifyCommitted(tx, poll.id, poll.title, 'expired');
        });
      }
    }

    return { resolved: expired.length };
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private async resolveDecisivePoll(poll: PollModel): Promise<void> {
    const tally = await this.computeLiveTally(poll);
    const status = tally.passed ? PollStatus.PASSED : PollStatus.FAILED;
    const now = this.clock.now();
    await this.prisma.poll.update({ where: { id: poll.id }, data: { status, resolvedAt: now, closedAt: now } });
  }

  private async notifyCommitted(tx: Prisma.TransactionClient, pollId: string, title: string, kind: 'fired' | 'expired'): Promise<void> {
    const commitments = await tx.pollCommitment.findMany({ where: { pollId }, include: { resident: true } });
    for (const commitment of commitments) {
      if (kind === 'fired') {
        await this.notifications.sendPollFired(commitment.resident.email, title);
      } else {
        await this.notifications.sendPollExpired(commitment.resident.email, title);
      }
    }
  }

  private computeVoterHash(pollId: string, userId: string): string {
    return sha256(Buffer.from(`${pollId}:${userId}`)).toString('hex');
  }

  /** One active occupancy per user in v1 (see UserContextService) — loaded fresh here because it carries flat.ownershipShare, which CurrentUserContext doesn't. */
  private async loadVoterOccupancy(societyId: string, userId: string): Promise<VoterOccupancy | null> {
    return this.prisma.occupancy.findFirst({
      where: { userId, tenureEndedAt: null, flat: { societyId } },
      select: { role: true, flat: { select: { ownershipShare: true } } },
    });
  }

  /**
   * ADVISORY / EVENT / BULK_BUY_RESIDENT: every resident is eligible,
   * weight 1 regardless of weightMode. BINDING: only owners are eligible
   * (a TENANT is rejected with 403); weight is the flat's ownershipShare
   * under OWNERSHIP_WEIGHTED, else 1.
   */
  private eligibleVoterWeight(poll: PollModel, occupancy: VoterOccupancy): number {
    if (poll.pollType !== PollType.BINDING) {
      return 1;
    }
    if (!OWNER_ROLES.has(occupancy.role)) {
      throw new ForbiddenException('Tenants cannot vote on binding polls');
    }
    return poll.weightMode === PollWeightMode.OWNERSHIP_WEIGHTED ? Number(occupancy.flat.ownershipShare) : 1;
  }

  /**
   * Sum of weights of every resident *eligible* to vote on this poll
   * (whether or not they have), computed fresh from current occupancies —
   * used as the tally's quorum denominator.
   */
  private async computeTotalEligibleWeight(societyId: string, poll: PollModel): Promise<number> {
    if (poll.pollType === PollType.BINDING) {
      const owners = await this.prisma.occupancy.findMany({
        where: { tenureEndedAt: null, flat: { societyId }, role: { in: Array.from(OWNER_ROLES) } },
        select: { flat: { select: { ownershipShare: true } } },
      });
      if (poll.weightMode === PollWeightMode.OWNERSHIP_WEIGHTED) {
        return owners.reduce((total, o) => total + Number(o.flat.ownershipShare), 0);
      }
      return owners.length;
    }

    // ADVISORY / EVENT / BULK_BUY_RESIDENT: every resident, weight 1 each.
    return this.prisma.occupancy.count({ where: { tenureEndedAt: null, flat: { societyId } } });
  }

  private async computeLiveTally(poll: PollModel): Promise<TallyResult> {
    const [totalEligibleWeight, votes] = await Promise.all([
      this.computeTotalEligibleWeight(poll.societyId, poll),
      this.prisma.vote.findMany({ where: { pollId: poll.id }, select: { choice: true, weight: true } }),
    ]);

    return computeTally({
      totalEligibleWeight,
      votes: votes.map((v) => ({ choice: v.choice, weight: Number(v.weight) })),
      quorumPct: Number(poll.quorumPct),
      passingPct: Number(poll.passingPct),
    });
  }

  private async toDetail(poll: PollModel, callerId: string | null): Promise<PollDetail> {
    const [tally, commitmentCount, hasVoted, hasJoined] = await Promise.all([
      this.computeLiveTally(poll),
      this.prisma.pollCommitment.count({ where: { pollId: poll.id } }),
      callerId ? this.hasVoted(poll.id, callerId) : Promise.resolve(false),
      callerId ? this.prisma.pollCommitment.findUnique({ where: { pollId_residentId: { pollId: poll.id, residentId: callerId } } }).then(Boolean) : Promise.resolve(false),
    ]);

    return { ...poll, tally, commitmentCount, hasVoted, hasJoined };
  }

  private async hasVoted(pollId: string, callerId: string): Promise<boolean> {
    const voterHash = this.computeVoterHash(pollId, callerId);
    const vote = await this.prisma.vote.findUnique({ where: { pollId_voterHash: { pollId, voterHash } } });
    return vote !== null;
  }

  private async getInternal(societyId: string, id: string): Promise<PollModel> {
    const poll = await this.prisma.poll.findUnique({ where: { id } });
    if (!poll || poll.societyId !== societyId) {
      throw new NotFoundException('Poll not found');
    }
    return poll;
  }
}
