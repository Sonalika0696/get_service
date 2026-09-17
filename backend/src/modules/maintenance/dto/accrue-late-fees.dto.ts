import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Body of POST /maintenance/accrue-late-fees. `asOf` is optional and almost
 * always omitted in production (defaults to Clock.now()) — it exists so a
 * test (or an operator backfilling a missed run) can accrue as of a
 * specific instant instead of waiting for real time to pass.
 */
export class AccrueLateFeesDto {
  @IsOptional()
  @IsISO8601()
  asOf?: string;
}
