import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { OccupancyRole } from '../../../generated/prisma/enums.js';

const OCCUPANCY_ROLES = Object.values(OccupancyRole);

export class SignupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone?: string;

  @IsString()
  societyId!: string;

  @IsString()
  flatId!: string;

  @IsIn(OCCUPANCY_ROLES)
  role!: OccupancyRole;
}

export class RequestOtpDto {
  @IsEmail()
  email!: string;
}

export class VerifyOtpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
