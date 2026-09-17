import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

interface MeResponse {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  kycTier: string;
  societyId: string;
  occupancyRole: string;
  roleKinds: string[];
}

/**
 * Phase 6.2: resident-only (a vendor/operator now has a session too, via
 * AuthGuard, but this route's response shape is resident-specific —
 * societyId/occupancyRole/roleKinds — so it's guarded explicitly rather
 * than relying only on CurrentResident()'s runtime narrowing). Compare
 * VendorsController's `GET /vendors/me` and OperatorController's
 * `GET /operator/ping` for the other two principal kinds' identity echoes.
 */
@Controller('me')
@UseGuards(AuthGuard, PrincipalGuard)
@ResidentOnly()
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentResident() currentUser: ResidentPrincipal): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: currentUser.id } });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      kycTier: user.kycTier,
      societyId: currentUser.societyId,
      occupancyRole: currentUser.occupancyRole,
      roleKinds: currentUser.roleKinds,
    };
  }

  /**
   * Self-service profile edit. SECURITY: the phone number is a sign-in
   * credential (phone OTP), so it can NOT be changed here. Writing an
   * unverified number would let anyone holding a session re-point the
   * account's OTP delivery to a phone they control, and keep signing in
   * after that session is revoked; the old `phoneVerifiedAt` would also
   * stay set against a number that was never verified. A phone change must
   * verify the NEW number first (dedicated flow, not built yet). Sending
   * the current phone unchanged is accepted as a no-op, so clients that
   * resubmit the whole form keep working for name edits.
   */
  @Patch()
  @AuditLog('PROFILE_UPDATE', 'User')
  async updateProfile(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: UpdateProfileDto): Promise<MeResponse> {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: currentUser.id } });
    if (dto.phone !== undefined && dto.phone !== current.phone) {
      throw new BadRequestException('Your phone number is used to sign in, so changing it requires verifying the new number. That is not available yet. Nothing was changed.');
    }

    const user = await this.prisma.user.update({
      where: { id: currentUser.id },
      data: { name: dto.name },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      kycTier: user.kycTier,
      societyId: currentUser.societyId,
      occupancyRole: currentUser.occupancyRole,
      roleKinds: currentUser.roleKinds,
    };
  }
}
