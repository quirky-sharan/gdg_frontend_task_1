import type { I18n } from '../../i18n/i18n';
import type { Entry } from '../../sync/lww';
import type { ChangeSource } from '../../sync/store';
import type { Primitive } from '../../sync/types';
import { h, setText } from '../dom';
import { fieldLabel, formatValue, tabLabel, type PreferenceKey } from '../format';

export type LogEntry =
  | {
      readonly kind: 'change';
      readonly field: PreferenceKey;
      readonly value: Primitive;
      readonly source: ChangeSource;
      /** Tab that wrote the value. */
      readonly origin: string;
      readonly latencyMs: number | null;
    }
  | {
      readonly kind: 'conflict';
      readonly field: PreferenceKey;
      readonly winner: Entry;
      readonly loser: Entry;
    }
  | { readonly kind: 'repair'; readonly fields: readonly PreferenceKey[] }
  | { readonly kind: 'peer'; readonly peer: string; readonly joined: boolean }
  | { readonly kind: 'conflict-test'; readonly initiator: string };

interface LogItem {
  entry: LogEntry;
  time: number;
  readonly element: HTMLLIElement;
}

const MAX_ITEMS = 40;
/** Consecutive changes of one field from one source merge into one line (e.g. slider drags). */
const COALESCE_WINDOW_MS = 1500;

/** Chronological record of everything the sync layer did, newest first. */
export class ActivityLog {
  readonly element: HTMLElement;
  private readonly title: HTMLHeadingElement;
  private readonly list: HTMLOListElement;
  private readonly empty: HTMLParagraphElement;
  private readonly items: LogItem[] = [];
  private i18n: I18n;

  constructor(
    private readonly selfId: string,
    i18n: I18n,
    private readonly now: () => number = Date.now,
  ) {
    this.i18n = i18n;
    this.title = h('h2', { class: 'card__title', id: 'activity-title' });
    this.list = h('ol', { class: 'log', 'data-testid': 'activity-log' });
    this.empty = h('p', { class: 'log__empty' });
    this.element = h(
      'section',
      { class: 'card activity', 'aria-labelledby': 'activity-title' },
      this.title,
      this.empty,
      this.list,
    );
    this.renderChrome();
  }

  add(entry: LogEntry): void {
    const time = this.now();
    const newest = this.items[0];
    if (newest !== undefined && canCoalesce(newest, entry, time)) {
      newest.entry = entry;
      newest.time = time;
      this.renderItem(newest);
      return;
    }
    const item: LogItem = { entry, time, element: h('li') };
    this.renderItem(item);
    this.items.unshift(item);
    this.list.prepend(item.element);
    for (const stale of this.items.splice(MAX_ITEMS)) stale.element.remove();
    this.renderChrome();
  }

  setI18n(i18n: I18n): void {
    if (i18n === this.i18n) return;
    this.i18n = i18n;
    this.renderChrome();
    for (const item of this.items) this.renderItem(item);
  }

  private renderChrome(): void {
    setText(this.title, this.i18n.t('activityTitle'));
    setText(this.empty, this.i18n.t('activityEmpty'));
    this.empty.hidden = this.items.length > 0;
  }

  private renderItem(item: LogItem): void {
    const { text, meta, tone } = this.describe(item.entry);
    item.element.className = `log__item log__item--${tone}`;
    item.element.replaceChildren(
      h('span', { class: 'log__dot', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'log__body' },
        h('p', { class: 'log__text' }, text),
        meta ? h('p', { class: 'log__meta' }, meta) : null,
      ),
      h(
        'time',
        { class: 'log__time', datetime: new Date(item.time).toISOString() },
        this.i18n.time(item.time),
      ),
    );
  }

  private describe(entry: LogEntry): { text: string; meta: string; tone: string } {
    const i18n = this.i18n;
    switch (entry.kind) {
      case 'change':
        return {
          text: i18n.t('logChange', {
            field: fieldLabel(i18n, entry.field),
            value: formatValue(i18n, entry.field, entry.value),
          }),
          meta: this.describeSource(entry),
          tone: entry.source,
        };
      case 'conflict':
        return {
          text: i18n.t('logConflict', {
            field: fieldLabel(i18n, entry.field),
            winner: formatValue(i18n, entry.field, entry.winner.value),
            loser: formatValue(i18n, entry.field, entry.loser.value),
          }),
          meta: i18n.t('logConflictMeta', {
            winnerTab: tabLabel(entry.winner.ts.node),
            loserTab: tabLabel(entry.loser.ts.node),
          }),
          tone: 'conflict',
        };
      case 'repair':
        return {
          text: i18n.t('logRepair', {
            fields: i18n.list(entry.fields.map((field) => fieldLabel(i18n, field))),
          }),
          meta: '',
          tone: 'repair',
        };
      case 'peer':
        return {
          text: i18n.t(entry.joined ? 'logPeerJoined' : 'logPeerLeft', {
            tab: tabLabel(entry.peer),
          }),
          meta: '',
          tone: 'peer',
        };
      case 'conflict-test':
        return {
          text: i18n.t('logConflictTest'),
          meta: this.describeTab(entry.initiator),
          tone: 'test',
        };
    }
  }

  private describeSource(entry: Extract<LogEntry, { kind: 'change' }>): string {
    const i18n = this.i18n;
    switch (entry.source) {
      case 'local':
        return i18n.t('metaThisTab');
      case 'remote': {
        const from = this.describeTab(entry.origin);
        return entry.latencyMs === null ? from : `${from} · ${i18n.ms(entry.latencyMs)}`;
      }
      case 'storage':
        return i18n.t('metaStorage', { tab: tabLabel(entry.origin) });
      case 'default':
        return i18n.t('metaSystem');
    }
  }

  private describeTab(nodeId: string): string {
    return nodeId === this.selfId
      ? this.i18n.t('metaThisTab')
      : this.i18n.t('metaFromTab', { tab: tabLabel(nodeId) });
  }
}

function canCoalesce(newest: LogItem, entry: LogEntry, time: number): boolean {
  const previous = newest.entry;
  return (
    previous.kind === 'change' &&
    entry.kind === 'change' &&
    previous.field === entry.field &&
    previous.source === entry.source &&
    previous.origin === entry.origin &&
    time - newest.time < COALESCE_WINDOW_MS
  );
}
