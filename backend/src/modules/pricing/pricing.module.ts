import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PricingCardsController } from './pricing-cards.controller.js';
import { PricingCardsService } from './pricing-cards.service.js';

/** Phase 7.2 (BACKEND_PLAN.md Phase 7 items 2-5) — vendor pricing cards. */
@Module({
  imports: [AuditModule],
  controllers: [PricingCardsController],
  providers: [PricingCardsService],
})
export class PricingModule {}
