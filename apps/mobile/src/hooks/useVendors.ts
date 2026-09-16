import { useQuery } from '@tanstack/react-query';
import type { VendorDetail, ListVendorsQuery } from '@sft/api-client';
import { api } from '../lib/api';

/**
 * Vendor directory. Backed by GET /vendors. Filter object is part of the
 * cache key so switching between "electrical" and "plumbing" doesn't confuse
 * a stale list for a fresh one.
 */
export function useVendors(filter: ListVendorsQuery = {}) {
  const params = new URLSearchParams();
  if (filter.category) params.set('category', filter.category);
  if (filter.q) params.set('q', filter.q);
  const qs = params.toString();

  return useQuery({
    queryKey: ['vendors', filter],
    queryFn: () => api<VendorDetail[]>(`/vendors${qs ? `?${qs}` : ''}`),
    staleTime: 60_000,
  });
}

export function useVendor(id: string | undefined) {
  return useQuery({
    queryKey: ['vendor', id],
    queryFn: () => api<VendorDetail>(`/vendors/${id}`),
    enabled: Boolean(id),
  });
}
