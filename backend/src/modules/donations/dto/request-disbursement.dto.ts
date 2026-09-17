import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

/** Body of POST /welfare-disbursements. `campaignId`, if given, must be an INTERNAL_WELFARE campaign (validated in-service). */
export class RequestDisbursementDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  payeeName!: string;

  @IsString()
  @MinLength(1)
  purpose!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  campaignId?: string;
}
