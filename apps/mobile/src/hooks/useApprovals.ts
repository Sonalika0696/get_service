import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApprovalItem,
  ApprovalsResponse,
  RoleKind,
} from '@sft/api-client';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';

/**
 * Committee approvals inbox — the mobile side of the M14 governance ladder.
 *
 * Backend timing: `GET /me/approvals` is called out in FRONTEND_PLAN §3.2 as
 * the aggregate for this screen but has NOT shipped yet. The individual
 * shipped POST routes (payout, milestone, retention authorise) are wired up
 * below so a treasurer with a bookingId in hand can still act.
 *
 * When the aggregate ships, delete the empty-state branch and the data
 * flows through untouched.
 */
export function useApprovals(): {
  data: ApprovalsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
} {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: ['me', 'approvals'],
    // Casting the endpoint as unshipped: it 404s today and TanStack Query
    // gets a friendly result. When it lands the same query key repopulates.
    queryFn: async (): Promise<ApprovalsResponse> => {
      try {
        return await api<ApprovalsResponse>('/me/approvals');
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 404) {
          return { asOf: new Date().toISOString(), items: [] };
        }
        throw err;
      }
    },
    staleTime: 30_000,
    enabled: isSignedIn,
  });
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
