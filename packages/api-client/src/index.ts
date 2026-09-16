/**
 * Generated API client — placeholder.
 *
 * Populated by `npm run generate` once `shared/openapi.json` is emitted by
 * the backend (BACKEND_PLAN Phase 6). Until then, this file exposes the
 * hand-rolled fetch primitive and a small handful of DTOs so the mobile app
 * can wire its query cache against real shapes.
 */

export type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type FetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string | null> | string | null;
  onUnauthorized?: () => void;
}

async function buildHeaders(
  config: ApiClientConfig,
  opts: FetchOptions,
): Promise<Record<string, string>> {
  const token = await config.getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  return headers;
}

async function throwApiError(res: Response): Promise<never> {
  const payload = await res.json().catch(() => ({}));
  const err: ApiError = {
    status: res.status,
    code: (payload && (payload as { code?: string }).code) ?? 'UNKNOWN',
    message: (payload && (payload as { message?: string }).message) ?? res.statusText,
    details: payload as Record<string, unknown>,
  };
  throw err;
}

export function createApiClient(config: ApiClientConfig) {
  const apiFetch = async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
    const headers = await buildHeaders(config, opts);
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    if (res.status === 401 && config.onUnauthorized) config.onUnauthorized();
    if (!res.ok) return throwApiError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };

  /**
   * Same as apiFetch, but also returns the response's Set-Cookie header —
   * necessary for POST /auth/verify, which delivers the session token in a
   * cookie rather than the JSON body. React Native's fetch exposes all
   * response headers on a Set-Cookie header (concatenated with commas), and
   * this helper parses out the session cookie by name.
   */
  const apiFetchWithCookie = async function apiFetchWithCookie<T>(
    path: string,
    opts: FetchOptions & { cookieName: string } = { cookieName: 'sid' },
  ): Promise<{ body: T; cookieValue: string | null }> {
    const { cookieName, ...rest } = opts;
    const headers = await buildHeaders(config, rest);
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: rest.method ?? 'GET',
      headers,
      body: rest.body ? JSON.stringify(rest.body) : undefined,
      signal: rest.signal,
    });

    if (res.status === 401 && config.onUnauthorized) config.onUnauthorized();
    if (!res.ok) return throwApiError(res);

    const setCookie = res.headers.get('set-cookie');
    const cookieValue = parseCookieValue(setCookie, cookieName);
    const body = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    return { body, cookieValue };
  };

  return Object.assign(apiFetch, { withCookie: apiFetchWithCookie });
}

/**
 * Pull a single cookie value out of a Set-Cookie header. React Native
 * concatenates multiple Set-Cookie values with a comma-and-space, so a
 * naive split on ',' would truncate cookies whose Expires attribute
 * contains a comma. We walk name=value pairs by splitting only on the
 * cookie boundary that starts with `<name>=`.
 */
function parseCookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  // Look for `name=` following a comma-space boundary, or at the very start.
  const idx = header.startsWith(`${name}=`)
    ? 0
    : header.indexOf(`, ${name}=`) >= 0
      ? header.indexOf(`, ${name}=`) + 2
      : -1;
  if (idx < 0) return null;
  const start = idx + name.length + 1;
  const semi = header.indexOf(';', start);
  return decodeURIComponent(header.slice(start, semi === -1 ? undefined : semi));
}

export * from './types';

/**
 * Provisional home aggregate — replaced by the generated DTO once the
 * backend publishes `GET /me/home` (FRONTEND_PLAN §3.2).
 */
export type MeHomePayload = {
  flat: { label: string; block: string; society: string };
  amountDue: { totalMinor: number; currency: string; dueOn: string | null };
  actionsNeeded: Array<{ id: string; kind: string; title: string; dueOn?: string }>;
  joinableRequests: Array<{
    id: string;
    category: string;
    title: string;
    participants: number;
    thresholdAt: number;
  }>;
  myRequests: Array<{ id: string; category: string; title: string; statusLabel: string }>;
  upcomingEvents: Array<{ id: string; title: string; startsAt: string; perFlatMinor: number }>;
};
