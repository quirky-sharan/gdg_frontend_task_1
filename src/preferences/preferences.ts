import type { Schema } from '../sync/types';

/** Prefix of every storage key. Bump the version if the stored format ever changes. */
export const STORAGE_NAMESPACE = 'settings-sync:v1';
/** Name of the BroadcastChannel shared by all tabs. */
export const CHANNEL_NAME = 'settings-sync:v1';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Page background of each theme, mirrored in `theme-color` for the browser's own UI. */
export const THEME_BACKGROUND: Readonly<Record<Theme, string>> = {
  light: '#f4f5f9',
  dark: '#0e1016',
};

export const LANGUAGES = {
  en: { nativeName: 'English', dir: 'ltr' },
  es: { nativeName: 'Español', dir: 'ltr' },
  fr: { nativeName: 'Français', dir: 'ltr' },
  de: { nativeName: 'Deutsch', dir: 'ltr' },
  hi: { nativeName: 'हिन्दी', dir: 'ltr' },
  ja: { nativeName: '日本語', dir: 'ltr' },
  ar: { nativeName: 'العربية', dir: 'rtl' },
} as const satisfies Record<string, { nativeName: string; dir: 'ltr' | 'rtl' }>;

export type Language = keyof typeof LANGUAGES;
export const LANGUAGE_CODES = Object.keys(LANGUAGES) as Language[];

export const FONT_SIZE = { min: 12, max: 24, step: 1, default: 16 } as const;

export type Preferences = {
  theme: Theme;
  language: Language;
  /** Root font size in CSS pixels; every rem-based size in the UI scales with it. */
  fontSize: number;
};

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && Object.hasOwn(LANGUAGES, value);
}

export function isFontSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= FONT_SIZE.min &&
    value <= FONT_SIZE.max
  );
}

/** The operating system's colour scheme. */
export function systemTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** First supported language among BCP 47 tags such as `navigator.languages`, else English. */
export function pickLanguage(tags: readonly string[]): Language {
  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

export function browserLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  return pickLanguage(navigator.languages.length > 0 ? navigator.languages : [navigator.language]);
}

/**
 * Until a preference is explicitly set, it follows the environment: the OS colour scheme and
 * the browser's language. Every tab derives the same defaults, so they are never replicated.
 */
export const preferencesSchema: Schema<Preferences> = {
  theme: { defaultValue: systemTheme, isValid: isTheme },
  language: { defaultValue: browserLanguage, isValid: isLanguage },
  fontSize: { defaultValue: () => FONT_SIZE.default, isValid: isFontSize },
};

export function defaultPreferences(): Preferences {
  return { theme: systemTheme(), language: browserLanguage(), fontSize: FONT_SIZE.default };
}
