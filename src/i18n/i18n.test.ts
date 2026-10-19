import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from '../preferences/preferences';
import { getI18n } from './i18n';
import { catalogs, type MessageKey } from './messages';

const placeholders = (template: string) =>
  [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('message catalogues', () => {
  const reference = catalogs.en;
  const keys = Object.keys(reference) as MessageKey[];

  it.each(LANGUAGE_CODES)('%s has every key with the same placeholders as English', (language) => {
    const catalog = catalogs[language];
    expect(Object.keys(catalog).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(catalog[key].trim(), `${language}.${key}`).not.toBe('');
      expect(placeholders(catalog[key]), `${language}.${key}`).toEqual(
        placeholders(reference[key]),
      );
    }
  });
});

describe('I18n', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    const i18n = getI18n('en');
    expect(i18n.t('metaFromTab', { tab: '#ab12' })).toBe('From tab #ab12');
    expect(i18n.t('metaFromTab')).toBe('From tab {tab}');
  });

  it('formats numbers and durations for the locale', () => {
    expect(getI18n('en').px(18)).toBe('18 px');
    expect(getI18n('en').ms(0.4234)).toBe('0.42 ms');
    expect(getI18n('en').ms(42.26)).toBe('42.3 ms');
    expect(getI18n('en').ms(250)).toBe('250 ms');
    expect(getI18n('de').ms(0.5)).toMatch(/^0,50\s?ms$/);
  });

  it('joins lists with the locale conjunction', () => {
    expect(getI18n('en').list(['Language', 'Font size'])).toBe('Language and Font size');
    expect(getI18n('es').list(['Idioma', 'Tamaño de letra'])).toBe('Idioma y Tamaño de letra');
  });

  it('caches one instance per language', () => {
    expect(getI18n('fr')).toBe(getI18n('fr'));
  });
});
