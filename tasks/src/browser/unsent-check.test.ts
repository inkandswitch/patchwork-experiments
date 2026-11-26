// A checker's cases of the list of what runs wrote (unsent.ts), the site's
// Repo and the list's storage stood in for, fake time:
//
// - written with no network, the page reloaded while still cut off, time
//   passing: nothing is asked of the Repo; the server reached again, each
//   listed document is found once (not again on later looks, which resync),
//   and the list empties once the server reports the page's heads;
// - a document that can never be sent (its Repo never finds it): the list
//   does not grow, it is asked for at most once a look, it leaves the list
//   once tried for TRY_MS, and afterwards nothing is asked at all;
// - one found but never reported: let go after TRY_MS, and afterwards no
//   resync.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASS_MS, TRY_MS, Unsent, readUnsent, type UnsentStore } from './unsent';

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
  setConnected(connected: boolean) {
    this.connected = connected;
    for (const listener of this.listeners.get('subduction-connection') ?? []) listener({ connected });
  }
  report(id: string) {
    for (const listener of this.listeners.get('subduction-remote-heads') ?? []) {
      listener({ documentId: id, storageId: 'server', heads: this.heads[id], timestamp: Date.now() });
    }
  }
}

let store: UnsentStore & { value: string | null };
let stops: (() => void)[];
const listed = () => Object.keys(readUnsent(store));
const count = (list: string[], id: string) => list.filter((x) => x === id).length;

beforeEach(() => {
  vi.useFakeTimers();
  const s = { value: null as string | null, read: () => s.value, write: (value: string | null) => void (s.value = value) };
  store = s;
  stops = [];
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A page's pool starting on `repo`: its list, started. */
const page = (repo: StandInRepo) => {
  const unsent = new Unsent(repo, store);
  stops.push(unsent.start());
  return unsent;
};
/** The page closed or reloaded: its list stops; the store stays. */
const closeAll = () => {
  for (const stop of stops.splice(0)) stop();
};

describe("a checker's cases: the list of what runs wrote", () => {
  it('written cut off, reloaded cut off, the network back: each found once, resynced after, and off the list once the server has it', async () => {
    const first = new StandInRepo();
    first.stored.add('changed');
    first.stored.add('made');
    page(first).remember(['changed', 'made']);
    await vi.advanceTimersByTimeAsync(PASS_MS * 2);
    expect(first.finds).toEqual([]);
    closeAll();

    // the reload, still cut off, for longer than the bound
    const second = new StandInRepo();
    second.stored = first.stored;
    page(second);
    await vi.advanceTimersByTimeAsync(TRY_MS * 2);
    expect(second.finds).toEqual([]);
    expect(listed()).toEqual(['changed', 'made']);

    // the network back, nothing else opening them
    second.setConnected(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.finds.sort()).toEqual(['changed', 'made']);
    // later looks, the server not having answered yet: no second find, a resync instead
    await vi.advanceTimersByTimeAsync(PASS_MS * 3);
    expect([count(second.finds, 'changed'), count(second.finds, 'made')]).toEqual([1, 1]);
    expect(count(second.resynced, 'changed')).toBeGreaterThanOrEqual(2);
    second.report('changed');
    second.report('made');
    await vi.advanceTimersByTimeAsync(0);
    expect(listed()).toEqual([]);
    expect(store.value).toBeNull();
    // nothing listed: later looks ask nothing
    const asked = [second.finds.length, second.resynced.length];
    await vi.advanceTimersByTimeAsync(PASS_MS * 5);
    expect([second.finds.length, second.resynced.length]).toEqual(asked);
  });

  it('one that can never be sent: the list does not grow, it is asked at most once a look, let go after TRY_MS, and then nothing is asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repo = new StandInRepo();
    repo.connected = true;
    const unsent = page(repo);
    unsent.remember(['never']);
    for (let i = 0; i < 5; i++) {
      unsent.remember(['never']);
      expect(listed()).toEqual(['never']);
    }
    await vi.advanceTimersByTimeAsync(TRY_MS + PASS_MS);
    expect(listed()).toEqual([]);
    const looks = Math.ceil((TRY_MS + PASS_MS) / PASS_MS) + 1;
    expect(count(repo.finds, 'never')).toBeLessThanOrEqual(looks + 6);
    expect(warn).toHaveBeenCalledTimes(1);
    const asked = [repo.finds.length, repo.resynced.length];
    await vi.advanceTimersByTimeAsync(TRY_MS);
    expect([repo.finds.length, repo.resynced.length]).toEqual(asked);
  });

  it('one found but never reported: let go after TRY_MS, and then no resync', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repo = new StandInRepo();
    repo.connected = true;
    repo.stored.add('quiet');
    page(repo).remember(['quiet']);
    await vi.advanceTimersByTimeAsync(TRY_MS + PASS_MS);
    expect(listed()).toEqual([]);
    expect(count(repo.finds, 'quiet')).toBe(1);
    const resyncs = repo.resynced.length;
    expect(resyncs).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(TRY_MS);
    expect(repo.resynced.length).toBe(resyncs);
  });
});
