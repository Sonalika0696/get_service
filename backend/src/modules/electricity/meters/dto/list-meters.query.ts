import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { MeterKind, Utility } from '../../../../generated/prisma/enums.js';

/** Query params for GET /meters — every field optional; filters combine with AND. */
export class ListMetersQuery {
  @IsOptional()
  @IsEnum(Utility)
  utility?: Utility;

  @IsOptional()
  @IsEnum(MeterKind)
  kind?: MeterKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  flatId?: string;
}
