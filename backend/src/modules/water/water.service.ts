import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { WaterSourceModel } from '../../generated/prisma/models.js';
import type { RecordWaterSourceDto } from './dto/record-water-source.dto.js';
import type { ListWaterSourcesQuery } from './dto/list-water-sources.query.js';

/**
 * Phase 10 — the utility-config plane's water-source recording (the cost
 * pool a billing cycle blends into a per-kilolitre rate — see
 * schema.prisma's WaterSource doc comment). Pure config-plane writes: no
 * ledger posting, no billing-pipeline side effects — this module only
 * records what a society paid a source for what volume in a period.
 */
@Injectable()
export class WaterService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates one WaterSource row. `kilolitres`/`cost` are already
   * class-validator-checked as >= 0 on the DTO; re-checked here too (belt
   * and braces — a Decimal-typed persistence boundary is exactly the kind
   * of place a caller bypassing the DTO, e.g. a future internal job, could
   * slip a negative value through).
   */
  async recordSource(societyId: string, dto: RecordWaterSourceDto): Promise<WaterSourceModel> {
    if (typeof dto.kilolitres !== 'number' || dto.kilolitres < 0) {
      throw new BadRequestException('kilolitres must be a non-negative number');
    }
    if (typeof dto.cost !== 'number' || dto.cost < 0) {
      throw new BadRequestException('cost must be a non-negative number');
    }

    if (dto.billingCycleId) {
      const cycle = await this.prisma.billingCycle.findUnique({ where: { id: dto.billingCycleId } });
      if (!cycle || cycle.societyId !== societyId) {
        throw new NotFoundException('Billing cycle not found');
      }
    }

    return this.prisma.waterSource.create({
      data: {
        societyId,
        billingCycleId: dto.billingCycleId ?? null,
        kind: dto.kind,
        kilolitres: dto.kilolitres,
        cost: dto.cost,
        period: dto.period,
      },
    });
  }

  /** Ordered newest-first (by createdAt) — filterable by period and/or billingCycleId. */
  async list(societyId: string, params: ListWaterSourcesQuery): Promise<WaterSourceModel[]> {
    return this.prisma.waterSource.findMany({
      where: {
        societyId,
        ...(params.period ? { period: params.period } : {}),
        ...(params.billingCycleId ? { billingCycleId: params.billingCycleId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
