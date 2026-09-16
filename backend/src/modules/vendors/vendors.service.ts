import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { GstinApiService } from '../../infra/gstinapi/gstinapi.service.js';
import { VerificationTier } from '../../generated/prisma/enums.js';
import type { VendorModel } from '../../generated/prisma/models.js';
import { canTransitionTier } from './verification-tier.util.js';
import type { CreateVendorDto } from './dto/create-vendor.dto.js';
import type { RateVendorDto } from './dto/rate-vendor.dto.js';
import type { VendorAccessRequestDto } from './dto/vendor-access-request.dto.js';
import type { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto.js';

/**
 * API-facing shape: the vendor plus its onboarded category list — but with
 * the settlement-account trio (Vendor.settlementAccountName/Number/Ifsc)
 * deliberately stripped out. This is what residents, committees and the
 * public pricing-card reader ever see of a vendor (BACKEND_PLAN.md Phase 7
 * item 6): the vendor's payout destination is banking metadata for a future
 * settlement, not directory content, and must never leak to anyone but the
 * vendor itself. See VendorProfileDetail for the vendor's own, fuller view.
 */
export type VendorDetail = Omit<VendorModel, 'settlementAccountName' | 'settlementAccountNumber' | 'settlementIfsc'> & { categories: string[] };

/** The vendor's OWN view of its profile (GET/PATCH /vendors/me/profile) — includes the settlement account fields VendorDetail strips out. */
export type VendorProfileDetail = VendorModel & { categories: string[] };

export interface ListVendorsFilter {
  category?: string;
  q?: string;
}

/** Public/committee/resident-facing projection — never includes the settlement account trio. */
function toDetail(vendor: VendorModel & { categories: { category: string }[] }): VendorDetail {
  const { categories, settlementAccountName: _settlementAccountName, settlementAccountNumber: _settlementAccountNumber, settlementIfsc: _settlementIfsc, ...rest } = vendor;
  return { ...rest, categories: categories.map((c) => c.category) };
}

/** The vendor's own full profile projection — the only place settlementAccountNumber is ever returned. */
function toProfileDetail(vendor: VendorModel & { categories: { category: string }[] }): VendorProfileDetail {
  const { categories, ...rest } = vendor;
  return { ...rest, categories: categories.map((c) => c.category) };
}

/** Averages are stored to 2 decimal places, matching the ratingAvg column's @db.Decimal(3, 2). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly gstinApi: GstinApiService,
  ) {}

  /**
   * Onboarding a vendor also creates its first VendorSocietyLink (Phase
   * 7.1) — a vendor onboarded by society A's committee starts out linked
   * to exactly society A, same as the pre-split behaviour where Vendor
   * carried societyId directly. Multi-society linking (a vendor being
   * added to a SECOND society) is 7.2/7.3 territory — not built here.
   */
  async create(societyId: string, dto: CreateVendorDto): Promise<VendorDetail> {
    const vendor = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vendor.create({
        data: {
          name: dto.name,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
          latitude: dto.latitude,
          longitude: dto.longitude,
          radiusKm: dto.radiusKm,
          gstin: dto.gstin,
        },
      });
      await tx.vendorSocietyLink.create({ data: { vendorId: created.id, societyId } });
      await tx.vendorCategory.createMany({
        data: [...new Set(dto.categories)].map((category) => ({ vendorId: created.id, category })),
      });
      return tx.vendor.findUniqueOrThrow({ where: { id: created.id }, include: { categories: true } });
    });
    return toDetail(vendor);
  }

  /** Directory for the caller's own society only — never another society's vendors. Phase 7.1: scoped via VendorSocietyLink, not Vendor.societyId. */
  async listForSociety(societyId: string, filter: ListVendorsFilter): Promise<VendorDetail[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: {
        societyLinks: { some: { societyId } },
        ...(filter.category ? { categories: { some: { category: { equals: filter.category, mode: 'insensitive' } } } } : {}),
        ...(filter.q ? { name: { contains: filter.q, mode: 'insensitive' } } : {}),
      },
      include: { categories: true },
      orderBy: { createdAt: 'desc' },
    });
    return vendors.map(toDetail);
  }

  async get(societyId: string, id: string): Promise<VendorDetail> {
    return toDetail(await this.getInternal(societyId, id));
  }

  /**
   * Committee approval step. If the vendor has a GSTIN, checks it against
   * GstinApiService; an Active result promotes UNVERIFIED -> SOCIETY_ATTESTED
   * and stamps gstinVerifiedAt. Any other outcome (no GSTIN, Inactive,
   * Unknown, lookup failure, or a vendor that's already past UNVERIFIED)
   * leaves the tier unchanged — the vendor + an explanatory note are
   * returned either way, never an error.
   */
  async approve(societyId: string, id: string): Promise<VendorDetail & { note: string }> {
    const vendor = await this.getInternal(societyId, id);

    if (!vendor.gstin) {
      return { ...toDetail(vendor), note: 'No GSTIN on file — tier unchanged.' };
    }

    if (!canTransitionTier(vendor.verificationTier, VerificationTier.SOCIETY_ATTESTED)) {
      return { ...toDetail(vendor), note: `Vendor is already at or beyond SOCIETY_ATTESTED (${vendor.verificationTier}) — tier unchanged.` };
    }

    const lookup = await this.gstinApi.lookup(vendor.gstin);
    if (lookup.status !== 'Active') {
      return { ...toDetail(vendor), note: `GSTIN lookup returned ${lookup.status} — tier unchanged.` };
    }

    const updated = await this.prisma.vendor.update({
      where: { id },
      data: { verificationTier: VerificationTier.SOCIETY_ATTESTED, gstinVerifiedAt: this.clock.now() },
      include: { categories: true },
    });
    return { ...toDetail(updated), note: 'GSTIN active — promoted to SOCIETY_ATTESTED.' };
  }

  /**
   * Not yet gated on a completed job: a later phase (job-card lifecycle)
   * will restrict this to residents whose job card with this vendor was
   * signed off. For now any resident in the vendor's society can rate.
   * Recomputes the vendor's ratingAvg/ratingCount lazily in the same tx —
   * cheap at this scale, and avoids a stale aggregate ever being served.
   */
  async rate(societyId: string, id: string, residentId: string, dto: RateVendorDto): Promise<VendorDetail> {
    await this.getInternal(societyId, id);

    const vendor = await this.prisma.$transaction(async (tx) => {
      await tx.vendorRating.create({
        data: { vendorId: id, residentId, rating: dto.rating, comment: dto.comment },
      });

      const aggregate = await tx.vendorRating.aggregate({
        where: { vendorId: id },
        _avg: { rating: true },
        _count: true,
      });

      return tx.vendor.update({
        where: { id },
        data: { ratingAvg: round2(aggregate._avg.rating ?? 0), ratingCount: aggregate._count },
        include: { categories: true },
      });
    });

    return toDetail(vendor);
  }

  async createAccessRequest(societyId: string, id: string, residentId: string, dto: VendorAccessRequestDto) {
    await this.getInternal(societyId, id);
    return this.prisma.vendorAccessRequest.create({
      data: { vendorId: id, residentId, purpose: dto.purpose },
    });
  }

  /**
   * ConsentGrant enforced AT QUERY TIME (BACKEND_PLAN.md Phase 6.3 item 7;
   * DESIGN.md's entity table) — the reference implementation the schema's
   * ConsentGrant doc comment points to. The consent check is embedded
   * directly in this query's `where` clause (a relational `some` filter on
   * User.consentsGranted), so a vendor lacking consent gets a query that
   * matches zero rows, NotFoundException, exactly the same response as the
   * resident not existing at all. This is deliberately NOT "fetch the
   * resident, then look at their consent grants, then decide whether to
   * include phone/email in the response" — that shape is a display-time
   * filter, which is what this phase's brief rules out.
   */
  /**
   * Phase 7.1: a vendor can now be linked to several societies, so the
   * caller must name WHICH one this lookup is scoped to (`societyId`) —
   * validated as an actual VendorSocietyLink for this vendor before the
   * consent + membership check below ever runs (a vendor can't probe a
   * society it has no relationship with by just changing the query param).
   */
  async getResidentContact(vendorUserId: string, vendorId: string, societyId: string | undefined, residentId: string): Promise<{ id: string; name: string; phone: string | null; email: string }> {
    if (!societyId) {
      throw new BadRequestException('societyId query param is required');
    }
    const link = await this.prisma.vendorSocietyLink.findUnique({ where: { vendorId_societyId: { vendorId, societyId } } });
    if (!link) {
      throw new ForbiddenException('Vendor is not linked to this society');
    }

    const resident = await this.prisma.user.findFirst({
      where: {
        id: residentId,
        occupancies: { some: { tenureEndedAt: null, ratificationStatus: 'RATIFIED', flat: { societyId } } },
        consentsGranted: { some: { granteeUserId: vendorUserId, purpose: 'CONTACT_INFO', revokedAt: null } },
      },
      select: { id: true, name: true, phone: true, email: true },
    });
    if (!resident) {
      throw new NotFoundException('Resident not found, not in your society, or has not granted contact-info consent');
    }
    return resident;
  }

  /**
   * Phase 7.3 (BACKEND_PLAN.md Phase 7 item 6): the vendor's own profile —
   * the ONLY read path that returns the settlement account trio. `vendorId`
   * always comes from the caller's own VendorPrincipal (never a route
   * param), so there is no way to address another vendor's row through this
   * method at all.
   */
  async getOwnProfile(vendorId: string): Promise<VendorProfileDetail> {
    return toProfileDetail(await this.getOwnVendorInternal(vendorId));
  }

  /**
   * Vendor self-service profile update (BACKEND_PLAN.md Phase 7 items 6-7):
   * contact/geo/radius, the settlement account destination, and the trade
   * licence number. PATCH semantics — only fields present in `dto` are
   * touched. Never logs `dto` (which may carry settlementAccountNumber):
   * pino's request logging doesn't capture the body either (see
   * app.module.ts's pinoHttp config), so the only way that value could ever
   * reach a log is a future change adding one — don't.
   */
  async updateOwnProfile(vendorId: string, dto: UpdateVendorProfileDto): Promise<VendorProfileDetail> {
    await this.getOwnVendorInternal(vendorId);
    const updated = await this.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
        ...(dto.radiusKm !== undefined ? { radiusKm: dto.radiusKm } : {}),
        ...(dto.tradeLicenceNumber !== undefined ? { tradeLicenceNumber: dto.tradeLicenceNumber } : {}),
        ...(dto.settlementAccountName !== undefined ? { settlementAccountName: dto.settlementAccountName } : {}),
        ...(dto.settlementAccountNumber !== undefined ? { settlementAccountNumber: dto.settlementAccountNumber } : {}),
        ...(dto.settlementIfsc !== undefined ? { settlementIfsc: dto.settlementIfsc } : {}),
      },
      include: { categories: true },
    });
    return toProfileDetail(updated);
  }

  /**
   * Adds a category to the caller's OWN vendor (BACKEND_PLAN.md Phase 7
   * item 6). Idempotent via upsert — VendorCategory's
   * `@@unique([vendorId, category])` means re-adding an existing category
   * is a no-op, not a 400/409, matching how self-service toggles elsewhere
   * in this phase (e.g. Milestone/PayoutAuthorisation's upsert-based no-op)
   * behave.
   */
  async addOwnCategory(vendorId: string, category: string): Promise<VendorDetail> {
    await this.getOwnVendorInternal(vendorId);
    await this.prisma.vendorCategory.upsert({
      where: { vendorId_category: { vendorId, category } },
      create: { vendorId, category },
      update: {},
    });
    return toDetail(await this.getOwnVendorInternal(vendorId));
  }

  /** Removes a category from the caller's OWN vendor. Idempotent — removing a category that isn't there deletes zero rows rather than 404ing. */
  async removeOwnCategory(vendorId: string, category: string): Promise<VendorDetail> {
    await this.getOwnVendorInternal(vendorId);
    await this.prisma.vendorCategory.deleteMany({ where: { vendorId, category } });
    return toDetail(await this.getOwnVendorInternal(vendorId));
  }

  /** Loads the caller's own vendor by id (no society scoping — a VENDOR principal's self-service surface isn't society-scoped at all). 404s if the vendorId on the session somehow doesn't resolve (should never happen for a real session). */
  private async getOwnVendorInternal(vendorId: string): Promise<VendorModel & { categories: { category: string }[] }> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, include: { categories: true } });
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }
    return vendor;
  }

  /** Phase 7.1: "does this vendor belong to this society" is now a VendorSocietyLink lookup, not a Vendor.societyId comparison. */
  private async getInternal(societyId: string, id: string): Promise<VendorModel & { categories: { category: string }[] }> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id }, include: { categories: true } });
    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }
    const link = await this.prisma.vendorSocietyLink.findUnique({ where: { vendorId_societyId: { vendorId: id, societyId } } });
    if (!link) {
      throw new NotFoundException('Vendor not found');
    }
    return vendor;
  }
}
