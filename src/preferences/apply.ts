import { LANGUAGES, THEME_BACKGROUND, type Preferences } from './preferences';

/**
 * Reflects preferences on the document root. Shared by the pre-paint boot script and the app,
 * so the first frame and every later update are rendered by exactly the same code.
 */
export function applyPreferences(doc: Document, preferences: Preferences): void {
  const root = doc.documentElement;
  if (root.dataset['theme'] !== preferences.theme) root.dataset['theme'] = preferences.theme;
  root.style.colorScheme = preferences.theme;
  root.style.fontSize = `${preferences.fontSize}px`;
  root.lang = preferences.language;
  root.dir = LANGUAGES[preferences.language].dir;
  doc
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_BACKGROUND[preferences.theme]);
}
