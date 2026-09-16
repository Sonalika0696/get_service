import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';

/**
 * Key/value store shape both real MMKV and the in-memory fallback implement.
 * The persister only needs get/set/delete of strings.
 */
type StringKV = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
};

/**
 * Volatile fallback used when the MMKV native module isn't linked — most
 * commonly Expo Go, which ships a fixed set of native modules. On a dev
 * build the real MMKV loads and this is never touched. Losing the cache
 * on reload is acceptable in that mode; nothing correctness-critical
 * lives here (bearer tokens go through SecureStore below).
 */
class InMemoryStore implements StringKV {
  private data = new Map<string, string>();
  getString(key: string): string | undefined { return this.data.get(key); }
  set(key: string, value: string): void { this.data.set(key, value); }
  delete(key: string): void { this.data.delete(key); }
}

let cachedKv: StringKV | null = null;
let warnedFallback = false;

/**
 * Lazy singleton so the first-import failure surface doesn't crash every
 * screen with "MMKV native module could not be found". MMKV throws
 * synchronously on construction when the JSI binding is missing; we
 * catch that and swap in the in-memory store.
 */
function getKv(): StringKV {
  if (cachedKv) return cachedKv;
  try {
    cachedKv = new MMKV({ id: 'gatex.resident.v1' });
  } catch (err) {
    if (!warnedFallback) {
      warnedFallback = true;
      // eslint-disable-next-line no-console
      console.warn(
        'react-native-mmkv native module is unavailable (Expo Go?). ' +
        'Falling back to an in-memory query cache — reloading the app clears it. ' +
        'Use a dev build for the real MMKV.',
        err,
      );
    }
    cachedKv = new InMemoryStore();
  }
  return cachedKv;
}

/**
 * Legacy export kept for anywhere the old direct-MMKV import lingers.
 * Prefer calling storage helpers rather than reaching into this.
 */
export const kv: StringKV = new Proxy({} as StringKV, {
  get(_target, prop: keyof StringKV) {
    const impl = getKv();
    const value = impl[prop];
    return typeof value === 'function' ? value.bind(impl) : value;
  },
});

const TOKEN_KEY = 'gatex.auth.bearer';

/**
 * Bearer tokens live in the platform secure keychain, never in the query
 * cache store. SecureStore itself is native — on web it silently no-ops
 * (returns null), on Expo Go it works for both iOS and Android.
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
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // Best-effort on platforms where clear is a no-op.
    }
  },
};

/**
 * Adapter that lets the TanStack Query async-storage persister talk to
 * whichever KV impl the lazy getter returns. The persister expects
 * promises; both real MMKV and the in-memory fallback are sync, so
 * wrapping is cheap.
 */
export const mmkvAsyncStorage = {
  getItem: (key: string) => Promise.resolve(getKv().getString(key) ?? null),
  setItem: (key: string, value: string) => {
    getKv().set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    getKv().delete(key);
    return Promise.resolve();
  },
};
