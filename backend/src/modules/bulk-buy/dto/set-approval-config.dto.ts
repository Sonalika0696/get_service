import { IsNumber, IsPositive, Max } from 'class-validator';

/**
 * Body of PUT /bulk-buy/approval-config (Phase 6.4, M14). Shape-only
 * validation here (all three fields positive numbers, majorityFraction
 * <= 1) — the cross-field rule (lowerThreshold < upperThreshold) lives in
 * BulkBuyService.setApprovalConfig via approval-ladder.util.ts's
 * validateApprovalConfig, the same split CreateOfferDto/discountLadder
 * already uses for its own cross-field ladder rule.
 */
export class SetApprovalConfigDto {
  /** Amounts at or below this need only 1 officer. */
  @IsNumber()
  @IsPositive()
  lowerThreshold!: number;

  /** Amounts at or below this (and above lowerThreshold) need 2 distinct officers. */
  @IsNumber()
  @IsPositive()
  upperThreshold!: number;

  /** Fraction (0, 1] of the committee roster required above upperThreshold. */
  @IsNumber()
  @IsPositive()
  @Max(1)
  majorityFraction!: number;
}
