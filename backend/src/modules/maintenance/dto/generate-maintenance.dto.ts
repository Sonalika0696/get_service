import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * Body of POST /maintenance/generate. `period` is validated shape-only here
 * (`YYYY-MM`); MaintenanceBillingService.generateForPeriod re-derives
 * everything else (dueDate) from it. `dueDay` is optional — omitted, the
 * due date falls back to the period's last calendar day plus the society's
 * configured late-fee grace period (see late-fee.util.ts).
 */
export class GenerateMaintenanceDto {
  /** Billing period, 'YYYY-MM'. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be in YYYY-MM format' })
  period!: string;

  /** Optional day-of-month (1-28, to stay valid across every month) the charge falls due on, within `period`'s own month. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dueDay?: number;
}
