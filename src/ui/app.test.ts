import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictTest } from '../app/conflictTest';
import { preferencesSchema, STORAGE_NAMESPACE } from '../preferences/preferences';
import { EntryPersistence } from '../sync/persistence';
import { Presence } from '../sync/presence';
import { SyncedStore } from '../sync/store';
import { FakeBrowser } from '../test/fakeBrowser';
import { mountApp } from './app';

/*
 * Mounts the real UI for one tab inside jsdom, connected through the fake browser to a second,
 * headless tab, and drives both sides.
 */

const cleanups: (() => void)[] = [];

function createTab(browser: FakeBrowser, nodeId: string) {
  const tab = browser.openTab();
  const persistence = new EntryPersistence({
    schema: preferencesSchema,
    storage: tab.storage,
    namespace: STORAGE_NAMESPACE,
    changes: tab.changes,
  });
  const store = new SyncedStore({
    schema: preferencesSchema,
    persistence,
    transport: tab.transport,
    nodeId,
  });
  const presence = new Presence({ transport: tab.transport, nodeId, digest: () => store.digest() });
  const conflictTest = new ConflictTest({ transport: tab.transport, store });
  cleanups.push(() => {
    presence.stop();
    conflictTest.destroy();
    store.destroy();
  });
  return { tab, store, presence, persistence, conflictTest };
}

function setup() {
  const browser = new FakeBrowser();
  const local = createTab(browser, 'aaaa11112222');
  const other = createTab(browser, 'bbbb33334444');
  const root = document.createElement('div');
  document.body.append(root);
  const unmount = mountApp(root, {
    store: local.store,
    presence: local.presence,
    conflictTest: local.conflictTest,
    transportKind: 'broadcast-channel',
    isStorageAvailable: () => local.persistence.isAvailable,
  });
  cleanups.push(() => {
    unmount();
    root.remove();
  });
  for (const { store, presence } of [local, other]) {
    store.start();
    presence.start();
  }
  browser.deliverInOrder();
  /** Finds an element and checks its type, e.g. `$('#language', HTMLSelectElement)`. */
  const $ = <E extends Element = HTMLElement>(
    selector: string,
    type: abstract new () => E = HTMLElement as unknown as abstract new () => E,
  ): E => {
    const element = root.querySelector(selector);
    if (!(element instanceof type)) throw new Error(`missing ${selector}`);
    return element;
  };
  return { browser, local, other, root, $ };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('mountApp', () => {
  it('renders the current preferences', () => {
    const { $ } = setup();
    expect($('#dark-mode').getAttribute('aria-checked')).toBe('false');
    expect($('#language', HTMLSelectElement).value).toBe('en');
    expect($('#font-size', HTMLInputElement).value).toBe('16');
    expect($('.badge').textContent).toBe('16 px');
    expect(document.title).toBe('Settings Sync');
  });

  it('writes local edits and broadcasts them to the other tab', () => {
    const { browser, other, $ } = setup();
    $('#dark-mode', HTMLButtonElement).click();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect($('#dark-mode').getAttribute('aria-checked')).toBe('true');

    const slider = $('#font-size', HTMLInputElement);
    slider.value = '21';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.documentElement.style.fontSize).toBe('21px');

    browser.deliverInOrder();
    expect(other.store.getState()).toMatchObject({ theme: 'dark', fontSize: 21 });
  });

  it('applies changes made in another tab without a reload', () => {
    const { browser, other, $, root } = setup();
    other.store.update({ language: 'ar', fontSize: 14 });
    browser.deliverInOrder();

    expect($('#language', HTMLSelectElement).value).toBe('ar');
    expect($('#font-size', HTMLInputElement).value).toBe('14');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.title).toBe('مزامنة الإعدادات');
    expect($('[data-field="language"]').className).toMatch(/is-updated-[ab]/);
    const newest = root.querySelector('.log__item');
    expect(newest?.classList.contains('log__item--remote')).toBe(true);
  });

  it('shows the connected tabs and whether they are in sync', () => {
    const { browser, $, root } = setup();
    expect($('.status-pill').getAttribute('data-sync')).toBe('in-sync');
    expect($('.status-pill__count').textContent).toBe('2');
    expect(root.querySelectorAll('.peer')).toHaveLength(2);

    $('#dark-mode', HTMLButtonElement).click();
    // The peer's digest is stale until the next ping round, but within the grace period.
    expect($('.status-pill').getAttribute('data-sync')).toBe('in-sync');
    vi.advanceTimersByTime(100); // Refresh ping.
    browser.deliverInOrder();
    vi.advanceTimersByTime(1_000);
    expect($('.status-pill').getAttribute('data-sync')).toBe('in-sync');
  });

  it('reports a tab whose state stays different as syncing', () => {
    const { $, other } = setup();
    other.tab.closed = true; // It stops receiving anything, but is still listed for now.
    $('#dark-mode', HTMLButtonElement).click();
    vi.advanceTimersByTime(500);
    expect($('.status-pill').getAttribute('data-sync')).toBe('syncing');
    expect($('.peer:not(.peer--self)').getAttribute('data-in-sync')).toBe('false');
  });

  it('logs concurrent edits as a resolved conflict', () => {
    const { browser, local, other, root } = setup();
    local.store.set('fontSize', 13);
    other.store.set('fontSize', 23);
    browser.deliverInOrder();
    const conflict = root.querySelector('.log__item--conflict');
    expect(conflict?.textContent).toContain('Concurrent edits to Font size');
    expect(local.store.getState().fontSize).toBe(other.store.getState().fontSize);
  });

  it('re-translates the activity log when the language changes', () => {
    const { $, root } = setup();
    $('#dark-mode', HTMLButtonElement).click();
    expect(root.querySelector('.log__text')?.textContent).toBe('Dark mode → on');
    const select = $('#language', HTMLSelectElement);
    select.value = 'de';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const lines = [...root.querySelectorAll('.log__text')].map((node) => node.textContent);
    expect(lines).toEqual(['Sprache → Deutsch', 'Dunkelmodus → an', 'Tab ⁦#bbbb⁩ verbunden']);
  });
});
