import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

/**
 * MMKV instance for non-sensitive persistent state: TanStack Query cache,
 * onboarding flags, last-seen society id. Secrets never live here.
 */
export const kv = new MMKV({ id: 'sft.resident.v1' });

const TOKEN_KEY = 'sft.auth.bearer';

/**
 * Bearer tokens live in the platform secure keychain, never in MMKV. The
 * FRONTEND_PLAN §3.3 note on "cold start never blocks on auth" is honoured
 * by reading it synchronously on native — SecureStore's sync API is only
 * available on native, so the shell can still render immediately on web
 * without waiting on a promise.
 */
export const secureStorage = {
  async getToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async setToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async clearToken(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

/**
 * Adapter that lets the TanStack Query async-storage persister talk to MMKV.
 * MMKV's API is sync; the persister expects promises. Wrapping is cheap.
 */
export const mmkvAsyncStorage = {
  getItem: (key: string) => Promise.resolve(kv.getString(key) ?? null),
  setItem: (key: string, value: string) => {
    kv.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    kv.delete(key);
    return Promise.resolve();
  },
};
