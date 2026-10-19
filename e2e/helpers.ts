import { expect, type BrowserContext, type Page } from '@playwright/test';

export const STORAGE_PREFIX = 'settings-sync:v1:';

export const BACKGROUND = {
  light: 'rgb(244, 245, 249)',
  dark: 'rgb(14, 16, 22)',
} as const;

/** Opens the app in a new tab of `context` and waits until it is interactive. */
export async function openTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('#dark-mode')).toBeVisible();
  return page;
}

type Tuple<T, N extends number, Acc extends T[] = []> = Acc['length'] extends N
  ? Acc
  : Tuple<T, N, [...Acc, T]>;

/** Opens several tabs and waits until each one sees all the others. */
export async function openTabs<N extends number>(
  context: BrowserContext,
  count: N,
): Promise<Tuple<Page, N>> {
  const pages: Page[] = [];
  for (let i = 0; i < count; i += 1) pages.push(await openTab(context));
  for (const page of pages) {
    await expect(page.locator('.status-pill__count')).toHaveText(String(count));
  }
  return pages as Tuple<Page, N>;
}

export interface RootState {
  readonly theme: string | undefined;
  readonly lang: string;
  readonly dir: string;
  readonly fontSize: string;
}

export function rootState(page: Page): Promise<RootState> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      theme: root.dataset['theme'],
      lang: root.lang,
      dir: root.dir,
      fontSize: root.style.fontSize,
    };
  });
}

/** Sets the font-size slider the way a drag does: by firing `input` events. */
export async function setFontSize(page: Page, size: number): Promise<void> {
  await page.locator('#font-size').fill(String(size));
}

/** Records, with a high-resolution timestamp, every change of the root element's attributes. */
export async function recordRootMutations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: { at: number; theme: string | undefined; fontSize: string; lang: string }[] = [];
    (window as unknown as { __mutations: typeof log }).__mutations = log;
    new MutationObserver(() => {
      const root = document.documentElement;
      log.push({
        at: performance.timeOrigin + performance.now(),
        theme: root.dataset['theme'],
        fontSize: root.style.fontSize,
        lang: root.lang,
      });
    }).observe(document.documentElement, { attributes: true });
  });
}

/**
 * Time of the first recorded root mutation after `after` that left the root in the
 * `expected` state, or null if there was none yet.
 */
export function firstMutationWhere(
  page: Page,
  expected: { theme?: string; fontSize?: string; lang?: string },
  after = 0,
): Promise<number | null> {
  return page.evaluate(
    ({ wanted, after }) => {
      const log = (
        window as unknown as {
          __mutations: { at: number; theme?: string; fontSize: string; lang: string }[];
        }
      ).__mutations;
      const hit = log.find(
        (entry) =>
          entry.at > after &&
          (wanted.theme === undefined || entry.theme === wanted.theme) &&
          (wanted.fontSize === undefined || entry.fontSize === wanted.fontSize) &&
          (wanted.lang === undefined || entry.lang === wanted.lang),
      );
      return hit?.at ?? null;
    },
    { wanted: expected, after },
  );
}

/** Current high-resolution epoch time in the page. */
export function preciseNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.timeOrigin + performance.now());
}
