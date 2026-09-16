/**
 * Vendor categories the resident app filters by. Kept as string literals to
 * match the backend's free-string `VendorCategory.category` column; when the
 * backend introduces an enum, this switches to importing it from the
 * generated client.
 */
export const VENDOR_CATEGORIES = [
  'Plumbing',
  'Electrical',
  'Carpentry',
  'AC repair',
  'Pest control',
  'Cleaning',
  'Painting',
  'Gardening',
] as const;

export type VendorCategory = typeof VENDOR_CATEGORIES[number];
