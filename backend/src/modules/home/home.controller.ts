import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { HomeService, type HomeAggregate } from './home.service.js';

/**
 * Phase 9.4 — mobile home-tab aggregate. Mirrors UsersController's
 * `@Controller('me')` + guard/decorator shape exactly (see that
 * controller's doc comment).
 */
@Controller('me')
@UseGuards(AuthGuard, PrincipalGuard)
@ResidentOnly()
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('home')
  async home(@CurrentResident() currentUser: ResidentPrincipal): Promise<HomeAggregate> {
    return this.homeService.aggregate(currentUser.id, currentUser.societyId);
  }
}
