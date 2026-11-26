// A checker's cases of the bound on the list of what runs wrote (unsent.ts),
// with the page's real localStorage (happy-dom's) as the store, so a new
// Unsent on the same store is a reload, and the clock moved by hand:
//
// - tried, then cut off for eleven minutes, then reloaded: the next page looks
//   it up and it is sent, not dropped;
// - never taken by the server, the server reachable throughout: given up after
//   ten minutes of reachable trying across three pages (two reloads), and not
//   one look sooner;
// - a Repo that cannot say whether it is connected, the browser's online flag
//   true through an hour's outage: nothing is given up by time;
// - the list never holds more than its cap, and keeps the newest;
// - the server's heads reports read localStorage not at all;
// - listing is synchronous and cannot throw, so nothing a run's report waits
//   on is added.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UNSENT, PASS_MS, TRY_MS, UNSENT_KEY, Unsent, readUnsent } from './unsent';

class StandInRepo {
  connected = false;
  heads: Record<string, string[]> = {};
  stored = new Set<string>();
  finds: string[] = [];
  resynced: string[] = [];
  listeners = new Map<string, Set<(event: any) => void>>();
  get handles() {
    return Object.fromEntries(Object.entries(this.heads).map(([id, heads]) => [id, { heads: () => heads }]));
  }
  async find(url: string) {
    const id = url.replace('automerge:', '');
    this.finds.push(id);
    if (!this.stored.has(id)) throw new Error(`Document ${id} is unavailable`);
    this.heads[id] ??= [`${id}@1`];
    return { documentId: id };
  }
  on(event: string, listener: (event: any) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: (event: any) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  async connectedSubductionPeerIds() {
    return this.connected ? ['server'] : [];
  }
  resyncSubduction(id: string) {
    this.resynced.push(id);
  }
  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
  report(id: string, heads = this.heads[id]) {
    this.emit('subduction-remote-heads', { documentId: id, storageId: 'server-storage', heads });
  }
  connect() {
    this.connected = true;
    this.emit('subduction-connection', { connected: true });
  }
  disconnect() {
    this.connected = false;
    this.emit('subduction-connection', { connected: false });
  }
}

/** A Repo that cannot say whether it is connected (no connectedSubductionPeerIds). */
class MuteRepo extends StandInRepo {
  constructor() {
    super();
    // an own property shadowing the method with undefined: typeof is not 'function'
    Object.defineProperty(this, 'connectedSubductionPeerIds', { value: undefined });
  }
}

const listed = () => Object.keys(readUnsent());
const MINUTE = 60_000;
let stops: (() => void)[];
/** A page: a new Unsent on the same localStorage, its pool started. */
const page = (repo: StandInRepo) => {
  const unsent = new Unsent(repo);
  const stop = unsent.start();
  stops.push(stop);
  return { unsent, stop };
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  stops = [];
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a checker's cases of the list's bound", () => {
  it('tried, cut off for eleven minutes with the page open, reloaded still cut off and then reachable: looked up and sent, not dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const one = new StandInRepo();
    one.stored.add('d');
    one.connected = true;
    const first = page(one);
    first.unsent.remember(['d']);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(one.finds).toEqual(['d']);
    expect(readUnsent().d.tried).toBe(2 * MINUTE);
    one.disconnect();
    await vi.advanceTimersByTimeAsync(11 * MINUTE);
    expect(readUnsent().d.tried).toBe(2 * MINUTE);
    first.stop();

    // the reload, still cut off for a while
    const two = new StandInRepo();
    two.stored.add('d');
    page(two);
    await vi.advanceTimersByTimeAsync(11 * MINUTE);
    expect(two.finds).toEqual([]);
    expect(listed()).toEqual(['d']);

    // reachable: looked up, and off the list once the server has its heads
    two.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(two.finds).toEqual(['d']);
    expect(listed()).toEqual(['d']);
    two.report('d');
    await vi.advanceTimersByTimeAsync(0);
    expect(listed()).toEqual([]);
    expect(localStorage.getItem(UNSENT_KEY)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('tried, then the page closed for eleven minutes, reloaded reachable: looked up at the first look and sent', async () => {
    const one = new StandInRepo();
    one.stored.add('d');
    one.connected = true;
    const first = page(one);
    first.unsent.remember(['d']);
    await vi.advanceTimersByTimeAsync(0);
    first.stop();
    await vi.advanceTimersByTimeAsync(11 * MINUTE); // nothing runs: the page is closed
    const two = new StandInRepo();
    two.stored.add('d');
    two.connected = true;
    page(two);
    await vi.advanceTimersByTimeAsync(0);
    expect(two.finds).toEqual(['d']);
    expect(listed()).toEqual(['d']);
    two.report('d');
    await vi.advanceTimersByTimeAsync(0);
    expect(listed()).toEqual([]);
  });

  it('never taken, the server reachable throughout: given up after ten minutes of trying across two reloads, and not one look sooner', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repo = new StandInRepo();
    repo.connected = true; // never stored, never reported: never taken
    const first = page(repo);
    first.unsent.remember(['d']);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(readUnsent().d.tried).toBe(4 * MINUTE);
    first.stop();
    await vi.advanceTimersByTimeAsync(30 * MINUTE); // closed, reachable: not trying, does not count

    const second = page(repo);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(readUnsent().d.tried).toBe(8 * MINUTE);
    second.stop();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);

    page(repo);
    await vi.advanceTimersByTimeAsync(2 * MINUTE - PASS_MS);
    expect(listed()).toEqual(['d']);
    expect(readUnsent().d.tried).toBe(TRY_MS - PASS_MS);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PASS_MS);
    expect(listed()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const asks = repo.finds.length;
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(repo.finds.length).toBe(asks);
  });

  it('a Repo that cannot say whether it is connected, the online flag true through an hour cut off, across a reload: nothing is given up by time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(navigator.onLine).toBe(true);
    const one = new MuteRepo();
    expect(typeof one.connectedSubductionPeerIds).not.toBe('function');
    const first = page(one);
    first.unsent.remember(['d', 'e']);
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(listed()).toEqual(['d', 'e']);
    expect(readUnsent().d.tried ?? 0).toBe(0);
    first.stop();

    const two = new MuteRepo();
    page(two);
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(listed()).toEqual(['d', 'e']);
    expect(readUnsent().e.tried ?? 0).toBe(0);
    // it is still tried on the browser's word: found again at each look while unfound
    expect(two.finds.filter((id) => id === 'd').length).toBeGreaterThan(1);
    expect(warn).not.toHaveBeenCalled();

    // the network back: found and sent
    two.stored.add('d');
    two.stored.add('e');
    await vi.advanceTimersByTimeAsync(PASS_MS);
    two.report('d');
    two.report('e');
    await vi.advanceTimersByTimeAsync(0);
    expect(listed()).toEqual([]);
  });

  it(`never holds more than ${MAX_UNSENT}, and keeps the newest, when listing and when looking`, async () => {
    const repo = new StandInRepo();
    repo.connected = true;
    const { unsent } = page(repo);
    const ids = Array.from({ length: 450 }, (_, i) => `doc${String(i).padStart(4, '0')}`);
    for (let i = 0; i < ids.length; i += 50) {
      unsent.remember(ids.slice(i, i + 50));
      expect(listed().length).toBeLessThanOrEqual(MAX_UNSENT);
    }
    await vi.advanceTimersByTimeAsync(PASS_MS * 3);
    expect(listed()).toEqual(ids.slice(-MAX_UNSENT));
    // an older one listed again is the newest
    unsent.remember([ids[300]]);
    expect(listed().length).toBe(MAX_UNSENT);
    expect(listed().at(-1)).toBe(ids[300]);
    // a new one pushes out the oldest
    unsent.remember(['fresh']);
    expect(listed().length).toBe(MAX_UNSENT);
    expect(listed()[0]).toBe(ids[251]);
    expect(listed().at(-1)).toBe('fresh');
    await vi.advanceTimersByTimeAsync(PASS_MS);
    expect(listed().length).toBe(MAX_UNSENT);
  });

  it('a thousand heads reports read localStorage not once, with nothing listed and with something listed', async () => {
    const repo = new StandInRepo();
    repo.connected = true;
    page(repo);
    await vi.advanceTimersByTimeAsync(0);
    const getItem = vi.spyOn(localStorage, 'getItem');
    readUnsent(); // the spy sees a read of the list
    expect(getItem).toHaveBeenCalledWith(UNSENT_KEY);
    getItem.mockClear();
    for (let i = 0; i < 1000; i++) repo.report(`other${i}`, [`h${i}`]);
    await vi.advanceTimersByTimeAsync(0);
    const withNothingListed = getItem.mock.calls.length;
    expect(withNothingListed).toBe(0);

    const other = new StandInRepo();
    other.connected = true;
    other.stored.add('d');
    const { unsent } = page(other);
    unsent.remember(['d']);
    await vi.advanceTimersByTimeAsync(0);
    getItem.mockClear();
    for (let i = 0; i < 1000; i++) other.report(`other${i}`, [`h${i}`]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getItem.mock.calls.length).toBe(0);
    // and a report for the listed one still takes it off
    other.report('d');
    await vi.advanceTimersByTimeAsync(0);
    expect(listed()).toEqual([]);
  });

  it('listing is synchronous and cannot throw, even where localStorage refuses: nothing a run waits on', () => {
    const repo = new StandInRepo();
    const { unsent } = page(repo);
    expect(unsent.remember(['d'])).toBeUndefined();
    expect(listed()).toEqual(['d']);
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => unsent.remember(['e'])).not.toThrow();
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });
});
