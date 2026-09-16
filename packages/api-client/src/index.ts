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

export function createApiClient(config: ApiClientConfig) {
  return async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
    const token = await config.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.headers ?? {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const res = await fetch(`${config.baseUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    if (res.status === 401 && config.onUnauthorized) config.onUnauthorized();

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const err: ApiError = {
        status: res.status,
        code: (payload && (payload as { code?: string }).code) ?? 'UNKNOWN',
        message: (payload && (payload as { message?: string }).message) ?? res.statusText,
        details: payload as Record<string, unknown>,
      };
      throw err;
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };
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
