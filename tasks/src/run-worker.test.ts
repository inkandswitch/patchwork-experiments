// The run worker's side of a job, with its port and its platform faked: every
// way a job can end says exactly one `done` or `threw`, after what the code
// wrote is saved and the sync server has acknowledged it, and nothing the code
// says after that reaches the pool. The fake Repo has the members of the real
// ones that the run worker uses (`handles`, the 'subduction-remote-heads'
// event with its real shape, `connectedSubductionPeerIds`,
// `resyncSubduction`), and a private field, as the real Repo's methods have.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromRunWorker, ToRunWorker } from './run-worker';
import type { Job } from './pool';

/** What happened, in order: the worker's messages by type, and its Repo's saves. */
let events: string[];
let said: FromRunWorker[];
let modules: Record<string, unknown>;
let flushFails: boolean;
let repoFails: boolean;
let imported: { docId: string; bytes: Uint8Array }[];
/** What each save named: its documents, or 'all'. */
let flushes: (string[] | 'all')[];
let calls: string[];
/** How the next Repo is made: whether it records every use, offers the server's reports, and which peers it is connected to. */
let made: { recorded: boolean; event: boolean; connected: string[] };
let theRepo: FakeRepo;
/** What `flush` does once it has saved (the same-tick case schedules a marker). */
let afterFlush: () => void;
/** When the Repo's first attempt to reach its server ends; `connectNow` ends it. */
let firstAttemptOver: Promise<void>;
let connectNow: () => void;

const SERVER = 'server-peer';

class FakeHandle {
  #n = 1;
  constructor(
    readonly documentId: string,
    public value: unknown = {},
    private headsNow: string[] = [`${documentId}@1`],
  ) {}
  get url() {
    return `automerge:${this.documentId}`;
  }
  heads() {
    return this.headsNow;
  }
  doc() {
    return this.value;
  }
  change() {
    this.headsNow = [`${this.documentId}@${++this.#n}`];
  }
}

class FakeRepo {
  /** Read by its methods, so that one called with any other `this` throws. */
  #own = 'the real Repo';
  byId: Record<string, FakeHandle> = {};
  listeners = new Map<string, Set<(event: any) => void>>();
  resynced: string[] = [];
  peersAsked = 0;
  /** Each find answers with the next of these: a handle, or a rejection; the last repeats. */
  answers: (FakeHandle | Error)[] = [new Error('Document is unavailable')];
  finds = 0;
  declare on?: (name: string, listener: (event: any) => void) => void;
  declare off?: (name: string, listener: (event: any) => void) => void;
  declare connectedSubductionPeerIds?: () => Promise<string[]>;
  declare resyncSubduction?: (documentId: string) => void;

  constructor(event: boolean) {
    if (event) {
      this.on = (name, listener) => {
        if (!this.listeners.has(name)) {
          this.listeners.set(name, new Set());
        }
        this.listeners.get(name)!.add(listener);
      };
      this.off = (name, listener) => void this.listeners.get(name)?.delete(listener);
      this.connectedSubductionPeerIds = async () => {
        this.peersAsked++;
        return made.connected;
      };
      this.resyncSubduction = (documentId) => void this.resynced.push(documentId);
    }
  }
  get handles() {
    return { ...this.byId };
  }
  import(bytes: Uint8Array, args: { docId: string }) {
    imported.push({ docId: args.docId, bytes });
    this.byId[args.docId] = new FakeHandle(args.docId);
  }
  async flush(ids?: string[]) {
    events.push('flush');
    flushes.push(ids ? [...ids] : 'all');
    if (flushFails) {
      throw new Error('disk full');
    }
    afterFlush();
  }
  create(value: unknown = {}) {
    const id = `doc${Object.keys(this.byId).length + 1}`;
    return (this.byId[id] = new FakeHandle(id, value));
  }
  async find(url: string) {
    this.finds++;
    const answer = this.answers[Math.min(this.finds, this.answers.length) - 1];
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  }
  /** A method that needs `this` to be the Repo itself. */
  whoAmI() {
    return { own: this.#own, self: this };
  }
  /** A method that finds through `this`, as the Repo's own workings do. */
  findInside(url: string) {
    return this.find(url);
  }
  /** What the sync server says: the real event's shape. */
  report(handle: FakeHandle, storageId = SERVER) {
    for (const listener of this.listeners.get('subduction-remote-heads') ?? []) {
      listener({ documentId: handle.documentId, storageId, heads: [...handle.heads()], timestamp: Date.now() });
    }
  }
}

vi.mock('./webworker-lib', () => ({
  setUpImportMap: async () => {},
  firstAttempt: () => firstAttemptOver,
  getRepo: async () => {
    if (repoFails) {
      throw new Error('no repo here');
    }
    theRepo = new FakeRepo(made.event);
    if (!made.recorded) {
      return theRepo;
    }
    // Records every use: the run worker may look at what the Repo can say, import the task, flush, and read heads.
    return new Proxy(theRepo, {
      get(target, name) {
        calls.push(String(name));
        const value = Reflect.get(target, name, target);
        // bound, so that the fake's own workings are not counted as uses
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  },
  importModule: async (url: string) => {
    if (!(url in modules)) {
      throw new Error(`cannot find ${url}`);
    }
    return modules[url];
  },
}));

const { serve, REACH_LIMIT_MS, RESYNC_EVERY_MS, STAYS_HERE, notReached } = await import('./run-worker');

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
const logs = () => said.filter((m) => m.type === 'log').map((m) => (m as { message: string }).message);

beforeEach(() => {
  events = [];
  said = [];
  modules = {};
  flushFails = false;
  repoFails = false;
  imported = [];
  flushes = [];
  calls = [];
  made = { recorded: false, event: true, connected: [SERVER] };
  afterFlush = () => {};
  firstAttemptOver = Promise.resolve();
  connectNow = () => {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a run worker', () => {
  it('calls the code with (input, ctx) and this = ctx, then says done with the result', async () => {
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
    expect(events).toEqual(['done']);
    expect(said).toEqual([{ type: 'done', result: { doubled: 2 } }]);
  });

  it('hands the code a Repo that has the task, and does nothing else to it', async () => {
    made.recorded = true;
    modules.ok = { default: () => 1 };
    const tell = start();
    tell(settings);
    const bytes = new Uint8Array([1, 2, 3]);
    tell({ type: 'job', job: job('ok'), task: bytes });
    await settle();
    expect(imported).toEqual([{ docId: '2KYqboWHPS5rvWsheoLnHgFvE7ou', bytes }]);
    // `then` is the promise machinery asking whether the Repo is itself a
    // promise; `on` and the two methods beside it are looked at once, to hear
    // the server's reports for the Repo's whole life; `handles` gives the
    // heads before and after the code ran. Code that wrote nothing has
    // nothing saved.
    expect(new Set(calls)).toEqual(
      new Set(['then', 'on', 'connectedSubductionPeerIds', 'resyncSubduction', 'import', 'handles']),
    );
    expect(theRepo.peersAsked).toBe(0);
  });

  // Each way the code can fail ends in one `threw`, never in silence, and
  // after the save of what it may have written: everything, when the code
  // was never called and so what changed cannot be told; nothing, when it
  // was called and wrote nothing.
  const failures: [string, unknown, RegExp, (string[] | 'all')[]][] = [
    ['code that will not import', undefined, /cannot find/, ['all']],
    ['a module with no default export', { other: () => 1 }, /no default export/, ['all']],
    ['a default export that is not a function', { default: 42 }, /no default export/, ['all']],
    ['a synchronous throw', { default: () => { throw new Error('sync boom'); } }, /sync boom/, []],
    ['a rejected promise', { default: async () => { throw new Error('async boom'); } }, /async boom/, []],
    ['a thrown non-error', { default: () => { throw null; } }, /null/, []],
    ['a result that cannot cross a thread', { default: () => () => 1 }, /could not be sent/, []],
  ];
  for (const [what, module, message, saved] of failures) {
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
      expect(flushes).toEqual(saved);
      expect(events.filter((it) => it === 'flush' || it === 'threw')).toEqual([...saved.map(() => 'flush'), 'threw']);
    });
  }

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

describe('ctx.settled', () => {
  /** Code that says how its `ctx.settled` went: 'settled', or the rejection's message. */
  const awaits = {
    default: async (_: unknown, ctx: any) => {
      try {
        await ctx.settled;
        return 'settled';
      } catch (error) {
        return (error as Error).message;
      }
    },
  };

  it('counts a settle said while the code is still being imported', async () => {
    let imported!: (module: unknown) => void;
    modules.slow = new Promise((resolve) => (imported = resolve));
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('slow') });
    tell({ type: 'settled', run: 'run-1' });
    await settle();
    expect(endings()).toEqual([]);
    imported(awaits);
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: 'settled' }]);
  });

  it("resolves for its own run's id only: another id, and the previous job's, are ignored", async () => {
    modules.quick = { default: () => 'first' };
    modules.waits = awaits;
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('quick') });
    await settle();
    tell({ type: 'job', job: { ...job('waits'), runId: 'run-2' } });
    await settle();
    tell({ type: 'settled', run: 'run-1' });
    tell({ type: 'settled', run: 'someone else' });
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: 'first' }]);
    tell({ type: 'settled', run: 'run-2' });
    await settle();
    expect(endings()).toEqual([
      { type: 'done', result: 'first' },
      { type: 'done', result: 'settled' },
    ]);
  });

  // Each reason the pool stops a run with, before it settled.
  for (const reason of ['cancelled', 'yielded', 'stopping'] as const) {
    it(`rejects with the reason when the run stops before it settled (${reason})`, async () => {
      modules.waits = awaits;
      const tell = start();
      tell(settings);
      tell({ type: 'job', job: job('waits') });
      await settle();
      tell({ type: 'abort', reason });
      await settle();
      expect(endings()).toEqual([{ type: 'done', result: `the run stopped before it settled (${reason})` }]);
    });
  }

  // How the promise stands once the pool has said both, in either order:
  // whichever came first decides, for good.
  const orders: [string, ('settled' | 'abort')[], string][] = [
    ['a settle, then an abort', ['settled', 'abort'], 'resolved'],
    ['an abort, then a settle', ['abort', 'settled'], 'rejected: the run stopped before it settled (yielded)'],
  ];
  for (const [what, said, outcome] of orders) {
    it(`resolves at most once, never after an abort: ${what}`, async () => {
      const outcomes: string[] = [];
      let finish!: () => void;
      modules.both = {
        default: (_: unknown, ctx: any) => {
          ctx.settled.then(
            () => outcomes.push('resolved'),
            (error: Error) => outcomes.push(`rejected: ${error.message}`),
          );
          return new Promise<void>((resolve) => (finish = resolve));
        },
      };
      const tell = start();
      tell(settings);
      tell({ type: 'job', job: job('both') });
      await settle();
      for (const message of said) {
        tell(message === 'settled' ? { type: 'settled', run: 'run-1' } : { type: 'abort', reason: 'yielded' });
      }
      await settle();
      finish();
      await settle();
      expect(outcomes).toEqual([outcome]);
    });
  }

  it('leaves no unhandled rejection when the code never looks at it and the run is stopped', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      modules.ignores = {
        default: (_: unknown, ctx: any) => new Promise((resolve) => ctx.signal.addEventListener('abort', () => resolve('stopped'))),
      };
      const tell = start();
      tell(settings);
      tell({ type: 'job', job: job('ignores') });
      await settle();
      tell({ type: 'abort', reason: 'cancelled' });
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(endings()).toEqual([{ type: 'done', result: 'stopped' }]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });
});

describe('ctx.settled, as a checker attacks it', () => {
  /** Code that records every way its `ctx.settled` went, and returns when told to. */
  function recording(outcomes: string[], finishers: (() => void)[]) {
    return {
      default: (_: unknown, ctx: any) => {
        ctx.settled.then(
          () => outcomes.push(`${ctx.run} resolved`),
          (error: Error) => outcomes.push(`${ctx.run} rejected: ${error.message}`),
        );
        return new Promise<string>((resolve) => finishers.push(() => resolve(ctx.run)));
      },
    };
  }

  it("a worker used for the next job: the previous job's settle, said while the next is still being imported, resolves nothing; the next job's own does", async () => {
    const outcomes: string[] = [];
    const finishers: (() => void)[] = [];
    modules.first = recording(outcomes, finishers);
    let imported!: (module: unknown) => void;
    modules.second = new Promise((resolve) => (imported = resolve));
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: { ...job('first'), runId: 'run-1' } });
    await settle();
    finishers.shift()!();
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: 'run-1' }]);
    tell({ type: 'job', job: { ...job('second'), runId: 'run-2' } });
    tell({ type: 'settled', run: 'run-1' });
    tell({ type: 'settled', run: 'run-1' });
    await settle();
    imported(recording(outcomes, finishers));
    await settle();
    // neither run-1's promise (no longer the worker's job) nor run-2's
    expect(outcomes).toEqual([]);
    tell({ type: 'settled', run: 'run-2' });
    tell({ type: 'settled', run: 'run-2' });
    await settle();
    expect(outcomes).toEqual(['run-2 resolved']);
    finishers.shift()!();
    await settle();
    expect(endings()).toEqual([
      { type: 'done', result: 'run-1' },
      { type: 'done', result: 'run-2' },
    ]);
  });

  // Whatever follows the first word, the first word stands, once.
  const sequences: [('settled' | 'abort')[], string][] = [
    [['settled', 'settled', 'settled'], 'run-1 resolved'],
    [['settled', 'abort', 'settled'], 'run-1 resolved'],
    [['abort', 'settled', 'settled'], 'run-1 rejected: the run stopped before it settled (cancelled)'],
    [['abort', 'abort', 'settled'], 'run-1 rejected: the run stopped before it settled (cancelled)'],
  ];
  for (const [words, outcome] of sequences) {
    it(`told ${words.join(', ')}: ${outcome}, once`, async () => {
      const outcomes: string[] = [];
      const finishers: (() => void)[] = [];
      modules.it = recording(outcomes, finishers);
      const tell = start();
      tell(settings);
      tell({ type: 'job', job: { ...job('it'), runId: 'run-1' } });
      await settle();
      for (const word of words) {
        tell(word === 'settled' ? { type: 'settled', run: 'run-1' } : { type: 'abort', reason: 'cancelled' });
        await settle();
      }
      finishers.shift()!();
      await settle();
      expect(outcomes).toEqual([outcome]);
    });
  }

  it('an abort said while the code is still being imported rejects it before the code first looks', async () => {
    const outcomes: string[] = [];
    const finishers: (() => void)[] = [];
    let imported!: (module: unknown) => void;
    modules.slow = new Promise((resolve) => (imported = resolve));
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: { ...job('slow'), runId: 'run-1' } });
    tell({ type: 'abort', reason: 'yielded' });
    tell({ type: 'settled', run: 'run-1' });
    await settle();
    imported(recording(outcomes, finishers));
    await settle();
    expect(outcomes).toEqual(['run-1 rejected: the run stopped before it settled (yielded)']);
    finishers.shift()!();
    await settle();
  });
});

describe('a run ends only once what it wrote has reached the sync server', () => {
  /** Code that writes `count` new documents and returns their ids. */
  const writes = (count: number) => ({
    default: (_: unknown, ctx: any) => Array.from({ length: count }, () => ctx.repo.create({ x: 1 }).documentId),
  });
  const handle = (id: string) => theRepo.byId[id];

  it('says done only after the server reports the heads of the document the code changed', async () => {
    modules.w = writes(1);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    expect(endings()).toEqual([]);
    theRepo.report(handle('doc1'));
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: ['doc1'] }]);
    expect(logs()).toEqual([]);
  });

  it('of two changed documents, waits for both', async () => {
    modules.w = writes(2);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    theRepo.report(handle('doc1'));
    await settle();
    expect(endings()).toEqual([]);
    theRepo.report(handle('doc2'));
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: ['doc1', 'doc2'] }]);
  });

  it('counts a report that came before the code returned', async () => {
    modules.w = {
      default: (_: unknown, ctx: any) => {
        const made = ctx.repo.create({});
        theRepo.report(made);
        return 'early report';
      },
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: 'early report' }]);
  });

  it('waits for the latest heads when they change again while it waits', async () => {
    modules.w = writes(1);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    // code that went on after returning changes it again, and then the
    // server reports the heads from before that change
    handle('doc1').change();
    theRepo.report(new FakeHandle('doc1', {}, ['doc1@1']));
    await settle();
    expect(endings()).toEqual([]);
    theRepo.report(handle('doc1'));
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: ['doc1'] }]);
  });

  it('does not count a report from a peer it is not connected to', async () => {
    modules.w = writes(1);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    theRepo.report(handle('doc1'), 'a-peer-gossiped-about');
    await settle();
    expect(endings()).toEqual([]);
    theRepo.report(handle('doc1'));
    await settle();
    expect(endings()).toHaveLength(1);
  });

  it('waits when the code threw, too', async () => {
    modules.w = {
      default: (_: unknown, ctx: any) => {
        ctx.repo.create({ half: 'done' });
        throw new Error('gave up');
      },
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    expect(endings()).toEqual([]);
    theRepo.report(handle('doc1'));
    await settle();
    expect(endings()).toEqual([{ type: 'threw', message: 'gave up' }]);
  });

  it('waits when the run was stopped, and then says how it ended', async () => {
    // a solver writes "cancelled" into its run document when told to stop
    modules.w = {
      default: (_: unknown, ctx: any) => {
        const run = ctx.repo.create({ status: 'running' });
        return new Promise((resolve) =>
          ctx.signal.addEventListener('abort', () => {
            run.change();
            resolve('stopped');
          }),
        );
      },
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    theRepo.report(handle('doc1')); // the "running" heads reach the server
    tell({ type: 'abort', reason: 'cancelled' });
    await settle();
    expect(endings()).toEqual([]);
    theRepo.report(handle('doc1')); // and the "cancelled" heads
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: 'stopped' }]);
  });

  it('with no report, says so in the log and how it ended after REACH_LIMIT_MS, asking again every RESYNC_EVERY_MS', async () => {
    vi.useFakeTimers();
    modules.w = writes(2);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await vi.advanceTimersByTimeAsync(0);
    theRepo.report(handle('doc2'));
    await vi.advanceTimersByTimeAsync(RESYNC_EVERY_MS);
    expect(theRepo.resynced).toEqual(['doc1']);
    await vi.advanceTimersByTimeAsync(REACH_LIMIT_MS - RESYNC_EVERY_MS - 1);
    expect(endings()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(theRepo.resynced).toEqual(['doc1', 'doc1']);
    expect(logs()).toEqual([notReached(1, 2)]);
    expect(endings()).toEqual([{ type: 'done', result: ['doc1', 'doc2'] }]);
    expect(said.at(-2)).toEqual({ type: 'log', message: notReached(1, 2) });
  });

  it('leaves no timer or interval behind once it has said how a run ended, by a report or at the limit, and the next job waits afresh', async () => {
    vi.useFakeTimers();
    modules.w = writes(1);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(3); // the limit, looking again, asking again
    theRepo.report(handle('doc1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(endings()).toEqual([{ type: 'done', result: ['doc1'] }]);
    expect(vi.getTimerCount()).toBe(0);

    said = [];
    tell({ type: 'job', job: { ...job('w'), runId: 'run-2' } });
    await vi.advanceTimersByTimeAsync(REACH_LIMIT_MS);
    expect(said).toEqual([
      { type: 'log', message: notReached(1, 1) },
      { type: 'done', result: ['doc2'] },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    // the one listener for the server's reports is the Repo's, kept for its life
    expect(theRepo.listeners.get('subduction-remote-heads')?.size).toBe(1);
  });

  it('when not connected to a server, waits for nothing and says once that it stays here', async () => {
    made.connected = [];
    modules.w = writes(3);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    expect(said).toEqual([
      { type: 'log', message: STAYS_HERE },
      { type: 'done', result: ['doc1', 'doc2', 'doc3'] },
    ]);
  });

  it('when its first attempt to connect is still going, waits for it and then for the report', async () => {
    made.connected = [];
    firstAttemptOver = new Promise((resolve) => (connectNow = resolve));
    modules.w = writes(1);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    expect(said).toEqual([]);
    made.connected = [SERVER];
    connectNow();
    await settle();
    expect(said).toEqual([]);
    theRepo.report(handle('doc1'));
    await settle();
    expect(said).toEqual([{ type: 'done', result: ['doc1'] }]);
  });

  it('when its first attempt to connect ends without a connection, says once that it stays here', async () => {
    made.connected = [];
    firstAttemptOver = new Promise((resolve) => (connectNow = resolve));
    modules.w = writes(1);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    connectNow();
    await settle();
    expect(said).toEqual([
      { type: 'log', message: STAYS_HERE },
      { type: 'done', result: ['doc1'] },
    ]);
  });

  it('when its first attempt to connect never ends, says after REACH_LIMIT_MS that it stays here', async () => {
    vi.useFakeTimers();
    made.connected = [];
    firstAttemptOver = new Promise(() => {});
    modules.w = writes(1);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await vi.advanceTimersByTimeAsync(REACH_LIMIT_MS - 1);
    expect(said).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(said).toEqual([
      { type: 'log', message: STAYS_HERE },
      { type: 'done', result: ['doc1'] },
    ]);
  });

  it('when the Repo cannot say what the server holds, waits for nothing and says once that it stays here', async () => {
    made.event = false;
    modules.w = writes(2);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    expect(said).toEqual([
      { type: 'log', message: STAYS_HERE },
      { type: 'done', result: ['doc1', 'doc2'] },
    ]);
  });

  it("does not wait for the task's own document", async () => {
    modules.w = {
      default: (_: unknown, ctx: any) => {
        theRepo.byId['2KYqboWHPS5rvWsheoLnHgFvE7ou'].change();
        return 'own only';
      },
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w'), task: new Uint8Array([1]) });
    await settle();
    expect(said).toEqual([{ type: 'done', result: 'own only' }]);
    expect(theRepo.peersAsked).toBe(0);
  });

  it('does not wait for a document that only changed before the code was called', async () => {
    modules.w = writes(1);
    modules.nothing = { default: () => 'idle' };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('w') });
    await settle();
    theRepo.report(handle('doc1'));
    await settle();
    said = [];
    tell({ type: 'job', job: { ...job('nothing'), runId: 'run-2' } });
    await settle();
    expect(said).toEqual([{ type: 'done', result: 'idle' }]);
  });

  it('a run that changes nothing saves nothing and says done in the same tick its code returns, asking nothing of the server', async () => {
    modules.ok = {
      default: () => {
        setTimeout(() => events.push('next tick'), 0);
        return 'nothing written';
      },
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('ok'), task: new Uint8Array([1]) });
    await settle();
    expect(events).toEqual(['done', 'next tick']);
    expect(theRepo.peersAsked).toBe(0);
  });
});

// What is saved
//
// Before a run says how it ended, what its code wrote is saved: every
// document whose heads differ from when the code was called, and no other.
// The cases: nothing changed; a document made; a document changed that
// existed before; the task's own document changed; what changed cannot be
// told (the code was never called); and a save that fails, both when the
// changed documents are known and when everything is saved.

describe('a run saves what its code changed, and only that', () => {
  const own = '2KYqboWHPS5rvWsheoLnHgFvE7ou';
  /** Runs `body(ctx.repo)` as the code of a job whose task is imported, the server acknowledging whatever changed. */
  async function runCode(body: (repo: any) => unknown, runId = 'run-1') {
    modules[runId] = { default: (_: unknown, ctx: any) => body(ctx.repo) };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: { ...job(runId), runId }, task: new Uint8Array([1]) });
    await settle();
    for (const handle of Object.values(theRepo.byId)) {
      theRepo.report(handle);
    }
    await settle();
    return tell;
  }

  it('saves nothing when the code changed nothing, the imported task included', async () => {
    await runCode(() => 'idle');
    expect(flushes).toEqual([]);
    expect(endings()).toEqual([{ type: 'done', result: 'idle' }]);
  });

  it('saves the document the code made, and nothing else', async () => {
    await runCode((repo) => repo.create({ x: 1 }).documentId);
    expect(endings()).toEqual([{ type: 'done', result: 'doc2' }]);
    expect(flushes).toEqual([['doc2']]);
    expect(events).toEqual(['flush', 'done']);
  });

  it('saves the existing document the code changed, and not the one beside it that it left alone', async () => {
    const tell = await runCode((repo) => [repo.create({}).documentId, repo.create({}).documentId]);
    expect(endings()).toEqual([{ type: 'done', result: ['doc2', 'doc3'] }]);
    said = [];
    flushes = [];
    modules.second = { default: () => (theRepo.byId.doc3.change(), 'changed doc3') };
    tell({ type: 'job', job: { ...job('second'), runId: 'run-2' } });
    await settle();
    theRepo.report(theRepo.byId.doc3);
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: 'changed doc3' }]);
    expect(flushes).toEqual([['doc3']]);
  });

  it("saves the task's own document when the code wrote to it", async () => {
    await runCode(() => (theRepo.byId[own].change(), 'own'));
    expect(endings()).toEqual([{ type: 'done', result: 'own' }]);
    expect(flushes).toEqual([[own]]);
  });

  it('saves everything when what changed cannot be told', async () => {
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('not there'), task: new Uint8Array([1]) });
    await settle();
    expect(flushes).toEqual(['all']);
    expect(events).toEqual(['flush', 'threw']);
  });

  it('says threw when what the code wrote cannot be saved, though it returned', async () => {
    flushFails = true;
    await runCode((repo) => repo.create({ x: 1 }).documentId);
    expect(flushes).toEqual([['doc2']]);
    expect(endings()).toEqual([{ type: 'threw', message: expect.stringMatching(/could not be saved: disk full/) }]);
  });

  it('says threw when saving everything fails', async () => {
    flushFails = true;
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('not there') });
    await settle();
    expect(flushes).toEqual(['all']);
    expect(endings()).toEqual([{ type: 'threw', message: expect.stringMatching(/could not be saved: disk full/) }]);
  });
});

describe("the code's Repo", () => {
  /** Runs `body(ctx.repo)` as a task's code and resolves to what it settled to. */
  async function withCode(body: (repo: any) => Promise<unknown> | unknown) {
    let settled: Promise<{ ok: unknown } | { error: unknown }> = Promise.resolve({ error: 'never ran' });
    modules.code = {
      default: (_: unknown, ctx: any) => {
        settled = Promise.resolve()
          .then(() => body(ctx.repo))
          .then(
            (ok) => ({ ok }),
            (error) => ({ error }),
          );
        return null;
      },
    };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('code') });
    await vi.advanceTimersByTimeAsync(0);
    return () => settled;
  }

  it('finds a document that arrives on the third asking', async () => {
    vi.useFakeTimers();
    const arrived = new FakeHandle('input', { content: 'here' });
    const result = await withCode((repo) => {
      theRepo.answers = [new Error('unavailable'), new Error('unavailable'), arrived];
      return repo.find('automerge:input');
    });
    await vi.advanceTimersByTimeAsync(500 + 1000);
    expect(await result()).toEqual({ ok: arrived });
    expect(theRepo.finds).toBe(3);
  });

  it('rejects a document that never arrives after findWhenThere has tried for about half a minute', async () => {
    vi.useFakeTimers();
    let done = false;
    const result = await withCode(async (repo) => {
      try {
        return await repo.find('automerge:never');
      } finally {
        done = true;
      }
    });
    // 8 tries, waiting 0.5, 1, 2, 4, 8, 8 and 8 s between them
    await vi.advanceTimersByTimeAsync(31_499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result()).toEqual({ error: new Error('Document is unavailable') });
    expect(theRepo.finds).toBe(8);
  });

  it('rejects a url the Repo cannot read at its first asking', async () => {
    vi.useFakeTimers();
    const unreadable = new Error("Invalid AutomergeUrl: 'nonsense'");
    const result = await withCode((repo) => {
      theRepo.answers = [unreadable];
      return repo.find('nonsense');
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(await result()).toEqual({ error: unreadable });
    expect(theRepo.finds).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops asking once the caller's own signal aborts, with its reason, between askings or before the first", async () => {
    vi.useFakeTimers();
    const stop = new AbortController();
    const result = await withCode((repo) => repo.find('automerge:late', { signal: stop.signal }));
    await vi.advanceTimersByTimeAsync(200); // the first asking was refused; the second is 500 ms after it
    stop.abort('given up');
    await vi.advanceTimersByTimeAsync(0);
    expect(await result()).toEqual({ error: 'given up' });
    expect(theRepo.finds).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    const already = await withCode((repo) => repo.find('automerge:late', { signal: AbortSignal.abort('stopped before') }));
    await vi.advanceTimersByTimeAsync(0);
    expect(await already()).toEqual({ error: 'stopped before' });
    expect(theRepo.finds).toBe(1); // a worker, and a Repo, of its own
  });

  it('passes every other member through to the Repo itself, whose own workings keep its own find', async () => {
    vi.useFakeTimers();
    const result = await withCode(async (repo) => {
      const inside = await repo.findInside('automerge:x').then(
        () => 'found',
        (error: Error) => error.message,
      );
      return {
        who: repo.whoAmI(),
        isRepo: repo instanceof FakeRepo,
        handles: Object.keys(repo.handles),
        created: repo.create({ a: 1 }).documentId,
        sameMethod: repo.whoAmI === repo.whoAmI,
        inside,
        findsByInside: theRepo.finds,
      };
    });
    const { ok } = (await result()) as { ok: any };
    expect(ok.who).toEqual({ own: 'the real Repo', self: theRepo });
    expect(ok).toMatchObject({
      isRepo: true,
      handles: [],
      created: 'doc1',
      sameMethod: true,
      inside: 'Document is unavailable',
      findsByInside: 1,
    });
  });
});
