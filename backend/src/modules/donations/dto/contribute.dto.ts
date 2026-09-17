import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

/**
 * Body of POST /donation-campaigns/:id/contributions. `externalReference` is
 * REQUIRED for an EXTERNAL_PASS_THROUGH campaign (the receipt/reference the
 * resident got from the organisation) and REJECTED for INTERNAL_WELFARE
 * (which is validated in-service, since the legal rule differs per
 * campaign — a class-validator decorator alone can't see the campaign).
 */
export class ContributeDto {
  /** Major units (rupees), INR only — no currency field is accepted (FCRA). */
  @IsNumber()
  @IsPositive()
  amount!: number;

  /** Hides the contributor from OTHER residents only — the audit chain always records them. */
  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  externalReference?: string;
}
