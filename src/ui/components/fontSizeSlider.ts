import type { I18n } from '../../i18n/i18n';
import { FONT_SIZE, isFontSize } from '../../preferences/preferences';
import { h, setAttr, setText } from '../dom';
import { SettingRow } from './settingRow';

/**
 * Range input for the root font size. It reports every `input` event, so other tabs follow
 * the thumb live while it is being dragged, not just when it is released.
 */
export class FontSizeSlider {
  readonly row: SettingRow;
  private readonly input: HTMLInputElement;
  private readonly output: HTMLOutputElement;

  constructor(onChange: (fontSize: number) => void) {
    this.input = h('input', {
      type: 'range',
      id: 'font-size',
      class: 'slider__input',
      min: FONT_SIZE.min,
      max: FONT_SIZE.max,
      step: FONT_SIZE.step,
    });
    this.output = h('output', { class: 'badge', for: 'font-size' });
    this.row = new SettingRow({
      field: 'fontSize',
      controlId: 'font-size',
      iconName: 'type',
      labelKey: 'fontSizeLabel',
      hintKey: 'fontSizeHint',
      aside: this.output,
      body: h(
        'div',
        { class: 'slider' },
        h('span', { class: 'slider__glyph slider__glyph--small', 'aria-hidden': 'true' }, 'A'),
        this.input,
        h('span', { class: 'slider__glyph slider__glyph--large', 'aria-hidden': 'true' }, 'A'),
      ),
    });
    this.input.setAttribute('aria-describedby', this.row.hintId);
    this.input.addEventListener('input', () => {
      const value = Number(this.input.value);
      if (isFontSize(value)) onChange(value);
    });
  }

  render(fontSize: number, i18n: I18n): void {
    this.row.render(i18n);
    if (this.input.value !== String(fontSize)) this.input.value = String(fontSize);
    const label = i18n.px(fontSize);
    setAttr(this.input, 'aria-valuetext', label);
    setText(this.output, label);
    const fill = ((fontSize - FONT_SIZE.min) / (FONT_SIZE.max - FONT_SIZE.min)) * 100;
    this.input.style.setProperty('--fill', `${fill}%`);
  }
}
