import type { I18n } from '../../i18n/i18n';
import { h, setText } from '../dom';

/** Sample text rendered with the current theme, language and font size. */
export class PreviewCard {
  readonly element: HTMLElement;
  private readonly title: HTMLHeadingElement;
  private readonly heading: HTMLParagraphElement;
  private readonly body: HTMLParagraphElement;

  constructor() {
    this.title = h('h2', { class: 'card__title', id: 'preview-title' });
    this.heading = h('p', { class: 'preview__heading' });
    this.body = h('p', { class: 'preview__body' });
    this.element = h(
      'section',
      { class: 'card preview', 'aria-labelledby': 'preview-title' },
      this.title,
      this.heading,
      this.body,
    );
  }

  render(i18n: I18n): void {
    setText(this.title, i18n.t('previewTitle'));
    setText(this.heading, i18n.t('previewHeading'));
    setText(this.body, i18n.t('previewBody'));
  }
}
