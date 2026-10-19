import { expect, test } from '@playwright/test';
import { openTab, openTabs } from './helpers';

test.describe('presence', () => {
  test('every tab counts the open tabs and notices when one closes', async ({ context }) => {
    const [first, second, third] = await openTabs(context, 3);
    await expect(first.locator('.peer')).toHaveCount(3);
    await third.close();
    for (const page of [first, second]) {
      await expect(page.locator('.status-pill__count')).toHaveText('2');
      await expect(page.locator('.status-pill')).toHaveAttribute('data-sync', 'in-sync');
    }
    await expect(first.locator('.log__item--peer').first()).toContainText('disconnected');
  });

  test('a lone tab says so and disables the conflict simulation', async ({ context }) => {
    const page = await openTab(context);
    await expect(page.locator('.status-pill')).toHaveAttribute('data-sync', 'alone');
    await expect(page.locator('[data-action="simulate-conflict"]')).toBeDisabled();
  });
});
