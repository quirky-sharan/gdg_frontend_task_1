import type { I18n } from '../i18n/i18n';
import { isLanguage, LANGUAGES, type Preferences } from '../preferences/preferences';
import { shortId } from '../sync/ids';
import type { Primitive } from '../sync/types';

export type PreferenceKey = keyof Preferences;

export function fieldLabel(i18n: I18n, field: PreferenceKey): string {
  switch (field) {
    case 'theme':
      return i18n.t('darkModeLabel');
    case 'language':
      return i18n.t('languageLabel');
    case 'fontSize':
      return i18n.t('fontSizeLabel');
  }
}

/** Human-readable value of a preference, in the current UI language. */
export function formatValue(i18n: I18n, field: PreferenceKey, value: Primitive): string {
  switch (field) {
    case 'theme':
      return i18n.t(value === 'dark' ? 'valueOn' : 'valueOff');
    case 'language':
      return isLanguage(value) ? LANGUAGES[value].nativeName : String(value);
    case 'fontSize':
      return typeof value === 'number' ? i18n.px(value) : String(value);
  }
}

/**
 * Tab ids are shown as `#` plus their first four hex digits, wrapped in a left-to-right
 * isolate (LRI … PDI) so they keep reading `#a1b2` inside right-to-left text.
 */
export function tabLabel(nodeId: string): string {
  return `⁦#${shortId(nodeId)}⁩`;
}
