import type { PricingBasis, PricingCardStatus } from './types';
import { formatRupees } from './format';

/** Human labels + the per-unit suffix shown after a rate for each basis. */
export const BASIS_META: Record<PricingBasis, { label: string; suffix: string }> = {
  PER_VISIT: { label: 'Per visit', suffix: 'per visit' },
  PER_HOUR: { label: 'Per hour', suffix: 'per hour' },
  PER_UNIT: { label: 'Per unit', suffix: 'per unit' },
  PERCENTAGE: { label: 'Percentage', suffix: 'of materials' },
};

export const BASIS_OPTIONS: { value: PricingBasis; label: string }[] = (
  Object.keys(BASIS_META) as PricingBasis[]
).map((value) => ({ value, label: BASIS_META[value].label }));

export const STATUS_META: Record<
  PricingCardStatus,
  { label: string; tone: 'neutral' | 'success' | 'warning' }
> = {
  DRAFT: { label: 'Draft', tone: 'warning' },
  PUBLISHED: { label: 'Published', tone: 'success' },
};

/** Render a line's rate the way it reads on a bill: "₹1,200 per visit" or "18% of materials". */
export function formatRate(rate: string | number, basis: PricingBasis): string {
  if (basis === 'PERCENTAGE') {
    const pct = typeof rate === 'string' ? parseFloat(rate) : rate;
    return `${pct}% ${BASIS_META.PERCENTAGE.suffix}`;
  }
  return `${formatRupees(rate)} ${BASIS_META[basis].suffix}`;
}
