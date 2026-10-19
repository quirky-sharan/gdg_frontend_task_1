import type { ConflictTest } from '../app/conflictTest';
import { getI18n, type I18n } from '../i18n/i18n';
import { applyPreferences } from '../preferences/apply';
import { defaultPreferences, type Preferences } from '../preferences/preferences';
import { LatencyTracker } from '../sync/latency';
import type { Presence } from '../sync/presence';
import type { StoreEvent, SyncedStore } from '../sync/store';
import type { TransportKind } from '../sync/transport';
import { ActivityLog } from './components/activityLog';
import { FontSizeSlider } from './components/fontSizeSlider';
import { LanguageSelect } from './components/languageSelect';
import { PreviewCard } from './components/previewCard';
import { StatusPill, type SyncStatus } from './components/statusPill';
import { SyncMonitor } from './components/syncMonitor';
import { ThemeSwitch } from './components/themeSwitch';
import { ConvergenceTracker } from './convergence';
import { h, setText } from './dom';
import { icon } from './icons';

export interface AppDependencies {
  readonly store: SyncedStore<Preferences>;
  readonly presence: Presence;
  readonly conflictTest: ConflictTest;
  readonly transportKind: TransportKind;
  readonly isStorageAvailable: () => boolean;
}

/** How long a tab's digest may lag behind before it is shown as out of sync. */
const SYNCING_GRACE_MS = 400;

/** Builds the UI inside `root` and keeps it in step with the store. Returns an unmount function. */
export function mountApp(root: HTMLElement, deps: AppDependencies): () => void {
  const { store, presence, conflictTest } = deps;
  const latency = new LatencyTracker();

  const themeSwitch = new ThemeSwitch((theme) => store.set('theme', theme));
  const languageSelect = new LanguageSelect((language) => store.set('language', language));
  const fontSizeSlider = new FontSizeSlider((fontSize) => store.set('fontSize', fontSize));
  const rows = {
    theme: themeSwitch.row,
    language: languageSelect.row,
    fontSize: fontSizeSlider.row,
  } as const;
  const preview = new PreviewCard();
  const statusPill = new StatusPill();
  const monitor = new SyncMonitor({
    openTab: () => window.open(window.location.href, '_blank', 'noopener'),
    simulateConflict: () => conflictTest.start(),
    reset: () => store.update(defaultPreferences()),
  });
  let i18n: I18n = getI18n(store.getState().language);
  const log = new ActivityLog(store.nodeId, i18n);

  const title = h('h1', { class: 'brand__title' });
  const tagline = h('p', { class: 'brand__tagline' });
  const preferencesTitle = h('h2', { class: 'card__title', id: 'preferences-title' });
  const footer = h('footer', { class: 'footer' });

  root.replaceChildren(
    h(
      'div',
      { class: 'app' },
      h(
        'header',
        { class: 'topbar' },
        h(
          'div',
          { class: 'brand' },
          h('span', { class: 'brand__mark', 'aria-hidden': 'true' }, icon('layers')),
          h('div', { class: 'brand__text' }, title, tagline),
        ),
        statusPill.element,
      ),
      h(
        'main',
        { class: 'layout' },
        h(
          'div',
          { class: 'column' },
          h(
            'section',
            { class: 'card', 'aria-labelledby': 'preferences-title' },
            preferencesTitle,
            h(
              'div',
              { class: 'settings' },
              rows.theme.element,
              rows.language.element,
              rows.fontSize.element,
            ),
          ),
          preview.element,
        ),
        h('div', { class: 'column' }, monitor.element, log.element),
      ),
      footer,
    ),
  );

  const convergence = new ConvergenceTracker(SYNCING_GRACE_MS, () => render());

  function render(): void {
    const state = store.getState();
    const nextI18n = getI18n(state.language);
    if (nextI18n !== i18n) {
      i18n = nextI18n;
      log.setI18n(i18n);
    }

    document.title = i18n.t('appTitle');
    setText(title, i18n.t('appTitle'));
    setText(tagline, i18n.t('appTagline'));
    setText(preferencesTitle, i18n.t('preferencesTitle'));
    setText(footer, i18n.t('footer'));
    themeSwitch.render(state.theme, i18n);
    languageSelect.render(state.language, i18n);
    fontSizeSlider.render(state.fontSize, i18n);
    preview.render(i18n);
    const peers = presence.getPeers();
    const ownDigest = store.digest();
    const diverged = convergence.diverged(peers, ownDigest);
    const status: SyncStatus =
      peers.length === 0 ? 'alone' : diverged.size > 0 ? 'syncing' : 'in-sync';
    statusPill.render(status, peers.length + 1, i18n);
    monitor.render({
      i18n,
      selfId: store.nodeId,
      selfDigest: ownDigest,
      peers,
      diverged,
      transport: deps.transportKind,
      storageAvailable: deps.isStorageAvailable(),
      latency: latency.summary(),
    });
  }

  function onStoreEvent(event: StoreEvent<Preferences>): void {
    switch (event.type) {
      case 'change': {
        // Apply to the document first: this is what the user sees, so it must not wait.
        applyPreferences(document, store.getState());
        const entries = store.getEntries();
        for (const key of event.keys) {
          log.add({
            kind: 'change',
            field: key,
            value: entries[key].value,
            source: event.source,
            origin: event.source === 'local' ? store.nodeId : entries[key].ts.node,
            latencyMs: event.latencyMs,
          });
          if (event.source === 'remote' || event.source === 'storage') rows[key].highlight();
        }
        presence.refreshSoon();
        break;
      }
      case 'conflict':
        log.add({ kind: 'conflict', field: event.key, winner: event.winner, loser: event.loser });
        break;
      case 'repair':
        log.add({ kind: 'repair', fields: event.keys });
        break;
      case 'delivered':
        // A change event (and render) follows whenever the message changed anything.
        latency.record(event.latencyMs);
        return;
    }
    render();
  }

  const disposers = [
    store.subscribe(onStoreEvent),
    presence.subscribe((event) => {
      for (const peer of event.joined) log.add({ kind: 'peer', peer, joined: true });
      for (const peer of event.left) log.add({ kind: 'peer', peer, joined: false });
      render();
    }),
    conflictTest.subscribe(({ initiator }) => {
      log.add({ kind: 'conflict-test', initiator });
      render();
    }),
  ];

  applyPreferences(document, store.getState());
  render();
  document.documentElement.classList.add('is-ready');

  return () => {
    for (const dispose of disposers) dispose();
    convergence.dispose();
    root.replaceChildren();
  };
}
