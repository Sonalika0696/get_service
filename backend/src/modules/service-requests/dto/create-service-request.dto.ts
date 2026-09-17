import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of POST /service-requests — a resident raises a Phase 8.2 pooling
 * service request for their OWN flat (resolved server-side from the
 * caller's active occupancy — never client-supplied, same stance as
 * BulkBuyService.commit's occupancy lookup). The per-category join
 * threshold is resolved and frozen server-side (see
 * service-request-threshold.util.ts) — not part of this body.
 */
export class CreateServiceRequestDto {
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

  /** ISO-8601 timestamp; must be in the future (validated in the service, where "now" comes from Clock). */
  @IsISO8601()
  closesAt!: string;
}
