import { defineConfig, devices, type Project } from '@playwright/test';

const PORT = 4173;
/**
 * Set PW_CHANNEL=chrome (or msedge) to run against an installed browser instead of the
 * Playwright-managed browsers, e.g. when those have not been downloaded.
 */
const channel = process.env['PW_CHANNEL'];
const isCI = Boolean(process.env['CI']);

const browsers: readonly { readonly name: string; readonly use: Project['use'] }[] = channel
  ? [{ name: channel, use: { ...devices['Desktop Chrome'], channel } }]
  : [
      { name: 'chromium', use: devices['Desktop Chrome'] },
      { name: 'firefox', use: devices['Desktop Firefox'] },
      { name: 'webkit', use: devices['Desktop Safari'] },
    ];

const LATENCY_SPEC = /latency\.spec\.ts$/;

/*
 * Functional tests run in parallel. Latency tests run afterwards, one browser at a time: each
 * latency project depends on every functional project and on the previous latency project, so
 * nothing else competes for the CPU while timings are measured.
 */
const functionalProjects: Project[] = browsers.map(({ name, use }) => ({
  name,
  use,
  testIgnore: LATENCY_SPEC,
}));
const latencyProjects: Project[] = browsers.map(({ name, use }, index) => ({
  name: `${name}-latency`,
  // Tracing records a DOM snapshot per action, which would distort the timings.
  use: { ...use, trace: 'off' },
  testMatch: LATENCY_SPEC,
  fullyParallel: false,
  dependencies: [
    ...browsers.map((browser) => browser.name),
    ...browsers.slice(0, index).map((browser) => `${browser.name}-latency`),
  ],
}));

export default defineConfig({
  testDir: 'e2e',
  // Each test drives several browser tabs; leave room for slow, shared CI machines.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Every test drives several tabs at once, so leave the machine some headroom.
  workers: isCI ? 2 : '25%',
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Recording traces for every test slows WebKit down by an order of magnitude.
    trace: 'on-first-retry',
  },
  // Tests run against the production build, including the inlined pre-paint boot script.
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
  projects: [...functionalProjects, ...latencyProjects],
});
