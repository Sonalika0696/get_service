import { IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * Body of POST /meters/:id/readings — a single manual reading capture.
 * `capturedAt` defaults to now() when omitted (schema default); `value` is
 * the raw dial reading (non-negative — a genuine decrease is expressed via
 * `reverse`, never a negative capture).
 */
export class CaptureReadingDto {
  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsISO8601()
  capturedAt?: string;

  /** Optional link to the billing cycle this reading was captured for. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  billingCycleId?: string;
}
