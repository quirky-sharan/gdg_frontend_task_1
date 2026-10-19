import { afterEach, describe, expect, it } from 'vitest';
import { applyPreferences } from './apply';
import {
  FONT_SIZE,
  isFontSize,
  isLanguage,
  isTheme,
  LANGUAGE_CODES,
  pickLanguage,
  preferencesSchema,
  THEME_BACKGROUND,
} from './preferences';

describe('validators', () => {
  it('accept exactly the supported values', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('sepia')).toBe(false);
    expect(LANGUAGE_CODES.every(isLanguage)).toBe(true);
    expect(isLanguage('xx')).toBe(false);
    expect(isLanguage('toString')).toBe(false);
    expect(isFontSize(FONT_SIZE.min)).toBe(true);
    expect(isFontSize(FONT_SIZE.max)).toBe(true);
    expect(isFontSize(FONT_SIZE.max + 1)).toBe(false);
    expect(isFontSize(16.5)).toBe(false);
    expect(isFontSize('16')).toBe(false);
  });

  it('ship valid defaults', () => {
    for (const spec of Object.values(preferencesSchema)) {
      expect(spec.isValid(spec.defaultValue())).toBe(true);
    }
  });
});

describe('pickLanguage', () => {
  it('returns the first supported language, matching on the base subtag', () => {
    expect(pickLanguage(['pt-BR', 'fr-CA', 'en'])).toBe('fr');
    expect(pickLanguage(['JA'])).toBe('ja');
  });

  it('falls back to English', () => {
    expect(pickLanguage(['pt-BR'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });
});

describe('applyPreferences', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
    document.head.replaceChildren();
  });

  it('reflects every preference on the root element', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    applyPreferences(document, { theme: 'dark', language: 'ar', fontSize: 20 });
    const root = document.documentElement;
    expect(root.dataset['theme']).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(root.style.fontSize).toBe('20px');
    expect(root.lang).toBe('ar');
    expect(root.dir).toBe('rtl');
    expect(meta.content).toBe(THEME_BACKGROUND.dark);

    applyPreferences(document, { theme: 'light', language: 'hi', fontSize: 12 });
    expect(root.dataset['theme']).toBe('light');
    expect(root.dir).toBe('ltr');
    expect(meta.content).toBe(THEME_BACKGROUND.light);
  });
});
