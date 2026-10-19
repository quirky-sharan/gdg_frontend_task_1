/**
 * Pre-paint boot script.
 *
 * The build bundles and minifies this file and inlines it into the <head> of index.html
 * (see `inlineBootScript` in vite.config.ts). It runs synchronously while the head is parsed,
 * before the first frame and before any module script, and applies the stored theme, language
 * and font size. A newly opened tab therefore never shows the wrong theme, not even for a frame.
 *
 * localStorage is used precisely because it can be read synchronously here; IndexedDB could
 * not be read before the first paint.
 */
import { applyPreferences } from './preferences/apply';
import { preferencesSchema, STORAGE_NAMESPACE } from './preferences/preferences';
import { toValues, withDefaults } from './sync/lww';
import { EntryPersistence, getLocalStorage } from './sync/persistence';

try {
  const persistence = new EntryPersistence({
    schema: preferencesSchema,
    storage: getLocalStorage(),
    namespace: STORAGE_NAMESPACE,
  });
  applyPreferences(document, toValues(withDefaults(preferencesSchema, persistence.readAll())));
} catch {
  // Never block the page; the app applies the preferences again once it starts.
}
