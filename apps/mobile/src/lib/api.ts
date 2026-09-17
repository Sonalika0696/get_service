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
 * Origin the realtime (Socket.IO) gateway listens on — same host/port
 * `resolveBaseUrl()` computed for the REST API, minus the `/api/v1` prefix.
 * The gateway is mounted on the bare Nest HTTP server, not under the API
 * path, so callers (RealtimeProvider) connect `io(apiOrigin, ...)` instead
 * of `baseUrl`.
 */
export const apiOrigin = baseUrl.endsWith(API_PREFIX)
  ? baseUrl.slice(0, -API_PREFIX.length)
  : baseUrl;

/**
 * F1 shipped: tokens come from SecureStore (platform keychain), minted by
 * POST /auth/verify. `devBearerToken` remains an emergency dev override —
 * used only when no real session token is present.
 */
const devToken = extra.devBearerToken ?? null;

/**
 * Sentinel stored by the "Developer sign-in" bypass. It is NOT a real
 * backend token, so it must never be sent as a bearer — when it's the
 * stored value we send the configured `devBearerToken` instead so guarded
 * calls actually authenticate. Shared with AuthProvider.
 */
export const DEV_BYPASS_TOKEN = 'gatex-dev-bypass';

/**
 * Resolves the bearer token the same way for every caller — the REST
 * client below and RealtimeProvider's socket handshake alike — so a swap
 * of the dev-bypass sentinel for the real dev token never drifts between
 * the two.
 */
export async function getAuthToken(): Promise<string | null> {
  const stored = await secureStorage.getToken();
  if (!stored) return devToken;
  // A stored dev-bypass sentinel is not a valid bearer — swap in the real
  // dev token so the backend doesn't reject it as "session expired".
  if (stored === DEV_BYPASS_TOKEN) return devToken;
  return stored;
}

export const api = createApiClient({
  baseUrl,
  getToken: getAuthToken,
  onUnauthorized: () => {
    // AuthProvider.refreshMe handles the local state transition on 401.
  },
});
