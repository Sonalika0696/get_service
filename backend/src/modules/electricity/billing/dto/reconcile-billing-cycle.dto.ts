import { IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Body of POST /billing-cycles/:id/reconcile — sets/updates the licensee
 * bulk-invoice figures a cycle reconciles Σ(flat bills) against
 * (BillingCycleService.reconcileInvoice). Callable any time before the
 * cycle's own reconcile stage has run (see BillingStage — a cycle only ever
 * moves forward, so once RECONCILED has been reached the stored `variance`
 * reflects whatever figures were on file at that moment).
 */
export class ReconcileBillingCycleDto {
  @IsNumber()
  @Min(0)
  bulkInvoiceAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bulkConsumption?: number;
}
