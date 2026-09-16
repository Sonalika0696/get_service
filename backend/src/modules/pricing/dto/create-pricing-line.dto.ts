import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { PricingBasis } from '../../../generated/prisma/enums.js';

export class CreatePricingLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  @IsEnum(PricingBasis)
  basis!: PricingBasis;

  @IsNumber()
  @Min(0)
  rate!: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  minimum?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  conditions?: string;
}
