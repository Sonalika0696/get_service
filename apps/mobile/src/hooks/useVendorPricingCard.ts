import { useQuery } from '@tanstack/react-query';
import type {
  VendorPricingCard,
  VendorPricingCardHistory,
} from '@sft/api-client';
import { api } from '../lib/api';

/**
 * Fetch the vendor's currently-published pricing card for one category.
 * Backed by GET /vendors/:id/pricing-cards/current?category=... once Phase 7
 * backend (M4 full) ships. Until then the request 404s and the hook
 * returns `undefined` so the screen renders an honest empty state.
 *
 * Category is optional — omit to fetch the vendor's default (first) card.
 */
export function useVendorPricingCard(
  vendorId: string | undefined,
  category?: string,
) {
  return useQuery({
    queryKey: ['vendor-pricing-card', vendorId, category ?? null],
    queryFn: async (): Promise<VendorPricingCard | null> => {
      const qs = category ? `?category=${encodeURIComponent(category)}` : '';
      try {
        return await api<VendorPricingCard>(`/vendors/${vendorId}/pricing-cards/current${qs}`);
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(vendorId),
    staleTime: 5 * 60_000,
  });
}

/**
 * History of every card version this vendor has published in this category,
 * newest first. Superseded cards remain readable per FRONTEND_PLAN §5.F3.
 * Backed by GET /vendors/:id/pricing-cards/history — also pending Phase 7.
 */
export function useVendorPricingCardHistory(
  vendorId: string | undefined,
  category?: string,
) {
  return useQuery({
    queryKey: ['vendor-pricing-card-history', vendorId, category ?? null],
    queryFn: async (): Promise<VendorPricingCardHistory | null> => {
      const qs = category ? `?category=${encodeURIComponent(category)}` : '';
      try {
        return await api<VendorPricingCardHistory>(
          `/vendors/${vendorId}/pricing-cards/history${qs}`,
        );
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(vendorId),
    staleTime: 5 * 60_000,
  });
}
