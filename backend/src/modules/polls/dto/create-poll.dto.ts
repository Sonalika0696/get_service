import { IsEnum, IsISO8601, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { ServiceRequestType } from '../../../generated/prisma/enums.js';

export class CreatePollDto {
  @IsEnum(ServiceRequestType)
  pollType!: ServiceRequestType;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  /** Required for EVENT polls. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  minCommitments?: number;

  /** ISO-8601 timestamp; must be in the future (validated in the service, where "now" comes from Clock). */
  @IsISO8601()
  closesAt!: string;
}
