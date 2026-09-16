import Constants from 'expo-constants';
import { createApiClient } from '@sft/api-client';
import { secureStorage } from './storage';

const baseUrl =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
  'http://localhost:3000';

export const api = createApiClient({
  baseUrl,
  getToken: () => secureStorage.getToken(),
  onUnauthorized: () => {
    // Session invalidation is wired in F1 once the auth store lands.
  },
});
