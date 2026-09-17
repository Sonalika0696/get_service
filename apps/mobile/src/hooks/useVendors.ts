import { useQuery } from '@tanstack/react-query';
import type { VendorDetail, ListVendorsQuery } from '@sft/api-client';
import { api } from '../lib/api';
import { demoVendors } from '../lib/demoData';
import { withSampleFallback } from '../lib/sampleFallback';

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

  const query = useQuery({
    queryKey: ['vendors', filter],
    queryFn: () => api<VendorDetail[]>(`/vendors${qs ? `?${qs}` : ''}`),
    staleTime: 60_000,
  });
  return withSampleFallback(query, (list) => list.length === 0, demoVendors);
}

export function useVendor(id: string | undefined) {
  const query = useQuery({
    queryKey: ['vendor', id],
    queryFn: () => api<VendorDetail>(`/vendors/${id}`),
    enabled: Boolean(id),
  });
  // Opening a tagged vendor from a sampled request must not 401. On a settled
  // failure, fall back to the sample vendor with the matching id.
  const sample = demoVendors.find((v) => v.id === id) ?? demoVendors[0];
  return withSampleFallback(query, () => false, sample);
}
