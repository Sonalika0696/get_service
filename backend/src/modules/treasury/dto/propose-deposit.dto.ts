import { IsInt, IsNumber, IsPositive, IsString, Min, MaxLength, MinLength } from 'class-validator';

/** Body of `POST /treasury/deposits`. `principal` is major units (rupees); `tenorDays` is validated against the society's own `minTenorDays` in the service (a fixed DTO-level floor of 7 backstops it — schema/config-independent). */
export class ProposeDepositDto {
  @IsNumber()
  @IsPositive()
  principal!: number;

  @IsNumber()
  @Min(0)
  ratePct!: number;

  @IsInt()
  @Min(7)
  tenorDays!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  bankName!: string;
}
