import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBrowser } from '../test/fakeBrowser';
import { Presence, type PeersEvent } from './presence';

const INTERVAL = 1_000;

function setup() {
  const browser = new FakeBrowser();
  const digests = { a: 'digest-a', b: 'digest-b' };
  const make = (id: 'a' | 'b') => {
    const tab = browser.openTab();
    const presence = new Presence({
      transport: tab.transport,
      nodeId: id,
      digest: () => digests[id],
      intervalMs: INTERVAL,
      refreshDelayMs: 100,
      now: () => Date.now(),
    });
    const events: PeersEvent[] = [];
    presence.subscribe((event) => events.push(event));
    return { tab, presence, events };
  };
  return { browser, digests, a: make('a'), b: make('b') };
}

describe('Presence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('discovers peers along with their state digest and round-trip time', () => {
    const { browser, a, b } = setup();
    a.presence.start();
    b.presence.start();
    browser.deliverInOrder();

    expect(a.presence.getPeers()).toEqual([
      expect.objectContaining({ id: 'b', digest: 'digest-b', rttMs: expect.any(Number) }),
    ]);
    expect(b.presence.getPeers().map((peer) => peer.id)).toEqual(['a']);
    expect(a.events[0]).toEqual(expect.objectContaining({ joined: ['b'], left: [] }));
  });

  it('removes a peer at once when it says goodbye', () => {
    const { browser, a, b } = setup();
    a.presence.start();
    b.presence.start();
    browser.deliverInOrder();
    b.presence.leave();
    browser.deliverInOrder();
    expect(a.presence.getPeers()).toEqual([]);
    expect(a.events.at(-1)).toEqual(expect.objectContaining({ joined: [], left: ['b'] }));
  });

  it('drops a peer that misses two ping rounds in a row, e.g. after a crash', () => {
    const { browser, a, b } = setup();
    a.presence.start();
    b.presence.start();
    browser.deliverInOrder();
    browser.closeTab(b.tab); // No goodbye.

    for (let round = 0; round < 2; round += 1) {
      vi.advanceTimersByTime(INTERVAL); // b misses this round...
      browser.deliverInOrder();
      expect(a.presence.getPeers().map((peer) => peer.id)).toEqual(['b']); // ...and is kept.
    }
    vi.advanceTimersByTime(INTERVAL); // The next round starts by pruning the silent peer.
    expect(a.presence.getPeers()).toEqual([]);
    expect(a.events.at(-1)).toEqual(expect.objectContaining({ left: ['b'] }));
  });

  it('keeps a hidden (paused) tab visible to others, because it still answers pings', () => {
    const { browser, a, b } = setup();
    a.presence.start();
    b.presence.start();
    browser.deliverInOrder();
    b.presence.pause();
    for (let round = 0; round < 5; round += 1) {
      vi.advanceTimersByTime(INTERVAL);
      browser.deliverInOrder();
    }
    expect(a.presence.getPeers().map((peer) => peer.id)).toEqual(['b']);
  });

  it('refreshes peer digests shortly after a state change', () => {
    const { browser, digests, a, b } = setup();
    a.presence.start();
    b.presence.start();
    browser.deliverInOrder();
    digests.b = 'digest-b2';
    a.presence.refreshSoon();
    a.presence.refreshSoon(); // Debounced: one ping.
    vi.advanceTimersByTime(100);
    browser.deliverInOrder();
    expect(a.presence.getPeers()[0]?.digest).toBe('digest-b2');
  });

  it('ignores pongs addressed to another tab and malformed messages', () => {
    const { a } = setup();
    a.presence.start();
    const base = { v: 1, from: 'x', sentAt: Date.now() };
    a.tab.receive({ ...base, type: 'pong', to: 'someone-else', pingSentAt: 0, digest: 'd' });
    a.tab.receive({ ...base, type: 'ping', digest: 42 });
    a.tab.receive({ ...base, v: 2, type: 'ping', digest: 'd' });
    expect(a.presence.getPeers()).toEqual([]);
  });
});
