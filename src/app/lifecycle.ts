import type { Preferences } from '../preferences/preferences';
import type { Presence } from '../sync/presence';
import type { SyncedStore } from '../sync/store';

/**
 * Connects the sync layer to page lifecycle events:
 * - A hidden, frozen or back/forward-cached tab may miss messages, so it resyncs from storage
 *   and asks its peers for anything newer as soon as it is visible or restored again.
 * - Before the page is hidden or unloaded, pending storage checks run and peers are told the
 *   tab is leaving, so they update their tab count immediately.
 * - Unset preferences follow the OS colour scheme and browser language live.
 */
export function bindPageLifecycle(store: SyncedStore<Preferences>, presence: Presence): () => void {
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      store.resync();
      presence.resume();
    } else {
      store.flush();
      presence.pause();
    }
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted) return;
    store.resync();
    presence.resume();
  };
  const onPageHide = (): void => {
    store.flush();
    presence.leave();
  };
  const onResume = (): void => store.resync();
  const onEnvironmentChange = (): void => store.refreshDefaults();
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('resume', onResume);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('languagechange', onEnvironmentChange);
  colorScheme.addEventListener('change', onEnvironmentChange);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('resume', onResume);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('languagechange', onEnvironmentChange);
    colorScheme.removeEventListener('change', onEnvironmentChange);
  };
}
