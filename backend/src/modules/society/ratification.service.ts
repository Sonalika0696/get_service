import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RatificationStatus } from '../../generated/prisma/enums.js';
import type { OccupancyModel } from '../../generated/prisma/models.js';
import type { DecideRatificationDto } from './dto/decide-ratification.dto.js';

/**
 * Committee ratification queue (BACKEND_PLAN.md Phase 6.3 item 5;
 * DECISIONS_V2_SCOPE.md §7.3, SDD §5.3 phantom-resident threat). Every
 * self-registered occupancy (AuthService.signup) starts PENDING; a resident
 * cannot authenticate at all until ratified — see
 * UserContextService.load()'s RESIDENT branch, which is the actual
 * enforcement point. This service only manages the queue's state
 * transitions; it does not itself gate anything.
 */
@Injectable()
export class RatificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly auditService: AuditService,
  ) {}

  async listPending(societyId: string): Promise<OccupancyModel[]> {
    return this.prisma.occupancy.findMany({
      where: { flat: { societyId }, ratificationStatus: RatificationStatus.PENDING },
      orderBy: { createdAt: 'asc' },
    });
  }

  async ratify(societyId: string, officerId: string, occupancyId: string, dto: DecideRatificationDto): Promise<OccupancyModel> {
    await this.getPendingOrThrow(societyId, occupancyId);

    const updated = await this.prisma.occupancy.update({
      where: { id: occupancyId },
      data: {
        ratificationStatus: RatificationStatus.RATIFIED,
        ratificationDecidedAt: this.clock.now(),
        ratifiedByUserId: officerId,
        ratificationNote: dto.note ?? null,
      },
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId: officerId,
      action: 'RESIDENT_RATIFY',
      subjectType: 'Occupancy',
      subjectId: occupancyId,
      payload: { userId: updated.userId, flatId: updated.flatId, note: dto.note ?? null },
    });

    return updated;
  }

  async reject(societyId: string, officerId: string, occupancyId: string, dto: DecideRatificationDto): Promise<OccupancyModel> {
    if (!dto.note || dto.note.trim().length === 0) {
      throw new BadRequestException('A note is required when rejecting an account');
    }

    await this.getPendingOrThrow(societyId, occupancyId);

    const updated = await this.prisma.occupancy.update({
      where: { id: occupancyId },
      data: {
        ratificationStatus: RatificationStatus.REJECTED,
        ratificationDecidedAt: this.clock.now(),
        ratifiedByUserId: officerId,
        ratificationNote: dto.note,
      },
    });

    await this.auditService.appendBestEffort({
      societyId,
      actorId: officerId,
      action: 'RESIDENT_REJECT',
      subjectType: 'Occupancy',
      subjectId: occupancyId,
      payload: { userId: updated.userId, flatId: updated.flatId, note: dto.note },
    });

    return updated;
  }

  private async getPendingOrThrow(societyId: string, occupancyId: string): Promise<OccupancyModel> {
    const occupancy = await this.prisma.occupancy.findUnique({ where: { id: occupancyId }, include: { flat: true } });
    if (!occupancy || occupancy.flat.societyId !== societyId) {
      throw new NotFoundException('Occupancy not found in this society');
    }
    if (occupancy.ratificationStatus !== RatificationStatus.PENDING) {
      throw new ConflictException(`Occupancy has already been decided (${occupancy.ratificationStatus})`);
    }
    return occupancy;
  }
}
