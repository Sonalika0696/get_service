import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrincipalKind, RatificationStatus } from '../../generated/prisma/enums.js';
import type { OccupancyModel } from '../../generated/prisma/models.js';
import type { MoveInDto } from './dto/move-in.dto.js';

/** Distinct from every other pg_advisory_xact_lock namespace in this repo — see AuditService (42), IdempotencyService (51), BulkBuyService (52, 53). */
const OCCUPANCY_LOCK_NAMESPACE = 54;

/**
 * Committee/operator-initiated occupancy lifecycle (BACKEND_PLAN.md Phase
 * 6.3 item 4) — distinct from AuthService.signup's self-registration path.
 * A move-in created here is stamped RATIFIED immediately (see
 * RatificationStatus's schema doc comment): a trusted party creating the
 * row IS the vetting the ratification queue exists to provide for a public
 * self-registration; there is no phantom-resident threat when a committee
 * member or operator is the one typing the flat/role in.
 *
 * Enforces the v1 "one user, one active occupancy" assumption
 * (UserContextService's class doc comment) with a Postgres advisory lock
 * keyed on the target user, mirroring AuditService.append / BulkBuyService's
 * payout/poll-fire locks, rather than a DB constraint — Prisma's schema DSL
 * has no portable partial-unique-index syntax to express "unique userId
 * WHERE tenureEndedAt IS NULL" (see the Phase 6.3 report's design-decisions
 * section for the full write-up of why a raw-SQL partial index was rejected
 * in favour of this lock).
 */
@Injectable()
export class OccupancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly auditService: AuditService,
  ) {}

  async moveIn(societyId: string, actorId: string, dto: MoveInDto): Promise<OccupancyModel> {
    const flat = await this.prisma.flat.findUnique({ where: { id: dto.flatId } });
    if (!flat || flat.societyId !== societyId) {
      throw new NotFoundException('Flat not found in this society');
    }
    if (dto.userId && (dto.name || dto.email)) {
      throw new BadRequestException('Provide either userId, or name + email — not both');
    }
    if (!dto.userId && (!dto.name || !dto.email)) {
      throw new BadRequestException('Provide an existing userId, or name + email to create a new resident');
    }

    const now = this.clock.now();

    const occupancy = await this.prisma.$transaction(async (tx) => {
      let userId = dto.userId;

      if (userId) {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || user.principalKind !== PrincipalKind.RESIDENT) {
          throw new NotFoundException('Resident user not found');
        }
      } else {
        const existingByEmail = await tx.user.findUnique({ where: { email: dto.email } });
        if (existingByEmail) {
          throw new ConflictException('An account with this email already exists — pass its userId instead');
        }
        const created = await tx.user.create({
          data: { name: dto.name!, email: dto.email!, phone: dto.phone },
        });
        userId = created.id;
      }

      // Serializes concurrent move-ins for the SAME user so the
      // "one active occupancy" check just below can't race with another
      // transaction's identical check (classic check-then-act TOCTOU).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OCCUPANCY_LOCK_NAMESPACE}, hashtext(${userId}))`;

      const activeElsewhere = await tx.occupancy.findFirst({ where: { userId, tenureEndedAt: null } });
      if (activeElsewhere) {
        throw new ConflictException('This user already has an active occupancy — move them out first');
      }

      return tx.occupancy.create({
        data: {
          flatId: dto.flatId,
          userId,
          role: dto.role,
          ratificationStatus: RatificationStatus.RATIFIED,
          ratificationDecidedAt: now,
          ratifiedByUserId: actorId,
          ratificationNote: 'Committee/operator move-in — vetted at creation, no ratification queue.',
        },
      });
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'OCCUPANCY_MOVE_IN',
      subjectType: 'Occupancy',
      subjectId: occupancy.id,
      payload: { flatId: dto.flatId, userId: occupancy.userId, role: dto.role },
    });

    return occupancy;
  }

  async moveOut(societyId: string, actorId: string, occupancyId: string): Promise<OccupancyModel> {
    const occupancy = await this.prisma.occupancy.findUnique({ where: { id: occupancyId }, include: { flat: true } });
    if (!occupancy || occupancy.flat.societyId !== societyId) {
      throw new NotFoundException('Occupancy not found in this society');
    }
    if (occupancy.tenureEndedAt) {
      throw new ConflictException('Occupancy has already ended');
    }

    const now = this.clock.now();

    const ended = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.occupancy.update({
        where: { id: occupancyId },
        data: { tenureEndedAt: now },
      });

      // Delegated operational rights don't outlive the occupancy that
      // granted them — revoke every still-active Delegation tied to it in
      // the same transaction as the move-out.
      await tx.delegation.updateMany({
        where: { occupancyId, revokedAt: null },
        data: { revokedAt: now },
      });

      return updated;
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'OCCUPANCY_MOVE_OUT',
      subjectType: 'Occupancy',
      subjectId: occupancyId,
      payload: { userId: occupancy.userId, flatId: occupancy.flatId },
    });

    return ended;
  }

  async listForSociety(societyId: string): Promise<OccupancyModel[]> {
    return this.prisma.occupancy.findMany({
      where: { flat: { societyId } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
