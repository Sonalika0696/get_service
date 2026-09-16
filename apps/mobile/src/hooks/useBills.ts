import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillsHubResponse,
  BillLine,
  CreateOrderBody,
  CreateOrderResult,
  Payment,
  ResidentPollDetail,
} from '@sft/api-client';
import { api } from '../lib/api';
import { useResidentPolls } from './useResidentPolls';

/**
 * The bills hub. Ideal shape: one round-trip to `GET /me/bills` returning
 * every obligation pre-composed (FRONTEND_PLAN §3.2). That endpoint has
 * NOT shipped yet — Phase 9 backend delivers only /payments/orders and
 * /payments/:id today. Until it lands, this hook composes the hub client-
 * side from the shipped surfaces so the screen carries real data:
 *
 *   BULK_BUY_SHARE lines come from Flow B polls the resident joined that
 *   are FIRED. The share amount isn't yet exposed by the backend, so it's
 *   a placeholder pending Phase 9's bills aggregate — the *presence* of the
 *   obligation is real, the *amount* renders as pending.
 *
 * When Phase 9 ships GET /me/bills, this whole body collapses to a single
 * api() call. The DTO shape is already what that endpoint should return.
 */
export function useBillsHub() {
  const polls = useResidentPolls();

  // TODO(phase 9 backend): swap for `api<BillsHubResponse>('/me/bills')`.
  return {
    ...polls,
    data: polls.data ? composeHubFromPolls(polls.data) : undefined,
  } as {
    data: BillsHubResponse | undefined;
    isLoading: boolean;
    isError: boolean;
    isSuccess: boolean;
    error: unknown;
    refetch: () => Promise<unknown>;
  };
}

function composeHubFromPolls(polls: ResidentPollDetail[]): BillsHubResponse {
  const lines: BillLine[] = polls
    .filter((p) => p.hasJoined && (p.status === 'FIRED' || p.bookingId))
    .map<BillLine>((p) => {
      const unit = p.vendorUnitPrice != null ? Number(p.vendorUnitPrice) : 0;
      const shareMinor = Math.max(0, Math.round(unit * 100));
      return {
        id: `poll:${p.id}`,
        kind: 'BULK_BUY_SHARE',
        title: p.title,
        basis: p.category
          ? `Your share of a ${p.category} pool with ${p.commitmentCount} neighbours`
          : `Your share of a pooled request`,
        amountMinor: shareMinor,
        currency: 'INR',
        dueOn: p.closesAt,
        status: unit > 0 ? 'DUE' : 'DUE',
        rail: 'BULK_BUY_ESCROW',
        evidence: { kind: 'POLL', pollId: p.id },
      };
    });

  const totalDueMinor = lines
    .filter((l) => l.status === 'DUE' || l.status === 'OVERDUE' || l.status === 'PARTIAL')
    .reduce((sum, l) => sum + l.amountMinor, 0);

  return {
    asOf: new Date().toISOString(),
    totalDueMinor,
    currency: 'INR',
    lines,
  };
}

export function useBillLine(billId: string | undefined) {
  const hub = useBillsHub();
  const line = useMemo(
    () => hub.data?.lines.find((l) => l.id === billId),
    [hub.data, billId],
  );
  return { line, isLoading: hub.isLoading, isError: hub.isError, error: hub.error };
}

/**
 * Create a Razorpay order for a bill. Backend requires an Idempotency-Key
 * header; we mint one per (billId, timestamp) so a double-tap on the pay
 * button never charges the resident twice.
 */
export function useCreatePaymentOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: CreateOrderBody; idempotencyKey: string }) =>
      api<CreateOrderResult>('/payments/orders', {
        method: 'POST',
        body: input.body,
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['bills'] });
    },
  });
}

export function usePayment(id: string | undefined) {
  return useQuery({
    queryKey: ['payment', id],
    queryFn: () => api<Payment>(`/payments/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Poll while the webhook is in flight; stop once it lands.
      return status === 'CAPTURED' || status === 'FAILED' || status === 'REFUNDED'
        ? false
        : 3_000;
    },
  });
}

/**
 * Mint an idempotency key for a payment order. The bill id is the natural
 * dedup key; the timestamp lets a resident retry a genuinely failed order.
 */
export function makeIdempotencyKey(billId: string): string {
  return `bill:${billId}:${Date.now()}`;
}
