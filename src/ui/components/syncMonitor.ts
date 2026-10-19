import type { I18n } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import type { LatencySummary } from '../../sync/latency';
import type { PeerInfo } from '../../sync/presence';
import type { TransportKind } from '../../sync/transport';
import { h, setAttr, setText } from '../dom';
import { tabLabel } from '../format';
import { icon } from '../icons';

/** End-to-end delivery target from the requirements. */
const LATENCY_TARGET_MS = 100;

export interface MonitorView {
  readonly i18n: I18n;
  readonly selfId: string;
  readonly selfDigest: string;
  readonly peers: readonly PeerInfo[];
  /** Peers whose state has visibly lagged behind this tab's. */
  readonly diverged: ReadonlySet<string>;
  readonly transport: TransportKind;
  readonly storageAvailable: boolean;
  readonly latency: LatencySummary | null;
}

export interface MonitorActions {
  readonly openTab: () => void;
  readonly simulateConflict: () => void;
  readonly reset: () => void;
}

type StatKey = 'thisTab' | 'openTabs' | 'channel' | 'storage' | 'lastSync' | 'average';

const STAT_LABELS: Readonly<Record<StatKey, MessageKey>> = {
  thisTab: 'statThisTab',
  openTabs: 'statOpenTabs',
  channel: 'statChannel',
  storage: 'statStorage',
  lastSync: 'statLastSync',
  average: 'statAverage',
};

const CHANNEL_LABELS: Readonly<Record<TransportKind, MessageKey>> = {
  'broadcast-channel': 'channelBroadcast',
  'storage-event': 'channelStorage',
  none: 'channelNone',
};

interface Stat {
  readonly label: HTMLElement;
  readonly value: HTMLElement;
  readonly note: HTMLElement;
}

/** Diagnostics: connection details, latency, every connected tab's state digest, and actions. */
export class SyncMonitor {
  readonly element: HTMLElement;
  private readonly title: HTMLHeadingElement;
  private readonly hint: HTMLParagraphElement;
  private readonly stats: Readonly<Record<StatKey, Stat>>;
  private readonly peersTitle: HTMLHeadingElement;
  private readonly peerList: HTMLUListElement;
  private readonly openTabLabel: HTMLSpanElement;
  private readonly conflictLabel: HTMLSpanElement;
  private readonly resetLabel: HTMLSpanElement;
  private readonly conflictButton: HTMLButtonElement;
  private readonly actionsHint: HTMLParagraphElement;
  private peerListKey = '';

  constructor(actions: MonitorActions) {
    this.title = h('h2', { class: 'card__title', id: 'monitor-title' });
    this.hint = h('p', { class: 'card__hint' });

    const statList = h('dl', { class: 'stats' });
    const stats: Partial<Record<StatKey, Stat>> = {};
    for (const key of Object.keys(STAT_LABELS) as StatKey[]) {
      const stat: Stat = {
        label: h('dt', { class: 'stat__label' }),
        value: h('span', { class: 'stat__value', 'data-stat': key }),
        note: h('span', { class: 'stat__note' }),
      };
      stats[key] = stat;
      statList.append(h('div', { class: 'stat' }, stat.label, h('dd', {}, stat.value, stat.note)));
    }
    this.stats = stats as Record<StatKey, Stat>;

    this.peersTitle = h('h3', { class: 'subhead' });
    this.peerList = h('ul', { class: 'peers', 'data-testid': 'peer-list' });

    this.openTabLabel = h('span');
    this.conflictLabel = h('span');
    this.resetLabel = h('span');
    const openTab = h(
      'button',
      { type: 'button', class: 'button button--primary', 'data-action': 'open-tab' },
      icon('externalLink', 'icon icon--directional'),
      this.openTabLabel,
    );
    this.conflictButton = h(
      'button',
      { type: 'button', class: 'button', 'data-action': 'simulate-conflict' },
      icon('shuffle'),
      this.conflictLabel,
    );
    const reset = h(
      'button',
      { type: 'button', class: 'button button--ghost', 'data-action': 'reset' },
      icon('rotateCcw'),
      this.resetLabel,
    );
    openTab.addEventListener('click', actions.openTab);
    this.conflictButton.addEventListener('click', actions.simulateConflict);
    reset.addEventListener('click', actions.reset);
    this.actionsHint = h('p', { class: 'actions__hint', id: 'actions-hint' });
    this.conflictButton.setAttribute('aria-describedby', 'actions-hint');

    this.element = h(
      'section',
      { class: 'card monitor', 'aria-labelledby': 'monitor-title' },
      h('div', { class: 'card__header' }, this.title, this.hint),
      statList,
      this.peersTitle,
      this.peerList,
      h('div', { class: 'actions' }, openTab, this.conflictButton, reset),
      this.actionsHint,
    );
  }

  render(view: MonitorView): void {
    const { i18n, latency } = view;
    setText(this.title, i18n.t('monitorTitle'));
    setText(this.hint, i18n.t('monitorHint'));
    for (const key of Object.keys(STAT_LABELS) as StatKey[]) {
      setText(this.stats[key].label, i18n.t(STAT_LABELS[key]));
    }

    this.setStat('thisTab', tabLabel(view.selfId));
    this.setStat('openTabs', i18n.integer(view.peers.length + 1));
    this.setStat('channel', i18n.t(CHANNEL_LABELS[view.transport]), view.transport !== 'none');
    this.setStat(
      'storage',
      i18n.t(view.storageAvailable ? 'storageOk' : 'storageUnavailable'),
      view.storageAvailable,
    );
    const noData = '—';
    this.setStat('lastSync', latency ? i18n.ms(latency.last) : noData);
    this.setStat(
      'average',
      latency ? `${i18n.ms(latency.mean)} · ${i18n.ms(latency.p95)}` : noData,
    );
    const target = i18n.t('latencyTarget', { value: i18n.ms(LATENCY_TARGET_MS) });
    setText(this.stats.average.note, target);
    setAttr(
      this.stats.average.note,
      'data-state',
      latency === null ? null : latency.p95 < LATENCY_TARGET_MS ? 'ok' : 'warn',
    );

    setText(this.peersTitle, i18n.t('peersTitle'));
    this.renderPeers(view);

    setText(this.openTabLabel, i18n.t('actionOpenTab'));
    setText(this.conflictLabel, i18n.t('actionConflict'));
    setText(this.resetLabel, i18n.t('actionReset'));
    this.conflictButton.disabled = view.peers.length === 0;
    setText(
      this.actionsHint,
      i18n.t(view.peers.length === 0 ? 'conflictNeedsPeers' : 'conflictHint'),
    );
  }

  private setStat(key: StatKey, value: string, healthy = true): void {
    setText(this.stats[key].value, value);
    setAttr(this.stats[key].value, 'data-state', healthy ? null : 'warn');
  }

  private renderPeers({ i18n, selfId, selfDigest, peers, diverged }: MonitorView): void {
    const rows = [
      { id: selfId, digest: selfDigest, info: i18n.t('peerThisTab'), self: true, inSync: true },
      ...peers.map((peer) => ({
        id: peer.id,
        digest: peer.digest,
        info: peer.rttMs === null ? '' : i18n.t('peerRtt', { value: i18n.ms(peer.rttMs) }),
        self: false,
        inSync: !diverged.has(peer.id),
      })),
    ];
    const key = `${i18n.language}|${rows
      .map((row) => `${row.id}:${row.digest}:${row.info}:${row.inSync}`)
      .join(',')}`;
    if (key === this.peerListKey) return;
    this.peerListKey = key;

    this.peerList.replaceChildren(
      ...rows.map(({ id, digest, info, self, inSync }) =>
        h(
          'li',
          {
            class: self ? 'peer peer--self' : 'peer',
            'data-peer': id,
            'data-in-sync': String(inSync),
          },
          h('span', { class: 'peer__dot', 'aria-hidden': 'true' }),
          h('code', { class: 'peer__id' }, tabLabel(id)),
          h('span', { class: 'peer__info' }, info),
          h('code', { class: 'peer__digest', title: i18n.t('statState') }, digest),
          h(
            'span',
            { class: 'peer__state' },
            icon(inSync ? 'check' : 'refresh', 'icon icon--sm'),
            h(
              'span',
              { class: 'visually-hidden' },
              i18n.t(inSync ? 'statusInSync' : 'statusSyncing'),
            ),
          ),
        ),
      ),
    );
  }
}
