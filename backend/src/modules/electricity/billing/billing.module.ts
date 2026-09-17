import { Module, type OnModuleInit } from '@nestjs/common';
import { LedgerModule } from '../../ledger/ledger.module.js';
import { AuditModule } from '../../audit/audit.module.js';
import { RealtimeModule } from '../../realtime/realtime.module.js';
import { PaymentsModule } from '../../payments/payments.module.js';
import { PaymentsService } from '../../payments/payments.service.js';
import { MetersModule } from '../meters/meters.module.js';
import { ReadingsModule } from '../readings/readings.module.js';
import { TariffModule } from '../tariff.module.js';
import { WaterModule } from '../../water/water.module.js';
import { BillingCycleController } from './billing-cycle.controller.js';
import { BillingCycleService } from './billing-cycle.service.js';
import { BillingQueue } from './billing.queue.js';

/**
 * Phase 10 CAPSTONE — wires the billing-cycle pipeline together and, on
 * module init, registers the 'FlatBill' payment-link handler with
 * PaymentsService (see PaymentLinkHandler's doc comment) exactly once —
 * mirroring how PaymentsService's own constructor registers 'MaintenanceCharge'.
 * A FlatBill-linked Payment capture now credits ELECTRICITY or WATER
 * (resolved per-payment from the FlatBill's own BillingCycle.utility) instead
 * of the default BULK_BUY escrow, and advances/reverts that FlatBill's
 * paidAmount/status atomically inside the SAME webhook transaction.
 *
 * LedgerModule/AuditModule/RealtimeModule/MetersModule/ReadingsModule/
 * TariffModule/WaterModule are imported for BillingCycleService's own direct
 * dependencies (audit + realtime pushes) and so Nest's DI graph resolves
 * every provider this module's controllers/services touch — even where
 * BillingCycleService talks to Meter/Reading/TariffSchedule/WaterSource rows
 * directly via PrismaService rather than through those modules' own
 * services (kept minimal: this lane only needed TariffScheduleService for
 * the currentFor() snapshot lookup at `open`).
 */
@Module({
  imports: [LedgerModule, AuditModule, RealtimeModule, PaymentsModule, MetersModule, ReadingsModule, TariffModule, WaterModule],
  controllers: [BillingCycleController],
  providers: [BillingCycleService, BillingQueue],
  exports: [BillingCycleService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly billingCycleService: BillingCycleService,
  ) {}

  onModuleInit(): void {
    this.paymentsService.registerLinkHandler('FlatBill', {
      pocketKind: (tx, flatBillId) => this.billingCycleService.resolvePocketForFlatBill(tx, flatBillId),
      onCaptured: (tx, flatBillId, amountRupees, payment) => this.billingCycleService.advanceFlatBill(tx, flatBillId, amountRupees, payment),
      onRefunded: (tx, flatBillId, amountRupees, payment) => this.billingCycleService.revertFlatBill(tx, flatBillId, amountRupees, payment),
    });
  }
}
