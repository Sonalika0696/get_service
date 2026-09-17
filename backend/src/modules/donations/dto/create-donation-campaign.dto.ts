import { IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUrl, MinLength } from 'class-validator';
import { DonationMode } from '../../../generated/prisma/enums.js';

/**
 * Body of POST /donation-campaigns. `mode` determines which of the
 * recipient-org fields are legal — see DonationCampaignsService.create's
 * doc comment: INTERNAL_WELFARE rejects every `recipientOrg*` field;
 * EXTERNAL_PASS_THROUGH requires `recipientOrgName`.
 */
export class CreateDonationCampaignDto {
  @IsEnum(DonationMode)
  mode!: DonationMode;

  @IsString()
  @MinLength(1)
  title!: string;

  /** Bye-law purpose (INTERNAL) or the campaign's stated cause (EXTERNAL) — always required. */
  @IsString()
  @MinLength(1)
  purpose!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetAmount?: number;

  /** EXTERNAL only. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  recipientOrgName?: string;

  /** EXTERNAL only. */
  @IsOptional()
  @IsUrl()
  recipientOrgUrl?: string;

  /** EXTERNAL only — the recipient issues 80G certificates (the platform never does). */
  @IsOptional()
  @IsBoolean()
  recipientIssues80G?: boolean;

  @IsISO8601()
  opensAt!: string;

  @IsOptional()
  @IsISO8601()
  closesAt?: string;
}
