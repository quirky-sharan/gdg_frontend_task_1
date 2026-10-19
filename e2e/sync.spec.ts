import { expect, test, type Page } from '@playwright/test';
import { openTabs, rootState, setFontSize } from './helpers';

async function markNotReloaded(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __marker: string }).__marker = 'same document';
  });
}

async function wasReloaded(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __marker?: string }).__marker !== 'same document',
  );
}

test.describe('real-time synchronisation', () => {
  test('every preference reaches every open tab without a reload', async ({ context }) => {
    const [source, ...others] = await openTabs(context, 3);
    for (const page of others) await markNotReloaded(page);

    await source.locator('#dark-mode').click();
    await source.locator('#language').selectOption('fr');
    await setFontSize(source, 20);

    for (const page of others) {
      await expect(page.locator('#dark-mode')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('#language')).toHaveValue('fr');
      await expect(page.locator('#font-size')).toHaveValue('20');
      await expect(page.locator('.brand__title')).toHaveText('Synchronisation des réglages');
      expect(await rootState(page)).toEqual({
        theme: 'dark',
        lang: 'fr',
        dir: 'ltr',
        fontSize: '20px',
      });
      expect(await wasReloaded(page)).toBe(false);
    }
  });

  test('a change made in any tab reaches the others, including right-to-left', async ({
    context,
  }) => {
    const [first, middle, last] = await openTabs(context, 3);
    await middle.locator('#language').selectOption('ar');
    for (const page of [first, last]) {
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('#language')).toHaveValue('ar');
    }
    await last.locator('#dark-mode').click();
    await expect(first.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(middle.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the switch works from the keyboard', async ({ context }) => {
    const [source, other] = await openTabs(context, 2);
    await source.locator('#dark-mode').focus();
    await source.keyboard.press('Space');
    await expect(other.locator('#dark-mode')).toHaveAttribute('aria-checked', 'true');
  });

  test('keeps syncing over storage events when BroadcastChannel is unavailable', async ({
    context,
  }) => {
    await context.addInitScript(() => {
      Reflect.deleteProperty(window, 'BroadcastChannel');
    });
    const [source, target] = await openTabs(context, 2);
    await expect(source.locator('[data-stat="channel"]')).toHaveText('Storage events');
    await source.locator('#dark-mode').click();
    await source.locator('#language').selectOption('ja');
    await expect(target.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(target.locator('#language')).toHaveValue('ja');
  });
});
