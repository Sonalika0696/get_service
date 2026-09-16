import { useQuery } from '@tanstack/react-query';
import type { UtilityBillTrace } from '@sft/api-client';
import { api } from '../lib/api';

/**
 * Fetch the full computation trace for one utility bill (ELECTRICITY /
 * WATER). Backed by GET /me/bills/:id/trace once Phase 10 backend ships
 * (M5 electricity + M6 water billing cycles). Until then, the request 404s
 * and the query returns `undefined` — the screen renders an honest empty
 * state instead of crashing.
 *
 * When Phase 10 lands, the same query key repopulates with the real trace
 * and no screen changes are needed.
 */
export function useUtilityBillTrace(billId: string | undefined) {
  return useQuery({
    queryKey: ['bill-trace', billId],
    queryFn: async (): Promise<UtilityBillTrace | null> => {
      try {
        return await api<UtilityBillTrace>(`/me/bills/${billId}/trace`);
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(billId),
    staleTime: 5 * 60_000,
  });
}
