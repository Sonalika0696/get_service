import { IsISO8601, IsNumber, Max, Min } from 'class-validator';

/**
 * Body of `POST /pricing-cards/:id/revise`. `:id` must be the vendor's own
 * CURRENT card for its category (status PUBLISHED, supersededAt null) —
 * see PricingCardsService.revise. category carries over from the card
 * being revised; gstRatePct/effectiveFrom are re-supplied because a
 * revision commonly exists BECAUSE the GST rate or effective date changed.
 */
export class RevisePricingCardDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  gstRatePct!: number;

  @IsISO8601()
  effectiveFrom!: string;
}
