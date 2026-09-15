import { IsEnum, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PollType, PollWeightMode } from '../../../generated/prisma/enums.js';

export class CreatePollDto {
  @IsEnum(PollType)
  pollType!: PollType;

  /** Ignored for ADVISORY/EVENT/BULK_BUY_RESIDENT — only consulted for BINDING. */
  @IsOptional()
  @IsEnum(PollWeightMode)
  weightMode?: PollWeightMode;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  quorumPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  passingPct?: number;

  /** Required for EVENT/BULK_BUY_RESIDENT polls; ignored for ADVISORY/BINDING. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  minCommitments?: number;

  /** ISO-8601 timestamp; must be in the future (validated in the service, where "now" comes from Clock). */
  @IsISO8601()
  closesAt!: string;
}
