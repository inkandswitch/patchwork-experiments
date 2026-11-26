// @vitest-environment node
//
// The browser executor's side of the local link (executor.ts), with a
// stand-in run worker and a stand-in link: a linked run worker's settings
// wait until the page has named its link's peer and carry that id; an
// ending that names what the run wrote is heard only once the page has
// saved it, or KEEP_LIMIT_MS has passed, or the page said why not (both
// said in the run's log); an ending that names nothing, and every ending
// with no link, is heard at once; what the worker says after its ending
// waits behind it; a worker ended meanwhile is heard of no more.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserExecutor, KEEP_LIMIT_MS, notKept, type RunWorkerLink } from './executor';
import type { WorkerEvents } from '../pool';

class StandInWorker {
  static made: StandInWorker[] = [];
  told: { message: any; transfer: unknown[] }[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;
  constructor() {
    StandInWorker.made.push(this);
  }
  postMessage(message: any, transfer: unknown[] = []) {
    this.told.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  say(data: unknown) {
    this.onmessage?.({ data });
  }
}

beforeEach(() => {
  StandInWorker.made = [];
  vi.stubGlobal('Worker', StandInWorker);
  vi.stubGlobal('navigator', { locks: { request: () => new Promise(() => {}) } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A link whose peer and saves the test answers by hand. */
function standInLink() {
  let name!: (peer: string | null) => void;
  const saves: { documents: string[]; answer: (problem: string | null) => void }[] = [];
  const { port1, port2 } = new MessageChannel();
  port2.close();
  const link: RunWorkerLink & { ended: boolean } = {
    port: port1,
    peer: new Promise((resolve) => (name = resolve)),
    keep: (documents) => new Promise((answer) => saves.push({ documents, answer })),
    end: () => void (link.ended = true),
    ended: false,
  };
  return { link, name: (peer: string | null) => name(peer), saves };
}

function events() {
  const heard: unknown[][] = [];
  const record =
    (type: string) =>
    (...args: unknown[]) =>
      void heard.push([type, ...args]);
  const it: WorkerEvents = {
    log: record('log'),
    progress: record('progress'),
    done: record('done'),
    threw: record('threw'),
    exit: record('exit'),
  } as WorkerEvents;
  return { events: it, heard };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settings = { repoConfig: { syncServerUrl: 'wss://nowhere.invalid' } };

describe('a linked run worker, in a browser', () => {
  it("is told its settings only once the page has named its link's peer, with that id and its end of the link; the job waits behind them", async () => {
    const { link, name } = standInLink();
    const executor = new BrowserExecutor({ settings, taskBytes: async () => undefined, link: () => link });
    const run = executor.start(events().events);
    run.run({ taskUrl: 'automerge:x', runId: 'r', importUrl: 'u', input: null, key: 'k' } as any);
    await tick();
    const worker = StandInWorker.made[0];
    expect(worker.told).toEqual([]);
    name('task-link-chosen');
    await tick();
    expect(worker.told.map(({ message }) => message.type)).toEqual(['settings', 'job']);
    const told = worker.told[0];
    expect(told.message.settings.peerId).toBe('task-link-chosen');
    expect(told.message.settings.link === link.port).toBe(true);
    expect(told.transfer.length === 1 && told.transfer[0] === link.port).toBe(true);
  });

  it('is told no link where the page took none', async () => {
    const { link, name } = standInLink();
    const executor = new BrowserExecutor({ settings, taskBytes: async () => undefined, link: () => link });
    executor.start(events().events);
    name(null);
    await tick();
    const told = StandInWorker.made[0].told[0];
    expect(told.message.settings.link).toBeUndefined();
    expect(told.message.settings.peerId).toBeUndefined();
    expect(told.transfer).toEqual([]);
  });

  it("an ending that names what the run wrote is heard once the page has saved it, and what follows it waits behind it", async () => {
    const { link, name, saves } = standInLink();
    const { events: e, heard } = events();
    new BrowserExecutor({ settings, taskBytes: async () => undefined, link: () => link }).start(e);
    name('p');
    await tick();
    const worker = StandInWorker.made[0];
    worker.say({ type: 'log', message: 'before' });
    worker.say({ type: 'done', result: 7, wrote: ['a', 'b', 3] });
    worker.say({ type: 'log', message: 'after' });
    await tick();
    expect(saves.map((save) => save.documents)).toEqual([['a', 'b']]);
    expect(heard).toEqual([['log', 'before']]);
    saves[0].answer(null);
    await tick();
    expect(heard).toEqual([['log', 'before'], ['done', 7], ['log', 'after']]);
  });

  it('an ending that names nothing, or comes with no link, is heard at once', async () => {
    const { link, name, saves } = standInLink();
    const { events: e, heard } = events();
    new BrowserExecutor({ settings, taskBytes: async () => undefined, link: () => link }).start(e);
    name('p');
    await tick();
    StandInWorker.made[0].say({ type: 'done', result: 1 });
    StandInWorker.made[0].say({ type: 'threw', message: 'x', wrote: [] });
    const unlinked = events();
    new BrowserExecutor({ settings, taskBytes: async () => undefined }).start(unlinked.events);
    StandInWorker.made[1].say({ type: 'done', result: 2, wrote: ['a'] });
    await tick();
    expect(saves).toEqual([]);
    expect(heard).toEqual([['done', 1], ['threw', 'x']]);
    expect(unlinked.heard).toEqual([['done', 2]]);
  });

  it('the page that says why it could not save, or does not answer in KEEP_LIMIT_MS: said in the log, and the ending heard', async () => {
    vi.useFakeTimers();
    const { link, name, saves } = standInLink();
    const { events: e, heard } = events();
    new BrowserExecutor({ settings, taskBytes: async () => undefined, link: () => link }).start(e);
    name('p');
    await vi.advanceTimersByTimeAsync(0);
    const worker = StandInWorker.made[0];
    worker.say({ type: 'threw', message: 'boom', wrote: ['a'] });
    await vi.advanceTimersByTimeAsync(0);
    saves[0].answer('the disk is full');
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([['log', notKept(1, 'the disk is full')], ['threw', 'boom']]);

    worker.say({ type: 'done', result: 2, wrote: ['a', 'b'] });
    await vi.advanceTimersByTimeAsync(KEEP_LIMIT_MS - 1);
    expect(heard).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(heard.slice(2)).toEqual([['log', notKept(2, `no answer in ${KEEP_LIMIT_MS / 1000} s`)], ['done', 2]]);
  });

  it('a worker ended while the page saves is heard of no more, and its link is ended', async () => {
    const { link, name, saves } = standInLink();
    const { events: e, heard } = events();
    const run = new BrowserExecutor({ settings, taskBytes: async () => undefined, link: () => link }).start(e);
    name('p');
    await tick();
    StandInWorker.made[0].say({ type: 'done', result: 1, wrote: ['a'] });
    await tick();
    run.terminate();
    saves[0].answer(null);
    await tick();
    expect(heard).toEqual([['exit']]);
    expect(link.ended).toBe(true);
  });

  it('a worker ended before the page named its peer is never told its settings', async () => {
    const { link, name } = standInLink();
    const run = new BrowserExecutor({ settings, taskBytes: async () => undefined, link: () => link }).start(events().events);
    run.terminate();
    name('p');
    await tick();
    expect(StandInWorker.made[0].told).toEqual([]);
  });
});
