import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import type { JobCardModel } from '../../generated/prisma/models.js';
import { BulkBuyService } from './bulk-buy.service.js';

@Controller('job-cards')
export class JobCardsController {
  constructor(private readonly bulkBuy: BulkBuyService) {}

  @Post(':id/sign-off')
  @UseGuards(AuthGuard)
  @AuditLog('JOB_CARD_SIGN_OFF', 'JobCard')
  async signOff(@CurrentUser() currentUser: CurrentUserContext, @Param('id') id: string): Promise<JobCardModel> {
    return this.bulkBuy.signOffJobCard(currentUser.societyId, id, currentUser.id);
  }
}
