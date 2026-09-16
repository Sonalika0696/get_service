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

/**
 * Phase 6.2: either `email` or `phone` identifies the account — never both,
 * never neither (enforced in AuthService.resolveResidentCredentialUser, not
 * here — class-validator has no portable "exactly one of" constraint, same
 * stance as Commitment.offerId/pollId's application-level XOR). Existing
 * email-only callers are unaffected; phone is the new path
 * (DECISIONS_V2_SCOPE.md §7.1).
 */
export class RequestOtpDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone?: string;
}

export class VerifyOtpDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  phone?: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
