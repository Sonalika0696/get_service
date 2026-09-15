import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class DiscountLadderRungDto {
  @IsNumber()
  @Min(1)
  minN!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  pct!: number;
}

/**
 * Body of POST /offers. `vendorId` is accepted directly rather than derived
 * from an authenticated vendor session: v1 has no vendor login yet (see
 * bulk-buy.service.ts's doc comment), so a COMMITTEE member creates the
 * offer on the vendor's behalf. `minCommitments` is NOT a client input — it
 * is always derived server-side as discountLadder's lowest rung's minN (see
 * discount-ladder.util.ts's minCommitmentsOf).
 */
export class CreateOfferDto {
  @IsString()
  @MinLength(1)
  vendorId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Major units (rupees), pre-discount. */
  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DiscountLadderRungDto)
  discountLadder!: DiscountLadderRungDto[];

  /** ISO-8601 timestamp; must be in the future (validated in the service, where "now" comes from Clock). */
  @IsISO8601()
  deadline!: string;
}
