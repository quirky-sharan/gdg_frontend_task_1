import type { I18n } from '../../i18n/i18n';
import { h, setAttr, setText } from '../dom';
import { icon } from '../icons';

export type SyncStatus = 'alone' | 'in-sync' | 'syncing';

/** Header badge: number of open tabs and whether they all hold the same state. */
export class StatusPill {
  readonly element: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly text: HTMLSpanElement;

  constructor() {
    this.count = h('span', { class: 'status-pill__count' });
    this.text = h('span', { class: 'status-pill__text' });
    this.element = h(
      'div',
      { class: 'status-pill', 'data-sync': 'alone' },
      h('span', { class: 'status-pill__dot', 'aria-hidden': 'true' }),
      h('span', { class: 'status-pill__tabs' }, icon('tabs', 'icon icon--sm'), this.count),
      h('span', { class: 'status-pill__divider', 'aria-hidden': 'true' }),
      this.text,
    );
  }

  render(status: SyncStatus, tabCount: number, i18n: I18n): void {
    const label =
      status === 'alone'
        ? i18n.t('statusAlone')
        : i18n.t(status === 'in-sync' ? 'statusInSync' : 'statusSyncing');
    setAttr(this.element, 'data-sync', status);
    setText(this.count, i18n.integer(tabCount));
    setText(this.text, label);
    setAttr(
      this.element,
      'title',
      `${i18n.t('statOpenTabs')}: ${i18n.integer(tabCount)} · ${label}`,
    );
  }
}
