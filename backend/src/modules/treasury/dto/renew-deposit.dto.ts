import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

/** Body of `POST /treasury/deposits/:id/renew` — both fields optional, defaulting to the society's TreasuryConfig (defaultTenorDays/defaultRatePct) when omitted. */
export class RenewDepositDto {
  @IsOptional()
  @IsInt()
  @Min(7)
  tenorDays?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  ratePct?: number;
}
