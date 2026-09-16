import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

/**
 * Password + mandatory TOTP 2FA — the credential path for committee
 * officers and vendors (SDD §5.1 / DECISIONS_V2_SCOPE.md §7.2), separate
 * from resident phone OTP. There is no self-serve signup here: the User row
 * (principalKind VENDOR/OPERATOR, email set) is provisioned directly —
 * society/vendor account-management CRUD is Phase 6.3's job — and these
 * three enroll/* calls turn that bare row into a usable login, reusing the
 * existing email-OTP machinery (OtpService) as the "prove you own this
 * inbox" step before a password/secret can be set.
 */
export class OfficerEnrollStartDto {
  @IsEmail()
  email!: string;
}

export class OfficerEnrollCompleteDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class OfficerEnrollVerifyTotpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class OfficerLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  /**
   * Optional at the DTO level (rather than required) so an absent code is a
   * clean, explicit "invalid or missing 2FA code" 401 from
   * OfficerAuthService — same rejection reason as a wrong code — instead of
   * a generic 400 from the validation pipe.
   */
  @IsOptional()
  @IsString()
  @Length(6, 6)
  totpCode?: string;
}
