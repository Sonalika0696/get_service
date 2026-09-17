import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApprovalItem,
  ApprovalsResponse,
  RoleKind,
} from '@sft/api-client';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { demoApprovals } from '../lib/demoData';
import { withSampleFallback, type SampleFallbackResult } from '../lib/sampleFallback';

/**
 * Committee approvals inbox — the mobile side of the M14 governance ladder.
 *
 * `GET /me/approvals` exists in backend source now (backend/src/modules/
 * approvals), but as of writing the running dev server 404s on it with
 * Nest's generic "Cannot GET" (a route-not-registered error, not an
 * application 404) — it hasn't picked up a rebuild/restart yet. Rather than
 * special-case that, this just calls the real route and lets any failure
 * (including today's stale-server 404) fall back to curated sample
 * approvals via withSampleFallback — the same pattern as every other
 * resident-facing hook. No mobile change is needed once their server
 * catches up; real data (including a genuinely empty inbox) takes over
 * automatically the moment the call succeeds.
 */
export function useApprovals(): SampleFallbackResult<ApprovalsResponse> {
  const { isSignedIn } = useAuth();
  const query = useQuery({
    queryKey: ['me', 'approvals'],
    queryFn: () => api<ApprovalsResponse>('/me/approvals'),
    staleTime: 30_000,
    enabled: isSignedIn,
  });

  return withSampleFallback(query, (data) => data.items.length === 0, demoApprovals);
}

export function useAuthorisePayout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      api(`/bookings/${bookingId}/payout/authorise`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me', 'approvals'] }),
  });
}

export function useAuthoriseMilestone() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, milestoneId }: { bookingId: string; milestoneId: string }) =>
      api(`/bookings/${bookingId}/milestones/${milestoneId}/authorise`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me', 'approvals'] }),
  });
}

export function useReleaseRetention() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      api(`/bookings/${bookingId}/retention/release`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me', 'approvals'] }),
  });
}

/**
 * Dispatch an approval action against the right backend route based on the
 * item's `actionRef`. Rejected client-side (with a meaningful message) if
 * the item is one of the unshipped kinds (RATIFICATION, CORPUS).
 */
export function useAuthoriseApproval() {
  const payout = useAuthorisePayout();
  const milestone = useAuthoriseMilestone();
  const retention = useReleaseRetention();

  return {
    isPending: payout.isPending || milestone.isPending || retention.isPending,
    authorise: async (item: ApprovalItem): Promise<void> => {
      switch (item.actionRef.kind) {
        case 'PAYOUT':
          await payout.mutateAsync(item.actionRef.bookingId);
          return;
        case 'MILESTONE':
          await milestone.mutateAsync({
            bookingId: item.actionRef.bookingId,
            milestoneId: item.actionRef.milestoneId,
          });
          return;
        case 'RETENTION':
          await retention.mutateAsync(item.actionRef.bookingId);
          return;
        case 'RATIFICATION':
        case 'CORPUS':
          throw {
            status: 501,
            code: 'NOT_IMPLEMENTED',
            message: 'This approval type will be actionable once the backend ships.',
          };
      }
    },
  };
}

/**
 * True if the current user carries at least one committee role. Used to
 * gate the Approvals entry on Profile — the plan's "one admin surface on
 * mobile" only shows up for role-holders.
 */
export function useIsCommittee(): boolean {
  const { me } = useAuth();
  const committee: RoleKind[] = ['COMMITTEE', 'TREASURER', 'DEPUTY_TREASURER'];
  return Boolean(me?.roleKinds?.some((r) => committee.includes(r as RoleKind)));
}
