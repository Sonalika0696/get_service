import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ResidentPollDetail,
  CreateResidentPollBody,
} from '@sft/api-client';
import { api } from '../lib/api';
import { queryClient as globalQueryClient } from '../lib/query';
import { demoResidentPolls } from '../lib/demoData';
import { withSampleFallback } from '../lib/sampleFallback';

/**
 * Mutation keys doubling as restart-persistence anchors (FRONTEND_PLAN
 * §3.3 stretch): a mutation paused offline loses its `mutationFn` closure
 * across a cold start, so `resumePausedMutations()` after restart can only
 * replay it if a `mutationFn` was registered against this exact key via
 * `setMutationDefaults` below. Only mutations whose `mutationFn` doesn't
 * close over anything but static imports are safe to register this way —
 * `useUpdateResidentPoll` closes over its `id` argument, so it's excluded
 * (see its doc comment) and only resumes within the current session.
 */
const JOIN_POLL_MUTATION_KEY = ['resident-poll-join'] as const;
const CREATE_POLL_MUTATION_KEY = ['resident-poll-create'] as const;

globalQueryClient.setMutationDefaults(JOIN_POLL_MUTATION_KEY, {
  mutationFn: (id: string) => api<ResidentPollDetail>(`/bulk-buy/polls/${id}/join`, { method: 'POST' }),
});
globalQueryClient.setMutationDefaults(CREATE_POLL_MUTATION_KEY, {
  mutationFn: (body: CreateResidentPollBody) => api<ResidentPollDetail>('/bulk-buy/polls', { method: 'POST', body }),
});

/**
 * Resident-initiated bulk-buy polls (Flow B) — the M7 pooling surface. All
 * routes are society-scoped by the backend from the caller's context; the
 * client never passes societyId. Cache key is intentionally coarse ('open'
 * vs 'mine' is derived client-side from the list, not from separate queries)
 * — the list is small (dozens, not thousands) and one round-trip beats two.
 */
export function useResidentPolls() {
  const query = useQuery({
    queryKey: ['resident-polls'],
    queryFn: () => api<ResidentPollDetail[]>('/bulk-buy/polls'),
    staleTime: 30_000,
  });

  // Falls back to curated sample polls once settled with an empty list —
  // see sampleFallback.ts. The "Mine" segment still shows the real empty
  // state, since no sample poll's creatorId matches the real caller.
  return withSampleFallback(query, (polls) => polls.length === 0, demoResidentPolls);
}

export function useResidentPoll(id: string | undefined) {
  const query = useQuery({
    queryKey: ['resident-poll', id],
    queryFn: () => api<ResidentPollDetail>(`/bulk-buy/polls/${id}`),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
  // Opening a request from the sample list must not 401 ("session expired")
  // just because the detail fetch hits the wiped backend. On a settled
  // failure, fall back to the sample poll with the matching id (or the first
  // sample), so a sampled Open request opens instead of erroring.
  const sample =
    demoResidentPolls.find((p) => p.id === id) ?? demoResidentPolls[0];
  return withSampleFallback(query, () => false, sample);
}

export function useCreateResidentPoll() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: CREATE_POLL_MUTATION_KEY,
    mutationFn: (body: CreateResidentPollBody) =>
      api<ResidentPollDetail>('/bulk-buy/polls', { method: 'POST', body }),
    onSuccess: (created) => {
      // Inject the new poll into the list cache immediately, rather than
      // relying solely on invalidateQueries' background refetch — the
      // create flow navigates straight to the detail screen (see
      // requests/new.tsx), which can unmount the Requests tab before that
      // refetch resolves, so the "Mine" segment must not depend on timing
      // to show a request the resident just raised.
      client.setQueryData<ResidentPollDetail[]>(['resident-polls'], (old) => {
        if (!old) return old; // no list cached yet — the next fetch already includes it
        if (old.some((p) => p.id === created.id)) return old;
        return [created, ...old];
      });
      client.invalidateQueries({ queryKey: ['resident-polls'] });
      client.setQueryData(['resident-poll', created.id], created);
    },
  });
}

/** Fields the creator can amend on a still-open poll. */
export type UpdateResidentPollBody = {
  title?: string;
  description?: string | null;
  closesAt?: string; // ISO-8601
};

/**
 * Edit a poll the current resident created. Targets PATCH
 * /bulk-buy/polls/:id — see BACKEND gap note in useResidentPolls: the route
 * is not shipped yet, so a save currently returns an error until the backend
 * lands it. The client is ready the moment it does.
 *
 * Not registered for restart-persistence (FRONTEND_PLAN §3.3 stretch):
 * `mutationFn` closes over the hook's `id` argument rather than taking it as
 * part of the mutation variables, so there's nothing a static
 * `setMutationDefaults` call could reconstruct after a cold start. It still
 * queues and replays normally within the current app session.
 */
export function useUpdateResidentPoll(id: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateResidentPollBody) =>
      api<ResidentPollDetail>(`/bulk-buy/polls/${id}`, { method: 'PATCH', body }),
    onSuccess: (updated) => {
      client.invalidateQueries({ queryKey: ['resident-polls'] });
      client.setQueryData(['resident-poll', updated.id], updated);
    },
  });
}

/**
 * Optimistic join. On tap we bump commitmentCount + set hasJoined=true so the
 * progress bar advances immediately; on error we roll back exactly what we
 * changed. Safe with the backend's idempotency guarantees — a replayed join
 * on an already-joined poll is a no-op on the server, and the roll-back
 * only fires if the server explicitly rejected.
 */
export function useJoinResidentPoll() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: JOIN_POLL_MUTATION_KEY,
    mutationFn: (id: string) =>
      api<ResidentPollDetail>(`/bulk-buy/polls/${id}/join`, { method: 'POST' }),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: ['resident-poll', id] });
      const previousDetail = client.getQueryData<ResidentPollDetail>(['resident-poll', id]);
      const previousList = client.getQueryData<ResidentPollDetail[]>(['resident-polls']);

      if (previousDetail && !previousDetail.hasJoined) {
        client.setQueryData<ResidentPollDetail>(['resident-poll', id], {
          ...previousDetail,
          hasJoined: true,
          commitmentCount: previousDetail.commitmentCount + 1,
        });
      }
      if (previousList) {
        client.setQueryData<ResidentPollDetail[]>(
          ['resident-polls'],
          previousList.map((p) =>
            p.id === id && !p.hasJoined
              ? { ...p, hasJoined: true, commitmentCount: p.commitmentCount + 1 }
              : p,
          ),
        );
      }
      return { previousDetail, previousList };
    },
    onError: (_err, id, context) => {
      if (context?.previousDetail) {
        client.setQueryData(['resident-poll', id], context.previousDetail);
      }
      if (context?.previousList) {
        client.setQueryData(['resident-polls'], context.previousList);
      }
    },
    onSettled: (data, _err, id) => {
      client.invalidateQueries({ queryKey: ['resident-poll', id] });
      client.invalidateQueries({ queryKey: ['resident-polls'] });
      if (data) client.setQueryData(['resident-poll', id], data);
    },
  });
}
