import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrincipalKind } from '../../../generated/prisma/enums.js';

const PROVISIONABLE_KINDS = [PrincipalKind.VENDOR, PrincipalKind.OPERATOR] as const;

/**
 * The admin surface Phase 6.2 explicitly deferred to 6.3 — see
 * OfficerAuthService's class doc comment. Creates the bare User row
 * (email + principalKind, no credentials) that OfficerAuthService's
 * enroll/login flow then turns into a real password+TOTP login. RESIDENT is
 * deliberately not accepted here — residents self-register via
 * POST /auth/signup, never provisioned by an operator.
 */
export class ProvisionAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  email!: string;

  @IsIn(PROVISIONABLE_KINDS)
  principalKind!: 'VENDOR' | 'OPERATOR';

  /** Required (and only meaningful) when principalKind is VENDOR — the existing Vendor row this login is for. */
  @IsOptional()
  @IsString()
  vendorId?: string;
}
