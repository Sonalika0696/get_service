import { QueryClient, onlineManager, focusManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { mmkvAsyncStorage } from './storage';

/**
 * Wire React Query's online/offline signal to real device connectivity
 * (FRONTEND_PLAN §3.3). Without this, `onlineManager` defaults to always
 * "online", so paused-mutation queuing never kicks in and mutations just
 * error out the moment a request fails offline. This predicate matches
 * OfflineBanner's exactly, so the banner and the query client always agree
 * on whether the device is offline.
 */
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(Boolean(state.isConnected && state.isInternetReachable !== false))),
);

/**
 * Wire React Query's "focus" signal to the RN app lifecycle. On the web
 * "focus" is the browser window regaining focus; RN has no such event, so
 * without this `refetchOnWindowFocus` never fires. Mapping it to AppState
 * means every screen's stale queries auto-refetch the moment the user
 * brings the app back to the foreground — so data an admin changed while
 * the app was backgrounded is up to date the instant they return, with no
 * manual pull-to-refresh. This complements realtime pushes (which update a
 * foregrounded app live) and covers the cases realtime doesn't emit for yet.
 */
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    handleFocus(status === 'active');
  });
  return () => sub.remove();
});

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
      // Auto-refetch stale queries when the app returns to the foreground
      // (wired to AppState via focusManager above) and on mount, so lists
      // stay current without the user pulling to refresh.
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Optimistic mutations are configured per-hook; global retry stays off
      // so double-fires never surprise the ledger.
      retry: 0,
      // Explicit default (matches the library default, but stated here so it
      // can't drift): 'online' means a mutation fired while offline goes
      // *paused* instead of erroring, sits in the mutation cache, and fires
      // for real the moment `onlineManager` flips back online. 'always'
      // would defeat the offline queue entirely.
      networkMode: 'online',
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: mmkvAsyncStorage,
  key: 'sft.query.v1',
  throttleTime: 1_000,
});
