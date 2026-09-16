import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OccupancyRole } from '../../../generated/prisma/enums.js';

const OCCUPANCY_ROLES = Object.values(OccupancyRole);

/**
 * Either `userId` (attach an existing resident) or `name` + `email` (create
 * one inline, mirroring SignupDto's shape) — never both, never neither;
 * checked in OccupancyService.moveIn (class-validator has no portable
 * "exactly one of" constraint, same stance as SignupDto's
 * email-xor-phone note elsewhere in this repo).
 */
export class MoveInDto {
  @IsString()
  flatId!: string;

  @IsIn(OCCUPANCY_ROLES)
  role!: OccupancyRole;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone?: string;
}
