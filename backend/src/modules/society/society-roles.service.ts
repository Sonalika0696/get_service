import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RatificationStatus } from '../../generated/prisma/enums.js';
import type { RoleModel } from '../../generated/prisma/models.js';
import type { AssignRoleDto } from './dto/assign-role.dto.js';

/**
 * Committee/treasurer role assignment (BACKEND_PLAN.md Phase 6.3 item 8):
 * COMMITTEE, TREASURER, DEPUTY_TREASURER onto the existing `Role` model
 * (`@@unique([societyId, userId, kind])`, unchanged from Phase 0). Only a
 * user with an active, RATIFIED occupancy in this society is eligible —
 * granting a role to an outsider (or a still-pending/rejected signup) would
 * be a bigger hole than the ratification gate this same phase just closed.
 *
 * Audits manually (awaited, before returning) rather than via
 * AuditLogInterceptor's `@AuditLog(...)` decorator — that decorator writes
 * fire-and-forget, AFTER the response is already sent (see its class doc
 * comment), which is the right default for most routes but means a caller
 * that immediately re-queries the audit trail could race it. A role/
 * membership grant is authority-adjacent enough that this service prefers
 * the stronger (still best-effort/non-throwing) guarantee.
 */
@Injectable()
export class SocietyRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(societyId: string): Promise<RoleModel[]> {
    return this.prisma.role.findMany({ where: { societyId }, orderBy: { createdAt: 'desc' } });
  }

  async assign(societyId: string, actorId: string, dto: AssignRoleDto): Promise<RoleModel> {
    const isMember = await this.prisma.occupancy.findFirst({
      where: { userId: dto.userId, tenureEndedAt: null, ratificationStatus: RatificationStatus.RATIFIED, flat: { societyId } },
    });
    if (!isMember) {
      throw new NotFoundException('User is not an active, ratified resident of this society');
    }

    const existing = await this.prisma.role.findUnique({
      where: { societyId_userId_kind: { societyId, userId: dto.userId, kind: dto.kind } },
    });
    if (existing) {
      throw new ConflictException('This user already holds this role in this society');
    }

    const role = await this.prisma.role.create({ data: { societyId, userId: dto.userId, kind: dto.kind } });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'ROLE_GRANT',
      subjectType: 'Role',
      subjectId: role.id,
      payload: { userId: dto.userId, kind: dto.kind },
    });

    return role;
  }

  async revoke(societyId: string, actorId: string, roleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role || role.societyId !== societyId) {
      throw new NotFoundException('Role not found in this society');
    }
    await this.prisma.role.delete({ where: { id: roleId } });

    await this.auditService.appendBestEffort({
      societyId,
      actorId,
      action: 'ROLE_REVOKE',
      subjectType: 'Role',
      subjectId: roleId,
      payload: { userId: role.userId, kind: role.kind },
    });
  }
}
