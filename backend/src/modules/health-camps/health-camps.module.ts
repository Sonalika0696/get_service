import { Module, OnModuleInit } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AccountKind, CampRegistrationStatus } from '../../generated/prisma/enums.js';
import { HealthCampsController } from './health-camps.controller.js';
import { HealthCampsService } from './health-camps.service.js';

/**
 * Phase 12 M9 — health camps. Registration fees are "collected through the
 * same rail as events" (this lane's brief): the CampRegistration link
 * handler credits the EVENTS pocket, not a dedicated CAMPS pocket (there is
 * none in the Phase 11/12 schema freeze).
 */
@Module({
  imports: [PaymentsModule],
  controllers: [HealthCampsController],
  providers: [HealthCampsService],
})
export class HealthCampsModule implements OnModuleInit {
  constructor(private readonly payments: PaymentsService) {}

  onModuleInit(): void {
    this.payments.registerLinkHandler('CampRegistration', {
      pocketKind: AccountKind.EVENTS,
      onCaptured: async (tx, registrationId, amountRupees) => {
        await tx.campRegistration.updateMany({
          where: { id: registrationId, status: CampRegistrationStatus.REGISTERED },
          data: { paidAmount: { increment: amountRupees } },
        });
      },
      onRefunded: async (tx, registrationId) => {
        await tx.campRegistration.updateMany({
          where: { id: registrationId, status: { not: CampRegistrationStatus.CANCELLED } },
          data: { status: CampRegistrationStatus.CANCELLED },
        });
      },
    });
  }
}
