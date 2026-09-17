import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ResidentPollDetail,
  CreateResidentPollBody,
} from '@sft/api-client';
import { api } from '../lib/api';

/**
 * Resident-initiated bulk-buy polls (Flow B) — the M7 pooling surface. All
 * routes are society-scoped by the backend from the caller's context; the
 * client never passes societyId. Cache key is intentionally coarse ('open'
 * vs 'mine' is derived client-side from the list, not from separate queries)
 * — the list is small (dozens, not thousands) and one round-trip beats two.
 */
export function useResidentPolls() {
  return useQuery({
    queryKey: ['resident-polls'],
    queryFn: () => api<ResidentPollDetail[]>('/bulk-buy/polls'),
    staleTime: 30_000,
  });
}

export function useResidentPoll(id: string | undefined) {
  return useQuery({
    queryKey: ['resident-poll', id],
    queryFn: () => api<ResidentPollDetail>(`/bulk-buy/polls/${id}`),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useCreateResidentPoll() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateResidentPollBody) =>
      api<ResidentPollDetail>('/bulk-buy/polls', { method: 'POST', body }),
    onSuccess: (created) => {
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
