import type { VerificationTier } from './types';

export const VENDOR_CATEGORY_PRESETS = [
  'Plumbing',
  'Electrical',
  'AC service',
  'Painting',
  'Deep cleaning',
  'Pest control',
  'Groceries',
  'Tanker supply',
  'AMC',
  'Carpentry',
];

export const TIER_META: Record<VerificationTier, { label: string; tone: 'neutral' | 'info' | 'success' }> = {
  UNVERIFIED: { label: 'Unverified', tone: 'neutral' },
  SOCIETY_ATTESTED: { label: 'Society attested', tone: 'info' },
  PLATFORM_AUDITED: { label: 'Platform audited', tone: 'success' },
};

export function ratingNumber(v: string | number): number {
  return typeof v === 'string' ? parseFloat(v) : v;
}
