import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { firstMutationWhere, openTabs, recordRootMutations } from './helpers';

/*
 * Latency measurements. The `*-latency` projects in playwright.config.ts run this file only
 * after every functional test has finished, one browser at a time, so the numbers are not
 * distorted by other tests competing for the CPU (the conflict tests busy-wait on purpose).
 */

const LATENCY_BUDGET_MS = 100;

test.describe.configure({ mode: 'serial', timeout: 90_000 });

/**
 * Changes the font size in `source` repeatedly and returns, for every change and every
 * target, the time from the edit until the target's DOM reflected it.
 */
async function measure(source: Page, targets: readonly Page[], changes: number): Promise<number[]> {
  for (const page of targets) await recordRootMutations(page);
  const samples: number[] = [];
  for (let i = 0; i < changes; i += 1) {
    const size = 12 + (i % 13); // Never equal to the previous value.
    // Timestamp taken inside the page, immediately before the edit happens.
    const sentAt = await source.evaluate((value) => {
      const slider = document.querySelector<HTMLInputElement>('#font-size');
      if (slider === null) throw new Error('missing slider');
      const now = performance.timeOrigin + performance.now();
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return now;
    }, size);
    for (const page of targets) {
      const applied = () => firstMutationWhere(page, { fontSize: `${size}px` }, sentAt);
      await expect.poll(applied, { intervals: [2, 5, 10, 25, 50], timeout: 10_000 }).not.toBeNull();
      samples.push(((await applied()) ?? Number.POSITIVE_INFINITY) - sentAt);
    }
  }
  return samples.sort((a, b) => a - b);
}

function report(label: string, samples: readonly number[]): number {
  const at = (q: number) => samples[Math.ceil(samples.length * q) - 1] ?? Number.POSITIVE_INFINITY;
  const p95 = at(0.95);
  const summary = `n=${samples.length} median=${at(0.5).toFixed(2)} ms p95=${p95.toFixed(2)} ms max=${at(1).toFixed(2)} ms`;
  test.info().annotations.push({ type: label, description: summary });
  console.log(`${test.info().project.name} ${label}: ${summary}`);
  return p95;
}

async function withoutBroadcastChannel(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Reflect.deleteProperty(window, 'BroadcastChannel');
  });
}

test(`BroadcastChannel: other tabs apply a change within ${LATENCY_BUDGET_MS} ms`, async ({
  context,
}) => {
  const [source, ...targets] = await openTabs(context, 3);
  const p95 = report('broadcast-channel latency', await measure(source, targets, 20));
  // p95 rather than max, so one scheduling hiccup on a busy CI machine does not fail the run.
  expect(p95).toBeLessThan(LATENCY_BUDGET_MS);
});

test(`storage-event fallback: other tabs apply a change within ${LATENCY_BUDGET_MS} ms`, async ({
  context,
}) => {
  await withoutBroadcastChannel(context);
  const [source, target] = await openTabs(context, 2);
  await expect(source.locator('[data-stat="channel"]')).toHaveText('Storage events');
  const p95 = report('storage-event latency', await measure(source, [target], 20));
  expect(p95).toBeLessThan(LATENCY_BUDGET_MS);
});
