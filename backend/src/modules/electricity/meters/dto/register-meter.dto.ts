import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { MeterKind, Utility } from '../../../../generated/prisma/enums.js';

/**
 * Body of POST /meters (Phase 10 — meter registry).
 *
 * `flatId` is required exactly when `kind` is FLAT (a per-flat sub-meter)
 * and must be omitted for COMMON/BULK (society-level) meters —
 * class-validator's per-property decorators can't express that cross-field
 * rule, so MetersService.register enforces it explicitly.
 */
export class RegisterMeterDto {
  @IsEnum(Utility)
  utility!: Utility;

  @IsEnum(MeterKind)
  kind!: MeterKind;

  @IsString()
  @MinLength(1)
  serial!: string;

  /** Required for kind=FLAT; must be omitted for COMMON/BULK. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  flatId?: string;

  /** CT/multiplier applied to raw dial deltas. Defaults to 1 (schema default) when omitted. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  multiplier?: number;

  /** Config A only — the licensee consumer number for BBPS bill presentment. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  consumerNumber?: string;
}
