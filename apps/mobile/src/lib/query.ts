import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { mmkvAsyncStorage } from './storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Aggregate endpoints revalidate on focus; treat cached data as fresh
      // for 30s so tabs don't re-fetch immediately on switch.
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
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
