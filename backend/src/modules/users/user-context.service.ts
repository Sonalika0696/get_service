import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { PrincipalKind, RatificationStatus } from '../../generated/prisma/enums.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';

/**
 * Resolves the full auth/authorization context for a user id, branching on
 * User.principalKind (Phase 6.2 — see BACKEND_PLAN.md Phase 6):
 *
 *   RESIDENT — via their active occupancy (one user, one society in v1).
 *     No active occupancy means no context at all (null), same as before
 *     6.2 — a resident who has moved out still can't authenticate.
 *   VENDOR   — via User.vendorId -> Vendor, and (Phase 7.1) that Vendor's
 *     linked societies via VendorSocietyLink -> `societyIds`. No
 *     linked/resolvable Vendor means no context; a vendor may resolve to
 *     zero societyIds (unlinked from every society) without that being an
 *     auth failure — see VendorPrincipal's doc comment.
 *   OPERATOR — platform-level, no society scope, always resolvable once the
 *     User row exists.
 *
 * Before 6.2 this unconditionally required an active Occupancy and returned
 * null otherwise, which AuthGuard turned into a 401 — so a vendor or
 * operator (who never has an Occupancy) could never authenticate at all.
 * That's the bug this rewrite fixes. Used by AuthGuard on every
 * authenticated request and by GET /me.
 */
@Injectable()
export class UserContextService {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string): Promise<CurrentUserContext | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    if (user.principalKind === PrincipalKind.OPERATOR) {
      return {
        principalKind: 'OPERATOR',
        id: user.id,
        name: user.name,
        email: user.email,
      };
    }

    if (user.principalKind === PrincipalKind.VENDOR) {
      if (!user.vendorId) return null;
      const vendor = await this.prisma.vendor.findUnique({ where: { id: user.vendorId } });
      if (!vendor) return null;
      const links = await this.prisma.vendorSocietyLink.findMany({ where: { vendorId: vendor.id }, select: { societyId: true } });
      return {
        principalKind: 'VENDOR',
        id: user.id,
        name: user.name,
        email: user.email,
        vendorId: vendor.id,
        societyIds: links.map((l) => l.societyId),
      };
    }

    // RESIDENT
    // Phase 6.3 ratification gate (DECISIONS_V2_SCOPE.md §7.3, SDD §5.3
    // phantom-resident threat): an occupancy that is still PENDING (every
    // self-registered signup() starts here) or was REJECTED does not count
    // as "active" for authentication purposes, even though tenureEndedAt is
    // null — this is the enforcement point. A resident stuck here gets the
    // exact same 401 ("No active society membership") an occupancy-less
    // resident always got; there is no separate "your account is pending"
    // response, matching how AuthGuard has never distinguished "no account"
    // from "no active occupancy".
    const occupancy = await this.prisma.occupancy.findFirst({
      where: { userId, tenureEndedAt: null, ratificationStatus: RatificationStatus.RATIFIED },
      orderBy: { createdAt: 'desc' },
      include: { flat: true },
    });
    if (!occupancy) return null;

    const roles = await this.prisma.role.findMany({ where: { userId, societyId: occupancy.flat.societyId } });

    return {
      principalKind: 'RESIDENT',
      id: user.id,
      name: user.name,
      email: user.email,
      societyId: occupancy.flat.societyId,
      occupancyRole: occupancy.role,
      roleKinds: roles.map((r) => r.kind),
    };
  }
}
