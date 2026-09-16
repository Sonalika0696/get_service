import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  MeResponse,
  RequestOtpBody,
  VerifyOtpBody,
  VerifyOtpResult,
  SignupBody,
} from '@sft/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { secureStorage } from '../lib/storage';

type AuthStatus =
  | { kind: 'unknown' }        // initial — reading secure storage
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; me: MeResponse | null };

type AuthContextValue = {
  status: AuthStatus;
  isSignedIn: boolean;
  me: MeResponse | null;
  requestOtp: (body: RequestOtpBody) => Promise<void>;
  verifyOtp: (body: VerifyOtpBody) => Promise<VerifyOtpResult>;
  signUp: (body: SignupBody) => Promise<{ userId: string }>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session lifecycle for the resident app. All resident-facing routes are
 * guarded by the backend's AuthGuard, which accepts either a session cookie
 * (web) or an `Authorization: Bearer` header (native — see
 * backend/src/common/guards/auth.guard.ts). We use the bearer path: the
 * token is minted by POST /auth/verify and delivered on the response's
 * Set-Cookie header, from which api.withCookie extracts it. It then lives
 * in the platform keychain via SecureStore, and never reaches MMKV.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ kind: 'unknown' });
  const queryClient = useQueryClient();

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<MeResponse>('/me');
      setStatus({ kind: 'signed-in', me });
    } catch (err) {
      const apiErr = err as { status?: number } | undefined;
      // 401 = token no longer valid; 403 = principal kind mismatch. Either
      // way, the local session is spent — drop it and force a fresh sign-in.
      if (apiErr?.status === 401 || apiErr?.status === 403) {
        await secureStorage.clearToken();
        setStatus({ kind: 'signed-out' });
      } else {
        // Network / server error: keep the session, surface nothing here.
        setStatus((prev) => (prev.kind === 'signed-in' ? prev : { kind: 'signed-in', me: null }));
      }
    }
  }, []);

  // Hydrate from secure storage on first mount.
  useEffect(() => {
    (async () => {
      const token = await secureStorage.getToken();
      if (!token) {
        setStatus({ kind: 'signed-out' });
        return;
      }
      await refreshMe();
    })();
  }, [refreshMe]);

  const requestOtp = useCallback(async (body: RequestOtpBody) => {
    await api<void>('/auth/otp', { method: 'POST', body });
  }, []);

  const verifyOtp = useCallback(async (body: VerifyOtpBody): Promise<VerifyOtpResult> => {
    const { body: user, cookieValue } = await api.withCookie<VerifyOtpResult>('/auth/verify', {
      method: 'POST',
      body,
      cookieName: 'sid',
    });
    if (!cookieValue) {
      throw {
        status: 500,
        code: 'NO_SESSION_COOKIE',
        message: 'Server did not return a session token.',
      };
    }
    await secureStorage.setToken(cookieValue);
    await refreshMe();
    return user;
  }, [refreshMe]);

  const signUp = useCallback(async (body: SignupBody): Promise<{ userId: string }> => {
    return api<{ userId: string }>('/auth/signup', { method: 'POST', body });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } catch {
      // Server-side revoke best-effort — local session always clears.
    }
    await secureStorage.clearToken();
    queryClient.clear();
    setStatus({ kind: 'signed-out' });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    isSignedIn: status.kind === 'signed-in',
    me: status.kind === 'signed-in' ? status.me : null,
    requestOtp,
    verifyOtp,
    signUp,
    signOut,
    refreshMe,
  }), [status, requestOtp, verifyOtp, signUp, signOut, refreshMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
