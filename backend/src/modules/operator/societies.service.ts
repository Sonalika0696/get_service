import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SocietyStatus } from '../../generated/prisma/enums.js';
import type { SocietyModel } from '../../generated/prisma/models.js';
import type { CreateSocietyDto } from './dto/create-society.dto.js';
import type { UpdateSocietyDto } from './dto/update-society.dto.js';

/**
 * Platform-operator society CRUD (BACKEND_PLAN.md Phase 6.3 item 1;
 * DECISIONS_V2_SCOPE.md §1.4). Lifecycle is ACTIVE/ARCHIVED, not a hard
 * delete — see SocietyStatus's schema doc comment.
 */
@Injectable()
export class SocietiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The one write in this whole phase that can't use
   * AuditLogInterceptor's `@AuditLog(...)` decorator: the audit chain is
   * per-society (AuditLog.societyId is NOT NULL), and before this call
   * succeeds there is no society yet to scope the entry to. Appends
   * best-effort, after the row exists, using its own new id. Every other
   * write below carries a `:sid` route param the interceptor resolves from
   * request.params instead — see AuditLogInterceptor.resolveSocietyId.
   */
  async create(operatorId: string, dto: CreateSocietyDto): Promise<SocietyModel> {
    const society = await this.prisma.society.create({
      data: { name: dto.name, address: dto.address, latitude: dto.latitude, longitude: dto.longitude },
    });

    await this.auditService.appendBestEffort({
      societyId: society.id,
      actorId: operatorId,
      action: 'SOCIETY_CREATE',
      subjectType: 'Society',
      subjectId: society.id,
      payload: { name: dto.name, address: dto.address },
    });

    return society;
  }

  async list(status?: SocietyStatus): Promise<SocietyModel[]> {
    return this.prisma.society.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string): Promise<SocietyModel> {
    return this.getInternal(id);
  }

  async update(id: string, actorId: string, dto: UpdateSocietyDto): Promise<SocietyModel> {
    await this.getInternal(id);
    const updated = await this.prisma.society.update({
      where: { id },
      data: {
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        ...(dto.config !== undefined ? { config: dto.config as never } : {}),
      },
    });
    await this.auditService.appendBestEffort({ societyId: id, actorId, action: 'SOCIETY_UPDATE', subjectType: 'Society', subjectId: id, payload: dto });
    return updated;
  }

  /** Excludes the society from the operator's default listing without deleting it or its history (flats/occupancies/ledger/audit chain all survive untouched). */
  async archive(id: string, actorId: string): Promise<SocietyModel> {
    const society = await this.getInternal(id);
    if (society.status === SocietyStatus.ARCHIVED) {
      throw new ConflictException('Society is already archived');
    }
    const updated = await this.prisma.society.update({ where: { id }, data: { status: SocietyStatus.ARCHIVED } });
    await this.auditService.appendBestEffort({ societyId: id, actorId, action: 'SOCIETY_ARCHIVE', subjectType: 'Society', subjectId: id, payload: {} });
    return updated;
  }

  async reactivate(id: string, actorId: string): Promise<SocietyModel> {
    const society = await this.getInternal(id);
    if (society.status === SocietyStatus.ACTIVE) {
      throw new ConflictException('Society is already active');
    }
    const updated = await this.prisma.society.update({ where: { id }, data: { status: SocietyStatus.ACTIVE } });
    await this.auditService.appendBestEffort({ societyId: id, actorId, action: 'SOCIETY_REACTIVATE', subjectType: 'Society', subjectId: id, payload: {} });
    return updated;
  }

  private async getInternal(id: string): Promise<SocietyModel> {
    const society = await this.prisma.society.findUnique({ where: { id } });
    if (!society) throw new NotFoundException('Society not found');
    return society;
  }
}
