import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsPositive, Min, ValidateNested } from 'class-validator';
import { DiscountLadderRungDto } from './create-offer.dto.js';

/**
 * Body of POST /bulk-buy/polls/:id/vendor-confirm — a COMMITTEE member,
 * acting for the tagged vendor (no vendor login in v1, same stance as
 * CreateOfferDto), confirms the terms Flow B fires under.
 * `confirmedMinimum` replaces the resident's proposedMinimum outright;
 * `discountLadder`, if present, is validated by the same
 * discount-ladder.util.ts.validateLadder Flow A's CreateOfferDto uses — a
 * poll with no ladder fires at appliedDiscountPct 0.
 */
export class VendorConfirmDto {
  @IsInt()
  @Min(1)
  confirmedMinimum!: number;

  /** Major units (rupees), pre-discount — matches Offer.unitPrice's convention. */
  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DiscountLadderRungDto)
  discountLadder?: DiscountLadderRungDto[];
}
