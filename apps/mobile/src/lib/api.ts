import Constants from 'expo-constants';
import { createApiClient } from '@sft/api-client';
import { secureStorage } from './storage';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiBaseUrl?: string;
  devBearerToken?: string | null;
};

const baseUrl = extra.apiBaseUrl ?? 'http://localhost:4000/api/v1';
/**
 * Dev-only escape hatch: F1 (phone-OTP sign-in) has not landed yet, so the
 * query hooks below need *some* bearer token to hit the guarded routes. When
 * F1 ships, real tokens live in SecureStore under `sft.auth.bearer` and this
 * field goes back to null.
 */
const devToken = extra.devBearerToken ?? null;

export const api = createApiClient({
  baseUrl,
  getToken: async () => (await secureStorage.getToken()) ?? devToken,
  onUnauthorized: () => {
    // Session invalidation is wired in F1 once the auth store lands.
  },
});
