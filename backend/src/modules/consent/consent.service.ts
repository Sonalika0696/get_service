import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ConsentGrantModel } from '../../generated/prisma/models.js';
import type { CreateConsentDto } from './dto/create-consent.dto.js';

/**
 * ConsentGrant (BACKEND_PLAN.md Phase 6.3 item 7; DESIGN.md's entity
 * table). This service is the self-service grant/revoke surface only — the
 * part of the spec that matters most ("enforced AT QUERY TIME, not at
 * display time") lives in the QUERY that reads consented data, not here.
 * See VendorsService.getResidentContact for the reference implementation:
 * the consent check is embedded directly in that query's Prisma `where`
 * clause, so a caller lacking consent gets zero rows back, indistinguishable
 * from the resident not existing — never "fetch the resident, then decide
 * whether to include the phone/email fields".
 *
 * Audits manually (awaited, before returning), not via
 * AuditLogInterceptor's `@AuditLog(...)` decorator — see
 * SocietyRolesService's class doc comment for why. ConsentGrant itself
 * carries no societyId (consent is a relationship between two Users, not
 * scoped to a society the way Occupancy/Role are) — ConsentController
 * passes the grantor's own `societyId` (from their ResidentPrincipal) in
 * for the audit entry to scope to.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly auditService: AuditService,
  ) {}

  async grant(userId: string, societyId: string, dto: CreateConsentDto): Promise<ConsentGrantModel> {
    if (dto.granteeUserId === userId) {
      throw new BadRequestException('Cannot grant consent to yourself');
    }
    const grantee = await this.prisma.user.findUnique({ where: { id: dto.granteeUserId } });
    if (!grantee) {
      throw new NotFoundException('Grantee not found');
    }

    const existing = await this.prisma.consentGrant.findUnique({
      where: { userId_granteeUserId_purpose: { userId, granteeUserId: dto.granteeUserId, purpose: dto.purpose } },
    });
    if (existing && !existing.revokedAt) {
      throw new ConflictException('Consent already granted for this purpose');
    }

    const consent = existing
      ? // Revocation is immediate and re-granting is a fresh act of consent —
        // reactivate the existing row (same unique key) rather than insert a
        // second one.
        await this.prisma.consentGrant.update({ where: { id: existing.id }, data: { revokedAt: null, grantedAt: this.clock.now() } })
      : await this.prisma.consentGrant.create({ data: { userId, granteeUserId: dto.granteeUserId, purpose: dto.purpose } });

    await this.auditService.appendBestEffort({
      societyId,
      actorId: userId,
      action: 'CONSENT_GRANT',
      subjectType: 'ConsentGrant',
      subjectId: consent.id,
      payload: { granteeUserId: dto.granteeUserId, purpose: dto.purpose },
    });

    return consent;
  }

  async revoke(userId: string, societyId: string, consentId: string): Promise<ConsentGrantModel> {
    const consent = await this.prisma.consentGrant.findUnique({ where: { id: consentId } });
    if (!consent || consent.userId !== userId) {
      throw new NotFoundException('Consent grant not found');
    }
    if (consent.revokedAt) {
      return consent; // Idempotent.
    }
    // Revocation is IMMEDIATE (DESIGN.md): the very next query-time check
    // (e.g. GET /vendors/residents/:id/contact) sees revokedAt set and
    // denies — there is no propagation delay or cache to invalidate.
    const revoked = await this.prisma.consentGrant.update({ where: { id: consentId }, data: { revokedAt: this.clock.now() } });

    await this.auditService.appendBestEffort({
      societyId,
      actorId: userId,
      action: 'CONSENT_REVOKE',
      subjectType: 'ConsentGrant',
      subjectId: consentId,
      payload: { granteeUserId: consent.granteeUserId, purpose: consent.purpose },
    });

    return revoked;
  }

  async listGranted(userId: string): Promise<ConsentGrantModel[]> {
    return this.prisma.consentGrant.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }
}
