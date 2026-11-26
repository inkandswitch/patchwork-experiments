// What runs wrote, sent to the sync server when it can be reached
// (unsent.ts), with the site's Repo and the list's storage stood in for. The
// cases: a list kept across a reload; nothing done while the server cannot
// be reached; each listed document found once it can be, and taken off once
// the server reports its heads, a report heard before the listing too; the
// bound for one never reported, counted only while the server is reachable
// by the Repo's word, across pages, never on the browser's word alone, and
// at most PASS_MS between two looks; what starts a look (the pool's start,
// the Repo connecting, the browser online, the interval); the list's size; a
// Repo that cannot say whether it is connected; and nothing after the stop.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_UNSENT, PASS_MS, TRY_MS, Unsent, readUnsent, type UnsentStore } from './unsent';

/** The site's Repo: documents by id, whether it is connected, what it was asked, and the server's reports. */
class StandInRepo {
  connected = false;
  heads: Record<string, string[]> = {};
  stored = new Set<string>();
  asked: string[] = [];
  resynced: string[] = [];
  listeners = new Map<string, Set<(event: any) => void>>();
  get handles() {
    return Object.fromEntries(Object.entries(this.heads).map(([id, heads]) => [id, { heads: () => heads }]));
  }
  async find(url: string) {
    const id = url.replace('automerge:', '');
    this.asked.push(id);
    if (!this.stored.has(id)) {
      throw new Error(`Document ${id} is unavailable`);
    }
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
  /** The server says it has `id` at these heads (the page's, by default). */
  report(id: string, heads = this.heads[id]) {
    this.emit('subduction-remote-heads', { documentId: id, storageId: 'server-storage', heads, timestamp: Date.now() });
  }
  /** The Repo connects to the server. */
  connect() {
    this.connected = true;
    this.emit('subduction-connection', { connected: true });
  }
  /** The Repo loses the server. */
  disconnect() {
    this.connected = false;
    this.emit('subduction-connection', { connected: false });
  }
}

function memoryStore(): UnsentStore & { value: string | null } {
  const store = {
    value: null as string | null,
    read: () => store.value,
    write: (value: string | null) => void (store.value = value),
  };
  return store;
}

let repo: StandInRepo;
let store: ReturnType<typeof memoryStore>;
let stops: (() => void)[];
const listed = () => Object.keys(readUnsent(store));
const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  repo = new StandInRepo();
  store = memoryStore();
  stops = [];
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const started = (unsent = new Unsent(repo, store)) => {
  stops.push(unsent.start());
  return unsent;
};

describe('the list of what runs wrote', () => {
  it('lists what it is given at once, in a store that a later page reads (a reload)', () => {
    const unsent = new Unsent(repo, store);
    unsent.remember(['a', 'b']);
    unsent.remember([]);
    unsent.remember(['a']);
    expect(listed()).toEqual(['b', 'a']);
    expect(Object.keys(readUnsent(memoryStore()))).toEqual([]);
    const later = new Unsent(repo, store);
    expect(later).toBeDefined();
    expect(listed()).toEqual(['b', 'a']);
  });

  it('does nothing while the server cannot be reached: nothing is asked of the Repo and nothing leaves the list', async () => {
    repo.stored.add('a');
    started().remember(['a']);
    await vi.advanceTimersByTimeAsync(PASS_MS * 3);
    expect(repo.asked).toEqual([]);
    expect(listed()).toEqual(['a']);
    expect(readUnsent(store).a.tried).toBeUndefined();
  });

  it('once the Repo connects, finds each listed document, and takes it off once the server reports the page\'s heads', async () => {
    repo.stored.add('a');
    repo.stored.add('b');
    started().remember(['a', 'b']);
    await tick();
    repo.connect();
    await tick();
    expect(repo.asked.sort()).toEqual(['a', 'b']);
    expect(listed()).toEqual(['a', 'b']);
    // heads the page does not have yet are not enough
    repo.report('a', ['a@0']);
    await tick();
    expect(listed()).toEqual(['a', 'b']);
    repo.report('a');
    await tick();
    expect(listed()).toEqual(['b']);
    repo.report('b');
    await tick();
    expect(listed()).toEqual([]);
    expect(store.value).toBeNull();
  });

  it('a report heard before the documents are listed counts (with the network, the page sent them as the run wrote them)', async () => {
    repo.connected = true;
    repo.stored.add('a');
    repo.heads.a = ['a@3'];
    const unsent = started();
    await tick();
    repo.report('a');
    unsent.remember(['a']);
    await tick();
    expect(listed()).toEqual([]);
  });

  it('a later page, at its pool\'s start, sends what an earlier one listed', async () => {
    new Unsent(repo, store).remember(['a']);
    repo.connected = true;
    repo.stored.add('a');
    started();
    await tick();
    expect(repo.asked).toEqual(['a']);
    repo.report('a');
    await tick();
    expect(listed()).toEqual([]);
  });

  it('when the browser says it is online, or at the next interval, it looks again', async () => {
    repo.stored.add('a');
    started().remember(['a']);
    await tick();
    repo.connected = true; // no event from the Repo
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(repo.asked).toEqual(['a']);

    // listed by another (the list is in the store), with the Repo connected and saying nothing: the interval finds it
    repo.stored.add('b');
    new Unsent(repo, store).remember(['b']);
    await vi.advanceTimersByTimeAsync(PASS_MS);
    expect(repo.asked).toContain('b');
  });

  it('one never reported is asked about again at each look, and let go, said in the console, after TRY_MS of trying with the server reachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    repo.connected = true;
    repo.stored.add('a');
    started().remember(['a']);
    await tick();
    expect(repo.asked).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(PASS_MS);
    expect(repo.resynced.length).toBeGreaterThan(0);
    expect(listed()).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(TRY_MS);
    expect(listed()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/a document a task wrote \(a…\) was not seen at the sync server/));
  });

  it('time with the server unreachable does not count against the bound', async () => {
    repo.stored.add('a');
    started().remember(['a']);
    await vi.advanceTimersByTimeAsync(TRY_MS * 2);
    expect(listed()).toEqual(['a']);
    repo.connect();
    await tick();
    expect(listed()).toEqual(['a']);
    repo.report('a');
    await tick();
    expect(listed()).toEqual([]);
  });

  it('tried once, then cut off for longer than TRY_MS and the page closed: the next page finds it and keeps it listed', async () => {
    repo.connected = true;
    repo.stored.add('a');
    const unsent = new Unsent(repo, store);
    const stop = unsent.start();
    unsent.remember(['a']);
    await tick();
    expect(repo.asked).toEqual(['a']);
    // the network goes before the server has reported it; the page is closed
    repo.disconnect();
    stop();
    await vi.advanceTimersByTimeAsync(TRY_MS + PASS_MS);
    // a new page, with the network
    const next = new StandInRepo();
    next.connected = true;
    next.stored.add('a');
    stops.push(new Unsent(next, store).start());
    await tick();
    expect({ asked: next.asked, listed: listed() }).toEqual({ asked: ['a'], listed: ['a'] });
  });

  it("a Repo that cannot say whether it is connected never lets an entry go by time: the browser's word, true though cut off, counts no time", async () => {
    const cutOff = { handles: {}, find: vi.fn(async () => ({})) };
    const first = new Unsent(cutOff, store);
    const stop = first.start();
    first.remember(['a']);
    await vi.advanceTimersByTimeAsync(TRY_MS * 3);
    stop();
    expect(listed()).toEqual(['a']);
    const online = { handles: {}, find: vi.fn(async () => ({})) };
    stops.push(new Unsent(online, store).start());
    await vi.advanceTimersByTimeAsync(TRY_MS * 3);
    expect({ asked: online.find.mock.calls.length, listed: listed() }).toEqual({ asked: 1, listed: ['a'] });
  });

  it('the time tried adds up across pages, only while the Repo says it is reachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    repo.connected = true;
    repo.stored.add('a');
    const first = new Unsent(repo, store);
    const stopFirst = first.start();
    first.remember(['a']);
    await vi.advanceTimersByTimeAsync(TRY_MS / 2);
    expect(readUnsent(store).a.tried).toBe(TRY_MS / 2);
    // a drop and a return between two looks: the count starts afresh at the next look
    repo.disconnect();
    repo.connect();
    await tick();
    expect(readUnsent(store).a.tried).toBe(TRY_MS / 2);
    stopFirst();
    // closed for an hour, then a new page
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    stops.push(new Unsent(repo, store).start());
    await tick();
    expect(readUnsent(store).a.tried).toBe(TRY_MS / 2);
    await vi.advanceTimersByTimeAsync(TRY_MS / 2 - PASS_MS);
    expect(listed()).toEqual(['a']);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PASS_MS);
    expect(listed()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a jump of the clock between two looks (a sleep the Repo has not noticed) adds at most PASS_MS', async () => {
    let now = 0;
    repo.connected = true;
    repo.stored.add('a');
    const unsent = started(new Unsent(repo, store, () => now));
    unsent.remember(['a']);
    await tick();
    expect(readUnsent(store).a.tried).toBe(0);
    now += 24 * 60 * 60_000;
    await unsent.pass();
    expect(readUnsent(store).a.tried).toBe(PASS_MS);
    expect(listed()).toEqual(['a']);
  });

  it("a server's report does not read the store: the listed ids are kept in memory", async () => {
    repo.connected = true;
    repo.stored.add('a');
    const unsent = started();
    unsent.remember(['a']);
    await tick();
    const read = vi.spyOn(store, 'read');
    for (let i = 0; i < 50; i++) repo.report(`other${i}`, ['x']);
    expect(read).not.toHaveBeenCalled();
    repo.report('a');
    await tick();
    expect(listed()).toEqual([]);
  });

  it('one its Repo cannot find (not stored here) is asked for again at the next look', async () => {
    repo.connected = true;
    started().remember(['gone']);
    await tick();
    await vi.advanceTimersByTimeAsync(PASS_MS);
    expect(repo.asked).toEqual(['gone', 'gone']);
  });

  it(`keeps at most ${MAX_UNSENT}, the newest`, () => {
    const unsent = new Unsent(repo, store);
    const ids = Array.from({ length: MAX_UNSENT + 5 }, (_, i) => `d${i}`);
    unsent.remember(ids);
    expect(listed()).toEqual(ids.slice(5));
  });

  it("a Repo that cannot say whether it is connected: the browser's word", async () => {
    const plain = { handles: {}, find: vi.fn(async () => ({})) };
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const unsent = new Unsent(plain, store);
    stops.push(unsent.start());
    unsent.remember(['a']);
    await tick();
    expect(plain.find).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await tick();
    expect(plain.find).toHaveBeenCalledWith('automerge:a');
  });

  it('stopped, it looks no more and hears nothing', async () => {
    repo.stored.add('a');
    const unsent = new Unsent(repo, store);
    const stop = unsent.start();
    stop();
    unsent.remember(['a']);
    repo.connect();
    await vi.advanceTimersByTimeAsync(PASS_MS * 2);
    expect(repo.asked).toEqual([]);
    expect([...repo.listeners.values()].every((set) => set.size === 0)).toBe(true);
    expect(listed()).toEqual(['a']);
  });

  it('an unreadable list is read as empty, and written afresh', () => {
    store.value = '{not json';
    expect(listed()).toEqual([]);
    new Unsent(repo, store).remember(['a']);
    expect(listed()).toEqual(['a']);
  });
});
