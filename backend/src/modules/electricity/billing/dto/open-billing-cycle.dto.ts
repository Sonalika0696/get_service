import { IsEnum, IsNumber, IsOptional, Matches, Min } from 'class-validator';
import { Utility } from '../../../../generated/prisma/enums.js';

/**
 * Body of POST /billing-cycles (BillingCycleService.open). `bulkInvoiceAmount`/
 * `bulkConsumption` are optional at open time — a treasurer may not have the
 * licensee's bulk invoice yet when opening the cycle to start capturing
 * readings, and can supply/correct them later via POST
 * /billing-cycles/:id/reconcile (BillingCycleService.reconcileInvoice)
 * before the reconcile stage runs.
 */
export class OpenBillingCycleDto {
  @IsEnum(Utility)
  utility!: Utility;

  /** Billing period, 'YYYY-MM' — same format TariffScheduleService.currentFor and MaintenanceBillingService.generateForPeriod already use. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be in YYYY-MM format' })
  period!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bulkInvoiceAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bulkConsumption?: number;
}
