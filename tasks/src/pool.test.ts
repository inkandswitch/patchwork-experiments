// @vitest-environment node
//
// A pool on real automerge-repo documents, with a fake executor whose workers
// say what the test tells them to, a clock moved by hand, and ears that carry
// messages between the pools in this process. Each of the design's finite
// cases, (a) to (j), is a test named by its letter; each of the pool's own
// promises is a test named by what it promises.

import * as A from '@automerge/automerge';
import { initSubduction, Repo, type AutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Acceptance } from './acceptance';
import {
  Pool,
  type Clock,
  type Docs,
  type Ears,
  type Executor,
  type Job,
  type PoolOptions,
  type RunWorker,
  type StopReason,
  type WorkerEvents,
} from './pool';
import {
  BEAT_MS,
  GRACE_MS,
  LAPSE_MS,
  ending,
  listTask,
  taskError,
  taskResult,
  type Queue,
  type Run,
  type Task,
} from './rules';

await initSubduction();

// The harness

/** Lets promises, and the Repo's own work, run. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

class ManualClock implements Clock {
  t = 1_000_000;
  private timers: { id: number; at: number; every?: number; fn: () => void }[] = [];
  private next = 1;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => this.add(fn, ms);
  setInterval = (fn: () => void, ms: number) => this.add(fn, ms, ms);
  clearTimeout = (id: unknown) => this.remove(id);
  clearInterval = (id: unknown) => this.remove(id);
  private add(fn: () => void, ms: number, every?: number) {
    const id = this.next++;
    this.timers.push({ id, at: this.t + ms, every, fn });
    return id;
  }
  private remove(id: unknown) {
    this.timers = this.timers.filter((timer) => timer.id !== id);
  }
  /** How many timers are set and not yet cleared or fired. */
  get pending() {
    return this.timers.length;
  }
  /** Moves time on by `ms`, firing each timer due on the way at its own time, in order. */
  async advance(ms: number) {
    const until = this.t + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) {
        break;
      }
      this.t = due.at;
      if (due.every) {
        due.at += due.every;
      } else {
        this.remove(due.id);
      }
      due.fn();
      await settle();
    }
    this.t = until;
    await settle();
  }
}

/** Ears for several pools in one process: what one sends, every other hears; `sent` keeps it all. */
class Loopback {
  sent: { url: string; message: any }[] = [];
  private listeners = new Map<string, Set<(message: any) => void>>();
  ears(): Ears & { deaf: boolean } {
    const mine = new Set<(message: any) => void>();
    const ears = {
      deaf: false,
      send: (handle: { url: string }, message: any) => {
        this.sent.push({ url: handle.url, message });
        for (const listener of this.listeners.get(handle.url) ?? []) {
          if (!mine.has(listener)) {
            listener(structuredClone(message));
          }
        }
      },
      listen: (handle: { url: string }, onMessage: (message: any) => void) => {
        const listener = (message: any) => (ears.deaf ? undefined : onMessage(message));
        mine.add(listener);
        if (!this.listeners.has(handle.url)) {
          this.listeners.set(handle.url, new Set());
        }
        this.listeners.get(handle.url)!.add(listener);
        return () => this.listeners.get(handle.url)!.delete(listener);
      },
    };
    return ears;
  }
  /** Says a run is going on, as its pool would. */
  beat(url: string, run: string) {
    this.ears().send({ url }, { type: 'task progress', run, from: 'elsewhere', seq: this.sent.length });
  }
}

class FakeWorker implements RunWorker {
  jobs: Job[] = [];
  aborts: { reason: StopReason; at: number }[] = [];
  terminations: number[] = [];
  constructor(
    readonly events: WorkerEvents,
    private readonly clock: Clock,
  ) {}
  run(job: Job) {
    this.jobs.push(job);
  }
  abort(reason: StopReason) {
    this.aborts.push({ reason, at: this.clock.now() });
  }
  terminate() {
    this.terminations.push(this.clock.now());
  }
  get job() {
    return this.jobs.at(-1);
  }
}

class FakeExecutor implements Executor {
  workers: FakeWorker[] = [];
  constructor(private readonly clock: Clock) {}
  start(events: WorkerEvents) {
    const worker = new FakeWorker(events, this.clock);
    this.workers.push(worker);
    return worker;
  }
  /** The worker last handed this run. */
  of(runId: string) {
    const worker = [...this.workers].reverse().find((it) => it.job?.runId === runId);
    expect(worker, `a worker for ${runId}`).toBeDefined();
    return worker!;
  }
  /** Runs handed out and not yet over, by what the workers were told and what they said. */
  live(over: Set<string>) {
    return this.workers.filter((w) => w.terminations.length === 0 && w.job && !over.has(w.job.runId)).length;
  }
}

const CODE = 'data:text/javascript,export default () => 1';
const PKG = 'automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P';
const OTHER_PKG = 'automerge:4QvJwDgN9Wfnp9Eb1oNmhS8oWfRc';
const codeIn = (pkg: string) => `https://site.example/${encodeURIComponent(pkg)}/dist/task.js`;

type Handle<T> = DocHandle<T>;

function world() {
  const clock = new ManualClock();
  const net = new Loopback();
  const repo = new Repo({ network: [] } as any);
  const queue = repo.create<Queue>({ title: 'q', jobs: {} });
  let asked = 0;
  const ask = (
    key: string,
    more: { importUrl?: string; package?: string | null; askedAt?: number; runs?: Run[]; queue?: Handle<Queue> } = {},
  ) => {
    const task = repo.create<Task>({ importUrl: more.importUrl ?? CODE, input: { key }, key, runs: more.runs ?? [] });
    (more.queue ?? queue).change((doc) =>
      listTask(doc, key, { taskUrl: task.url, askedAt: more.askedAt ?? ++asked, package: more.package ?? null }),
    );
    return task;
  };
  const pool = (id: string, more: Partial<PoolOptions> = {}) => {
    const executor = new FakeExecutor(clock);
    const ears = net.ears();
    const it = new Pool({
      repo: repo as Docs,
      id,
      name: `pool ${id}`,
      slots: 1,
      executor,
      queues: { [queue.url]: 'any' },
      ears,
      clock,
      ...more,
    });
    return { pool: it, executor, ears };
  };
  return { clock, net, repo, queue, ask, pool };
}

const runsOf = (task: Handle<Task>) => task.doc()!.runs;
const statuses = (task: Handle<Task>) => runsOf(task).map((run) => run.status ?? 'open');
const lastRun = (task: Handle<Task>) => runsOf(task).at(-1)!;
const listed = (queue: Handle<Queue>, key: string) => queue.doc()!.jobs[key]?.taskUrl;

let w: ReturnType<typeof world>;
beforeEach(() => {
  w = world();
});

// The design's cases

describe('the design cases', () => {
  it('(a) one pool: takes the task, runs it, ends it, deletes the entry', async () => {
    const task = w.ask('k');
    const { pool, executor } = w.pool('A');
    await settle();

    expect(runsOf(task)).toHaveLength(1);
    const run = lastRun(task);
    expect(run).toMatchObject({ pool: 'A', start: w.clock.now() });
    expect(run.status).toBeUndefined();
    const worker = executor.of(run.id);
    expect(worker.job).toEqual({ taskUrl: task.url, runId: run.id, importUrl: CODE, input: { key: 'k' }, key: 'k' });
    expect(pool.busy).toBe(1);

    worker.events.log('working');
    worker.events.done({ answer: 42 });
    await settle();

    expect(lastRun(task)).toMatchObject({ status: 'succeeded', result: { answer: 42 }, end: w.clock.now() });
    expect(lastRun(task).logs!.map((line) => line.message)).toEqual(['working']);
    expect(taskResult(task.doc())).toEqual({ answer: 42 });
    expect(listed(w.queue, 'k')).toBeUndefined();
    expect(pool.busy).toBe(0);
    expect(worker.terminations).toEqual([]);

    // a worker whose run ended by itself is used again
    const next = w.ask('k2');
    await settle();
    expect(executor.workers).toHaveLength(1);
    expect(worker.job!.taskUrl).toBe(next.url);
  });

  it('(b) two pools take a task at once: the merge orders the runs, the later yields, one result', async () => {
    const clock = new ManualClock();
    const net = new Loopback();
    const repoA = new Repo({ network: [] } as any);
    const repoB = new Repo({ network: [] } as any);
    const queueA = repoA.create<Queue>({ title: 'q', jobs: {} });
    const taskA = repoA.create<Task>({ importUrl: CODE, input: null, key: 'k', runs: [] });
    queueA.change((doc) => listTask(doc, 'k', { taskUrl: taskA.url, askedAt: 1, package: null }));
    const queueB = repoB.import<Queue>(A.save(queueA.doc()), { docId: queueA.documentId } as any);
    const taskB = repoB.import<Task>(A.save(taskA.doc()), { docId: taskA.documentId } as any);
    const merge = () => {
      for (const [a, b] of [
        [taskA, taskB],
        [queueA, queueB],
      ] as const) {
        a.merge(b as any);
        b.merge(a as any);
      }
    };
    const start = (id: string, repo: Repo) => {
      const executor = new FakeExecutor(clock);
      const pool = new Pool({
        repo: repo as Docs,
        id,
        name: id,
        slots: 1,
        executor,
        queues: { [queueA.url]: 'any' },
        ears: net.ears(),
        clock,
      });
      return { pool, executor };
    };
    const a = start('A', repoA);
    const b = start('B', repoB);
    await settle();
    // each took it, not knowing of the other
    expect(runsOf(taskA)).toHaveLength(1);
    expect(runsOf(taskB)).toHaveLength(1);
    expect(runsOf(taskA)[0].id).not.toBe(runsOf(taskB)[0].id);

    merge();
    await settle();
    const order = runsOf(taskA).map((run) => run.id);
    expect(runsOf(taskB).map((run) => run.id)).toEqual(order);
    const [first, second] = runsOf(taskA);
    const [holder, later] = first.pool === 'A' ? [a, b] : [b, a];
    // the later one is told at once; the earlier is left alone
    expect(later.executor.of(second.id).aborts.map((it) => it.reason)).toEqual(['yielded']);
    expect(holder.executor.of(first.id).aborts).toEqual([]);

    await clock.advance(GRACE_MS);
    expect(later.executor.of(second.id).terminations).toEqual([clock.now()]);
    holder.executor.of(first.id).events.done('the one result');
    await settle();
    merge();
    await settle();

    for (const task of [taskA, taskB]) {
      expect(statuses(task)).toEqual(['succeeded', 'yielded']);
      expect(taskResult(task.doc())).toBe('the one result');
    }
    expect(queueA.doc().jobs.k).toBeUndefined();
    expect(queueB.doc().jobs.k).toBeUndefined();
  });

  it('(c) a holder gone for good: unheard for LAPSE_MS, then taken; the dead run stays open', async () => {
    const task = w.ask('k', { runs: [{ id: 'dead', pool: 'gone', start: 0 }] });
    const { executor } = w.pool('B');
    await settle();
    await w.clock.advance(LAPSE_MS - BEAT_MS);
    expect(runsOf(task)).toHaveLength(1);
    await w.clock.advance(BEAT_MS);
    expect(runsOf(task)).toHaveLength(2);
    expect(lastRun(task).pool).toBe('B');
    expect(executor.workers).toHaveLength(1);
    // nobody but its own pool says what became of a run
    expect(runsOf(task)[0]).toEqual({ id: 'dead', pool: 'gone', start: 0 });
  });

  it('(c) a holder that is heard is not taken from, however long it runs', async () => {
    const task = w.ask('k', { runs: [{ id: 'far', pool: 'far away', start: 0 }] });
    w.pool('B');
    await settle();
    for (let i = 0; i < 10; i++) {
      w.net.beat(task.url, 'far');
      await w.clock.advance(BEAT_MS);
    }
    expect(runsOf(task)).toHaveLength(1);
    await w.clock.advance(LAPSE_MS);
    expect(runsOf(task)).toHaveLength(2);
  });

  it('(e) a run taken while an earlier one was unheard gives way as soon as the earlier one is heard', async () => {
    const task = w.ask('k', { runs: [{ id: 'cut off', pool: 'X', start: 0 }] });
    const { executor } = w.pool('B');
    await settle();
    await w.clock.advance(LAPSE_MS);
    const mine = lastRun(task).id;
    expect(executor.of(mine).aborts).toEqual([]);
    w.net.beat(task.url, 'cut off');
    await settle();
    expect(executor.of(mine).aborts.map((it) => it.reason)).toEqual(['yielded']);
    await w.clock.advance(GRACE_MS);
    expect(statuses(task)).toEqual(['open', 'yielded']);
  });

  it('(d) a holder that restarts records its run lost at once and takes the task again', async () => {
    const task = w.ask('k');
    w.pool('A');
    await settle();
    const before = lastRun(task).id;

    // the machine stops without a word; its pool starts again from what it had saved
    const repo = new Repo({ network: [] } as any);
    const savedQueue = repo.import<Queue>(A.save(w.queue.doc()), { docId: w.queue.documentId } as any);
    const savedTask = repo.import<Task>(A.save(task.doc()), { docId: task.documentId } as any);
    const executor = new FakeExecutor(w.clock);
    new Pool({
      repo: repo as Docs,
      id: 'A',
      name: 'A',
      slots: 1,
      executor,
      queues: { [savedQueue.url]: 'any' },
      ears: w.net.ears(),
      clock: w.clock,
    });
    await settle();

    expect(statuses(savedTask)).toEqual(['lost', 'open']);
    expect(runsOf(savedTask)[0].id).toBe(before);
    expect(lastRun(savedTask).pool).toBe('A');
    expect(executor.of(lastRun(savedTask).id).jobs).toHaveLength(1);
  });

  it('(d) the third lost run fails the task, and nothing takes it again', async () => {
    const task = w.ask('k', {
      runs: [
        { id: 'r1', pool: 'A', start: 0, end: 1, status: 'lost', result: null, logs: [] },
        { id: 'r2', pool: 'A', start: 2, end: 3, status: 'lost', result: null, logs: [] },
        { id: 'r3', pool: 'A', start: 4 },
      ],
    });
    const { executor } = w.pool('A');
    await settle();
    await w.clock.advance(LAPSE_MS);
    expect(statuses(task)).toEqual(['lost', 'lost', 'lost']);
    expect(ending(task.doc())).toBe('failed');
    expect(taskError(task.doc())).toMatch(/stopped 3 times/);
    expect(executor.workers).toHaveLength(0);
    expect(listed(w.queue, 'k')).toBeUndefined();
  });

  it('(f) cancel before a run: nothing is started, and the entry goes', async () => {
    const task = w.ask('k');
    task.change((doc) => {
      doc.cancelled = true;
    });
    const { executor } = w.pool('A');
    await settle();
    expect(runsOf(task)).toEqual([]);
    expect(executor.workers).toHaveLength(0);
    expect(listed(w.queue, 'k')).toBeUndefined();
  });

  it('(f) cancel during a run: aborted at once, killed GRACE_MS later, recorded cancelled', async () => {
    const task = w.ask('k');
    const { executor, pool } = w.pool('A');
    await settle();
    const worker = executor.of(lastRun(task).id);
    const cancelledAt = w.clock.now();
    task.change((doc) => {
      doc.cancelled = true;
    });
    await settle();
    expect(worker.aborts).toEqual([{ reason: 'cancelled', at: cancelledAt }]);
    await w.clock.advance(GRACE_MS - 1);
    expect(worker.terminations).toEqual([]);
    expect(lastRun(task).status).toBeUndefined();
    await w.clock.advance(1);
    expect(worker.terminations).toEqual([cancelledAt + GRACE_MS]);
    expect(lastRun(task).status).toBe('cancelled');
    expect(listed(w.queue, 'k')).toBeUndefined();
    expect(pool.busy).toBe(0);

    // a worker that was stopped is never used again
    w.ask('k2');
    await settle();
    expect(executor.workers).toHaveLength(2);
    expect(worker.jobs).toHaveLength(1);
  });

  it('(f) cancel obeyed: code that stops is recorded cancelled, not failed, and its worker is ended', async () => {
    const task = w.ask('k');
    const { executor } = w.pool('A');
    await settle();
    const worker = executor.of(lastRun(task).id);
    task.change((doc) => {
      doc.cancelled = true;
    });
    await settle();
    worker.events.threw('AbortError: cancelled');
    await settle();
    expect(lastRun(task).status).toBe('cancelled');
    expect(worker.terminations).toEqual([w.clock.now()]);
    await w.clock.advance(GRACE_MS);
    expect(worker.terminations).toHaveLength(1);
  });

  it('(g) the same key asked twice: the task that lost its key yields, and the survivor runs', async () => {
    const first = w.ask('k');
    const { executor } = w.pool('A');
    await settle();
    const firstRun = lastRun(first).id;
    // the merge of the two asks kept the other one under the key
    const second = w.repo.create<Task>({ importUrl: CODE, input: null, key: 'k', runs: [] });
    w.queue.change((doc) => {
      doc.jobs.k = { taskUrl: second.url, askedAt: 1, package: null };
    });
    await settle();
    expect(executor.of(firstRun).aborts.map((it) => it.reason)).toEqual(['yielded']);
    await w.clock.advance(GRACE_MS);
    expect(statuses(first)).toEqual(['yielded']);
    expect(ending(first.doc())).toBeNull();
    // the freed slot takes the survivor
    expect(runsOf(second)).toHaveLength(1);
    executor.of(lastRun(second).id).events.done('done');
    await settle();
    expect(statuses(second)).toEqual(['succeeded']);
    expect(listed(w.queue, 'k')).toBeUndefined();
  });

  it('(h) a throw fails the task once, with the message as its last log line', async () => {
    const task = w.ask('k');
    const { executor } = w.pool('A');
    await settle();
    const worker = executor.of(lastRun(task).id);
    worker.events.log('starting');
    worker.events.threw('Error: boom');
    await settle();
    expect(statuses(task)).toEqual(['failed']);
    expect(lastRun(task).logs!.map((line) => line.message)).toEqual(['starting', 'Error: boom']);
    expect(taskError(task.doc())).toBe('Error: boom');
    expect(listed(w.queue, 'k')).toBeUndefined();
    await w.clock.advance(LAPSE_MS * 2);
    expect(runsOf(task)).toHaveLength(1);
    // its code ended by itself, so its worker is kept
    expect(worker.terminations).toEqual([]);
  });

  it('(h) a worker that dies under its run fails the task once, and is not used again', async () => {
    const task = w.ask('k');
    const { executor } = w.pool('A');
    await settle();
    const worker = executor.of(lastRun(task).id);
    worker.events.exit();
    await settle();
    expect(statuses(task)).toEqual(['failed']);
    expect(taskError(task.doc())).toBe('its worker died');
    await w.clock.advance(LAPSE_MS * 2);
    expect(runsOf(task)).toHaveLength(1);
    w.ask('k2');
    await settle();
    expect(executor.workers).toHaveLength(2);
  });

  it('(i) a graceful stop: every run is aborted, ended, recorded lost; another pool takes them again', async () => {
    const obeys = w.ask('obeys');
    const ignores = w.ask('ignores');
    const { pool, executor } = w.pool('A', { slots: 2 });
    await settle();
    const [obeying, ignoring] = [lastRun(obeys).id, lastRun(ignores).id].map((id) => executor.of(id));
    let stopped = false;
    const stopping = pool.stop().then(() => (stopped = true));
    await settle();
    expect(obeying.aborts.map((it) => it.reason)).toEqual(['stopping']);
    expect(ignoring.aborts.map((it) => it.reason)).toEqual(['stopping']);
    obeying.events.done('finished anyway');
    await settle();
    expect(statuses(obeys)).toEqual(['lost']);
    expect(obeying.terminations).toHaveLength(1);
    expect(stopped).toBe(false);

    await w.clock.advance(GRACE_MS);
    await stopping;
    expect(statuses(ignores)).toEqual(['lost']);
    expect(ignoring.terminations).toHaveLength(1);

    // the pool takes nothing more, and another pool takes both
    w.ask('later');
    const other = w.pool('B', { slots: 3 });
    await settle();
    expect(executor.workers).toHaveLength(2);
    expect(other.executor.workers).toHaveLength(3);
    expect(statuses(obeys)).toEqual(['lost', 'open']);
    expect(statuses(ignores)).toEqual(['lost', 'open']);
  });

  it('(j) code that will not load fails once, visibly', async () => {
    const task = w.ask('k', { importUrl: 'https://nowhere.invalid/task.js' });
    const { executor } = w.pool('A');
    await settle();
    executor.of(lastRun(task).id).events.threw('could not load https://nowhere.invalid/task.js: 404');
    await settle();
    expect(statuses(task)).toEqual(['failed']);
    expect(taskError(task.doc())).toBe('could not load https://nowhere.invalid/task.js: 404');
    await w.clock.advance(LAPSE_MS * 2);
    expect(runsOf(task)).toHaveLength(1);
  });
});

// What the pool promises

describe('the pool', () => {
  it('has at most one open run per task, always', async () => {
    const second = w.repo.create<Queue>({ title: 'second', jobs: {} });
    const task = w.ask('k');
    // the same task listed twice, in two queues it serves
    second.change((doc) => listTask(doc, 'other key', { taskUrl: task.url, askedAt: 0, package: null }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const docs: Docs = { find: (url) => w.repo.find(url) as any, flush: () => gate };
    const { executor } = w.pool('A', { repo: docs, slots: 3, queues: { [w.queue.url]: 'any', [second.url]: 'any' } });
    await settle();
    await w.clock.advance(BEAT_MS * 2); // looked at again while its start is being saved
    expect(runsOf(task)).toHaveLength(1);
    release();
    await settle();
    await w.clock.advance(LAPSE_MS * 2); // and while it runs, unheard by anyone else
    expect(runsOf(task)).toHaveLength(1);
    expect(executor.workers).toHaveLength(1);
  });

  it('completes every run it appends exactly once, on every path', async () => {
    // Each path ends a run, then everything that could come late comes late:
    // the worker's word, its exit, the kill timer. The record does not move,
    // and the worker is ended at most once.
    const paths: [string, (worker: FakeWorker, task: Handle<Task>) => void, string][] = [
      ['done', (worker) => worker.events.done(1), 'succeeded'],
      ['threw', (worker) => worker.events.threw('no'), 'failed'],
      ['exit', (worker) => worker.events.exit(), 'failed'],
      ['cancel', (_, task) => task.change((doc) => void (doc.cancelled = true)), 'cancelled'],
      [
        'yield',
        (_, task) => w.queue.change((doc) => void (doc.jobs[task.doc().key] = { taskUrl: 'automerge:x' as AutomergeUrl, askedAt: 0, package: null })),
        'yielded',
      ],
    ];
    for (const [name, end, status] of paths) {
      w = world();
      const task = w.ask(name);
      const { executor } = w.pool('A');
      await settle();
      const worker = executor.of(lastRun(task).id);
      end(worker, task);
      await settle();
      await w.clock.advance(GRACE_MS);
      const record = structuredClone(lastRun(task));
      expect(record.status, name).toBe(status);
      worker.events.done('late');
      worker.events.threw('late');
      worker.events.exit();
      await w.clock.advance(GRACE_MS * 2);
      expect(runsOf(task), name).toHaveLength(1);
      expect(lastRun(task), name).toEqual(record);
      expect(worker.terminations.length, name).toBeLessThanOrEqual(1);
    }
  });

  it('completes a run once when its end races a stop: what comes first decides', async () => {
    // done, then the cancel: the run had already succeeded
    const done = w.ask('done first');
    const one = w.pool('A');
    await settle();
    one.executor.of(lastRun(done).id).events.done('result');
    done.change((doc) => void (doc.cancelled = true));
    await settle();
    await w.clock.advance(GRACE_MS);
    expect(statuses(done)).toEqual(['succeeded']);
    expect(ending(done.doc())).toBe('succeeded');

    // the cancel, then done within the grace: the cancel decided it
    w = world();
    const cancel = w.ask('cancel first');
    const two = w.pool('A');
    await settle();
    const worker = two.executor.of(lastRun(cancel).id);
    cancel.change((doc) => void (doc.cancelled = true));
    await settle();
    worker.events.done('result');
    await settle();
    expect(statuses(cancel)).toEqual(['cancelled']);
    expect(lastRun(cancel).result).toBeNull();
  });

  it('drops a result that arrives after it decided to stop: the status is the reason', async () => {
    const task = w.ask('k');
    const { executor } = w.pool('A');
    await settle();
    const worker = executor.of(lastRun(task).id);
    task.change((doc) => void (doc.cancelled = true));
    await settle();
    await w.clock.advance(GRACE_MS / 2);
    worker.events.done({ big: 'result' });
    await settle();
    expect(lastRun(task)).toMatchObject({ status: 'cancelled', result: null });
    expect(taskResult(task.doc())).toBeUndefined();
  });

  it('ends a stopped worker within GRACE_MS on its clock, for every reason, unless it finished first', async () => {
    const reasons: [StopReason, (task: Handle<Task>, pool: Pool) => void][] = [
      ['cancelled', (task) => task.change((doc) => void (doc.cancelled = true))],
      ['yielded', (task) => w.queue.change((doc) => void (doc.jobs.k = { taskUrl: 'automerge:x' as AutomergeUrl, askedAt: 0, package: null }))],
      ['stopping', (_, pool) => void pool.stop()],
    ];
    for (const [reason, stop] of reasons) {
      for (const finishes of [false, true]) {
        w = world();
        const task = w.ask('k');
        const { executor, pool } = w.pool('A');
        await settle();
        const worker = executor.of(lastRun(task).id);
        stop(task, pool);
        await settle();
        const [{ at }] = worker.aborts;
        expect(worker.aborts.map((it) => it.reason)).toEqual([reason]);
        if (finishes) {
          await w.clock.advance(1_000);
          worker.events.done('stopped myself');
          await settle();
          expect(worker.terminations, `${reason}, finished`).toEqual([at + 1_000]);
        } else {
          await w.clock.advance(GRACE_MS);
          expect(worker.terminations, reason).toEqual([at + GRACE_MS]);
        }
        expect(lastRun(task).status).toBe(reason === 'stopping' ? 'lost' : reason);
      }
    }
  });

  it('never runs more than its slots; a freed slot takes the next waiting task in waitingWork order', async () => {
    // asked out of order: the keys are taken oldest ask first, then by key
    const tasks = Object.fromEntries(
      (
        [
          ['d', 4],
          ['a', 1],
          ['c', 3],
          ['b2', 2],
          ['b1', 2],
        ] as const
      ).map(([key, askedAt]) => [key, w.ask(key, { askedAt })]),
    );
    const { executor, pool } = w.pool('A', { slots: 2 });
    const order: string[] = [];
    const over = new Set<string>();
    const step = async () => {
      await settle();
      for (const worker of executor.workers) {
        if (worker.job && !order.includes(worker.job.key)) {
          order.push(worker.job.key);
        }
      }
      expect(executor.live(over)).toBeLessThanOrEqual(2);
      expect(pool.busy).toBeLessThanOrEqual(2);
    };
    await step();
    expect(order).toEqual(['a', 'b1']);
    for (const key of ['a', 'b1', 'b2', 'c', 'd']) {
      const run = lastRun(tasks[key]).id;
      over.add(run);
      executor.of(run).events.done(key);
      await step();
    }
    expect(order).toEqual(['a', 'b1', 'b2', 'c', 'd']);
    expect(executor.workers).toHaveLength(2);
  });

  it('checks the importUrl before taking, and leaves a task it does not accept with no run', async () => {
    const accepted = w.ask('accepted', { importUrl: codeIn(PKG), package: PKG });
    // listed as in the package, but its code is somewhere else
    const elsewhere = w.ask('elsewhere', { importUrl: codeIn(OTHER_PKG), package: PKG });
    const inline = w.ask('inline', { importUrl: CODE, package: null });
    const { executor } = w.pool('A', { slots: 3, queues: { [w.queue.url]: [PKG] satisfies Acceptance } });
    await settle();
    await w.clock.advance(LAPSE_MS);
    expect(runsOf(accepted)).toHaveLength(1);
    expect(runsOf(elsewhere)).toEqual([]);
    expect(runsOf(inline)).toEqual([]);
    expect(executor.workers.map((it) => it.job!.importUrl)).toEqual([codeIn(PKG)]);
    // a pool that accepts any code takes them
    w.pool('B', { slots: 3 });
    await settle();
    expect(runsOf(elsewhere).map((run) => run.pool)).toEqual(['B']);
    expect(runsOf(inline).map((run) => run.pool)).toEqual(['B']);
  });

  it('hands over the importUrl and input as read when it checked, not as they are once saved', async () => {
    const task = w.ask('k', { importUrl: codeIn(PKG), package: PKG });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const docs: Docs = { find: (url) => w.repo.find(url) as any, flush: () => gate };
    const { executor } = w.pool('A', { repo: docs, queues: { [w.queue.url]: [PKG] } });
    await settle();
    task.change((doc) => {
      doc.importUrl = codeIn(OTHER_PKG);
      doc.input = 'changed';
    });
    release();
    await settle();
    expect(executor.of(lastRun(task).id).job).toMatchObject({ importUrl: codeIn(PKG), input: { key: 'k' } });
  });

  it('starts nothing for a task whose flush has not returned', async () => {
    const task = w.ask('k');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const docs: Docs = { find: (url) => w.repo.find(url) as any, flush: () => gate };
    const { executor, pool } = w.pool('A', { repo: docs });
    await settle();
    await w.clock.advance(BEAT_MS * 3);
    expect(runsOf(task)).toHaveLength(1);
    expect(executor.workers).toHaveLength(0);
    expect(w.net.sent.filter((it) => it.message.type === 'task progress')).toEqual([]);
    expect(pool.busy).toBe(1);
    release();
    await settle();
    expect(executor.of(lastRun(task).id).jobs).toHaveLength(1);
  });

  it('records a stop that came due while the start was being saved, and starts nothing', async () => {
    const task = w.ask('k');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const docs: Docs = { find: (url) => w.repo.find(url) as any, flush: () => gate };
    const { executor } = w.pool('A', { repo: docs });
    await settle();
    task.change((doc) => void (doc.cancelled = true));
    release();
    await settle();
    expect(statuses(task)).toEqual(['cancelled']);
    expect(executor.workers).toHaveLength(0);
  });

  it('records lost, and starts nothing, when the start cannot be saved', async () => {
    // A pool that cannot save takes the task again at once and loses it
    // again: MAX_LOST bounds it, and the task fails, visibly.
    const task = w.ask('k');
    const docs: Docs = {
      find: (url) => w.repo.find(url) as any,
      flush: () => Promise.reject(new Error('disk full')),
    };
    const { executor } = w.pool('A', { repo: docs });
    await settle();
    await w.clock.advance(LAPSE_MS);
    expect(statuses(task)).toEqual(['lost', 'lost', 'lost']);
    expect(ending(task.doc())).toBe('failed');
    expect(executor.workers).toHaveLength(0);
  });

  it('tries a task it cannot find yet again a beat later, without an error', async () => {
    const task = w.ask('k');
    let misses = 1;
    const docs: Docs = {
      find: (url) => (url === task.url && misses-- > 0 ? Promise.reject(new Error('unavailable')) : (w.repo.find(url) as any)),
      flush: (ids) => w.repo.flush(ids),
    };
    const { executor } = w.pool('A', { repo: docs });
    await settle();
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(BEAT_MS);
    expect(runsOf(task)).toHaveLength(1);
    expect(executor.workers).toHaveLength(1);
  });

  it('stops a run whose task document is gone, and ends its worker; the record is not written anywhere', async () => {
    const task = w.ask('k');
    const { executor, pool } = w.pool('A');
    await settle();
    const worker = executor.of(lastRun(task).id);
    w.repo.delete(task.url);
    await settle();
    expect(worker.aborts.map((it) => it.reason)).toEqual(['cancelled']);
    await w.clock.advance(GRACE_MS);
    expect(worker.terminations).toHaveLength(1);
    expect(pool.busy).toBe(0);
  });

  it('carries a run on to its end when its queue document is gone', async () => {
    const task = w.ask('k');
    const { executor } = w.pool('A');
    await settle();
    const worker = executor.of(lastRun(task).id);
    w.repo.delete(w.queue.url);
    await settle();
    expect(worker.aborts).toEqual([]);
    worker.events.done('still wanted by whoever follows the task');
    await settle();
    expect(statuses(task)).toEqual(['succeeded']);
  });

  it('deletes an entry whose task has ended, without taking it', async () => {
    const task = w.ask('k', {
      runs: [{ id: 'r', pool: 'elsewhere', start: 0, end: 1, status: 'succeeded', result: 1, logs: [] }],
    });
    const { executor } = w.pool('A');
    await settle();
    expect(listed(w.queue, 'k')).toBeUndefined();
    expect(runsOf(task)).toHaveLength(1);
    expect(executor.workers).toHaveLength(0);
  });

  it('records lost only its own runs that it is not running', async () => {
    const task = w.ask('k', {
      runs: [
        { id: 'theirs', pool: 'B', start: 0 },
        { id: 'mine', pool: 'A', start: 1 },
      ],
    });
    w.pool('A');
    await settle();
    expect(statuses(task)).toEqual(['open', 'lost']);
    await w.clock.advance(LAPSE_MS);
    expect(statuses(task)).toEqual(['open', 'lost', 'open']);
    expect(lastRun(task).pool).toBe('A');
  });

  it('says each run is going on: at once, every BEAT_MS, with progress, and logs at most every 100 ms', async () => {
    const task = w.ask('k');
    const { executor } = w.pool('A');
    await settle();
    const run = lastRun(task).id;
    const said = () => w.net.sent.filter((it) => it.url === task.url).map((it) => it.message);
    expect(said()).toEqual([expect.objectContaining({ type: 'task progress', run })]);
    expect(said()[0]).not.toHaveProperty('progress');

    const worker = executor.of(run);
    worker.events.log('one');
    await w.clock.advance(50);
    worker.events.log('two');
    worker.events.progress({ step: 1, of: 3 });
    await w.clock.advance(49);
    expect(said()).toHaveLength(1);
    await w.clock.advance(1);
    expect(said()).toHaveLength(2);
    expect(said()[1]).toMatchObject({
      run,
      progress: { step: 1, of: 3 },
      logs: [{ message: 'one' }, { message: 'two' }],
    });

    // the worker says nothing more (its code is blocked): the pool still says it is going on
    await w.clock.advance(BEAT_MS * 3);
    const beats = said().slice(2);
    expect(beats.length).toBeGreaterThanOrEqual(3);
    for (const beat of beats) {
      expect(beat).toMatchObject({ type: 'task progress', run, progress: { step: 1, of: 3 } });
      expect(beat).not.toHaveProperty('logs');
    }
    // every message is stamped, in one series per channel
    expect(said().map((it) => it.seq)).toEqual(said().map((_, i) => i));
  });

  it('is heard by another pool: a run said to be going on is not taken from', async () => {
    const task = w.ask('k');
    w.pool('A');
    await settle();
    const b = w.pool('B');
    await w.clock.advance(LAPSE_MS * 3);
    expect(runsOf(task)).toHaveLength(1);
    expect(b.executor.workers).toHaveLength(0);
  });

  it('says it serves, on each queue it serves, every BEAT_MS', async () => {
    const task = w.ask('k');
    w.pool('A', { slots: 4 });
    await settle();
    await w.clock.advance(BEAT_MS * 2);
    const serving = w.net.sent.filter((it) => it.message.type === 'serving');
    expect(serving.length).toBe(3);
    for (const { url, message } of serving) {
      expect(url).toBe(w.queue.url);
      expect(message).toMatchObject({ pool: 'A', name: 'pool A', slots: 4 });
    }
    // said first as the queue is found, before it has taken anything
    expect(serving.map((it) => it.message.busy)).toEqual([0, 1, 1]);
    expect(runsOf(task)).toHaveLength(1);
  });

  it('writes nothing but runs and their ends into a task, and nothing but deletions into a queue', async () => {
    const task = w.ask('k');
    const queueBefore = structuredClone(w.queue.doc());
    w.pool('A');
    await settle();
    const { runs, ...rest } = task.doc();
    expect(rest).toEqual({ importUrl: CODE, input: { key: 'k' }, key: 'k' });
    expect(Object.keys(runs[0]).sort()).toEqual(['id', 'pool', 'start']);
    expect(w.queue.doc()).toEqual(queueBefore);
  });
});

// What a document, a worker or a listener that misbehaves can do to a pool:
// each spoils only its own part, and never leaves a run open or a slot busy
// for ever.

/** A fake executor whose workers throw from the named method. */
class ThrowingExecutor extends FakeExecutor {
  constructor(
    clock: Clock,
    private readonly method: 'run' | 'abort' | 'terminate',
  ) {
    super(clock);
  }
  start(events: WorkerEvents) {
    const worker = super.start(events);
    const original = worker[this.method].bind(worker) as (arg?: any) => void;
    worker[this.method] = (arg?: any) => {
      original(arg);
      throw new Error(`${this.method} broke`);
    };
    return worker;
  }
}

describe('the pool, when something it uses throws', () => {
  it('leaves no timer set once stop() resolves, whatever its runs were doing', async () => {
    // One run with a log line waiting to be said, one being cancelled (its
    // kill is set), one that ignores the stop, and one whose start is still
    // being saved when the pool stops.
    const talking = w.ask('talking');
    const cancelling = w.ask('cancelling');
    const ignoring = w.ask('ignoring');
    const { pool, executor } = w.pool('A', { slots: 3 });
    await settle();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const saving = w.ask('saving');
    const docs: Docs = {
      find: (url) => w.repo.find(url) as any,
      flush: (ids) => (ids?.includes(saving.documentId) && runsOf(saving).length > 0 && !runsOf(saving)[0].status ? gate : w.repo.flush(ids)),
    };
    const second = w.pool('B', { slots: 1, repo: docs });
    await settle();
    expect(statuses(saving)).toEqual(['open']);

    cancelling.change((doc) => void (doc.cancelled = true));
    await settle();
    let stopped = 0;
    void pool.stop().then(() => stopped++);
    void second.pool.stop().then(() => stopped++);
    // its code logs a line, and returns before that line is said
    const talker = executor.of(lastRun(talking).id);
    talker.events.log('a line not said yet');
    talker.events.done('returned anyway');
    await settle();
    release();
    await w.clock.advance(GRACE_MS);
    expect(stopped).toBe(2);
    expect(w.clock.pending).toBe(0);
    expect(statuses(talking)).toEqual(['lost']);
    expect(statuses(cancelling)).toEqual(['cancelled']);
    expect(statuses(ignoring)).toEqual(['lost']);
    expect(statuses(saving)).toEqual(['lost']);
    const sent = w.net.sent.length;
    await w.clock.advance(BEAT_MS * 5);
    expect(w.net.sent.length).toBe(sent);
  });

  it('a task document without runs (anyone can write one) does not keep it from taking the next task', async () => {
    const broken = w.repo.create<any>({ importUrl: CODE, input: null, key: 'broken' });
    w.queue.change((doc) => listTask(doc, 'broken', { taskUrl: broken.url, askedAt: 0, package: null }));
    const good = w.ask('good');
    const { pool } = w.pool('A');
    await settle();
    expect(statuses(good)).toEqual(['open']);
    expect(pool.busy).toBe(1);
  });

  it('a claim whose change throws is not counted against the slots', async () => {
    const stuck = w.ask('stuck');
    const good = w.ask('good');
    const docs: Docs = {
      find: async (url) => {
        const handle = await w.repo.find<any>(url);
        if (url !== stuck.url) {
          return handle as any;
        }
        return {
          url: handle.url,
          documentId: handle.documentId,
          doc: () => handle.doc(),
          change: () => {
            throw new Error('this handle is read only');
          },
          on: (event: any, fn: any) => handle.on(event, fn),
          off: (event: any, fn: any) => handle.off(event, fn),
          isDeleted: () => handle.isDeleted(),
        };
      },
      flush: (ids) => w.repo.flush(ids),
    };
    const { pool } = w.pool('A', { repo: docs });
    await settle();
    expect(runsOf(stuck)).toEqual([]);
    expect(statuses(good)).toEqual(['open']);
    expect(pool.busy).toBe(1);
  });

  it('a worker whose run() throws fails the run once, is ended, and frees its slot', async () => {
    const task = w.ask('k');
    const executor = new ThrowingExecutor(w.clock, 'run');
    const { pool } = w.pool('A', { executor });
    await settle();
    expect(statuses(task)).toEqual(['failed']);
    expect(taskError(task.doc())).toMatch(/run broke/);
    expect(executor.workers[0].terminations).toHaveLength(1);
    expect(pool.busy).toBe(0);
    const said = w.net.sent.length;
    await w.clock.advance(BEAT_MS * 3);
    expect(w.net.sent.slice(said).filter((it) => it.message.type === 'task progress')).toEqual([]);
  });

  it('a worker whose abort() throws is still ended GRACE_MS later, and its run recorded', async () => {
    const task = w.ask('k');
    const executor = new ThrowingExecutor(w.clock, 'abort');
    const { pool } = w.pool('A', { executor });
    await settle();
    const at = w.clock.now();
    task.change((doc) => void (doc.cancelled = true));
    await settle();
    await w.clock.advance(GRACE_MS);
    expect(executor.workers[0].terminations).toEqual([at + GRACE_MS]);
    expect(statuses(task)).toEqual(['cancelled']);
    expect(pool.busy).toBe(0);
  });

  it('a worker whose terminate() throws still has its run recorded and its slot freed', async () => {
    const task = w.ask('k');
    const executor = new ThrowingExecutor(w.clock, 'terminate');
    const { pool } = w.pool('A', { executor });
    await settle();
    task.change((doc) => void (doc.cancelled = true));
    await settle();
    await w.clock.advance(GRACE_MS);
    expect(statuses(task)).toEqual(['cancelled']);
    expect(pool.busy).toBe(0);
    // and it is not used again
    w.ask('next');
    await settle();
    expect(executor.workers).toHaveLength(2);
    expect(executor.workers[0].jobs).toHaveLength(1);
  });

  it('a send that throws (a listener that throws) keeps no run from starting, beating or ending', async () => {
    const task = w.ask('k');
    const ears = w.net.ears();
    const throwing: Ears = {
      listen: ears.listen,
      send: (handle, message) => {
        ears.send(handle, message);
        throw new Error('a listener threw');
      },
    };
    const { executor, pool } = w.pool('A', { ears: throwing });
    await settle();
    const worker = executor.of(lastRun(task).id);
    expect(worker.jobs).toHaveLength(1);
    const beats = () => w.net.sent.filter((it) => it.message.type === 'task progress').length;
    const before = beats();
    await w.clock.advance(BEAT_MS);
    expect(beats()).toBe(before + 1);
    worker.events.done(1);
    await settle();
    expect(statuses(task)).toEqual(['succeeded']);
    expect(pool.busy).toBe(0);
  });

  it('takes nothing more from a queue whose document is gone', async () => {
    const first = w.ask('first');
    const second = w.ask('second');
    const { executor } = w.pool('A');
    await settle();
    w.repo.delete(w.queue.url);
    await settle();
    executor.of(lastRun(first).id).events.done(1);
    await settle();
    await w.clock.advance(BEAT_MS);
    expect(statuses(first)).toEqual(['succeeded']);
    expect(runsOf(second)).toEqual([]);
  });
});
