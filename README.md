# Settings Sync — multi-tab preference synchronisation

A TypeScript web app that keeps user preferences (dark mode, interface language, font size) in
sync across every open browser tab in real time, persists them across sessions, paints new
tabs with the right theme from the very first frame, and resolves simultaneous edits
deterministically.

- **No framework**: vanilla TypeScript + Vite. The sync engine (`src/sync/`) is framework-agnostic
  and knows nothing about preferences or the UI.
- **7 languages**, including right-to-left Arabic (English, Español, Français, Deutsch, हिन्दी,
  日本語, العربية), with locale-aware number and time formatting.
- **Built-in sync monitor**: tab id, connected tabs with their state digest and round-trip time,
  live latency stats, an activity log, and a _Simulate conflict_ button.

## Getting started

Requirements: Node.js ≥ 20.19 and npm.

```bash
npm install
npm run dev          # http://localhost:5173 — open it in two or more tabs
```

| Command            | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `npm run build`    | Type-check and build to `dist/` (static files, relative paths) |
| `npm run preview`  | Serve the production build on http://localhost:4173            |
| `npm test`         | Unit, integration and property-based tests (Vitest)            |
| `npm run test:e2e` | End-to-end tests in real browsers (Playwright)                 |
| `npm run check`    | Type-check, lint, format check and unit tests                  |

End-to-end tests run in Chromium, Firefox and WebKit, so they need Playwright's browsers
(`npx playwright install`). To use an installed browser instead, set `PW_CHANNEL=chrome` (or
`msedge`).

**Deployment**: `.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on
every push to `main` (enable _Settings → Pages → Source: GitHub Actions_). The build uses
relative asset paths, so `dist/` can be hosted from any static host or sub-path.

## How synchronisation works

```
 tab A ──set()──► HLC tick ──► BroadcastChannel ─────────────► tab B, C … merge → render
                     │                                              ▲
                     └──► localStorage (one key per field) ─storage event (fallback/repair)
```

1. **Local write.** A change gets a timestamp from a _hybrid logical clock_, is applied
   locally, broadcast on a `BroadcastChannel`, then written to `localStorage` in the same task.
2. **Delivery.** Other tabs merge the entry and update the DOM synchronously in the message
   handler. The E2E suite asserts a cross-tab p95 below 100 ms. Measured on a Windows laptop,
   from the edit in one tab to the other (focused) tab:

   | Change    | Browser | DOM updated (median / p95) | Frame rendered (median / p95) |
   | --------- | ------- | -------------------------- | ----------------------------- |
   | Theme     | Chrome  | 1.8 / 3.0 ms               | 9 / 26 ms                     |
   | Font size | Chrome  | 2.3 / 21 ms                | 23 / 55 ms                    |
   | Theme     | Edge    | 1.8 / 3.3 ms               | 9 / 29 ms                     |
   | Font size | Edge    | 3.4 / 12 ms                | 19 / 51 ms                    |

   "Frame rendered" includes style, layout and paint and the wait for the next 60 Hz frame.
   Font-size changes cost more because the whole page relayouts at the new size. The message
   itself arrives in under 1 ms (median 0.5 ms).

3. **Fallback.** Without BroadcastChannel, messages travel through `storage` events
   (`StorageEventTransport`); the storage path also acts as a second, redundant channel.
4. **New tabs / wake-ups.** A starting tab sends `hello` with its state; peers reply with only
   the entries it lacks (anti-entropy). Hidden, frozen or bfcache-restored tabs resync on
   `visibilitychange`, `resume` and `pageshow`.
5. **No flash on load.** `src/boot.ts` is bundled and _inlined into `<head>`_ at build time
   (Vite plugin in `vite.config.ts`). It reads `localStorage` synchronously and sets
   `data-theme`, `color-scheme`, `lang`, `dir` and the root font size before the first frame.
   It shares the storage format, validation and DOM code with the app, so they cannot drift.
   With nothing stored, defaults follow the OS colour scheme and browser language.

## Conflict resolution

Each field is a **last-writer-wins register**; the document is an LWW-element map, a
state-based CRDT whose merge is commutative, associative and idempotent. Delivery order,
duplicates and redelivery therefore never matter — every tab converges.

- **Ordering**: hybrid logical clock timestamps `(wall time, counter, tab id)`. They track real
  time (the latest edit wins, as users expect), stay monotonic if the clock stalls or jumps
  back, and respect causality: a tab that has _seen_ a value always orders its next write after
  it, even if that value came from a clock running hours ahead. The tab id breaks exact ties, so
  every tab picks the same winner.
- **Per-field granularity**: concurrent edits to _different_ fields both survive. Each field is
  stored under its own key, so a tab saving one field never overwrites another tab's field.
- **Conflict detection** (for display): an update carries the timestamp of the value it
  replaced; two writes are concurrent when neither writer had seen the other. Both tabs log the
  same resolution.
- **Storage self-repair**: `localStorage` has no transactions, and in Chromium each tab reads a
  cache that lags behind other tabs' writes, so racing read-merge-write cycles can store an older
  entry over a newer one. Storage is treated as one more replica: writes are read-merge-write,
  storage events carry the written value (used instead of re-reading the stale cache), and any
  tab that finds storage behind — or cleared — writes the newer entry back.
- **Untrusted input**: everything from storage or other tabs is validated per field; messages
  from other protocol versions are ignored.

**Guarantees (verified by property-based tests over randomised schedules):** all open tabs and
storage always converge; no write is lost unless _every_ tab that knew it closes within the
few milliseconds before its message is delivered while a racing older write lands in storage —
a value that only ever existed in closed tabs cannot be recovered by any storage-based design.

## Testing

- **Unit / integration (Vitest, 109 tests)**: clock, merge laws (fast-check), codecs,
  persistence, store scenarios, presence, i18n catalogue completeness, and the mounted UI.
- **Adversarial simulation** (`src/sync/convergence.test.ts`): up to six tabs with skewed clocks,
  random interleavings, duplicated messages, abrupt and graceful closes, storage clears, and a
  faithful model of Chromium's per-tab storage cache (`src/test/fakeBrowser.ts`). Stress-run with
  ~39,000 randomised cases without a counterexample.
- **End-to-end (Playwright, 15 tests per browser)** against the production build: cross-tab sync
  of every preference (including RTL), keyboard use, the storage-event fallback, persistence after
  closing all tabs, corrupt stored data, first-frame theme checks (stored dark on a light OS and
  vice versa), conflict races and presence. Latency tests run in separate projects after all
  functional tests, one browser at a time, so other tests cannot skew the timings. The suite
  passes in Chromium, Firefox and WebKit (the engine behind Safari), and in installed Chrome
  and Edge. Cross-tab latency measured by it (median / p95):

  | Engine  | BroadcastChannel | Storage-event fallback |
  | ------- | ---------------- | ---------------------- |
  | Chrome  | 2.6 / 7.4 ms     | 3.2 / 6.4 ms           |
  | Edge    | 2.5 / 20.7 ms    | 3.3 / 5.2 ms           |
  | Firefox | 2 / 7 ms         | 5 / 8 ms               |
  | WebKit  | 9 / 17 ms        | 10 / 18 ms             |

## Project structure

```
src/
  sync/          framework-agnostic engine: hlc, lww, codec, protocol, transport,
                 persistence, store, presence, latency, digest
  preferences/   schema, defaults, applyPreferences (shared with the boot script)
  i18n/          message catalogues + Intl formatting
  ui/            components, app controller, convergence indicator, styles in src/styles
  app/           conflict simulation, page lifecycle wiring
  boot.ts        pre-paint script, inlined into index.html at build time
  main.ts        composition root
e2e/             Playwright tests
```
