import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { mmkvAsyncStorage } from './storage';

/**
 * A network/connection failure (backend not up yet, phone off Wi-Fi) has no
 * HTTP status. We keep retrying those with backoff so the screen recovers on
 * its own the moment the backend comes up — "wait for the backend" rather
 * than hard-failing. A real HTTP error (401/404/500) is not retried past a
 * couple of attempts, since retrying won't change the answer.
 */
function isConnectionError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === undefined;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Aggregate endpoints revalidate on focus; treat cached data as fresh
      // for 30s so tabs don't re-fetch immediately on switch.
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        if (isConnectionError(error)) return failureCount < 12; // keep waiting for the backend
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Optimistic mutations are configured per-hook; global retry stays off
      // so double-fires never surprise the ledger.
      retry: 0,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: mmkvAsyncStorage,
  key: 'sft.query.v1',
  throttleTime: 1_000,
});
