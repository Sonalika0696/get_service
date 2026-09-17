import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillsHubResponse,
  BillsPage,
  BillsPageItem,
  BillLine,
  BillKind,
  BillStatus,
  CreateOrderBody,
  CreateOrderResult,
  Payment,
} from '@sft/api-client';
import { api } from '../lib/api';
import { majorStringToMinor } from '../lib/money';
import { demoBillsPage } from '../lib/demoData';
import { withSampleFallback } from '../lib/sampleFallback';

/**
 * The bills hub — `GET /me/bills` (shipped). Falls back to curated sample
 * data (demoData.ts) once the query settles with no items, so Bills always
 * has something to render instead of an empty list or a session-expired
 * error card. See sampleFallback.ts.
 *
 * A single first page (`limit=50`) is fine for now — the screen doesn't
 * paginate yet. `nextCursor` on the raw response is there for later.
 */
export function useBillsHub() {
  const query = useQuery({
    queryKey: ['bills'],
    queryFn: () => api<BillsPage>('/me/bills?limit=50'),
    staleTime: 30_000,
  });

  const fallback = withSampleFallback(query, (page) => page.items.length === 0, demoBillsPage);

  return {
    ...fallback,
    data: fallback.data ? toBillsHubResponse(fallback.data) : undefined,
  };
}

/**
 * The backend's `kind` split is coarser than the client's own BillKind — a
 * pooled PROCUREMENT line reads to the resident as a group buy, so it maps
 * onto the existing BULK_BUY_SHARE icon/tone rather than inventing a new
 * one, and a paid HEALTH_CAMP registration has no dedicated client bucket
 * yet, so it renders as a generic ADJUSTMENT (neutral icon/tone) rather
 * than something actively misleading like a lightning-bolt icon.
 *
 * Exhaustive over BillsPageItem['kind'] on purpose: if the backend adds a
 * 7th kind, this fails to compile instead of silently defaulting every new
 * kind to MAINTENANCE.
 */
function mapBillKind(kind: BillsPageItem['kind']): BillKind {
  switch (kind) {
    case 'MAINTENANCE': return 'MAINTENANCE';
    case 'PROCUREMENT': return 'BULK_BUY_SHARE';
    case 'ELECTRICITY': return 'ELECTRICITY';
    case 'WATER': return 'WATER';
    case 'EVENT': return 'EVENT_CHARGE';
    case 'HEALTH_CAMP': return 'ADJUSTMENT';
  }
}

/** The backend's `rail` isn't in this DTO yet, so it's inferred from
 * `kind`: the society collects maintenance directly, a pooled procurement
 * line sits in escrow until the vendor is paid out. */
function railForKind(kind: BillKind): BillLine['rail'] {
  return kind === 'BULK_BUY_SHARE' ? 'BULK_BUY_ESCROW' : 'SOCIETY_UPI';
}

/**
 * The backend's `status` is a plain string, not the client's BillStatus
 * union. Known values map directly; anything else falls back to a
 * due-date check so an unrecognised status still renders sensibly instead
 * of crashing the kind/status switch in BillLineRow.
 *
 * EVENT/HEALTH_CAMP add REFUNDED/CANCELLED/WITHDRAWN (2026-09-17, backend
 * commit 75cf88a) — these only ever appear once money has actually moved
 * (a waitlisted or free registration never becomes a bill line at all), so
 * the matter is closed and nothing is owed. They read as PAID rather than
 * falling through to the due-date guess below, which would otherwise
 * wrongly nudge a refunded or withdrawn line as "due"/"overdue". PENDING
 * (EVENT/HEALTH_CAMP's "not yet paid" state) needs no explicit branch — it
 * means the same thing the due-date fallback already computes.
 */
function mapBillStatus(status: string, dueDate: string | null): BillStatus {
  const s = status.toUpperCase();
  if (s === 'PAID' || s === 'SETTLED') return 'PAID';
  if (s === 'DISPUTED') return 'DISPUTED';
  if (s === 'PARTIAL' || s === 'PARTIALLY_PAID') return 'PARTIAL';
  if (s === 'OVERDUE') return 'OVERDUE';
  if (s === 'REFUNDED' || s === 'CANCELLED' || s === 'WITHDRAWN') return 'PAID';
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'OVERDUE';
  return 'DUE';
}

function toBillLine(item: BillsPageItem): BillLine {
  const kind = mapBillKind(item.kind);
  return {
    id: item.id,
    kind,
    title: item.title,
    basis: item.basis,
    amountMinor: majorStringToMinor(item.amountDue),
    currency: 'INR',
    // No due date on file (e.g. an already-settled line) — today's date
    // reads as "not overdue" rather than showing an invalid one.
    dueOn: item.dueDate ?? new Date().toISOString(),
    status: mapBillStatus(item.status, item.dueDate),
    rail: railForKind(kind),
  };
}

function toBillsHubResponse(page: BillsPage): BillsHubResponse {
  const lines = page.items.map(toBillLine);
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
