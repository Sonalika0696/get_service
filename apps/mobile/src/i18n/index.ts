import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { kv } from '../lib/storage';
import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';
import kn from './kn.json';

/** Same MMKV key `app/account/language.tsx` has always written to. */
export const LANGUAGE_STORAGE_KEY = 'gatex.language';

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'mr', 'kn'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function isSupported(code: string | null | undefined): code is SupportedLanguage {
  return !!code && (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

/**
 * Resolves the language to boot with, in priority order:
 *  1. A choice the user already made and persisted via the Language screen.
 *  2. The device's own locale, when it happens to be one of the four we ship.
 *  3. English.
 * Each step is wrapped on its own — a storage failure still lets device-locale
 * detection run, and a `expo-localization` failure (e.g. on a locked-down web
 * host) still leaves the persisted/English choice intact. Nothing here can
 * throw past this function.
 */
function resolveInitialLanguage(): SupportedLanguage {
  try {
    const stored = kv.getString(LANGUAGE_STORAGE_KEY);
    if (isSupported(stored)) return stored;
  } catch {
    // Best-effort; fall through to device locale / English.
  }
  try {
    const deviceCode = Localization.getLocales()[0]?.languageCode;
    if (isSupported(deviceCode)) return deviceCode;
  } catch {
    // expo-localization can throw in odd web/SSR contexts; ignore.
  }
  return 'en';
}

try {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      mr: { translation: mr },
      kn: { translation: kn },
    },
    lng: resolveInitialLanguage(),
    fallbackLng: 'en',
    compatibilityJSON: 'v4',
    interpolation: {
      // React already escapes interpolated values when rendering text.
      escapeValue: false,
    },
  });
} catch {
  // If init itself throws (corrupt resource, unexpected native failure),
  // `useTranslation` still renders — react-i18next falls back to the raw
  // key rather than crashing the app.
}

/**
 * Switches the active language at runtime — every mounted `useTranslation`
 * consumer re-renders — and persists the choice under the same key the
 * Language screen has always used, so it survives app restarts. Best-effort:
 * a persistence failure still leaves the in-session language switched.
 */
export function setLanguage(code: SupportedLanguage): void {
  i18n.changeLanguage(code).catch(() => undefined);
  try {
    kv.set(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // Best-effort; language still switches for the current session.
  }
}

export default i18n;
