import { IsString, MinLength } from 'class-validator';

/**
 * Body of POST /service-requests/:id/assign — a COMMITTEE member assigns a
 * vendor to an OPEN/POOLED request. The vendor must already be linked to
 * this society (VendorSocietyLink) and hold a current PUBLISHED PricingCard
 * for the request's category — both checked server-side (400 otherwise),
 * not part of this body.
 */
export class AssignVendorDto {
  @IsString()
  @MinLength(1)
  vendorId!: string;
}
