import { IsISO8601, IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Body of `POST /pricing-cards` — creates the FIRST (version 1) draft for a
 * (vendor, category). Once a card of any status exists for that category,
 * further creation is rejected — see PricingCardsService.createDraft's doc
 * comment; a category with a live published card is revised via
 * `POST /pricing-cards/:id/revise`, not created again.
 */
export class CreatePricingCardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  /** Percentage, e.g. 18 for 18% GST. */
  @IsNumber()
  @Min(0)
  @Max(100)
  gstRatePct!: number;

  @IsISO8601()
  effectiveFrom!: string;
}
