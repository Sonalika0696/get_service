import { IsEnum, IsNumber, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { AccountKind } from '../../../generated/prisma/enums.js';

/** Body of POST /ledger/adjustments — a treasury tool that also doubles as the vehicle proving unit-of-work + idempotency (see LedgerController). */
export class PostAdjustmentDto {
  @IsEnum(AccountKind)
  debitKind!: AccountKind;

  @IsEnum(AccountKind)
  creditKind!: AccountKind;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  reasonCode!: string;
}
