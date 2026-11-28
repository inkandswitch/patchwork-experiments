// The run worker's side of a job, with its port and its platform faked: every
// way a job can end says exactly one `done` or `threw`, as soon as it has
// ended, and nothing the code says after that reaches the pool. The fake Repo
// has a private field, as the real Repo's methods have.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromRunWorker, ToRunWorker } from './run-worker';
import type { Job } from './pool';

/** What happened, in order: the worker's messages by type, and its Repo's saves. */
let events: string[];
let said: FromRunWorker[];
let modules: Record<string, unknown>;
let repoFails: boolean;
let theRepo: FakeRepo;
/** Each document the Repo was given the bytes of, as events says in order. */
let imported: { docId: string; bytes: Uint8Array }[];

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
  /** Each find answers with the next of these: a handle, or a rejection; the last repeats. */
  answers: (FakeHandle | Error)[] = [new Error('Document is unavailable')];
  finds = 0;

  get handles() {
    return { ...this.byId };
  }
  import(bytes: Uint8Array, args: { docId: string }) {
    events.push('import');
    imported.push({ docId: args.docId, bytes });
    this.byId[args.docId] = new FakeHandle(args.docId);
  }
  async flush() {
    events.push('flush');
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
}

vi.mock('./webworker-lib', () => ({
  setUpImportMap: async () => {},
  getRepo: async () => {
    if (repoFails) {
      throw new Error('no repo here');
    }
    theRepo = new FakeRepo();
    return theRepo;
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

const settings: ToRunWorker = { type: 'settings', settings: { link: new MessageChannel().port1 } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const endings = () => said.filter((m) => m.type === 'done' || m.type === 'threw');

beforeEach(() => {
  events = [];
  said = [];
  modules = {};
  repoFails = false;
  imported = [];
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
    tell({ type: 'job', job: job('ok'), task: null });
    await settle();
    expect(seen).toEqual({ self: true, input: { n: 1 }, run: 'run-1', key: 'k', taskUrl: job('ok').taskUrl });
    expect(events).toEqual(['done']);
    expect(said).toEqual([{ type: 'done', result: { doubled: 2 } }]);
  });

  it("has the task's document, from the bytes its job carries, before the code is called", async () => {
    modules.ok = { default: () => events.push('code') };
    const bytes = new Uint8Array([1, 2, 3]);
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('ok'), task: bytes });
    await settle();
    expect(imported.map(({ docId, bytes }) => [docId, [...bytes]])).toEqual([['2KYqboWHPS5rvWsheoLnHgFvE7ou', [1, 2, 3]]]);
    expect(events.indexOf('import')).toBeLessThan(events.indexOf('code'));
  });

  it('imports nothing for a job whose task the pool could not export, and runs it all the same', async () => {
    modules.ok = { default: () => 1 };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('ok'), task: null });
    await settle();
    expect(imported).toEqual([]);
    expect(endings()).toEqual([{ type: 'done', result: 1 }]);
  });

  // Each way the code can fail ends in one `threw`, never in silence, and
  // and without saving first.
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
      tell({ type: 'job', job: job('it'), task: null });
      await settle();
      expect(endings()).toHaveLength(1);
      expect(endings()[0].type).toBe('threw');
      expect((endings()[0] as { message: string }).message).toMatch(message);
      expect(events.filter((it) => it === 'flush' || it === 'threw')).toEqual(['threw']);
    });
  }

  it('says threw when it has no Repo, or was never told its settings', async () => {
    modules.ok = { default: () => 1 };
    repoFails = true;
    let tell = start();
    tell(settings);
    tell({ type: 'job', job: job('ok'), task: null });
    await settle();
    expect(endings()).toEqual([{ type: 'threw', message: 'no repo here' }]);

    said = [];
    repoFails = false;
    tell = start();
    tell({ type: 'job', job: job('ok'), task: null });
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
    tell({ type: 'job', job: job('waits'), task: null });
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
    tell({ type: 'job', job: job('talks'), task: null });
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
    tell({ type: 'job', job: job('lingers'), task: null });
    await new Promise((resolve) => setTimeout(resolve, 1));
    tell({ type: 'job', job: { ...job('ok'), runId: 'run-2' }, task: null });
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
    tell({ type: 'job', job: job('slow'), task: null });
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
    tell({ type: 'job', job: job('quick'), task: null });
    await settle();
    tell({ type: 'job', job: { ...job('waits'), runId: 'run-2' }, task: null });
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
      tell({ type: 'job', job: job('waits'), task: null });
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
      tell({ type: 'job', job: job('both'), task: null });
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
      tell({ type: 'job', job: job('ignores'), task: null });
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
    tell({ type: 'job', job: { ...job('first'), runId: 'run-1' }, task: null });
    await settle();
    finishers.shift()!();
    await settle();
    expect(endings()).toEqual([{ type: 'done', result: 'run-1' }]);
    tell({ type: 'job', job: { ...job('second'), runId: 'run-2' }, task: null });
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
      tell({ type: 'job', job: { ...job('it'), runId: 'run-1' }, task: null });
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
    tell({ type: 'job', job: { ...job('slow'), runId: 'run-1' }, task: null });
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

describe('what a run wrote is left to its Repo', () => {
  it('says done as soon as the code returns, without waiting for a save', async () => {
    modules.ok = { default: (_: unknown, ctx: any) => ctx.repo.create({ x: 1 }).documentId };
    const tell = start();
    tell(settings);
    tell({ type: 'job', job: job('ok'), task: null });
    await settle();
    expect(events).toEqual(['done']);
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
    tell({ type: 'job', job: job('code'), task: null });
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
