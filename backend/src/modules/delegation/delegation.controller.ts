import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import type { DelegationModel } from '../../generated/prisma/models.js';
import { CreateDelegationDto } from './dto/create-delegation.dto.js';
import { DelegationService } from './delegation.service.js';

/**
 * Self-service delegation (BACKEND_PLAN.md Phase 6.3 item 6) — mirrors
 * UsersController's `/me` mount. No `@AuditLog(...)` — DelegationService
 * writes its own (best-effort, awaited) entries; see its class doc comment.
 */
@Controller('me/delegations')
@UseGuards(AuthGuard, PrincipalGuard)
@ResidentOnly()
export class DelegationController {
  constructor(private readonly delegationService: DelegationService) {}

  @Get()
  async listGranted(@CurrentResident() currentUser: ResidentPrincipal): Promise<DelegationModel[]> {
    return this.delegationService.listGranted(currentUser.id);
  }

  @Get('received')
  async listReceived(@CurrentResident() currentUser: ResidentPrincipal): Promise<DelegationModel[]> {
    return this.delegationService.listReceived(currentUser.id);
  }

  @Post()
  async grant(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateDelegationDto): Promise<DelegationModel> {
    return this.delegationService.grant(currentUser.id, currentUser.societyId, dto);
  }

  @Delete(':id')
  async revoke(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<DelegationModel> {
    return this.delegationService.revoke(currentUser.id, currentUser.societyId, id);
  }
}
