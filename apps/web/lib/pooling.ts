import type { OfferStatus, PollStatus, DiscountRung } from './types';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const OFFER_STATUS_META: Record<OfferStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'info' },
  FIRED: { label: 'Fired', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

export const POLL_STATUS_META: Record<PollStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'info' },
  FIRED: { label: 'Fired', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  CANCELLED: { label: 'Declined', tone: 'danger' },
};

/** Human summary of a discount ladder, e.g. "5+ save 10%, 10+ save 15%". */
export function describeLadder(ladder: DiscountRung[] | null | undefined): string {
  if (!ladder || ladder.length === 0) return 'No volume discount';
  return [...ladder]
    .sort((a, b) => a.minN - b.minN)
    .map((r) => `${r.minN}+ save ${r.pct}%`)
    .join(', ');
}
