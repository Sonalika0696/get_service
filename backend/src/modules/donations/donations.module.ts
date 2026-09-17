import { Module, OnModuleInit } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AccountKind, DonationContributionStatus } from '../../generated/prisma/enums.js';
import { DonationCampaignsController } from './donation-campaigns.controller.js';
import { DonationCampaignsService } from './donation-campaigns.service.js';
import { WelfareDisbursementsController } from './welfare-disbursements.controller.js';
import { WelfareDisbursementsService } from './welfare-disbursements.service.js';

/** Phase 12 M10 — donations (campaigns + contributions) and welfare disbursements, sharing one module per the lane brief. */
@Module({
  imports: [LedgerModule, AuditModule, PaymentsModule],
  controllers: [DonationCampaignsController, WelfareDisbursementsController],
  providers: [DonationCampaignsService, WelfareDisbursementsService],
})
export class DonationsModule implements OnModuleInit {
  constructor(private readonly payments: PaymentsService) {}

  onModuleInit(): void {
    this.payments.registerLinkHandler('DonationContribution', {
      pocketKind: AccountKind.WELFARE,
      onCaptured: async (tx, contributionId) => {
        await tx.donationContribution.updateMany({
          where: { id: contributionId, status: DonationContributionStatus.PENDING },
          data: { status: DonationContributionStatus.RECEIVED },
        });
      },
      onRefunded: async (tx, contributionId) => {
        await tx.donationContribution.updateMany({
          where: { id: contributionId, status: { not: DonationContributionStatus.CANCELLED } },
          data: { status: DonationContributionStatus.CANCELLED },
        });
      },
    });
  }
}
