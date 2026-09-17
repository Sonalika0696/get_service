import { IsEnum, IsOptional } from 'class-validator';
import { BillingCycleStatus, Utility } from '../../../../generated/prisma/enums.js';

/** Query params for GET /billing-cycles — every field optional; filters combine with AND. */
export class ListBillingCyclesQuery {
  @IsOptional()
  @IsEnum(Utility)
  utility?: Utility;

  @IsOptional()
  @IsEnum(BillingCycleStatus)
  status?: BillingCycleStatus;
}
