import { expect, test, type BrowserContext } from '@playwright/test';
import { BACKGROUND, openTab, openTabs, rootState, setFontSize } from './helpers';

interface PaintRecord {
  /** Root state during the very first animation frame, i.e. right before the first paint. */
  firstFrame: { theme: string | null; background: string; lang: string; fontSize: string } | null;
  /** Every value data-theme took while the page loaded. */
  themes: (string | null)[];
  /** Animation frames that had run when data-theme was first set. */
  framesBeforeTheme: number | null;
}

/** Records, for every page opened afterwards, what its first frame looked like. */
async function recordFirstFrames(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const record: PaintRecord = { firstFrame: null, themes: [], framesBeforeTheme: null };
    (window as unknown as { __paint: PaintRecord }).__paint = record;
    let frames = 0;
    new MutationObserver(() => {
      record.themes.push(document.documentElement.getAttribute('data-theme'));
      record.framesBeforeTheme ??= frames;
    }).observe(document, { attributes: true, attributeFilter: ['data-theme'], subtree: true });
    const onFrame = (): void => {
      if (frames === 0) {
        const root = document.documentElement;
        record.firstFrame = {
          theme: root.getAttribute('data-theme'),
          background: getComputedStyle(root).backgroundColor,
          lang: root.lang,
          fontSize: root.style.fontSize,
        };
      }
      frames += 1;
      if (frames < 5) requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
  });
}

async function paintRecord(context: BrowserContext): Promise<PaintRecord> {
  const page = await openTab(context);
  await page.waitForFunction(
    () => (window as unknown as { __paint: PaintRecord }).__paint.firstFrame !== null,
  );
  return page.evaluate(() => (window as unknown as { __paint: PaintRecord }).__paint);
}

/** Stores preferences through the UI, then closes every tab. */
async function storePreferences(
  context: BrowserContext,
  options: { dark: boolean; language?: string; fontSize?: number },
): Promise<void> {
  const page = await openTab(context);
  const toggle = page.locator('#dark-mode');
  if ((await toggle.getAttribute('aria-checked')) !== String(options.dark)) await toggle.click();
  if (options.language !== undefined)
    await page.locator('#language').selectOption(options.language);
  if (options.fontSize !== undefined) await setFontSize(page, options.fontSize);
  await page.close();
}

test.describe('persistence', () => {
  test('preferences survive closing every tab and come back on reopen', async ({ context }) => {
    const [a, b] = await openTabs(context, 2);
    await a.locator('#dark-mode').click();
    await b.locator('#language').selectOption('de');
    await setFontSize(a, 22);
    await expect(b.locator('#font-size')).toHaveValue('22');
    await a.close();
    await b.close();
    expect(context.pages()).toHaveLength(0);

    const reopened = await openTab(context);
    expect(await rootState(reopened)).toEqual({
      theme: 'dark',
      lang: 'de',
      dir: 'ltr',
      fontSize: '22px',
    });
    await expect(reopened.locator('#language')).toHaveValue('de');
    await expect(reopened.locator('#font-size')).toHaveValue('22');
    await expect(reopened.locator('.brand__title')).toHaveText('Einstellungs-Sync');
  });

  test('ignores corrupt stored data and falls back to defaults', async ({ context }) => {
    await context.addInitScript(() => {
      if (sessionStorage.getItem('seeded') !== null) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('settings-sync:v1:theme', '{not json');
      localStorage.setItem(
        'settings-sync:v1:fontSize',
        JSON.stringify({ value: 999, ts: { wall: 1, counter: 0, node: 'x' } }),
      );
    });
    const page = await openTab(context);
    expect(await rootState(page)).toMatchObject({ theme: 'light', fontSize: '16px' });
  });
});

test.describe('first paint, system theme light', () => {
  test.use({ colorScheme: 'light' });

  test('a new tab shows a stored dark theme from its very first frame', async ({ context }) => {
    await storePreferences(context, { dark: true, language: 'ar', fontSize: 24 });
    await recordFirstFrames(context);
    const record = await paintRecord(context);
    expect(record.firstFrame).toEqual({
      theme: 'dark',
      background: BACKGROUND.dark,
      lang: 'ar',
      fontSize: '24px',
    });
    expect(record.framesBeforeTheme).toBe(0);
    expect(record.themes).toEqual(['dark']);
  });
});

test.describe('first paint, system theme dark', () => {
  test.use({ colorScheme: 'dark' });

  test('a stored light theme wins over the dark system theme, with no flash', async ({
    context,
  }) => {
    await storePreferences(context, { dark: false });
    await recordFirstFrames(context);
    const record = await paintRecord(context);
    expect(record.firstFrame).toMatchObject({ theme: 'light', background: BACKGROUND.light });
    expect(record.framesBeforeTheme).toBe(0);
    expect(record.themes).toEqual(['light']);
  });

  test('without a stored choice, the first frame follows the system theme', async ({ context }) => {
    await recordFirstFrames(context);
    const record = await paintRecord(context);
    expect(record.firstFrame).toMatchObject({ theme: 'dark', background: BACKGROUND.dark });
    expect(record.themes).toEqual(['dark']);
  });
});
