import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { AccountKind } from '../../../generated/prisma/enums.js';

/**
 * Body of `POST /pocket-transfers`. `fromKind`/`toKind` are validated as
 * real `AccountKind` enum members here (shape only); PocketTransfersService.request
 * additionally rejects anything outside the seven Phase 9.1 pocket kinds
 * (MAINTENANCE/ELECTRICITY/WATER/EVENTS/WELFARE/SINKING/CORPUS) — see
 * POCKET_KINDS in that file. `amount` is major units (rupees), matching
 * every other money DTO in this codebase (CreateOfferDto.unitPrice, etc).
 */
export class RequestTransferDto {
  @IsEnum(AccountKind)
  fromKind!: AccountKind;

  @IsEnum(AccountKind)
  toKind!: AccountKind;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
