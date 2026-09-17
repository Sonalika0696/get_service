import { Type } from 'class-transformer';
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

  /**
   * Ordered telescoping slab array — see tariff-config.types.ts's Slab doc
   * comment. Element-level validation happens in the service via
   * parseTariffConfig. `@Type(() => Object)` is REQUIRED here, not
   * decorative: without it, NestJS's global ValidationPipe
   * (transform:true + transformOptions.enableImplicitConversion:true, see
   * validation.pipe.ts) reflects this property's design:type as the bare
   * `Array` constructor (TypeScript can't reflect `unknown[]`'s element
   * shape) and, with no `@Type()` telling class-transformer what each
   * element actually is, coerces every element via `Array.from(element)` —
   * which silently turns each `{upTo, rate}` slab object into `[]` (no
   * `length`/iterator on a plain object) before this DTO ever reaches
   * TariffScheduleService.create. `@Type(() => Object)` tells
   * class-transformer each element is a plain object, not something to be
   * array-coerced, and leaves its fields untouched for parseTariffConfig
   * to validate.
   */
  @IsArray()
  @Type(() => Object)
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
