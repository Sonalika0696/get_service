import { useQuery } from '@tanstack/react-query';
import type { HomeAggregate } from '@sft/api-client';
import { api } from '../lib/api';
import { majorStringToMinor } from '../lib/money';
import { demoHomeAggregate } from '../lib/demoData';
import { withSampleFallback } from '../lib/sampleFallback';

/** Home hero's view of the aggregate — money already converted to minor
 * units at this boundary so nothing downstream touches the raw string. */
export type HomeView = {
  amountDueMinor: number;
  overdueCount: number;
  actionsNeeded: number;
  joinableServiceRequests: HomeAggregate['joinableServiceRequests'];
  upcomingEvents: HomeAggregate['upcomingEvents'];
};

function toHomeView(raw: HomeAggregate): HomeView {
  return {
    amountDueMinor: majorStringToMinor(raw.amountDue),
    overdueCount: raw.overdueCount,
    actionsNeeded: raw.actionsNeeded,
    joinableServiceRequests: raw.joinableServiceRequests,
    upcomingEvents: raw.upcomingEvents,
  };
}

/** Nothing worth showing as "real": no due amount, no overdue/actions flags,
 * and nothing joinable — i.e. a structurally empty aggregate. */
function isHomeAggregateEmpty(data: HomeAggregate): boolean {
  const amount = Number(data.amountDue);
  return (
    (!Number.isFinite(amount) || amount <= 0) &&
    data.overdueCount === 0 &&
    data.actionsNeeded === 0 &&
    data.joinableServiceRequests.length === 0
  );
}

/**
 * The home aggregate — `GET /me/home` (shipped). Falls back to curated
 * sample data (demoData.ts) once the query settles with nothing usable, so
 * the dashboard always shows a dues amount and a joinable-requests list
 * instead of zeros or a session-expired error. See sampleFallback.ts.
 */
export function useHome() {
  const query = useQuery({
    queryKey: ['home'],
    queryFn: () => api<HomeAggregate>('/me/home'),
    staleTime: 30_000,
  });

  const fallback = withSampleFallback(query, isHomeAggregateEmpty, demoHomeAggregate);

  return {
    ...fallback,
    data: fallback.data ? toHomeView(fallback.data) : undefined,
  };
}
