import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { Clock } from '../../infra/clock/clock.service.js';
import { GstinApiService } from '../../infra/gstinapi/gstinapi.service.js';
import { VerificationTier } from '../../generated/prisma/enums.js';
import type { VendorModel } from '../../generated/prisma/models.js';
import { canTransitionTier } from './verification-tier.util.js';
import type { CreateVendorDto } from './dto/create-vendor.dto.js';
import type { RateVendorDto } from './dto/rate-vendor.dto.js';
import type { VendorAccessRequestDto } from './dto/vendor-access-request.dto.js';

/** API-facing shape: the vendor plus its onboarded category list. */
export type VendorDetail = VendorModel & { categories: string[] };

export interface ListVendorsFilter {
  category?: string;
  q?: string;
}

function toDetail(vendor: VendorModel & { categories: { category: string }[] }): VendorDetail {
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

  async create(societyId: string, dto: CreateVendorDto): Promise<VendorDetail> {
    const vendor = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vendor.create({
        data: {
          societyId,
          name: dto.name,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
          latitude: dto.latitude,
          longitude: dto.longitude,
          radiusKm: dto.radiusKm,
          gstin: dto.gstin,
        },
      });
      await tx.vendorCategory.createMany({
        data: [...new Set(dto.categories)].map((category) => ({ vendorId: created.id, category })),
      });
      return tx.vendor.findUniqueOrThrow({ where: { id: created.id }, include: { categories: true } });
    });
    return toDetail(vendor);
  }

  /** Directory for the caller's own society only — never another society's vendors. */
  async listForSociety(societyId: string, filter: ListVendorsFilter): Promise<VendorDetail[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: {
        societyId,
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
  async getResidentContact(vendorUserId: string, vendorSocietyId: string, residentId: string): Promise<{ id: string; name: string; phone: string | null; email: string }> {
    const resident = await this.prisma.user.findFirst({
      where: {
        id: residentId,
        occupancies: { some: { tenureEndedAt: null, ratificationStatus: 'RATIFIED', flat: { societyId: vendorSocietyId } } },
        consentsGranted: { some: { granteeUserId: vendorUserId, purpose: 'CONTACT_INFO', revokedAt: null } },
      },
      select: { id: true, name: true, phone: true, email: true },
    });
    if (!resident) {
      throw new NotFoundException('Resident not found, not in your society, or has not granted contact-info consent');
    }
    return resident;
  }

  private async getInternal(societyId: string, id: string): Promise<VendorModel & { categories: { category: string }[] }> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id }, include: { categories: true } });
    if (!vendor || vendor.societyId !== societyId) {
      throw new NotFoundException('Vendor not found');
    }
    return vendor;
  }
}
