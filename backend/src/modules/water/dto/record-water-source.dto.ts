import { IsEnum, IsNumber, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';
import { WaterSourceKind } from '../../../generated/prisma/enums.js';

/**
 * Body of POST /water-sources. One source's contribution to a period's cost
 * pool — see schema.prisma's WaterSource doc comment (the blended
 * per-kilolitre rate = Σcost / Σkilolitres across a period's sources).
 * `billingCycleId` is optional: a source can be recorded ahead of the
 * billing cycle that will consume it (config-plane input, not a billing
 * pipeline write).
 */
export class RecordWaterSourceDto {
  @IsEnum(WaterSourceKind)
  kind!: WaterSourceKind;

  /** Volume supplied in the period, kilolitres. */
  @IsNumber()
  @Min(0)
  kilolitres!: number;

  /** Cost of this source's supply in the period. */
  @IsNumber()
  @Min(0)
  cost!: number;

  /** Billing period, 'YYYY-MM'. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be in YYYY-MM format' })
  period!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  billingCycleId?: string;
}
