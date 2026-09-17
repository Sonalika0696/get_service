import { IsInt, IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Body of `PUT /treasury/config` — see treasury-config.util.ts's TreasuryConfig/validateTreasuryConfig for the authoritative bounds; this DTO only enforces shape, the service re-validates the assembled candidate. */
export class SetTreasuryConfigDto {
  @IsNumber()
  @Min(0)
  operatingFloatFloor!: number;

  @IsInt()
  @Min(7)
  minTenorDays!: number;

  @IsInt()
  @Min(7)
  defaultTenorDays!: number;

  @IsNumber()
  @Min(0)
  @Max(20)
  defaultRatePct!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  defaultBankName!: string;
}
