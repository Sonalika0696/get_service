import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { PricingBasis } from '../../../generated/prisma/enums.js';

/** Every field optional — a PATCH edits only what's supplied. Draft-only, enforced in the service. */
export class UpdatePricingLineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsEnum(PricingBasis)
  basis?: PricingBasis;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  minimum?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  conditions?: string | null;
}
