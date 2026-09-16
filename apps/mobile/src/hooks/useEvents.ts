import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventSummary, EventDetail } from '@sft/api-client';
import { api } from '../lib/api';

/**
 * Events browse. Ideal source is GET /events (Phase 11 backend, M8). That
 * richer surface — per-flat charge, capacity, refund policy, waitlist —
 * isn't shipped yet; the backend today only has bare EVENT polls under
 * /polls. This hook targets the future endpoint and falls back to an empty
 * list on 404 so the screen renders its empty state rather than erroring.
 *
 * When Phase 11 ships GET /events, this repopulates unchanged.
 */
export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async (): Promise<EventSummary[]> => {
      try {
        return await api<EventSummary[]>('/events');
      } catch (err) {
        if ((err as { status?: number } | null)?.status === 404) return [];
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: async (): Promise<EventDetail | null> => {
      try {
        return await api<EventDetail>(`/events/${id}`);
      } catch (err) {
        if ((err as { status?: number } | null)?.status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/**
 * Opt into an event. Optimistically flips myOptIn so the CTA updates
 * instantly; rolls back on error. Payment is a separate step (the bills
 * hub) — opting in creates the obligation, it doesn't settle it.
 */
export function useOptInEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<EventDetail>(`/events/${id}/opt-in`, { method: 'POST' }),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: ['event', id] });
      const prev = client.getQueryData<EventDetail>(['event', id]);
      if (prev && prev.myOptIn.state === 'NONE') {
        const atCapacity = prev.capacity !== null && prev.optedInCount >= prev.capacity;
        client.setQueryData<EventDetail>(['event', id], {
          ...prev,
          myOptIn: atCapacity
            ? { state: 'WAITLISTED', position: prev.waitlistCount + 1 }
            : { state: 'OPTED_IN', paid: false },
          optedInCount: atCapacity ? prev.optedInCount : prev.optedInCount + 1,
          waitlistCount: atCapacity ? prev.waitlistCount + 1 : prev.waitlistCount,
        });
      }
      return { prev };
    },
    onError: (_e, id, ctx) => {
      if (ctx?.prev) client.setQueryData(['event', id], ctx.prev);
    },
    onSettled: (data, _e, id) => {
      client.invalidateQueries({ queryKey: ['events'] });
      if (data) client.setQueryData(['event', id], data);
      else client.invalidateQueries({ queryKey: ['event', id] });
    },
  });
}
