import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createApiClient } from '@sft/api-client';
import { secureStorage } from './storage';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiBaseUrl?: string;
  devBearerToken?: string | null;
};

const API_PORT = 4000;
const API_PREFIX = '/api/v1';

/**
 * On a physical device / emulator, `localhost` resolves to the device
 * itself, not the dev machine — so a base URL of http://localhost:4000
 * fails with ConnectException. In development we rewrite the host to the
 * machine actually serving the Metro bundle, which Expo exposes via
 * `hostUri` (e.g. "10.16.44.231:8081"). Web keeps localhost (same origin
 * as the browser). A production build uses the configured apiBaseUrl as-is.
 */
function resolveBaseUrl(): string {
  const configured = extra.apiBaseUrl ?? `http://localhost:${API_PORT}${API_PREFIX}`;

  if (!__DEV__ || Platform.OS === 'web') return configured;

  // Only rewrite when the configured host is localhost/127.0.0.1.
  const isLoopback = /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configured);
  if (!isLoopback) return configured;

  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older/dev-client fallbacks.
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
    (Constants as unknown as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } })
      .manifest2?.extra?.expoClient?.hostUri;

  const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : null;
  if (!host || host === 'localhost' || host === '127.0.0.1') return configured;

  return `http://${host}:${API_PORT}${API_PREFIX}`;
}

const baseUrl = resolveBaseUrl();

/**
 * F1 shipped: tokens come from SecureStore (platform keychain), minted by
 * POST /auth/verify. `devBearerToken` remains an emergency dev override —
 * used only when no real session token is present.
 */
const devToken = extra.devBearerToken ?? null;

export const api = createApiClient({
  baseUrl,
  getToken: async () => (await secureStorage.getToken()) ?? devToken,
  onUnauthorized: () => {
    // AuthProvider.refreshMe handles the local state transition on 401.
  },
});
