import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body of `POST /treasury/deposits/:id/withdraw`. */
export class WithdrawDepositDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
