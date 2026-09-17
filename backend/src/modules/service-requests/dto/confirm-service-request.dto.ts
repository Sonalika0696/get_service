import { IsNumber, IsPositive } from 'class-validator';

/**
 * Body of POST /service-requests/:id/confirm — a COMMITTEE member relays the
 * assigned vendor's confirmation (no vendor login on this path yet, same
 * stance as BulkBuyService's vendorConfirm/Flow B): an EXPLICIT per-flat
 * contribution figure the vendor quoted. This is never auto-summed from the
 * frozen PricingCard's lines — see ServiceRequestsService.confirm's doc
 * comment for why. Major units (rupees), matching Offer.unitPrice's
 * convention.
 */
export class ConfirmServiceRequestDto {
  @IsNumber()
  @IsPositive()
  contribution!: number;
}
