import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChargeSheet, DisputeChargeSheetBody } from '@sft/api-client';
import { api } from '../lib/api';

/**
 * A vendor's post-work charge sheet for a booking, paired with the frozen
 * card it's measured against. Backed by GET /bookings/:id/charge-sheet
 * (Phase 11 backend, M8). Returns null on 404 so the screen shows an
 * honest "no charge sheet yet" state until the vendor submits one.
 */
export function useChargeSheet(bookingId: string | undefined) {
  return useQuery({
    queryKey: ['charge-sheet', bookingId],
    queryFn: async (): Promise<ChargeSheet | null> => {
      try {
        return await api<ChargeSheet>(`/bookings/${bookingId}/charge-sheet`);
      } catch (err) {
        if ((err as { status?: number } | null)?.status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(bookingId),
    staleTime: 30_000,
  });
}

export function useAcknowledgeChargeSheet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      api<ChargeSheet>(`/bookings/${bookingId}/charge-sheet/acknowledge`, { method: 'POST' }),
    onSuccess: (data, bookingId) => {
      client.setQueryData(['charge-sheet', bookingId], data);
    },
  });
}

export function useDisputeChargeSheet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, body }: { bookingId: string; body: DisputeChargeSheetBody }) =>
      api<ChargeSheet>(`/bookings/${bookingId}/charge-sheet/dispute`, { method: 'POST', body }),
    onSuccess: (data, { bookingId }) => {
      client.setQueryData(['charge-sheet', bookingId], data);
    },
  });
}
