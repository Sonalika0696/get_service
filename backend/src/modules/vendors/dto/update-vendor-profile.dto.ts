import { IsEmail, IsLatitude, IsLongitude, IsNumber, IsOptional, IsPositive, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Phase 7.3 (BACKEND_PLAN.md Phase 7 items 6-7): vendor profile
 * self-service — every field is optional (PATCH semantics: only fields the
 * caller sends are updated) and every field here belongs to the CALLING
 * vendor's own Vendor row (see VendorsController.updateMyProfile — the
 * vendorId comes from the authenticated VendorPrincipal, never from the
 * request body or a route param, so a vendor cannot even address another
 * vendor's row with this DTO).
 */
export class UpdateVendorProfileDto {
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  /** Service radius in km — matches Vendor.radiusKm's `@db.Decimal(6, 2)`. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  radiusKm?: number;

  /**
   * Self-declared trade licence number, captured alongside the existing
   * GSTIN (BACKEND_PLAN.md Phase 7 item 7). Mirrors gstin: captured here,
   * verified (tradeLicenceVerifiedAt) only through a manual/stubbed path —
   * no registry integration in this phase.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  tradeLicenceNumber?: string;

  /**
   * Settlement account — the vendor's OWN payout destination, self-declared
   * via this authenticated route (BACKEND_PLAN.md Phase 7 item 6). This is
   * metadata for a still-stubbed future RazorpayX payout, not a credential:
   * nothing here is verified or used to move money in this phase. See
   * Vendor.settlementAccountNumber's schema doc comment for why it's never
   * logged and never exposed through the resident/committee-facing
   * VendorDetail shape.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  settlementAccountName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{6,20}$/, { message: 'settlementAccountNumber must be 6-20 digits' })
  settlementAccountNumber?: string;

  /** Standard Indian IFSC shape: 4 letters, a literal 0, then 6 alphanumerics. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'settlementIfsc must be a valid IFSC code (e.g. HDFC0001234)' })
  settlementIfsc?: string;
}
