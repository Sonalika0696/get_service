import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RatificationStatus } from '../../generated/prisma/enums.js';
import type { DelegationModel } from '../../generated/prisma/models.js';
import type { CreateDelegationDto } from './dto/create-delegation.dto.js';

/**
 * Delegation (BACKEND_PLAN.md Phase 6.3 item 6; DESIGN.md's entity table).
 * Self-service: the resident whose occupancy is delegating creates and
 * revokes their own grants — see DelegationController's `/me/delegations`
 * mount, mirroring UsersController's `/me`. See the DelegationScope enum's
 * schema doc comment for how financial/governance capability is excluded
 * AT THE TYPE LEVEL, and Occupancy.delegatedToUserId's doc comment for why
 * this supersedes rather than reads from that older, unstructured column.
 *
 * Audits manually (awaited, before returning), not via
 * AuditLogInterceptor's `@AuditLog(...)` decorator — see
 * SocietyRolesService's class doc comment for why an authority-adjacent
 * grant prefers the stronger (still non-throwing) timing guarantee over
 * the interceptor's default fire-and-forget-after-response write.
 */
@Injectable()
export class DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly auditService: AuditService,
  ) {}

  async grant(residentId: string, societyId: string, dto: CreateDelegationDto): Promise<DelegationModel> {
    const occupancy = await this.prisma.occupancy.findUnique({ where: { id: dto.occupancyId } });
    if (!occupancy || occupancy.userId !== residentId) {
      throw new NotFoundException('Occupancy not found, or does not belong to you');
    }
    if (occupancy.tenureEndedAt || occupancy.ratificationStatus !== RatificationStatus.RATIFIED) {
      throw new BadRequestException('Occupancy must be active and ratified to delegate from it');
    }
    if (dto.delegateUserId === residentId) {
      throw new BadRequestException('Cannot delegate to yourself');
    }

    const delegateIsMember = await this.prisma.occupancy.findFirst({
      where: { userId: dto.delegateUserId, tenureEndedAt: null, ratificationStatus: RatificationStatus.RATIFIED, flat: { societyId } },
    });
    if (!delegateIsMember) {
      throw new NotFoundException('Delegate must be an active, ratified resident of the same society');
    }

    const existing = await this.prisma.delegation.findUnique({
      where: { occupancyId_delegateUserId_scope: { occupancyId: dto.occupancyId, delegateUserId: dto.delegateUserId, scope: dto.scope } },
    });
    if (existing && !existing.revokedAt) {
      throw new ConflictException('This delegation already exists and is active');
    }

    const delegation = existing
      ? // A previously-revoked grant for this exact (occupancy, delegate,
        // scope) triple reactivates in place rather than violating the
        // unique constraint with a second row.
        await this.prisma.delegation.update({ where: { id: existing.id }, data: { revokedAt: null, grantedAt: this.clock.now() } })
      : await this.prisma.delegation.create({ data: { occupancyId: dto.occupancyId, delegateUserId: dto.delegateUserId, scope: dto.scope } });

    await this.auditService.appendBestEffort({
      societyId,
      actorId: residentId,
      action: 'DELEGATION_GRANT',
      subjectType: 'Delegation',
      subjectId: delegation.id,
      payload: { occupancyId: dto.occupancyId, delegateUserId: dto.delegateUserId, scope: dto.scope },
    });

    return delegation;
  }

  async revoke(residentId: string, societyId: string, delegationId: string): Promise<DelegationModel> {
    const delegation = await this.prisma.delegation.findUnique({ where: { id: delegationId }, include: { occupancy: true } });
    if (!delegation || delegation.occupancy.userId !== residentId) {
      throw new NotFoundException('Delegation not found, or does not belong to you');
    }
    if (delegation.revokedAt) {
      return delegation; // Idempotent — revoking twice is not an error.
    }
    const revoked = await this.prisma.delegation.update({ where: { id: delegationId }, data: { revokedAt: this.clock.now() } });

    await this.auditService.appendBestEffort({
      societyId,
      actorId: residentId,
      action: 'DELEGATION_REVOKE',
      subjectType: 'Delegation',
      subjectId: delegationId,
      payload: { occupancyId: delegation.occupancyId, delegateUserId: delegation.delegateUserId, scope: delegation.scope },
    });

    return revoked;
  }

  /** Delegations this resident has GIVEN (they are the occupant delegating rights away). */
  async listGranted(residentId: string): Promise<DelegationModel[]> {
    return this.prisma.delegation.findMany({ where: { occupancy: { userId: residentId } }, orderBy: { createdAt: 'desc' } });
  }

  /** Delegations this resident has RECEIVED (they are the delegate). */
  async listReceived(delegateUserId: string): Promise<DelegationModel[]> {
    return this.prisma.delegation.findMany({ where: { delegateUserId }, orderBy: { createdAt: 'desc' } });
  }
}
