import type { I18n } from '../../i18n/i18n';
import {
  isLanguage,
  LANGUAGE_CODES,
  LANGUAGES,
  type Language,
} from '../../preferences/preferences';
import { h } from '../dom';
import { icon } from '../icons';
import { SettingRow } from './settingRow';

/** Native <select> listing every language by its own name, so anyone can find theirs. */
export class LanguageSelect {
  readonly row: SettingRow;
  private readonly select: HTMLSelectElement;

  constructor(onChange: (language: Language) => void) {
    this.select = h(
      'select',
      { id: 'language', class: 'select__control' },
      ...LANGUAGE_CODES.map((code) =>
        h('option', { value: code, lang: code }, LANGUAGES[code].nativeName),
      ),
    );
    this.row = new SettingRow({
      field: 'language',
      controlId: 'language',
      iconName: 'globe',
      labelKey: 'languageLabel',
      hintKey: 'languageHint',
      aside: h(
        'div',
        { class: 'select' },
        this.select,
        icon('chevronDown', 'icon select__chevron'),
      ),
    });
    this.select.setAttribute('aria-describedby', this.row.hintId);
    this.select.addEventListener('change', () => {
      if (isLanguage(this.select.value)) onChange(this.select.value);
    });
  }

  render(language: Language, i18n: I18n): void {
    this.row.render(i18n);
    if (this.select.value !== language) this.select.value = language;
  }
}
