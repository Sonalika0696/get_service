import { IsString, MaxLength, MinLength } from 'class-validator';

/** Phase 7.3: a vendor adds one category to its own directory listing (VendorCategory's `@@unique([vendorId, category])`). */
export class AddVendorCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;
}
