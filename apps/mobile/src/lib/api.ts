import Constants from 'expo-constants';
import { createApiClient } from '@sft/api-client';
import { secureStorage } from './storage';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiBaseUrl?: string;
  devBearerToken?: string | null;
};

const baseUrl = extra.apiBaseUrl ?? 'http://localhost:4000/api/v1';

/**
 * F1 shipped: tokens now come from SecureStore (backed by the platform
 * keychain), minted by POST /auth/verify. `devBearerToken` remains as an
 * emergency dev override — if it's set in app.json.extra, it takes over
 * *only* when no real session token is present.
 */
const devToken = extra.devBearerToken ?? null;

export const api = createApiClient({
  baseUrl,
  getToken: async () => (await secureStorage.getToken()) ?? devToken,
  onUnauthorized: () => {
    // AuthProvider.refreshMe handles the local state transition when a
    // guarded call returns 401; nothing to do here.
  },
});
