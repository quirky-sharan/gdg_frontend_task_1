import type { I18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import { h, replayAnimation, setText } from '../dom';
import { icon, type IconName } from '../icons';

export interface SettingRowOptions {
  readonly field: string;
  /** Id of the form control the label points at. */
  readonly controlId: string;
  readonly iconName: IconName;
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
  /** Shown beside the label (a compact control, or a value badge). */
  readonly aside: Node;
  /** Shown below the label, for controls that need the full width. */
  readonly body?: Node;
}

/** Layout shared by every preference: icon, label and hint, plus the control. */
export class SettingRow {
  readonly element: HTMLDivElement;
  readonly hintId: string;
  private readonly labelText: HTMLSpanElement;
  private readonly hint: HTMLParagraphElement;

  constructor(private readonly options: SettingRowOptions) {
    this.hintId = `${options.controlId}-hint`;
    this.labelText = h('span');
    this.hint = h('p', { class: 'setting__hint', id: this.hintId });
    const label = h(
      'label',
      { class: 'setting__label', for: options.controlId },
      icon(options.iconName, 'icon setting__icon'),
      this.labelText,
    );
    const head = h(
      'div',
      { class: 'setting__head' },
      h('div', { class: 'setting__text' }, label, this.hint),
      options.aside,
    );
    this.element = h(
      'div',
      { class: options.body ? 'setting setting--stacked' : 'setting', 'data-field': options.field },
      head,
      options.body,
    );
  }

  render(i18n: I18n): void {
    setText(this.labelText, i18n.t(this.options.labelKey));
    setText(this.hint, i18n.t(this.options.hintKey));
  }

  /** Briefly highlights the row, signalling that another tab changed it. */
  highlight(): void {
    replayAnimation(this.element, 'is-updated');
  }
}
