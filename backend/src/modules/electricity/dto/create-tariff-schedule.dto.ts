import { IsArray, IsDateString, IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Utility } from '../../../generated/prisma/enums.js';

/**
 * Body of POST /tariffs. Shape-only validation here — `slabs` is checked
 * only for "is an array" (its element-level shape, ascending-band
 * invariants, etc. are enforced by `parseTariffConfig`, called from
 * TariffScheduleService.create, which THROWS on a malformed slab and is
 * converted to a 400 there — see tariff-config.parser.ts's doc comment for
 * why a malformed slab is rejected rather than defaulted). `fixedCharges`/
 * `dutyCess` are optional and independently defaulted to all-zero by the
 * same parser when absent or malformed, so only a loose "is an object"
 * check is needed here too.
 */
export class CreateTariffScheduleDto {
  @IsEnum(Utility)
  utility!: Utility;

  /** ISO date string; the tariff is "in force" from this date onward (see TariffScheduleService.currentFor). */
  @IsDateString()
  effectiveFrom!: string;

  /** Ordered telescoping slab array — see tariff-config.types.ts's Slab doc comment. Element-level validation happens in the service via parseTariffConfig. */
  @IsArray()
  slabs!: unknown[];

  /** Optional flat-charge group; missing/malformed defaults to all-zero (see tariff-config.parser.ts). */
  @IsOptional()
  @IsObject()
  fixedCharges?: Record<string, unknown>;

  /** Optional duty/cess group; missing/malformed defaults to all-zero (see tariff-config.parser.ts). */
  @IsOptional()
  @IsObject()
  dutyCess?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
