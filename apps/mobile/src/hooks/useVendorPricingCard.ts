import { useQuery } from '@tanstack/react-query';
import type { PricingCardDetail } from '@sft/api-client';
import { api } from '../lib/api';

async function fetchCurrentPricingCard(
  vendorId: string,
  category: string,
): Promise<PricingCardDetail | null> {
  try {
    return await api<PricingCardDetail>(
      `/pricing-cards/vendors/${vendorId}/categories/${encodeURIComponent(category)}/current`,
    );
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 404) return null;
    throw err;
  }
}

/**
 * Query options for the current pricing card in one vendor+category. Shared
 * between `useVendorPricingCard` (single category) and the pricing screen,
 * which needs one query per category and uses `useQueries` for that — both
 * must hit the exact same cache key to avoid double-fetching.
 */
export function vendorPricingCardQueryOptions(
  vendorId: string | undefined,
  category: string | undefined,
) {
  return {
    queryKey: ['vendor-pricing-card', vendorId, category ?? null],
    queryFn: () => fetchCurrentPricingCard(vendorId as string, category as string),
    enabled: Boolean(vendorId) && Boolean(category),
    staleTime: 5 * 60_000,
  } as const;
}

/**
 * Fetch the vendor's currently-published pricing card for one category.
 * Backed by the real endpoint:
 *   GET /pricing-cards/vendors/:vendorId/categories/:category/current
 * Returns `null` when the vendor has no published card for that category
 * (backend 404s) so the screen can render an honest empty state.
 *
 * `category` is a required path segment on the backend — the query stays
 * disabled until both `vendorId` and `category` are known. There is no
 * "list all versions" endpoint, so this hook intentionally has no history
 * counterpart; a specific older version is reachable one at a time via
 * GET /pricing-cards/vendors/:vendorId/categories/:category/versions/:version
 * but the app doesn't need a history list to show the current card.
 */
export function useVendorPricingCard(
  vendorId: string | undefined,
  category: string | undefined,
) {
  return useQuery(vendorPricingCardQueryOptions(vendorId, category));
}
