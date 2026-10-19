import { expect, test, type Page } from '@playwright/test';
import { openTabs, preciseNow, STORAGE_PREFIX } from './helpers';

interface Snapshot {
  readonly theme: string | undefined;
  readonly fontSize: string;
  readonly digest: string | null | undefined;
  readonly stored: string | null;
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate((prefix) => {
    const root = document.documentElement;
    return {
      theme: root.dataset['theme'],
      fontSize: root.style.fontSize,
      digest: document.querySelector('.peer--self .peer__digest')?.textContent,
      stored: localStorage.getItem(`${prefix}fontSize`),
    };
  }, STORAGE_PREFIX);
}

/**
 * Waits until every tab shows the same state (and the same state digest). Convergence takes
 * milliseconds; the generous timeout only absorbs a heavily loaded test machine.
 */
async function expectConverged(pages: Page[]): Promise<Snapshot> {
  await expect
    .poll(
      async () =>
        new Set((await Promise.all(pages.map(snapshot))).map((s) => JSON.stringify(s))).size,
      { timeout: 15_000 },
    )
    .toBe(1);
  const [first] = await Promise.all(pages.map(snapshot));
  if (first === undefined) throw new Error('no tabs');
  return first;
}

test.describe('conflict resolution', () => {
  test('"Simulate conflict" races every tab, and they all converge', async ({ context }) => {
    const pages = await openTabs(context, 3);
    for (let round = 0; round < 3; round += 1) {
      const initiator = pages[round % pages.length] ?? pages[0];
      await initiator.locator('[data-action="simulate-conflict"]').click();
      await initiator.waitForTimeout(600); // The shared write moment is 300 ms after the click.
      const state = await expectConverged(pages);
      expect(state.digest).toMatch(/^[0-9a-f]{8}$/);
      for (const page of pages) {
        await expect(page.locator('.status-pill')).toHaveAttribute('data-sync', 'in-sync');
      }
    }
  });

  test('genuinely simultaneous edits converge on one value, which is persisted', async ({
    context,
  }) => {
    const pages = await openTabs(context, 3);
    for (let round = 0; round < 5; round += 1) {
      const at = (await preciseNow(pages[0])) + 300;
      // Every tab busy-waits until the same instant, then writes its own value.
      await Promise.all(
        pages.map((page, index) =>
          page.evaluate(
            ({ at, size }) =>
              new Promise<void>((resolve) => {
                const now = () => performance.timeOrigin + performance.now();
                setTimeout(
                  () => {
                    while (now() < at) {
                      // Spin.
                    }
                    const slider = document.querySelector<HTMLInputElement>('#font-size');
                    if (slider !== null) {
                      slider.value = String(size);
                      slider.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    resolve();
                  },
                  Math.max(0, at - now() - 30),
                );
              }),
            { at, size: 13 + index * 4 + (round % 2) },
          ),
        ),
      );
      const state = await expectConverged(pages);
      const stored = JSON.parse(state.stored ?? 'null') as { value: number } | null;
      expect(`${stored?.value}px`).toBe(state.fontSize);
    }
    const conflicts = await pages[0].locator('.log__item--conflict').count();
    test.info().annotations.push({ type: 'conflicts logged', description: String(conflicts) });
  });
});
