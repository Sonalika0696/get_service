import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import type { ConsentGrantModel } from '../../generated/prisma/models.js';
import { CreateConsentDto } from './dto/create-consent.dto.js';
import { ConsentService } from './consent.service.js';

/**
 * Self-service consent (BACKEND_PLAN.md Phase 6.3 item 7) — mirrors
 * UsersController's `/me` mount. No `@AuditLog(...)` — ConsentService
 * writes its own (best-effort, awaited) entries; see its class doc comment.
 */
@Controller('me/consents')
@UseGuards(AuthGuard, PrincipalGuard)
@ResidentOnly()
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get()
  async list(@CurrentResident() currentUser: ResidentPrincipal): Promise<ConsentGrantModel[]> {
    return this.consentService.listGranted(currentUser.id);
  }

  @Post()
  async grant(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateConsentDto): Promise<ConsentGrantModel> {
    return this.consentService.grant(currentUser.id, currentUser.societyId, dto);
  }

  @Delete(':id')
  async revoke(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<ConsentGrantModel> {
    return this.consentService.revoke(currentUser.id, currentUser.societyId, id);
  }
}
