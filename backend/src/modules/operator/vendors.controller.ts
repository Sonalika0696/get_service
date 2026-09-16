import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { OperatorOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import { VendorPromotionService, type OperatorVendorView } from './vendor-promotion.service.js';

/**
 * Phase 7.3 (BACKEND_PLAN.md Phase 7 item 8): the platform-operator side of
 * vendor verification — promoting a vendor's GLOBAL identity to
 * PLATFORM_AUDITED. OPERATOR-only at the class level, same pattern as
 * SocietiesController — a resident/vendor session never reaches a handler
 * here at all (403 from PrincipalGuard).
 */
@Controller('operator/vendors')
@UseGuards(AuthGuard, PrincipalGuard)
@OperatorOnly()
export class OperatorVendorsController {
  constructor(private readonly vendorPromotion: VendorPromotionService) {}

  @Post(':vendorId/promote')
  async promote(@CurrentUser() operator: CurrentUserContext, @Param('vendorId') vendorId: string): Promise<OperatorVendorView> {
    return this.vendorPromotion.promoteToPlatformAudited(vendorId, operator.id);
  }
}
