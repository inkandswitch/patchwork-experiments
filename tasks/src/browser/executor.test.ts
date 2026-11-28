// @vitest-environment node
//
// The browser executor (executor.ts), with a stand-in run worker: a piped
// run worker is told its settings at once, with its end of the pipe, before
// its job; what it says is heard in order, an error after its ending behind
// it (the worker ended at once); its pipe ends with it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserExecutor, type RunWorkerLink } from './executor';
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
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function standInLink() {
  const { port1, port2 } = new MessageChannel();
  port2.close();
  const link: RunWorkerLink & { ended: boolean } = { port: port1, end: () => void (link.ended = true), ended: false };
  return link;
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

const settings = {};
const taskBytes = async () => new Uint8Array([1, 2, 3]);

describe('a run worker, in a browser', () => {
  it('is told its settings first, with its end of the pipe, and the job behind them', async () => {
    const link = standInLink();
    const run = new BrowserExecutor({ settings, link: () => link, taskBytes }).start(events().events);
    run.run({ taskUrl: 'automerge:x', runId: 'r', importUrl: 'u', input: null, key: 'k' } as any);
    const worker = StandInWorker.made[0];
    expect(worker.told[0].message.settings.link === link.port && worker.told[0].transfer[0] === link.port).toBe(true);
    expect(worker.told.map(({ message }) => message.type)).toEqual(['settings']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worker.told.map(({ message }) => message.type)).toEqual(['settings', 'job']);
  });

  it("a job carries the task's document, or null where the pool cannot export it, and an abort said at once waits behind it", async () => {
    const run = new BrowserExecutor({ settings, link: standInLink, taskBytes }).start(events().events);
    run.run({ taskUrl: 'automerge:x', runId: 'r', importUrl: 'u', input: null, key: 'k' } as any);
    run.abort('cancelled');
    const none = new BrowserExecutor({ settings, link: standInLink, taskBytes: async () => undefined }).start(events().events);
    none.run({ taskUrl: 'automerge:x', runId: 'r', importUrl: 'u', input: null, key: 'k' } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [first, second] = StandInWorker.made;
    expect(first.told.slice(1).map(({ message }) => message.type)).toEqual(['job', 'abort']);
    expect([...first.told[1].message.task]).toEqual([1, 2, 3]);
    expect(second.told[1].message.task).toBeNull();
  });

  it('what it says is heard in order; an error after its ending ends it at once and is heard behind it, and its pipe ends with it', () => {
    const link = standInLink();
    const { events: e, heard } = events();
    new BrowserExecutor({ settings, link: () => link, taskBytes }).start(e);
    const worker = StandInWorker.made[0];
    worker.say({ type: 'log', message: 'before' });
    worker.say({ type: 'done', result: 7 });
    (worker.onerror as (event: unknown) => void)({ message: 'late', preventDefault() {} });
    expect(worker.terminated).toBe(true);
    expect(heard).toEqual([['log', 'before'], ['done', 7], ['log', 'its worker crashed: late']]);
    expect(link.ended).toBe(true);
  });
});
