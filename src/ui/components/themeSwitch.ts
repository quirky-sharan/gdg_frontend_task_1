import type { I18n } from '../../i18n/i18n';
import type { Theme } from '../../preferences/preferences';
import { h, setAttr } from '../dom';
import { icon } from '../icons';
import { SettingRow } from './settingRow';

/** The dark-mode toggle: a button with the ARIA switch role. */
export class ThemeSwitch {
  readonly row: SettingRow;
  private readonly button: HTMLButtonElement;

  constructor(onChange: (theme: Theme) => void) {
    this.button = h(
      'button',
      { type: 'button', role: 'switch', id: 'dark-mode', class: 'switch', 'aria-checked': 'false' },
      h(
        'span',
        { class: 'switch__thumb' },
        icon('sun', 'switch__icon switch__icon--off'),
        icon('moon', 'switch__icon switch__icon--on'),
      ),
    );
    this.row = new SettingRow({
      field: 'theme',
      controlId: 'dark-mode',
      iconName: 'moon',
      labelKey: 'darkModeLabel',
      hintKey: 'darkModeHint',
      aside: this.button,
    });
    this.button.setAttribute('aria-describedby', this.row.hintId);
    this.button.addEventListener('click', () => {
      onChange(this.button.getAttribute('aria-checked') === 'true' ? 'light' : 'dark');
    });
  }

  render(theme: Theme, i18n: I18n): void {
    this.row.render(i18n);
    setAttr(this.button, 'aria-checked', String(theme === 'dark'));
  }
}
