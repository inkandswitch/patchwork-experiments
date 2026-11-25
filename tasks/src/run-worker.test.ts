// The run worker's side of a job, with its port and its platform faked: every
// way a job can end says exactly one `done` or `threw`, after what the code
// wrote is saved, and nothing the code says after that reaches the pool.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromRunWorker, ToRunWorker } from './run-worker';
import type { Job } from './pool';

/** What happened, in order: the worker's messages by type, and its Repo's saves. */
let events: string[];
let said: FromRunWorker[];
let modules: Record<string, unknown>;
let flushFails: boolean;
let repoFails: boolean;
let imported: { docId: string; bytes: Uint8Array }[];
let calls: string[];

vi.mock('./webworker-lib', () => ({
  setUpImportMap: async () => {},
  getRepo: async () => {
    if (repoFails) {
      throw new Error('no repo here');
    }
    // A Repo that records every use: the run worker may import the task and flush, nothing else.
    return new Proxy(
      {
        import: (bytes: Uint8Array, args: { docId: string }) => {
          imported.push({ docId: args.docId, bytes });
        },
        flush: async () => {
          events.push('flush');
          if (flushFails) {
            throw new Error('disk full');
          }
        },
      },
      {
        get(target, name) {
          calls.push(String(name));
          return (target as any)[name];
        },
      },
    );
  },
  importModule: async (url: string) => {
    if (!(url in modules)) {
      throw new Error(`cannot find ${url}`);
    }
    return modules[url];
  },
}));

const { serve } = await import('./run-worker');

const job = (importUrl: string): Job => ({
  taskUrl: 'automerge:2KYqboWHPS5rvWsheoLnHgFvE7ou' as Job['taskUrl'],
  runId: 'run-1',
  importUrl,
  input: { n: 1 },
  key: 'k',
});

/** A run worker on a port that copies what it posts the way a thread boundary does. */
function start() {
  let deliver: (message: ToRunWorker) => void = () => {};
  serve({
    post: (message) => {
      const copied = structuredClone(message);
      said.push(copied);
      events.push(copied.type);
    },
    onMessage: (listener) => (deliver = listener),
  });
  return (message: ToRunWorker) => deliver(message);
}

const settings: ToRunWorker = { type: 'settings', settings: { repoConfig: { syncServerUrl: 'wss://nowhere.invalid' } } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const endings = () => said.filter((m) => m.type === 'done' || m.type === 'threw');

beforeEach(() => {
  events = [];
  said = [];
  modules = {};
  flushFails = false;
  repoFails = false;
  imported = [];
  calls = [];
});

describe('a run worker', () => {
  it('calls the code with (input, ctx) and this = ctx, saves, then says done with the result', async () => {
    let seen: any;
    modules.ok = {
      default(this: unknown, input: unknown, ctx: any) {
        seen = { self: this === ctx, input, run: ctx.run, key: ctx.key, taskUrl: ctx.taskUrl };
        return { doubled: 2 };
      },
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('ok') });
    await settle();
    expect(seen).toEqual({ self: true, input: { n: 1 }, run: 'run-1', key: 'k', taskUrl: job('ok').taskUrl });
    expect(events).toEqual(['flush', 'done']);
    expect(said).toEqual([{ type: 'done', result: { doubled: 2 } }]);
  });

  it('hands the code a Repo that has the task, and does nothing else to it', async () => {
    modules.ok = { default: () => 1 };
    const tell = start();
    tell(settings);
    const bytes = new Uint8Array([1, 2, 3]);
    tell({ type: 'job', job: job('ok'), task: bytes });
    await settle();
    expect(imported).toEqual([{ docId: '2KYqboWHPS5rvWsheoLnHgFvE7ou', bytes }]);
    // `then` is the promise machinery asking whether the Repo is itself a promise
    expect(new Set(calls)).toEqual(new Set(['then', 'import', 'flush']));
  });

  // Each way the code can fail ends in one `threw`, after a save, never in silence.
  const failures: [string, unknown, RegExp][] = [
    ['code that will not import', undefined, /cannot find/],
    ['a module with no default export', { other: () => 1 }, /no default export/],
    ['a default export that is not a function', { default: 42 }, /no default export/],
    ['a synchronous throw', { default: () => { throw new Error('sync boom'); } }, /sync boom/],
    ['a rejected promise', { default: async () => { throw new Error('async boom'); } }, /async boom/],
    ['a thrown non-error', { default: () => { throw null; } }, /null/],
    ['a result that cannot cross a thread', { default: () => () => 1 }, /could not be sent/],
  ];
  for (const [what, module, message] of failures) {
    it(`says threw, once, for ${what}`, async () => {
      if (module !== undefined) {
        modules.it = module;
      }
      const tell = start();
      tell(settings);
      tell({ type: 'job', job: job('it') });
      await settle();
      expect(endings()).toHaveLength(1);
      expect(endings()[0].type).toBe('threw');
      expect((endings()[0] as { message: string }).message).toMatch(message);
      expect(events.indexOf('flush')).toBeLessThan(events.indexOf('threw'));
    });
  }

  it('says threw when what the code wrote cannot be saved, though it returned', async () => {
    modules.ok = { default: () => 1 };
    flushFails = true;
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('ok') });
    await settle();
    expect(endings()).toEqual([{ type: 'threw', message: expect.stringMatching(/could not be saved: disk full/) }]);
  });

  it('says threw when it has no Repo, or was never told its settings', async () => {
    modules.ok = { default: () => 1 };
    repoFails = true;
    let tell = start();
    tell(settings);
    tell({ type: 'job', job: job('ok') });
    await settle();
    expect(endings()).toEqual([{ type: 'threw', message: 'no repo here' }]);

    said = [];
    repoFails = false;
    tell = start();
    tell({ type: 'job', job: job('ok') });
    await settle();
    expect(endings()).toEqual([{ type: 'threw', message: expect.stringMatching(/before it was set up/) }]);
  });

  it("aborts the code's signal with the reason it is given", async () => {
    let reason: unknown;
    modules.waits = {
      default: (_: unknown, ctx: any) =>
        new Promise((resolve) => ctx.signal.addEventListener('abort', () => resolve((reason = ctx.signal.reason)))),
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('waits') });
    await settle();
    tell({ type: 'abort', reason: 'yielded' });
    await settle();
    expect(reason).toBe('yielded');
    expect(endings()).toEqual([{ type: 'done', result: 'yielded' }]);
  });

  it('passes log lines and progress on while the job runs, progress as a copy JSON can carry', async () => {
    modules.talks = {
      default: (_: unknown, ctx: any) => {
        ctx.log('a', 1, { b: 2 });
        ctx.progress({ step: 1, f: () => 1 });
        ctx.progress(0.5);
        return null;
      },
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('talks') });
    await settle();
    expect(said).toEqual([
      { type: 'log', message: 'a 1 [object Object]' },
      { type: 'progress', value: { step: 1 } },
      { type: 'progress', value: 0.5 },
      { type: 'done', result: null },
    ]);
  });

  it('says nothing for a job once it has said how it ended, though its code goes on', async () => {
    // A worker is handed the next job once this one is done, so a line the
    // first job's code logs later would be counted as the next job's.
    modules.lingers = {
      default: (_: unknown, ctx: any) => {
        setTimeout(() => {
          ctx.log('late');
          ctx.progress(1);
        }, 5);
        return 'early';
      },
    };
    modules.ok = { default: () => 'second' };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('lingers') });
    await new Promise((resolve) => setTimeout(resolve, 1));
    tell({ type: 'job', job: { ...job('ok'), runId: 'run-2' } });
    await settle();
    expect(said).toEqual([
      { type: 'done', result: 'early' },
      { type: 'done', result: 'second' },
    ]);
  });
});
