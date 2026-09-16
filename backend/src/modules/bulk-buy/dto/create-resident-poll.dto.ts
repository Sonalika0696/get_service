import { IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Body of POST /bulk-buy/polls — a resident opens a Flow B (resident-
 * initiated, tagged-vendor) bulk-buy poll. `taggedVendorId` must name a
 * Vendor that exists in the caller's own society (validated in the
 * service). `proposedMinimum` becomes the poll's Poll.minCommitments until
 * (and unless) the vendor confirms a different figure via
 * POST /bulk-buy/polls/:id/vendor-confirm.
 */
export class CreateResidentPollDto {
  @IsString()
  @MinLength(1)
  taggedVendorId!: string;

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

  @IsInt()
  @Min(2)
  proposedMinimum!: number;

  /** ISO-8601 timestamp; must be in the future (validated in the service, where "now" comes from Clock). */
  @IsISO8601()
  closesAt!: string;
}
