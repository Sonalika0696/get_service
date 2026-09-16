import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { VerificationTier } from '../../generated/prisma/enums.js';
import type { VendorModel } from '../../generated/prisma/models.js';
import { canTransitionTier } from '../vendors/verification-tier.util.js';

/** Public-facing shape — deliberately excludes the settlement account trio, same reasoning as VendorsService.toDetail. */
export type OperatorVendorView = Omit<VendorModel, 'settlementAccountName' | 'settlementAccountNumber' | 'settlementIfsc'>;

function toOperatorView(vendor: VendorModel): OperatorVendorView {
  const { settlementAccountName: _settlementAccountName, settlementAccountNumber: _settlementAccountNumber, settlementIfsc: _settlementIfsc, ...rest } = vendor;
  return rest;
}

/**
 * Phase 7.3 (BACKEND_PLAN.md Phase 7 item 8): OPERATOR-only promotion of a
 * vendor's GLOBAL identity to PLATFORM_AUDITED — the top of
 * VerificationTier's forward-only ladder (see verification-tier.util.ts).
 *
 * Precondition beyond the tier order itself: a vendor must already be
 * SOCIETY_ATTESTED (canTransitionTier enforces the forward-only, no-skip
 * rule — UNVERIFIED can't jump straight to PLATFORM_AUDITED) AND must carry
 * a GSTIN or a trade licence number. In practice a SOCIETY_ATTESTED vendor
 * already has a GSTIN (VendorsService.approve only promotes there after an
 * Active GSTIN lookup) — this second check exists for the platform-audit
 * step to require its OWN independent evidence rather than silently riding
 * on the automatic society-level check that got the vendor to
 * SOCIETY_ATTESTED in the first place, and to guard the (test/ops) case
 * where a vendor's tier was set directly rather than through approve().
 *
 * Idempotent: calling this on an already-PLATFORM_AUDITED vendor returns it
 * unchanged (200, not an error) and does NOT write a second audit entry —
 * same "no-op on repeat" shape as PayoutAuthorisation/MilestoneAuthorisation's
 * upsert-based idempotency elsewhere in this codebase.
 */
@Injectable()
export class VendorPromotionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async promoteToPlatformAudited(vendorId: string, operatorId: string): Promise<OperatorVendorView> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (vendor.verificationTier === VerificationTier.PLATFORM_AUDITED) {
      return toOperatorView(vendor);
    }

    if (!canTransitionTier(vendor.verificationTier, VerificationTier.PLATFORM_AUDITED)) {
      throw new BadRequestException(
        `Vendor must be SOCIETY_ATTESTED before it can be promoted to PLATFORM_AUDITED (currently ${vendor.verificationTier})`,
      );
    }

    if (!vendor.gstin && !vendor.tradeLicenceNumber) {
      throw new BadRequestException('Vendor must have a GSTIN or a trade licence number on file before platform-audit promotion');
    }

    const updated = await this.prisma.vendor.update({
      where: { id: vendorId },
      data: { verificationTier: VerificationTier.PLATFORM_AUDITED },
    });

    const societyId = await this.resolveAuditSocietyId(vendorId);
    if (societyId) {
      await this.auditService.appendBestEffort({
        societyId,
        actorId: operatorId,
        action: 'VENDOR_PROMOTE_PLATFORM_AUDITED',
        subjectType: 'Vendor',
        subjectId: vendorId,
        payload: { from: vendor.verificationTier, to: VerificationTier.PLATFORM_AUDITED },
      });
    }

    return toOperatorView(updated);
  }

  /**
   * Same "vendor's oldest link" convention PricingCardsService uses for its
   * publish-audit entry — a global-identity action needs SOME per-society
   * audit chain to land on, and the vendor's original home society is a
   * stable, deterministic pick. A vendor with zero links skips the audit
   * write entirely (still succeeds — the tier update itself is not
   * society-scoped).
   */
  private async resolveAuditSocietyId(vendorId: string): Promise<string | null> {
    const link = await this.prisma.vendorSocietyLink.findFirst({
      where: { vendorId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return link?.societyId ?? null;
  }
}
