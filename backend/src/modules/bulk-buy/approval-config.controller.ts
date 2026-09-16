import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import { BulkBuyService } from './bulk-buy.service.js';
import type { ApprovalConfig } from './approval-ladder.util.js';
import { SetApprovalConfigDto } from './dto/set-approval-config.dto.js';

/**
 * Phase 6.4 (BACKEND_PLAN.md Phase 6.4 item 6) — per-society bulk-buy
 * approval-ladder thresholds, read/write. COMMITTEE/TREASURER-gated, not
 * DEPUTY_TREASURER and not operator-only — see
 * BulkBuyService.setApprovalConfig's doc comment for why. GET has no
 * `@Roles(...)` at all: any resident of the society can see the ladder
 * that governs its own bulk-buy payouts (transparency), only setting it is
 * gated.
 */
@Controller('bulk-buy/approval-config')
export class ApprovalConfigController {
  constructor(private readonly bulkBuy: BulkBuyService) {}

  @Get()
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async get(@CurrentResident() currentUser: ResidentPrincipal): Promise<ApprovalConfig> {
    return this.bulkBuy.getApprovalConfig(currentUser.societyId);
  }

  @Put()
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.COMMITTEE, RoleKind.TREASURER)
  @AuditLog('APPROVAL_CONFIG_SET', 'Society')
  async set(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: SetApprovalConfigDto): Promise<ApprovalConfig> {
    return this.bulkBuy.setApprovalConfig(currentUser.societyId, currentUser.id, dto);
  }
}
