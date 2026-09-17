import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventSummary, EventDetail } from '@sft/api-client';
import { api } from '../lib/api';
import { queryClient as globalQueryClient } from '../lib/query';
import { demoEvents } from '../lib/demoData';
import { withSampleFallback } from '../lib/sampleFallback';

/**
 * Restart-persistence anchor (FRONTEND_PLAN §3.3 stretch) — see the matching
 * comment in useResidentPolls.ts. `mutationFn` here closes over nothing but
 * static imports, so it's safe to register for replay after a cold start.
 */
const OPT_IN_EVENT_MUTATION_KEY = ['event-opt-in'] as const;

globalQueryClient.setMutationDefaults(OPT_IN_EVENT_MUTATION_KEY, {
  mutationFn: (id: string) => api<EventDetail>(`/events/${id}/opt-in`, { method: 'POST' }),
});

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
  const query = useQuery({
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

  // Falls back to a curated sample event once settled with an empty list
  // (or a real error) — see sampleFallback.ts.
  return withSampleFallback(query, (events) => events.length === 0, demoEvents);
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
    mutationKey: OPT_IN_EVENT_MUTATION_KEY,
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
