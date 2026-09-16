import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { JobCardTier } from '../../../generated/prisma/enums.js';

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
 * Phase 4D: one entry of a LARGE offer's milestone template. Shape-only
 * validation here (name non-empty, pct > 0) — the cross-field rule that
 * pcts sum to exactly 100 lives in milestone-template.util.ts's
 * validateMilestoneTemplate, called from BulkBuyService.createOffer, the
 * same split discountLadder/DiscountLadderRungDto already uses.
 */
export class MilestoneTemplateRungDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsNumber()
  @IsPositive()
  pct!: number;
}

/**
 * Body of POST /offers. `vendorId` is accepted directly rather than derived
 * from an authenticated vendor session: v1 has no vendor login yet (see
 * bulk-buy.service.ts's doc comment), so a COMMITTEE member creates the
 * offer on the vendor's behalf. `minCommitments` is NOT a client input — it
 * is always derived server-side as discountLadder's lowest rung's minN (see
 * discount-ladder.util.ts's minCommitmentsOf).
 *
 * Phase 4D: `tier` defaults to SMALL (Phase 4C's unchanged single-payout
 * flow). `milestoneTemplate`/`retentionPct`/`retentionDays` are LARGE-only —
 * BulkBuyService.createOffer rejects a LARGE offer missing
 * milestoneTemplate, and rejects a SMALL offer that sets any of the three
 * (see its doc comment).
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

  /** Defaults to SMALL (Phase 4C's flow) when omitted. */
  @IsOptional()
  @IsEnum(JobCardTier)
  tier?: JobCardTier;

  /** LARGE only — see class doc comment. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MilestoneTemplateRungDto)
  milestoneTemplate?: MilestoneTemplateRungDto[];

  /** LARGE only — see class doc comment. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  retentionPct?: number;

  /** LARGE only — see class doc comment. */
  @IsOptional()
  @IsInt()
  @Min(0)
  retentionDays?: number;
}
