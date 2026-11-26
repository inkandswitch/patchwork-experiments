// @vitest-environment node
//
// A pool on real automerge-repo documents, with a fake executor whose workers
// say what the test tells them to, a clock moved by hand, and ears that carry
// messages between the pools in this process. Each of the design's finite
// cases, (a) to (k), is a test named by its letter; each of the pool's own
// promises is a test named by what it promises.

import * as A from '@automerge/automerge';
import { initSubduction, Repo, type AutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import type { Repo as NodeRepo } from '@automerge/automerge-repo-node';
import type { Repo as SiteRepo } from 'site-automerge-repo';
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
  type Query,
  type RunWorker,
  type StopReason,
  type WorkerEvents,
} from './pool';
import {
  BEAT_MS,
  GRACE_MS,
  Hearing,
  HOLD_MS,
  LAPSE_MS,
  LISTEN_MS,
  LOST_TOO_OFTEN,
  allHeard,
  claimRun,
  endRun,
  ending,
  gone,
  listTask,
  preferred,
  ranked,
  stopTask,
  taskError,
  taskResult,
  taskState,
  type Queue,
  type Run,
  type Task,
  type TaskState,
} from './task-rules.js';

await initSubduction();

// The harness

/** The longest `settle` waits before it fails the test. */
const SETTLE_LIMIT_MS = 3_000;

/**
 * A Repo that counts its finds and flushes while they are under way. Besides
 * the clock, they are all a pool waits on. Each ends when the Repo's own
 * storage work does, which has real timers in it, so no number of turns of
 * the event loop is sure to be enough: `settle` waits for the count instead.
 */
function countingWork(repo: Repo) {
  const counter = { underWay: 0 };
  const find = repo.find.bind(repo);
  const flush = repo.flush.bind(repo);
  const count = <T>(promise: Promise<T>) => {
    counter.underWay++;
    return promise.finally(() => counter.underWay--);
  };
  repo.find = ((...args: Parameters<Repo['find']>) => count(find(...args))) as Repo['find'];
  repo.flush = ((...args: Parameters<Repo['flush']>) => count(flush(...args))) as Repo['flush'];
  return counter;
}

/**
 * Waits until none of the world's Repo's finds and flushes is under way, a
 * whole turn after the last one ended: the pool's answer to it, and whatever
 * that answer started, has then run. Everything a pool does without the clock
 * moving is then done, so what a test sees after it is all there is to see.
 * A find or flush a test's own Docs holds back is not the Repo's and is not
 * waited for.
 */
async function settle() {
  const giveUpAt = Date.now() + SETTLE_LIMIT_MS;
  do {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (Date.now() > giveUpAt) {
      throw new Error(`settle: ${w.repoWork.underWay} finds or flushes still under way after ${SETTLE_LIMIT_MS} ms`);
    }
  } while (w.repoWork.underWay > 0);
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
  /** Ears that can be made deaf (they hear nothing) or mute (what is sent through them goes nowhere and is not kept). */
  ears(): Ears & { deaf: boolean; mute: boolean } {
    const mine = new Set<(message: any) => void>();
    const ears = {
      deaf: false,
      mute: false,
      send: (handle: { url: string }, message: any) => {
        if (ears.mute) {
          return;
        }
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
    const message = { type: 'task progress', run, from: 'elsewhere', seq: this.sent.length };
    this.ears().send({ url } as any, message);
  }
}

/** Ears that hear nothing a pool says of serving a queue: a pool with these hears no other pool, and is always preferred. */
function deafToServing(ears: Ears): Ears {
  return {
    send: ears.send,
    listen: (handle, onMessage) => ears.listen(handle, (message) => message?.type !== 'serving' && onMessage(message)),
  };
}

class FakeWorker implements RunWorker {
  jobs: Job[] = [];
  aborts: { reason: StopReason; at: number }[] = [];
  settles: { run: string; at: number }[] = [];
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
  settle(run: string) {
    this.settles.push({ run, at: this.clock.now() });
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
  const repoWork = countingWork(repo);
  const queue = repo.create<Queue>({ title: 'q', jobs: {} });
  let asked = 0;
  type AskMore = { importUrl?: string; package?: string | null; askedAt?: number; runs?: Run[]; queue?: Handle<Queue> };
  /** A task made and not yet listed. */
  const make = (key: string, more: AskMore = {}) =>
    repo.create<Task>({ importUrl: more.importUrl ?? CODE, input: { key }, key, runs: more.runs ?? [] });
  /** Lists a task made by `make` under its key. */
  const list = (task: Handle<Task>, more: AskMore = {}) =>
    (more.queue ?? queue).change((doc) =>
      listTask(doc, task.doc()!.key, { taskUrl: task.url, askedAt: more.askedAt ?? ++asked, package: more.package ?? null }),
    );
  const ask = (key: string, more: AskMore = {}) => {
    const task = make(key, more);
    list(task, more);
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
      has: [],
      executor,
      queues: { [queue.url]: 'any' },
      ears,
      clock,
      ...more,
    });
    return { pool: it, executor, ears };
  };
  /**
   * A pool that has listened to the queue for LISTEN_MS. Hearing no other
   * pool, it takes at once whatever is listed from then on; what was listed
   * before, it took HOLD_MS after first seeing it, on the way.
   */
  const started = async (id: string, more: Partial<PoolOptions> = {}) => {
    const it = pool(id, more);
    await settle();
    await clock.advance(LISTEN_MS);
    return it;
  };
  /** Pools started at one moment, each of which has listened to the queue for LISTEN_MS, and so heard every other. */
  const startedAll = async (...specs: [string, Partial<PoolOptions>?][]) => {
    const them = specs.map(([id, more]) => pool(id, more));
    await settle();
    await clock.advance(LISTEN_MS);
    return them;
  };
  return { clock, net, repo, repoWork, queue, make, list, ask, pool, started, startedAll };
}

const runsOf = (task: Handle<Task>) => task.doc()!.runs;
const statuses = (task: Handle<Task>) => runsOf(task).map((run) => run.status ?? 'open');
const lastRun = (task: Handle<Task>) => runsOf(task).at(-1)!;
const listed = (queue: Handle<Queue>, key: string) => queue.doc()!.jobs[key]?.taskUrl;
const runById = (task: Handle<Task>, id: string) => runsOf(task).find((run) => run.id === id)!;

/** A reader of a task with ears of its own, as a watcher has: which of its runs it counts as heard now. */
function readerOf(task: Handle<Task>) {
  const reader = new Hearing(w.clock);
  w.net.ears().listen(task, (message) => message?.type === 'task progress' && reader.heardFrom(message.run));
  return (runId: string) => {
    reader.saw(task.doc()?.runs);
    return reader.heard(runId);
  };
}

/** Stops a task as an asker does: a record that says `cancelled`, appended to its list. */
const stop = (task: Handle<Task>, id = 'stop') => task.change((doc) => void stopTask(doc, { id, at: w.clock.now() }));
/** The record a stop appends, as `stop` writes it at `at`. */
const stopRecord = (at: number, id = 'stop') => ({ id, start: at, end: at, status: 'cancelled' });

let w: ReturnType<typeof world>;
beforeEach(() => {
  w = world();
});

// The design's cases

describe('the design cases', () => {
  it('(a) one pool: takes the task, runs it, ends it, deletes the entry', async () => {
    const { pool, executor } = await w.started('A');
    const task = w.ask('k');
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
        has: [],
        executor,
        queues: { [queueA.url]: 'any' },
        // not knowing of each other, neither holds back for the other
        ears: deafToServing(net.ears()),
        clock,
      });
      return { pool, executor };
    };
    const a = start('A', repoA);
    const b = start('B', repoB);
    await settle();
    // each takes nothing until it has listened for LISTEN_MS, and then, ranking only itself, takes it
    await clock.advance(LISTEN_MS);
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

  // The README's Offline and partition, "a run finished while cut off": once
  // healed, its record and what it wrote arrive, and one ending stands. Which
  // run is first in the merged list is Automerge's to say; giving one side's
  // copy an extra change before it takes moves its insert in op order, and
  // the test sees both orders between the two cases.
  const firstPools = new Set<string>();
  for (const ahead of ['A', 'B'] as const) {
    it(`a run finished while its pool was cut off, another pool having taken the task meanwhile: healed, its record and what it wrote arrive, and one ending stands (${ahead}'s copy one change ahead)`, async () => {
      const clock = new ManualClock();
      const net = new Loopback();
      const repoA = new Repo({ network: [] } as any);
      const repoB = new Repo({ network: [] } as any);
      const queueA = repoA.create<Queue>({ title: 'q', jobs: {} });
      const taskA = repoA.create<Task>({ importUrl: CODE, input: null, key: 'k', runs: [] });
      queueA.change((doc) => listTask(doc, 'k', { taskUrl: taskA.url, askedAt: 1, package: null }));
      const queueB = repoB.import<Queue>(A.save(queueA.doc()), { docId: queueA.documentId } as any);
      const taskB = repoB.import<Task>(A.save(taskA.doc()), { docId: taskA.documentId } as any);
      (ahead === 'A' ? taskA : taskB).change((doc) => void (doc.title = 'one change ahead'));
      const heal = () => {
        for (const [a, b] of [
          [taskA, taskB],
          [queueA, queueB],
        ] as const) {
          a.merge(b as any);
          b.merge(a as any);
        }
      };
      // B is cut off: it hears nothing, and nothing it says is heard
      const earsB = net.ears();
      earsB.deaf = earsB.mute = true;
      const start = (id: string, repo: Repo, ears: Ears) => {
        const executor = new FakeExecutor(clock);
        const pool = new Pool({ repo: repo as Docs, id, name: id, slots: 1, has: [], executor, queues: { [queueA.url]: 'any' }, ears: deafToServing(ears), clock });
        return { pool, executor };
      };
      const a = start('A', repoA, net.ears());
      const b = start('B', repoB, earsB);
      await settle();
      await clock.advance(LISTEN_MS);
      const [runA] = runsOf(taskA);
      const [runB] = runsOf(taskB);
      expect([runA.pool, runB.pool]).toEqual(['A', 'B']);

      // B's code writes a document of its own, naming its run, and returns its url; B's pool records it
      const out = repoB.create<{ run: string; text: string }>({ run: runB.id, text: 'written while cut off' });
      b.executor.of(runB.id).events.done({ out: out.url });
      await settle();
      expect(statuses(taskB)).toEqual(['succeeded']);
      expect(queueB.doc().jobs.k).toBeUndefined();
      expect(a.executor.of(runA.id).aborts).toEqual([]);

      // healed: the documents meet, as the sync server would bring them, and B is heard again
      earsB.deaf = earsB.mute = false;
      heal();
      const outHere = repoA.import<{ run: string; text: string }>(A.save(out.doc()), { docId: out.documentId } as any);
      await settle();
      expect(runsOf(taskA).map((run) => run.id)).toEqual(runsOf(taskB).map((run) => run.id));
      expect(runById(taskA, runB.id)).toMatchObject({ status: 'succeeded', result: { out: out.url } });
      expect(outHere.doc()).toEqual({ run: runB.id, text: 'written while cut off' });

      // whichever run is first in the list, B's success ends the task: A's run, still going, gives way
      // (its code is told so; what it wrote meanwhile is the task code's to guard), and B's ending stands
      firstPools.add(runsOf(taskA)[0].pool ?? 'none');
      expect(a.executor.of(runA.id).aborts.map((it) => it.reason)).toEqual(['yielded']);
      await clock.advance(GRACE_MS);
      expect(a.executor.of(runA.id).terminations).toEqual([clock.now()]);
      heal();
      await settle();
      const order = runsOf(taskA)[0].pool === 'B' ? ['succeeded', 'yielded'] : ['yielded', 'succeeded'];
      for (const task of [taskA, taskB]) {
        expect(statuses(task)).toEqual(order);
        expect(taskResult(task.doc())).toEqual({ out: out.url });
      }
      expect(queueA.doc().jobs.k).toBeUndefined();
    });
  }

  it('a run finished while cut off: both orders of the merged runs were seen', () => {
    expect([...firstPools].sort()).toEqual(['A', 'B']);
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

  it('(d) a holder that restarts records its run lost at once, and takes the task again LISTEN_MS later: it has only begun to listen, and takes nothing until then', async () => {
    await w.started('A');
    const task = w.ask('k');
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
      has: [],
      executor,
      queues: { [savedQueue.url]: 'any' },
      ears: w.net.ears(),
      clock: w.clock,
    });
    await settle();
    expect(statuses(savedTask)).toEqual(['lost']);
    await w.clock.advance(LISTEN_MS - 1);
    expect(statuses(savedTask)).toEqual(['lost']);
    await w.clock.advance(1);

    expect(statuses(savedTask)).toEqual(['lost', 'open']);
    expect(runsOf(savedTask)[0].id).toBe(before);
    expect(lastRun(savedTask).pool).toBe('A');
    expect(executor.of(lastRun(savedTask).id).jobs).toHaveLength(1);
  });

  it('(d) the third lost run is recorded failed by its own pool, with LOST_TOO_OFTEN as its last line, and nothing takes the task again', async () => {
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
    expect(statuses(task)).toEqual(['lost', 'lost', 'failed']);
    expect(runsOf(task)[2].logs!.map((line) => line.message)).toEqual([LOST_TOO_OFTEN]);
    expect(ending(task.doc(), allHeard)).toBe('failed');
    expect(taskError(task.doc(), allHeard)).toBe(LOST_TOO_OFTEN);
    expect(executor.workers).toHaveLength(0);
    expect(listed(w.queue, 'k')).toBeUndefined();
  });

  it('(f) cancel before a run: the stop is the only record, nothing is started, and the entry goes', async () => {
    const task = w.ask('k');
    const at = w.clock.now();
    stop(task);
    const { executor } = w.pool('A');
    await settle();
    expect(runsOf(task)).toEqual([stopRecord(at)]);
    expect(task.doc()).not.toHaveProperty('cancelled');
    expect(executor.workers).toHaveLength(0);
    expect(listed(w.queue, 'k')).toBeUndefined();
  });

  it('(f) cancel during a run: aborted at once, killed GRACE_MS later, recorded cancelled', async () => {
    const task = w.ask('k');
    const { executor, pool } = await w.started('A');
    await settle();
    const run = lastRun(task).id;
    const worker = executor.of(run);
    const cancelledAt = w.clock.now();
    stop(task);
    await settle();
    expect(worker.aborts).toEqual([{ reason: 'cancelled', at: cancelledAt }]);
    // the entry goes as soon as the stop is read, while the run is still stopping
    expect(listed(w.queue, 'k')).toBeUndefined();
    await w.clock.advance(GRACE_MS - 1);
    expect(worker.terminations).toEqual([]);
    expect(statuses(task)).toEqual(['open', 'cancelled']);
    await w.clock.advance(1);
    expect(worker.terminations).toEqual([cancelledAt + GRACE_MS]);
    expect(statuses(task)).toEqual(['cancelled', 'cancelled']);
    expect(runById(task, run).status).toBe('cancelled');
    expect(pool.busy).toBe(0);

    // a worker that was stopped is never used again
    w.ask('k2');
    await settle();
    expect(executor.workers).toHaveLength(2);
    expect(worker.jobs).toHaveLength(1);
  });

  it('(f) cancel obeyed: code that stops is recorded cancelled, not failed, and its worker is ended', async () => {
    const task = w.ask('k');
    const { executor } = await w.started('A');
    await settle();
    const run = lastRun(task).id;
    const worker = executor.of(run);
    stop(task);
    await settle();
    worker.events.threw('AbortError: cancelled');
    await settle();
    expect(runById(task, run).status).toBe('cancelled');
    expect(worker.terminations).toEqual([w.clock.now()]);
    await w.clock.advance(GRACE_MS);
    expect(worker.terminations).toHaveLength(1);
  });

  it('(g) the same key asked twice: the task that lost its key yields, and the survivor runs', async () => {
    const first = w.ask('k');
    const { executor } = await w.started('A');
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
    expect(ending(first.doc(), allHeard)).toBeNull();
    // the freed slot takes the survivor
    expect(runsOf(second)).toHaveLength(1);
    executor.of(lastRun(second).id).events.done('done');
    await settle();
    expect(statuses(second)).toEqual(['succeeded']);
    expect(listed(w.queue, 'k')).toBeUndefined();
  });

  it('(h) a throw fails the task once, with the message as its last log line', async () => {
    const task = w.ask('k');
    const { executor } = await w.started('A');
    await settle();
    const worker = executor.of(lastRun(task).id);
    worker.events.log('starting');
    worker.events.threw('Error: boom');
    await settle();
    expect(statuses(task)).toEqual(['failed']);
    expect(lastRun(task).logs!.map((line) => line.message)).toEqual(['starting', 'Error: boom']);
    expect(taskError(task.doc(), allHeard)).toBe('Error: boom');
    expect(listed(w.queue, 'k')).toBeUndefined();
    await w.clock.advance(LAPSE_MS * 2);
    expect(runsOf(task)).toHaveLength(1);
    // its code ended by itself, so its worker is kept
    expect(worker.terminations).toEqual([]);
  });

  it('(h) a worker that dies under its run loses the run, is not used again, and the task is taken again; its third loss ends it failed with LOST_TOO_OFTEN', async () => {
    const task = w.ask('k');
    const { executor, pool } = await w.started('A');
    await settle();
    for (let death = 1; death <= 3; death++) {
      const worker = executor.of(lastRun(task).id);
      expect(worker.jobs, `death ${death}`).toHaveLength(1);
      worker.events.exit();
      await settle();
      expect(executor.workers, `death ${death}`).toHaveLength(death === 3 ? 3 : death + 1);
    }
    expect(statuses(task)).toEqual(['lost', 'lost', 'failed']);
    for (const run of runsOf(task)) {
      expect(run.logs!.map((line) => line.message)[0]).toBe('its worker died');
    }
    expect(taskError(task.doc(), allHeard)).toBe(LOST_TOO_OFTEN);
    expect(listed(w.queue, 'k')).toBeUndefined();
    expect(pool.busy).toBe(0);
    await w.clock.advance(LAPSE_MS * 2);
    expect(runsOf(task)).toHaveLength(3);
    // a dead worker is never handed another job
    w.ask('k2');
    await settle();
    expect(executor.workers).toHaveLength(4);
    expect(executor.workers.slice(0, 3).every((worker) => worker.jobs.length === 1)).toBe(true);
  });

  it('(h) a worker that cannot be started loses the run; the third loss ends the task failed with LOST_TOO_OFTEN', async () => {
    let tries = 0;
    const executor: Executor = {
      start: () => {
        tries++;
        throw new Error('no threads left');
      },
    };
    const { pool } = await w.started('A', { executor });
    const task = w.ask('k');
    await settle();
    expect(tries).toBe(3);
    expect(statuses(task)).toEqual(['lost', 'lost', 'failed']);
    expect(runsOf(task)[0].logs!.map((line) => line.message)).toEqual(['a worker could not be started: no threads left']);
    expect(runsOf(task)[2].logs!.map((line) => line.message)).toEqual([
      'a worker could not be started: no threads left',
      LOST_TOO_OFTEN,
    ]);
    expect(ending(task.doc(), allHeard)).toBe('failed');
    expect(listed(w.queue, 'k')).toBeUndefined();
    expect(pool.busy).toBe(0);
  });

  it('(i) a graceful stop: every run is aborted, ended, recorded lost; another pool takes them again', async () => {
    const obeys = w.ask('obeys');
    const ignores = w.ask('ignores');
    const { pool, executor } = await w.started('A', { slots: 2 });
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
    const other = await w.started('B', { slots: 3 });
    await settle();
    expect(executor.workers).toHaveLength(2);
    expect(other.executor.workers).toHaveLength(3);
    expect(statuses(obeys)).toEqual(['lost', 'open']);
    expect(statuses(ignores)).toEqual(['lost', 'open']);
  });

  it('(j) code that will not load fails once, visibly', async () => {
    const task = w.ask('k', { importUrl: 'https://nowhere.invalid/task.js' });
    const { executor } = await w.started('A');
    await settle();
    executor.of(lastRun(task).id).events.threw('could not load https://nowhere.invalid/task.js: 404');
    await settle();
    expect(statuses(task)).toEqual(['failed']);
    expect(taskError(task.doc(), allHeard)).toBe('could not load https://nowhere.invalid/task.js: 404');
    await w.clock.advance(LAPSE_MS * 2);
    expect(runsOf(task)).toHaveLength(1);
  });

  it('(k) a copy of a task another pool is running, listed under its own key, is taken after the lapse while the original keeps beating, by a pool that follows both', async () => {
    // The copy carries the original's open run, with the same name.
    const original = w.ask('original', { runs: [{ id: 'r', pool: 'X', start: 0 }] });
    const copied = w.ask('copy', { runs: [{ id: 'r', pool: 'X', start: 0 }] });
    const { pool, executor } = w.pool('B');
    await settle();
    const firstSeen = w.clock.now();
    while (w.clock.now() < firstSeen + LAPSE_MS - BEAT_MS) {
      w.net.beat(original.url, 'r');
      await w.clock.advance(BEAT_MS);
      expect(runsOf(copied), `at ${w.clock.now() - firstSeen}`).toHaveLength(1);
    }
    w.net.beat(original.url, 'r');
    await w.clock.advance(BEAT_MS);
    expect(w.clock.now()).toBe(firstSeen + LAPSE_MS);
    // the original's word was heard for the original only
    expect(pool.heardOf(original.url)('r')).toBe(true);
    expect(pool.heardOf(copied.url)('r')).toBe(false);
    expect(runsOf(original)).toHaveLength(1);
    expect(runsOf(copied).map((run) => run.pool)).toEqual(['X', 'B']);
    expect(executor.of(lastRun(copied).id).job?.taskUrl).toBe(copied.url);
    // and the copy's run carries on while the original keeps beating
    for (let i = 0; i < 3; i++) {
      w.net.beat(original.url, 'r');
      await w.clock.advance(BEAT_MS);
    }
    expect(executor.of(lastRun(copied).id).aborts).toEqual([]);
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
      ['exit', (worker) => worker.events.exit(), 'lost'],
      ['cancel', (_, task) => stop(task), 'cancelled'],
      [
        'yield',
        (_, task) => w.queue.change((doc) => void (doc.jobs[task.doc().key] = { taskUrl: 'automerge:x' as AutomergeUrl, askedAt: 0, package: null })),
        'yielded',
      ],
    ];
    for (const [name, end, status] of paths) {
      w = world();
      const task = w.ask(name);
      const { executor } = await w.started('A');
      await settle();
      const run = lastRun(task).id;
      const worker = executor.of(run);
      end(worker, task);
      await settle();
      await w.clock.advance(GRACE_MS);
      const record = structuredClone(runById(task, run));
      expect(record.status, name).toBe(status);
      const after = runsOf(task).length;
      worker.events.done('late');
      worker.events.threw('late');
      worker.events.exit();
      await w.clock.advance(GRACE_MS * 2);
      // a lost run's task is taken again, by a new run; nothing else is appended
      expect(runsOf(task), name).toHaveLength(after);
      expect(runsOf(task).filter((it) => it.id === run), name).toHaveLength(1);
      expect(runById(task, run), name).toEqual(record);
      expect(worker.terminations.length, name).toBeLessThanOrEqual(1);
    }
  });

  it('completes a run once when its end races a stop: what comes first decides', async () => {
    // done, then the cancel: the run had already succeeded
    const done = w.ask('done first');
    const one = await w.started('A');
    await settle();
    one.executor.of(lastRun(done).id).events.done('result');
    // the stop is not written over a task some record has ended
    let stopped: boolean | undefined;
    done.change((doc) => void (stopped = stopTask(doc, { id: 'stop', at: w.clock.now() })));
    expect(stopped).toBe(false);
    await settle();
    await w.clock.advance(GRACE_MS);
    expect(statuses(done)).toEqual(['succeeded']);
    expect(ending(done.doc(), allHeard)).toBe('succeeded');

    // the cancel, then done within the grace: the cancel decided it
    w = world();
    const cancel = w.ask('cancel first');
    const two = await w.started('A');
    await settle();
    const run = lastRun(cancel).id;
    const worker = two.executor.of(run);
    stop(cancel);
    await settle();
    worker.events.done('result');
    await settle();
    expect(statuses(cancel)).toEqual(['cancelled', 'cancelled']);
    expect(runById(cancel, run).result).toBeNull();
  });

  it('drops a result that arrives after it decided to stop: the status is the reason', async () => {
    const task = w.ask('k');
    const { executor } = await w.started('A');
    await settle();
    const run = lastRun(task).id;
    const worker = executor.of(run);
    stop(task);
    await settle();
    await w.clock.advance(GRACE_MS / 2);
    worker.events.done({ big: 'result' });
    await settle();
    expect(runById(task, run)).toMatchObject({ status: 'cancelled', result: null });
    expect(taskResult(task.doc())).toBeUndefined();
  });

  it('ends a stopped worker within GRACE_MS on its clock, for every reason, unless it finished first', async () => {
    const reasons: [StopReason, (task: Handle<Task>, pool: Pool) => void][] = [
      ['cancelled', (task) => stop(task)],
      ['yielded', (task) => w.queue.change((doc) => void (doc.jobs.k = { taskUrl: 'automerge:x' as AutomergeUrl, askedAt: 0, package: null }))],
      ['stopping', (_, pool) => void pool.stop()],
    ];
    for (const [reason, stop] of reasons) {
      for (const finishes of [false, true]) {
        w = world();
        const task = w.ask('k');
        const { executor, pool } = await w.started('A');
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
        expect(runsOf(task)[0].status).toBe(reason === 'stopping' ? 'lost' : reason);
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
    const { executor, pool } = await w.started('A', { slots: 2 });
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
    // a pool that accepts any code takes them, once it has listened to the queue
    w.pool('B', { slots: 3 });
    await settle();
    await w.clock.advance(LISTEN_MS);
    expect(runsOf(elsewhere).map((run) => run.pool)).toEqual(['B']);
    expect(runsOf(inline).map((run) => run.pool)).toEqual(['B']);
  });

  it('hands over the importUrl and input as read when it checked, not as they are once saved', async () => {
    const task = w.ask('k', { importUrl: codeIn(PKG), package: PKG });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const docs: Docs = { find: (url) => w.repo.find(url) as any, flush: () => gate };
    const { executor } = await w.started('A', { repo: docs, queues: { [w.queue.url]: [PKG] } });
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
    const { executor } = await w.started('A', { repo: docs });
    await settle();
    stop(task);
    release();
    await settle();
    expect(statuses(task)).toEqual(['cancelled', 'cancelled']);
    expect(executor.workers).toHaveLength(0);
  });

  it('records lost, and starts nothing, when the start cannot be saved; the third time, failed with LOST_TOO_OFTEN', async () => {
    // A pool that cannot save takes the task again at once and loses it
    // again: the third loss is recorded as the task's failure, visibly.
    const task = w.ask('k');
    const docs: Docs = {
      find: (url) => w.repo.find(url) as any,
      flush: () => Promise.reject(new Error('disk full')),
    };
    const { executor, pool } = w.pool('A', { repo: docs });
    await settle();
    await w.clock.advance(LAPSE_MS);
    expect(statuses(task)).toEqual(['lost', 'lost', 'failed']);
    expect(taskError(task.doc(), allHeard)).toBe(LOST_TOO_OFTEN);
    expect(executor.workers).toHaveLength(0);
    expect(pool.busy).toBe(0);
  });

  it('tries a task it cannot find yet again a beat later, without an error', async () => {
    const task = w.make('k');
    let misses = 1;
    const docs: Docs = {
      find: (url) => (url === task.url && misses-- > 0 ? Promise.reject(new Error('unavailable')) : (w.repo.find(url) as any)),
      flush: (ids) => w.repo.flush(ids),
    };
    const { executor } = await w.started('A', { repo: docs });
    // listed as a beat comes, so that the next beat is one beat after the refusal
    await w.clock.advance(2 * BEAT_MS - LISTEN_MS);
    w.list(task);
    await settle();
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(BEAT_MS);
    expect(runsOf(task)).toHaveLength(1);
    expect(executor.workers).toHaveLength(1);
  });

  it('stops a run whose task document is gone, and ends its worker; the record is not written anywhere', async () => {
    const task = w.ask('k');
    const { executor, pool } = await w.started('A');
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
    const { executor } = await w.started('A');
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
    const { executor } = await w.started('A');
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

  it('says it serves, on each queue it serves, every BEAT_MS, with what it has: what it was told, once each, and pool:<its id>; with no slots until it has listened for LISTEN_MS', async () => {
    const task = w.ask('k');
    const startedAt = w.clock.now();
    w.pool('A', { slots: 4, has: ['unix', 'node', 'unix'] });
    await settle();
    await w.clock.advance(BEAT_MS * 2);
    const serving = w.net.sent.filter((it) => it.message.type === 'serving');
    for (const { url, message } of serving) {
      expect(url).toBe(w.queue.url);
      expect(message).toMatchObject({ pool: 'A', name: 'pool A', has: ['unix', 'node', 'pool:A'] });
    }
    // said first as the queue is found, with no slots, and at the beat, still listening; at LISTEN_MS with its
    // slots, before it takes anything; as it takes the task; then each beat
    expect(serving.map((it) => [it.message.slots, it.message.busy])).toEqual([[0, 0], [0, 0], [4, 0], [4, 1], [4, 1]]);
    expect(runsOf(task).map((run) => run.start)).toEqual([startedAt + LISTEN_MS]);
  });

  it('says it serves, on every queue it serves, the moment how many of its slots are busy changes; stopping, it says once that it has no slots, and nothing after', async () => {
    const other = w.repo.create<Queue>({ title: 'other', jobs: {} });
    const { pool, executor } = await w.started('A', { slots: 2, queues: { [w.queue.url]: 'any', [other.url]: 'any' } });
    const said = (url: string) =>
      w.net.sent.filter((it) => it.url === url && it.message.type === 'serving').map((it) => [it.message.slots, it.message.busy]);
    const [before, otherBefore] = [said(w.queue.url).length, said(other.url).length];
    const since = () => [said(w.queue.url).slice(before), said(other.url).slice(otherBefore)];
    const task = w.ask('k');
    await settle();
    expect(since()).toEqual([[[2, 1]], [[2, 1]]]);
    executor.of(lastRun(task).id).events.done('done');
    await settle();
    expect(since()).toEqual([
      [[2, 1], [2, 0]],
      [[2, 1], [2, 0]],
    ]);

    const second = w.ask('k2');
    await settle();
    const sent = w.net.sent.length;
    const stopping = pool.stop();
    await w.clock.advance(GRACE_MS);
    await stopping;
    expect(statuses(second)).toEqual(['lost']);
    // said before its run is stopped, and not again when the run is over
    const last = w.net.sent.slice(sent).filter((it) => it.message.type === 'serving');
    expect(last.map((it) => [it.url, it.message.slots, it.message.busy])).toEqual([
      [w.queue.url, 0, 1],
      [other.url, 0, 1],
    ]);
  });

  it('stopping, records a run as gone says: cancelled if the task is stopped meanwhile, yielded if another run ended it, else lost; whether its code returns or is killed', async () => {
    const meanwhile: [string, (task: Handle<Task>) => void][] = [
      ['nothing', () => {}],
      ['flagged', (task) => stop(task)],
      [
        'yielded',
        (task) =>
          task.change((doc) => {
            claimRun(doc, { id: 'theirs', pool: 'Z', start: 0 });
            endRun(doc, 'theirs', { status: 'succeeded', result: 'theirs', end: 1 });
          }),
      ],
    ];
    const want: Record<string, string> = { nothing: 'lost', flagged: 'cancelled', yielded: 'yielded' };
    for (const [what, change] of meanwhile) {
      for (const returns of [false, true]) {
        w = world();
        const task = w.ask('k');
        const { pool, executor } = await w.started('A');
        await settle();
        const worker = executor.of(lastRun(task).id);
        const stopped = pool.stop();
        await settle();
        expect(worker.aborts.map((it) => it.reason)).toEqual(['stopping']);
        change(task);
        await settle();
        // told once, for the pool stopping: the change meanwhile tells it nothing more
        expect(worker.aborts).toHaveLength(1);
        if (returns) {
          worker.events.done('returned');
          await settle();
        } else {
          await w.clock.advance(GRACE_MS);
        }
        await stopped;
        expect(runsOf(task)[0].status, `${what}, ${returns ? 'returned' : 'killed'}`).toBe(want[what]);
        expect(runsOf(task)[0].result).toBeNull();
      }
    }
  });

  it('records its own orphan runs, at a restart, as gone says: cancelled on a stopped task, yielded on one another run ended; and lets their entries go', async () => {
    const flagged = w.ask('flagged', { runs: [{ id: 'mine', pool: 'A', start: 0 }] });
    stop(flagged);
    const ended = w.ask('ended', {
      runs: [
        { id: 'mine too', pool: 'A', start: 0 },
        { id: 'theirs', pool: 'B', start: 1, end: 2, status: 'succeeded', result: 'theirs', logs: [] },
      ],
    });
    const { executor } = w.pool('A', { slots: 2 });
    await settle();
    expect(statuses(flagged)).toEqual(['cancelled', 'cancelled']);
    expect(statuses(ended)).toEqual(['yielded', 'succeeded']);
    expect(taskResult(ended.doc())).toBe('theirs');
    expect(listed(w.queue, 'flagged')).toBeUndefined();
    expect(listed(w.queue, 'ended')).toBeUndefined();
    expect(executor.workers).toHaveLength(0);
  });

  it("lets go of a stopped task's entry at once, though another pool's open run of it is still heard, and writes nothing into that run", async () => {
    const task = w.ask('k', { runs: [{ id: 'theirs', pool: 'X', start: 0 }] });
    stop(task);
    const heard = readerOf(task);
    const { executor } = w.pool('A');
    await settle();
    w.net.beat(task.url, 'theirs');
    expect(taskState(task.doc(), heard)).toBe('stopping');
    expect(listed(w.queue, 'k')).toBeUndefined();
    // while it is heard, the task reads stopping, and it is taken by nobody
    for (let i = 0; i < 8; i++) {
      expect(taskState(task.doc(), heard), `beat ${i}`).toBe('stopping');
      w.net.beat(task.url, 'theirs');
      await w.clock.advance(BEAT_MS);
    }
    await w.clock.advance(LAPSE_MS);
    expect(taskState(task.doc(), heard)).toBe('cancelled');
    // nobody writes another pool's run
    expect(statuses(task)).toEqual(['open', 'cancelled']);
    expect(executor.workers).toHaveLength(0);
  });

  it("an entry goes as soon as a record ends its task, while an earlier run of another pool's is still heard and the task reads running", async () => {
    // [theirs open and heard, a failure after it]: the failure ends nothing yet for a listener, but the entry goes.
    const task = w.ask('k', {
      runs: [
        { id: 'theirs', pool: 'X', start: 0 },
        { id: 'failure', pool: 'Y', start: 1, end: 2, status: 'failed', result: null, logs: [] },
      ],
    });
    const heard = readerOf(task);
    const { executor } = w.pool('A');
    await settle();
    w.net.beat(task.url, 'theirs');
    expect(taskState(task.doc(), heard)).toBe('running');
    expect(listed(w.queue, 'k')).toBeUndefined();
    expect(executor.workers).toHaveLength(0);
  });

  it('the rescue rule: a run that throws after an earlier healthy run stops nothing; the earlier run carries on, and its success is the ending', async () => {
    const task = w.ask('k');
    const heard = readerOf(task);
    const a = await w.started('A');
    await settle();
    const first = lastRun(task).id;
    // B cannot hear A, so after the lapse it takes the task too
    const b = await w.started('B');
    b.ears.deaf = true;
    await settle();
    await w.clock.advance(LAPSE_MS);
    const second = lastRun(task).id;
    expect(runsOf(task).map((run) => run.pool)).toEqual(['A', 'B']);
    b.executor.of(second).events.threw('Error: B broke');
    await settle();
    expect(statuses(task)).toEqual(['open', 'failed']);
    // A is not told to stop, and a listener that hears A reads running, not failed
    expect(a.executor.of(first).aborts).toEqual([]);
    expect(taskState(task.doc(), heard)).toBe('running');
    // the failure is a record that ends the task, so the entry goes; A carries on all the same
    expect(listed(w.queue, 'k')).toBeUndefined();
    await w.clock.advance(BEAT_MS * 3);
    expect(a.executor.of(first).aborts).toEqual([]);
    a.executor.of(first).events.done('A after all');
    await settle();
    expect(statuses(task)).toEqual(['succeeded', 'failed']);
    expect(ending(task.doc(), allHeard)).toBe('succeeded');
    expect(taskResult(task.doc())).toBe('A after all');
  });

  it('a run that sees a later success and a stop together yields, whatever their order: its pool records yielded, and the ending stays the success', async () => {
    for (const order of [['success', 'stop'], ['stop', 'success']]) {
      w = world();
      const task = w.ask('k');
      const { executor } = await w.started('A');
      await settle();
      const mine = lastRun(task).id;
      const worker = executor.of(mine);
      // both reach A's pool in one change, so it decides on a list that has them both
      task.change((doc) => {
        for (const what of order) {
          if (what === 'stop') {
            stopTask(doc, { id: 'stop', at: w.clock.now() });
          } else {
            claimRun(doc, { id: 'theirs', pool: 'Z', start: 1 });
            endRun(doc, 'theirs', { status: 'succeeded', result: 'theirs', end: 2 });
          }
        }
      });
      await settle();
      expect(worker.aborts.map((it) => it.reason), order.join()).toEqual(['yielded']);
      // its code returns all the same: the reason is what is recorded
      worker.events.done('mine');
      await settle();
      expect(runById(task, mine).status, order.join()).toBe('yielded');
      expect(runById(task, mine).result, order.join()).toBeNull();
      expect(taskState(task.doc(), allHeard), order.join()).toBe('succeeded');
      expect(taskResult(task.doc()), order.join()).toBe('theirs');
    }
  });

  it('a task document whose runs are malformed (null, a map, a number, a string) is not taken, not written, and keeps nobody from the next task', async () => {
    for (const runs of [null, {}, 5, 'r']) {
      w = world();
      const broken = w.repo.create<any>({ importUrl: CODE, input: null, key: 'broken', runs });
      w.queue.change((doc) => listTask(doc, 'broken', { taskUrl: broken.url, askedAt: 0, package: null }));
      const heads = broken.heads();
      const good = w.ask('good');
      const { pool } = w.pool('A');
      await settle();
      await w.clock.advance(LAPSE_MS);
      expect(broken.heads(), JSON.stringify(runs)).toEqual(heads);
      expect(listed(w.queue, 'broken'), JSON.stringify(runs)).toBe(broken.url);
      expect(statuses(good), JSON.stringify(runs)).toEqual(['open']);
      expect(pool.busy, JSON.stringify(runs)).toBe(1);
    }
  });

  it('a third loss recorded after a healthy earlier run does not stop it: a reader that hears it reads running, never failed, and then succeeded', async () => {
    const lost = (id: string, start: number): Run => ({ id, pool: 'X', start, end: start, status: 'lost', result: null, logs: [] });
    const task = w.ask('k', { runs: [lost('l1', 0), lost('l2', 1)] });
    // a reader with ears of its own
    const reader = new Hearing(w.clock);
    w.net.ears().listen(task, (message) => message?.type === 'task progress' && reader.heardFrom(message.run));
    const states: TaskState[] = [];
    const look = () => {
      reader.saw(task.doc().runs);
      states.push(taskState(task.doc(), reader.heard));
    };
    task.on('change', look);
    const { executor } = await w.started('A');
    await settle();
    const mine = lastRun(task);
    expect(mine.pool).toBe('A');
    const worker = executor.of(mine.id);
    // a run of X's after it, which X's pool comes back and records as gone says: the third loss, so failed
    task.change((doc) => claimRun(doc, { id: 'x', pool: 'X', start: 3 }));
    task.change((doc) => endRun(doc, 'x', { status: gone(doc, 'x', 'this'), end: w.clock.now(), logs: [{ timestampMillis: 0, message: LOST_TOO_OFTEN }] }));
    expect(statuses(task)).toEqual(['lost', 'lost', 'open', 'failed']);
    for (let i = 0; i < 6; i++) {
      await w.clock.advance(BEAT_MS);
      look();
    }
    expect(worker.aborts).toEqual([]);
    // a reader that cannot hear the run reads failed here, and is wrong by the end (the admitted change)
    expect(taskState(task.doc(), () => false)).toBe('failed');
    worker.events.done('done after all');
    await settle();
    look();
    expect(states).not.toContain('failed');
    expect(states.at(-1)).toBe('succeeded');
    expect(taskResult(task.doc())).toBe('done after all');
  });

  it('a third loss recorded before a later run ends the task: the later run yields', async () => {
    const lost = (id: string, start: number): Run => ({ id, pool: 'X', start, end: start, status: 'lost', result: null, logs: [] });
    const task = w.ask('k', { runs: [lost('l1', 0), lost('l2', 1), { id: 'x', pool: 'X', start: 2 }] });
    const { executor } = w.pool('A');
    await settle();
    await w.clock.advance(LAPSE_MS);
    const mine = lastRun(task);
    expect(mine.pool).toBe('A');
    // X's pool comes back and records its run as gone says
    task.change((doc) => endRun(doc, 'x', { status: gone(doc, 'x', 'this'), end: w.clock.now() }));
    await settle();
    expect(executor.of(mine.id).aborts.map((it) => it.reason)).toEqual(['yielded']);
    await w.clock.advance(GRACE_MS);
    expect(statuses(task)).toEqual(['lost', 'lost', 'failed', 'yielded']);
    expect(ending(task.doc(), allHeard)).toBe('failed');
    expect(listed(w.queue, 'k')).toBeUndefined();
  });

  it("tells its orphans apart per task: a copy T' carrying its live run r on T has r completed as gone says, and may be taken; r on T carries on", async () => {
    const original = w.ask('original');
    const { pool, executor } = await w.started('A', { slots: 2 });
    await settle();
    const r = lastRun(original).id;
    // someone copies the task, run and all, and lists the copy under a key of its own
    const copied = w.ask('copy', { runs: [structuredClone(runById(original, r))] });
    await settle();
    expect(statuses(copied)).toEqual(['lost', 'open']);
    expect(runsOf(copied)[0].id).toBe(r);
    expect(lastRun(copied).pool).toBe('A');
    expect(executor.of(lastRun(copied).id).job?.taskUrl).toBe(copied.url);
    // the original's run is untouched and carries on
    expect(statuses(original)).toEqual(['open']);
    expect(executor.of(r).aborts).toEqual([]);
    expect(pool.busy).toBe(2);
    executor.of(r).events.done('original');
    await settle();
    expect(statuses(original)).toEqual(['succeeded']);
  });

  it('writes nothing but runs and their ends into a task, and nothing but deletions into a queue', async () => {
    const task = w.ask('k');
    const queueBefore = structuredClone(w.queue.doc());
    await w.started('A');
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
    private readonly method: 'run' | 'abort' | 'terminate' | 'settle',
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

describe('settling', () => {
  // A run settles once its pool has held it for BEAT_MS, counted from when
  // its start was saved, with nothing stopping it (`settles`): the pool tells
  // its worker so, once.

  it('tells the worker BEAT_MS after the start is saved, not before, and once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const docs: Docs = { find: (url) => w.repo.find(url) as any, flush: () => gate };
    const { executor } = await w.started('A', { repo: docs });
    const task = w.ask('k');
    await settle();
    const claimedAt = lastRun(task).start;
    // the start takes 700 ms to save; nothing is handed over meanwhile
    await w.clock.advance(700);
    expect(executor.workers).toHaveLength(0);
    release();
    await settle();
    const savedAt = w.clock.now();
    expect(savedAt).toBe(claimedAt + 700);
    const worker = executor.of(lastRun(task).id);
    await w.clock.advance(BEAT_MS - 1);
    expect(worker.settles).toEqual([]);
    await w.clock.advance(1);
    expect(worker.settles).toEqual([{ run: lastRun(task).id, at: savedAt + BEAT_MS }]);
    // more beats, more news of it, and something else changing: still once
    worker.events.log('working');
    w.ask('other');
    await w.clock.advance(BEAT_MS * 3);
    expect(worker.settles).toHaveLength(1);
    worker.events.done('done');
    await settle();
    expect(statuses(task)).toEqual(['succeeded']);
  });

  // A run taken while an earlier run was unheard (first seen LAPSE_MS ago),
  // and what then happens half a beat into its hold. Only where nothing does
  // does it settle; otherwise it is stopped, and never told it settled.
  const within: [string, (task: Handle<Task>, pool: Pool) => void, StopReason | null][] = [
    ['nothing', () => {}, null],
    ['the earlier run is heard', (task) => w.net.beat(task.url, 'cut off'), 'yielded'],
    ['the earlier run ends the task', (task) => task.change((doc) => endRun(doc, 'cut off', { status: 'failed', end: w.clock.now(), logs: [] })), 'yielded'],
    ['another run succeeds', (task) => task.change((doc) => void doc.runs.push({ id: 'elsewhere', pool: 'X', start: w.clock.now(), end: w.clock.now(), status: 'succeeded', result: 1, logs: [] } as Run)), 'yielded'],
    [
      'the key comes to name another task',
      () => {
        const other = w.make('k');
        w.queue.change((doc) => {
          doc.jobs.k = { taskUrl: other.url, askedAt: 1, package: null };
        });
      },
      'yielded',
    ],
    ['the task is stopped', (task) => stop(task), 'cancelled'],
    ['the pool stops', (_, pool) => void pool.stop(), 'stopping'],
  ];
  for (const [what, act, reason] of within) {
    it(`within the beat, ${what}: ${reason ? `stopped (${reason}), never told it settled` : 'told it settled at BEAT_MS'}`, async () => {
      const task = w.ask('k', { runs: [{ id: 'cut off', pool: 'X', start: 0 }] });
      const { executor, pool } = w.pool('B');
      await settle();
      await w.clock.advance(LAPSE_MS);
      const mine = lastRun(task);
      expect(mine.pool).toBe('B');
      const worker = executor.of(mine.id);
      await w.clock.advance(BEAT_MS / 2);
      act(task, pool);
      await settle();
      await w.clock.advance(BEAT_MS * 2);
      if (reason) {
        expect(worker.aborts.map((it) => it.reason)).toEqual([reason]);
        expect(worker.settles).toEqual([]);
      } else {
        expect(worker.aborts).toEqual([]);
        expect(worker.settles).toEqual([{ run: mine.id, at: mine.start + BEAT_MS }]);
      }
    });
  }

  it("clears its look at BEAT_MS when the run completes, and when it is stopped (the kill's timer takes its place)", async () => {
    const { executor } = await w.started('A');
    const idle = w.clock.pending;
    const done = w.ask('done');
    await settle();
    // while held: the run's beat and its look at BEAT_MS
    expect(w.clock.pending).toBe(idle + 2);
    executor.of(lastRun(done).id).events.done(1);
    await settle();
    expect(w.clock.pending).toBe(idle);

    const stopped = w.ask('stopped');
    await settle();
    const worker = executor.of(lastRun(stopped).id);
    expect(w.clock.pending).toBe(idle + 2);
    stop(stopped);
    await settle();
    // the run's beat and its kill
    expect(w.clock.pending).toBe(idle + 2);
    await w.clock.advance(GRACE_MS);
    expect(statuses(stopped)).toEqual(['cancelled', 'cancelled']);
    expect(w.clock.pending).toBe(idle);
    expect(worker.settles).toEqual([]);
  });

  it('a settle that throws spoils nothing: the run beats on and ends as its code says, is told once, and the next run settles too', async () => {
    const executor = new ThrowingExecutor(w.clock, 'settle');
    const { pool } = await w.started('A', { executor });
    const task = w.ask('k');
    await settle();
    const run = lastRun(task).id;
    const worker = executor.of(run);
    await w.clock.advance(BEAT_MS);
    expect(worker.settles).toHaveLength(1);
    const said = w.net.sent.length;
    await w.clock.advance(BEAT_MS * 2);
    expect(worker.settles).toHaveLength(1);
    expect(w.net.sent.slice(said).filter((it) => it.message.type === 'task progress' && it.message.run === run)).toHaveLength(2);
    expect(worker.aborts).toEqual([]);
    worker.events.done('fine');
    await settle();
    expect(statuses(task)).toEqual(['succeeded']);
    expect(worker.terminations).toEqual([]);
    const next = w.ask('next');
    await settle();
    await w.clock.advance(BEAT_MS);
    // the same worker, kept: told once of each run
    expect(executor.of(lastRun(next).id)).toBe(worker);
    expect(worker.settles).toEqual([
      { run, at: expect.any(Number) },
      { run: lastRun(next).id, at: lastRun(next).start + BEAT_MS },
    ]);
    expect(pool.busy).toBe(1);
  });
});

describe('settling, as a checker attacks it', () => {
  // Two pools on Repos of their own, each with its own copy of one queue and
  // one task, deaf to each other's serving words so that neither holds back:
  // what one writes reaches the other only when the test carries it there,
  // at the time the table says. Their copies of the task have actors chosen
  // so that the merge puts `first`'s run first (the higher actor's insert
  // comes first among concurrent ones). A pool writes nothing after its claim
  // until its yielded run is killed, GRACE_MS after the abort, and every case
  // carries its last copy before then, so carrying a copy as it stands is
  // carrying the claim.

  /** Counts a Repo's finds and flushes as the world's, so that `settle` waits for them too. */
  function countedAsTheWorlds(repo: Repo) {
    const find = repo.find.bind(repo);
    const flush = repo.flush.bind(repo);
    const count = <T>(promise: Promise<T>) => {
      w.repoWork.underWay++;
      return promise.finally(() => w.repoWork.underWay--);
    };
    repo.find = ((...args: Parameters<Repo['find']>) => count(find(...args))) as Repo['find'];
    repo.flush = ((...args: Parameters<Repo['flush']>) => count(flush(...args))) as Repo['flush'];
    return repo;
  }

  async function apart(first: 'A' | 'B') {
    const repoA = countedAsTheWorlds(new Repo({ network: [] } as any));
    const repoB = countedAsTheWorlds(new Repo({ network: [] } as any));
    const queueA = repoA.create<Queue>({ title: 'q', jobs: {} });
    const taskA = repoA.create<Task>({ importUrl: CODE, input: null, key: 'k', runs: [] });
    const queueB = repoB.import<Queue>(A.save(queueA.doc()), { docId: queueA.documentId } as any);
    const taskB = repoB.import<Task>(A.save(taskA.doc()), { docId: taskA.documentId } as any);
    const [high, low] = ['b'.repeat(32), 'a'.repeat(32)];
    taskA.update((doc) => A.clone(doc, { actor: first === 'A' ? high : low }));
    taskB.update((doc) => A.clone(doc, { actor: first === 'A' ? low : high }));
    const start = (id: string, repo: Repo) => {
      const executor = new FakeExecutor(w.clock);
      const ears = w.net.ears();
      const pool = new Pool({
        repo: repo as Docs,
        id,
        name: id,
        slots: 1,
        has: [],
        executor,
        queues: { [queueA.url]: 'any' },
        ears: deafToServing(ears),
        clock: w.clock,
      });
      return { pool, executor, ears };
    };
    const a = start('A', repoA);
    const b = start('B', repoB);
    await settle();
    await w.clock.advance(LISTEN_MS);
    return { a, b, queueA, queueB, taskA, taskB };
  }

  /** What one pool's worker was told of its run: when it settled and when it was told to yield, each from t0, or null. */
  type Told = { settled: number | null; yielded: number | null };

  // [what, first, B takes it this long after A, A's word reaches B after, B's word reaches A after, cut off, A told, B told]
  const crossings: [string, 'A' | 'B', number, number, number, boolean, Told, Told][] = [
    ['taken at once, each heard in 300 ms', 'A', 0, 300, 300, false, { settled: BEAT_MS, yielded: null }, { settled: null, yielded: 300 }],
    ['taken at once, each heard in 300 ms', 'B', 0, 300, 300, false, { settled: null, yielded: 300 }, { settled: BEAT_MS, yielded: null }],
    ['B takes it 900 ms after A, each heard in 1000 ms (a round trip of a beat)', 'A', 900, 1_000, 1_000, false, { settled: BEAT_MS, yielded: null }, { settled: null, yielded: 1_000 }],
    ['B takes it 900 ms after A, each heard in 1000 ms (a round trip of a beat)', 'B', 900, 1_000, 1_000, false, { settled: null, yielded: 1_900 }, { settled: 900 + BEAT_MS, yielded: null }],
    // Each pool hears the other within the beat, but B's run, listed first,
    // was taken 1900 ms into A's beat: its record reaches A after A settled.
    // Both runs settle. The README's limit names only an earlier run cut off
    // for longer than the beat; this is a round trip longer than the beat.
    ['B takes it 1900 ms after A, each heard in 1950 ms', 'A', 1_900, 1_950, 1_950, false, { settled: BEAT_MS, yielded: null }, { settled: null, yielded: 1_950 }],
    ['B takes it 1900 ms after A, each heard in 1950 ms', 'B', 1_900, 1_950, 1_950, false, { settled: BEAT_MS, yielded: 3_850 }, { settled: 1_900 + BEAT_MS, yielded: null }],
    ['taken at once, A heard by B late (2500 ms), B by A in 100 ms', 'A', 0, 2_500, 100, false, { settled: BEAT_MS, yielded: null }, { settled: BEAT_MS, yielded: 2_500 }],
    ['taken at once, A heard by B late (2500 ms), B by A in 100 ms', 'B', 0, 2_500, 100, false, { settled: null, yielded: 100 }, { settled: BEAT_MS, yielded: null }],
    ['taken at once, B cut off for 5000 ms', 'A', 0, 5_000, 5_000, true, { settled: BEAT_MS, yielded: null }, { settled: BEAT_MS, yielded: 5_000 }],
    ['taken at once, B cut off for 5000 ms', 'B', 0, 5_000, 5_000, true, { settled: BEAT_MS, yielded: 5_000 }, { settled: BEAT_MS, yielded: null }],
  ];
  for (const [what, first, gap, aToB, bToA, cut, toldA, toldB] of crossings) {
    it(`two pools cross, ${what}, ${first}'s run listed first: A ${JSON.stringify(toldA)}, B ${JSON.stringify(toldB)}`, async () => {
      const { a, b, queueA, queueB, taskA, taskB } = await apart(first);
      if (cut) {
        b.ears.deaf = true;
        b.ears.mute = true;
      }
      const t0 = w.clock.now();
      w.clock.setTimeout(() => queueB.merge(queueA), gap);
      w.clock.setTimeout(() => taskB.merge(taskA), aToB);
      w.clock.setTimeout(() => {
        b.ears.deaf = false;
        b.ears.mute = false;
        taskA.merge(taskB);
      }, gap + bToA);
      // A sees the listing now, B `gap` later
      queueA.change((doc) => listTask(doc, 'k', { taskUrl: taskA.url, askedAt: 1, package: null }));
      await settle();
      await w.clock.advance(6_000);

      const runA = runsOf(taskA).find((run) => run.pool === 'A')!;
      const runB = runsOf(taskB).find((run) => run.pool === 'B')!;
      expect(runA.start).toBe(t0);
      expect(runB.start).toBe(t0 + gap);
      // the merge put `first`'s run first, on both copies
      expect(runsOf(taskA).map((run) => run.pool)).toEqual(first === 'A' ? ['A', 'B'] : ['B', 'A']);
      expect(runsOf(taskB).map((run) => run.pool)).toEqual(first === 'A' ? ['A', 'B'] : ['B', 'A']);

      for (const [executor, run, told] of [
        [a.executor, runA, toldA],
        [b.executor, runB, toldB],
      ] as const) {
        const worker = executor.of(run.id);
        const seen: Told = {
          settled: worker.settles.length ? worker.settles[0].at - t0 : null,
          yielded: worker.aborts.length ? worker.aborts[0].at - t0 : null,
        };
        expect(seen, `pool ${run.pool}`).toEqual(told);
        // at most once, only for its own run, never after an abort
        expect(worker.settles.length).toBeLessThanOrEqual(1);
        expect(worker.settles.every((it) => it.run === run.id)).toBe(true);
        expect(worker.aborts.map((it) => it.reason)).toEqual(told.yielded === null ? [] : ['yielded']);
        if (told.settled !== null && told.yielded !== null) {
          expect(told.settled).toBeLessThan(told.yielded);
        }
        // a run made to yield within the beat from its start never settles
        if (told.yielded !== null && told.yielded < run.start - t0 + BEAT_MS) {
          expect(told.settled).toBeNull();
        }
      }
    });
  }

  it('a pool alone, its worker used again: the run that ended before its beat is never told; the next is told at its own beat, once', async () => {
    const { executor } = await w.started('A');
    const first = w.ask('first');
    await settle();
    const worker = executor.of(lastRun(first).id);
    // it ends a millisecond before its beat, and the next is taken by the same worker at that moment
    await w.clock.advance(BEAT_MS - 1);
    const second = w.ask('second');
    worker.events.done('one');
    await settle();
    expect(statuses(first)).toEqual(['succeeded']);
    expect(executor.of(lastRun(second).id)).toBe(worker);
    expect(lastRun(second).start).toBe(lastRun(first).start + BEAT_MS - 1);
    // the moment the first run's beat would have come
    await w.clock.advance(1);
    expect(worker.settles).toEqual([]);
    await w.clock.advance(BEAT_MS - 2);
    expect(worker.settles).toEqual([]);
    await w.clock.advance(1);
    expect(worker.settles).toEqual([{ run: lastRun(second).id, at: lastRun(second).start + BEAT_MS }]);
    // reviews by the dozen: logs, progress, more asks, beats
    for (let i = 0; i < 12; i++) {
      worker.events.log(`line ${i}`);
      worker.events.progress(i);
      w.ask(`more ${i}`);
      await w.clock.advance(BEAT_MS / 4);
    }
    expect(worker.settles).toHaveLength(1);
    expect(worker.jobs.map((job) => job.runId)).toEqual([lastRun(first).id, lastRun(second).id]);
  });

  it('a run retaken after its worker died is told at its own beat, by its new worker; the dead one never is', async () => {
    const { executor } = await w.started('A');
    const task = w.ask('k');
    await settle();
    const dead = executor.of(lastRun(task).id);
    await w.clock.advance(BEAT_MS / 2);
    dead.events.exit();
    await settle();
    expect(statuses(task)).toEqual(['lost', 'open']);
    const again = lastRun(task);
    expect(again.start).toBe(runsOf(task)[0].start + BEAT_MS / 2);
    const alive = executor.of(again.id);
    expect(alive).not.toBe(dead);
    await w.clock.advance(BEAT_MS * 3);
    expect(dead.settles).toEqual([]);
    expect(alive.settles).toEqual([{ run: again.id, at: again.start + BEAT_MS }]);
  });

  it('a run retaken after a pool stopped within its beat: the stopped run is never told; the new pool tells its own run at its own beat', async () => {
    const { pool, executor } = await w.started('A');
    const task = w.ask('k');
    await settle();
    const before = executor.of(lastRun(task).id);
    await w.clock.advance(BEAT_MS / 2);
    void pool.stop();
    await w.clock.advance(GRACE_MS);
    expect(statuses(task)).toEqual(['lost']);
    expect(before.settles).toEqual([]);
    const next = w.pool('B');
    await settle();
    await w.clock.advance(LISTEN_MS + BEAT_MS * 2);
    const again = lastRun(task);
    expect(again.pool).toBe('B');
    expect(next.executor.of(again.id).settles).toEqual([{ run: again.id, at: again.start + BEAT_MS }]);
    expect(before.settles).toEqual([]);
  });

  // A stop, at each moment around the beat: before it, never told; after it,
  // told once and then aborted.
  for (const at of [1, BEAT_MS / 2, BEAT_MS - 1, BEAT_MS + 1, BEAT_MS * 3]) {
    it(`a stop ${at} ms after the start was saved: ${at < BEAT_MS ? 'cancelled, never told it settled' : 'told it settled at the beat, then cancelled'}`, async () => {
      const { executor } = await w.started('A');
      const task = w.ask('k');
      await settle();
      const run = lastRun(task);
      const worker = executor.of(run.id);
      await w.clock.advance(at);
      stop(task);
      await settle();
      await w.clock.advance(BEAT_MS * 4);
      expect(worker.aborts).toEqual([{ reason: 'cancelled', at: run.start + at }]);
      expect(worker.settles).toEqual(at < BEAT_MS ? [] : [{ run: run.id, at: run.start + BEAT_MS }]);
    });
  }

  it('an earlier run heard after the beat: told it settled, then told to yield, and never told again', async () => {
    const task = w.ask('k', { runs: [{ id: 'cut off', pool: 'X', start: 0 }] });
    const { executor } = w.pool('B');
    await settle();
    await w.clock.advance(LAPSE_MS);
    const mine = lastRun(task);
    const worker = executor.of(mine.id);
    await w.clock.advance(BEAT_MS + 1);
    w.net.beat(task.url, 'cut off');
    await settle();
    await w.clock.advance(BEAT_MS * 4);
    expect(worker.settles).toEqual([{ run: mine.id, at: mine.start + BEAT_MS }]);
    expect(worker.aborts).toEqual([{ reason: 'yielded', at: mine.start + BEAT_MS + 1 }]);
  });
});

describe('what a pool has', () => {
  /** A task with these needs, listed with these needs on its entry. */
  const askNeeding = (key: string, taskNeeds: unknown, entryNeeds: unknown = taskNeeds) => {
    const task = w.repo.create<Task>({ importUrl: CODE, input: null, key, needs: taskNeeds as string[], runs: [] });
    w.queue.change((doc) => listTask(doc, key, { taskUrl: task.url, askedAt: 1, package: null, needs: entryNeeds }));
    return task;
  };

  // Each row: what the task and its entry need, the labels the pool was given, and whether it takes it.
  const cases: [string, unknown, unknown, string[], boolean][] = [
    ['needs nothing', [], [], [], true],
    ['needs what it has', ['unix'], ['unix'], ['unix', 'gpu'], true],
    ['needs it by name', ['pool:A'], ['pool:A'], [], true],
    ['needs another pool by name', ['pool:B'], ['pool:B'], [], false],
    ['needs one thing it lacks', ['unix', 'gpu'], ['unix', 'gpu'], ['unix'], false],
    ['the entry needs nothing, the task needs what it lacks', ['unix'], [], [], false],
    ['the task needs nothing, the entry needs what it lacks', [], ['unix'], [], false],
    ['needs that are not a list', 'unix', 'unix', ['unix'], false],
    ['an empty label', [''], [''], [''], false],
    ['a label that is not a string', [7], [7], ['7'], false],
  ];
  for (const [name, taskNeeds, entryNeeds, has, takes] of cases) {
    it(`${name}: ${takes ? 'takes it' : 'leaves it listed, with no run, however long'}`, async () => {
      const task = askNeeding('k', taskNeeds, entryNeeds);
      const { executor } = w.pool('A', { has });
      await settle();
      await w.clock.advance(LAPSE_MS + HOLD_MS);
      expect(runsOf(task).map((run) => run.pool)).toEqual(takes ? ['A'] : []);
      expect(executor.workers).toHaveLength(takes ? 1 : 0);
      expect(listed(w.queue, 'k')).toBe(task.url);
    });
  }

  it('work only one pool has what it needs for is taken by that one, at once, whichever the hash prefers', async () => {
    const [a, b] = await w.startedAll(['A'], ['B', { has: ['unix'] }]);
    const task = askNeeding('k', ['unix']);
    await settle();
    expect(runsOf(task).map((run) => run.pool)).toEqual(['B']);
    await w.clock.advance(LAPSE_MS * 2);
    expect(runsOf(task).map((run) => run.pool)).toEqual(['B']);
    expect(a.executor.workers).toHaveLength(0);
    expect(b.executor.workers).toHaveLength(1);
  });

  it('work that leaves a pool for want of a need does not hold up what is behind it', async () => {
    await w.started('A');
    const first = askNeeding('first', ['unix']);
    const second = w.ask('second', { askedAt: 2 });
    await settle();
    expect(runsOf(first)).toEqual([]);
    expect(runsOf(second).map((run) => run.pool)).toEqual(['A']);
  });
});

describe('the preferred pool', () => {
  let askedAt = 1_000;
  /** A task made and not yet listed, so that pools can be named after it before they see it. */
  const made = (key: string, more: { importUrl?: string; needs?: string[] } = {}) =>
    w.repo.create<Task>({ importUrl: more.importUrl ?? CODE, input: { key }, key, needs: more.needs ?? [], runs: [] });
  /** Lists tasks made by `made` in one change, as `ask` would, with `near` if given. */
  const list = (tasks: Handle<Task> | Handle<Task>[], near?: string) =>
    w.queue.change((doc) => {
      for (const task of [tasks].flat()) {
        listTask(doc, task.doc()!.key, { taskUrl: task.url, askedAt: ++askedAt, package: null, needs: task.doc()!.needs, near });
      }
    });
  /** Two pool ids for a task: the one `preferred` names when both have a free slot, then the other. */
  const byPreference = (task: Handle<Task>): [string, string] => {
    const ids = ['pool-1', 'pool-2'];
    const first = preferred(task.url, null, ids.map((pool) => ({ pool, slots: 1, busy: 0 })));
    return first === ids[0] ? [ids[0], ids[1]] : [ids[1], ids[0]];
  };
  const poolsOf = (task: Handle<Task>) => runsOf(task).map((run) => run.pool);
  const startsOf = (task: Handle<Task>) => runsOf(task).map((run) => run.start);

  // Each assignment of the preferred pool, two ways: by the hash (no near), and
  // by near, for each pool; each with either pool started first.
  for (const near of [undefined, 'pool-1', 'pool-2']) {
    for (const firstStarted of ['pool-1', 'pool-2']) {
      it(`two pools, one task, preferred ${near ? `by near (${near})` : 'by the hash'}, ${firstStarted} started first: the preferred pool takes it at once, the other appends nothing, ever, and nothing yields`, async () => {
        const task = made('k');
        const chosen = near ?? byPreference(task)[0];
        const pools: Record<string, ReturnType<typeof w.pool>> = {};
        for (const id of firstStarted === 'pool-1' ? ['pool-1', 'pool-2'] : ['pool-2', 'pool-1']) {
          pools[id] = w.pool(id);
          await settle();
          await w.clock.advance(BEAT_MS / 2);
        }
        await w.clock.advance(LISTEN_MS);
        const listedAt = w.clock.now();
        list(task, near);
        await settle();
        expect(poolsOf(task)).toEqual([chosen]);
        expect(startsOf(task)).toEqual([listedAt]);

        await w.clock.advance(LAPSE_MS * 2);
        expect(poolsOf(task)).toEqual([chosen]);
        pools[chosen].executor.of(lastRun(task).id).events.done('once');
        await settle();
        await w.clock.advance(LAPSE_MS);
        expect(statuses(task)).toEqual(['succeeded']);
        const other = chosen === 'pool-1' ? 'pool-2' : 'pool-1';
        expect(pools[other].executor.workers).toHaveLength(0);
        expect(listed(w.queue, 'k')).toBeUndefined();
      });
    }
  }

  it('four tasks listed at once near a pool with two slots, the other first seeing them before it hears that pool full: the pool takes two at once, the other the other two HOLD_MS after first seeing them, each run once', async () => {
    const [p, o] = await w.startedAll(['P', { slots: 2 }], ['O', { slots: 2 }]);
    // listed so that P's next beat comes within the hold
    await w.clock.advance(BEAT_MS / 4);
    const tasks = ['a', 'b', 'c', 'd'].map((key) => made(key));
    // P's word that its slots are full has not reached O when O first sees the four
    o.ears.deaf = true;
    const listedAt = w.clock.now();
    list(tasks, 'P');
    await settle();
    o.ears.deaf = false;
    expect(tasks.map(poolsOf)).toEqual([['P'], ['P'], [], []]);
    // O hears P say it is full within the hold, and does not judge again
    const said = w.net.sent.length;
    await w.clock.advance(HOLD_MS - 1);
    expect(w.net.sent.slice(said).filter((it) => it.message.type === 'serving' && it.message.pool === 'P').map((it) => it.message.busy)).toEqual([2]);
    expect(tasks.map(poolsOf)).toEqual([['P'], ['P'], [], []]);
    await w.clock.advance(1);
    expect(tasks.map(poolsOf)).toEqual([['P'], ['P'], ['O'], ['O']]);
    expect(tasks.map(startsOf)).toEqual([[listedAt], [listedAt], [listedAt + HOLD_MS], [listedAt + HOLD_MS]]);
    await w.clock.advance(LAPSE_MS * 2);
    expect(tasks.map(statuses)).toEqual([['open'], ['open'], ['open'], ['open']]);
    expect([p.executor.workers.length, o.executor.workers.length]).toEqual([2, 2]);
  });

  it('the preferred pool, full when it first saw a task, takes it the moment a slot frees within the hold, and the other never does', async () => {
    const [p, o] = await w.startedAll(['P', { slots: 2 }], ['O', { slots: 2 }]);
    const tasks = ['a', 'b', 'c'].map((key) => made(key));
    o.ears.deaf = true;
    const listedAt = w.clock.now();
    list(tasks, 'P');
    await settle();
    o.ears.deaf = false;
    await w.clock.advance(HOLD_MS / 2);
    p.executor.of(lastRun(tasks[0]).id).events.done('a');
    await settle();
    expect(poolsOf(tasks[2])).toEqual(['P']);
    expect(startsOf(tasks[2])).toEqual([listedAt + HOLD_MS / 2]);
    await w.clock.advance(LAPSE_MS * 2);
    expect(tasks.map(poolsOf)).toEqual([['P'], ['P'], ['P']]);
    expect(o.executor.workers).toHaveLength(0);
  });

  // Two machines, each pool with its own Repo, the documents merged only when
  // the test says: what one pool writes reaches the other a crossing later.
  for (const other of [true, false]) {
    it(`the preferred pool, full until just past the hold, ${other ? 'with another pool that could take the task: waits a second HOLD_MS, by when the run the other took has reached it, and never takes it' : 'alone: takes it the moment a slot frees'}`, async () => {
      const repoP = new Repo({ network: [] } as any);
      const repoO = new Repo({ network: [] } as any);
      const works = [countingWork(repoP), countingWork(repoO)];
      const settleBoth = async () => {
        do {
          await settle();
        } while (works.some((it) => it.underWay > 0));
      };
      const queueP = repoP.create<Queue>({ title: 'q', jobs: {} });
      const queueO = repoO.import<Queue>(A.save(queueP.doc()), { docId: queueP.documentId } as any);
      const start = (id: string, repo: Repo) => {
        const executor = new FakeExecutor(w.clock);
        const ears = w.net.ears();
        new Pool({ repo: repo as Docs, id, name: id, slots: 1, has: [], executor, queues: { [queueP.url]: 'any' }, ears, clock: w.clock });
        return { executor, ears };
      };
      const p = start('P', repoP);
      const o = other ? start('O', repoO) : null;
      await settleBoth();
      await w.clock.advance(LISTEN_MS);
      // what each machine has, merged both ways
      const handles: [DocHandle<any>, DocHandle<any>][] = [[queueP, queueO]];
      const merge = () => {
        for (const [a, b] of handles) {
          a.merge(b);
          b.merge(a);
        }
      };
      const make = (key: string) => {
        const onP = repoP.create<Task>({ importUrl: CODE, input: key, key, needs: [], runs: [] });
        const onO = repoO.import<Task>(A.save(onP.doc()), { docId: onP.documentId } as any);
        handles.push([onP, onO]);
        return onP;
      };
      const [busy, task] = [make('busy'), make('task')];
      if (o) {
        // P's word that it is full has not reached O when O first sees the two
        o.ears.deaf = true;
      }
      const listedAt = w.clock.now();
      queueP.change((doc) => {
        listTask(doc, 'busy', { taskUrl: busy.url, askedAt: 1, package: null, needs: [], near: 'P' });
        listTask(doc, 'task', { taskUrl: task.url, askedAt: 2, package: null, needs: [], near: 'P' });
      });
      merge();
      await settleBoth();
      if (o) {
        o.ears.deaf = false;
      }
      expect(runsOf(busy).map((run) => run.pool)).toEqual(['P']);
      // P's run of `busy` crosses to O within the hold
      merge();
      await settleBoth();
      await w.clock.advance(HOLD_MS);
      if (o) {
        // O took it at the end of the hold, on its own machine
        expect(runsOf(handles[2][1]).map((run) => run.pool)).toEqual(['O']);
      }
      // P's slot frees a moment later, before O's run has reached it
      await w.clock.advance(HOLD_MS / 10);
      p.executor.of(lastRun(busy).id).events.done('busy');
      await settleBoth();
      if (!o) {
        expect(runsOf(task).map((run) => run.pool)).toEqual(['P']);
        expect(lastRun(task).start).toBe(listedAt + HOLD_MS + HOLD_MS / 10);
        return;
      }
      expect(runsOf(task)).toEqual([]);
      await w.clock.advance(HOLD_MS / 2);
      merge();
      await settleBoth();
      await w.clock.advance(LAPSE_MS);
      merge();
      await settleBoth();
      expect(runsOf(task).map((run) => run.pool)).toEqual(['O']);
      expect(p.executor.workers.flatMap((worker) => worker.jobs).map((job) => job.key)).toEqual(['busy']);
    });
  }

  it('a pool judges as soon as the entry is listed, before the task document arrives: the preferred pool, heard full only by then with that very task, is still held back for', async () => {
    // Two machines: O fetches the task's document a moment after it sees the
    // listing, and its copy does not have P's run until the test merges it.
    const repoP = new Repo({ network: [] } as any);
    const repoO = new Repo({ network: [] } as any);
    const works = [countingWork(repoP), countingWork(repoO)];
    const settleBoth = async () => {
      do {
        await settle();
      } while (works.some((it) => it.underWay > 0));
    };
    const queueP = repoP.create<Queue>({ title: 'q', jobs: {} });
    const queueO = repoO.import<Queue>(A.save(queueP.doc()), { docId: queueP.documentId } as any);
    const taskP = repoP.create<Task>({ importUrl: CODE, input: null, key: 'k', needs: [], runs: [] });
    const taskO = repoO.import<Task>(A.save(taskP.doc()), { docId: taskP.documentId } as any);
    let away = true;
    const arrivals = new Set<(state: { state: string }) => void>();
    const docsO: Docs = {
      find: (url) => (url === taskO.url && away ? Promise.reject(new Error('unavailable')) : (repoO.find(url) as any)),
      flush: (ids) => repoO.flush(ids),
      findWithProgress: (url) => ({
        peek: () => ({ state: url === taskO.url && away ? 'unavailable' : 'ready' }),
        subscribe: (onState) => (arrivals.add(onState), () => void arrivals.delete(onState)),
      }),
    };
    const start = (id: string, repo: Docs) => {
      const executor = new FakeExecutor(w.clock);
      new Pool({ repo, id, name: id, slots: 1, has: [], executor, queues: { [queueP.url]: 'any' }, ears: w.net.ears(), clock: w.clock });
      return executor;
    };
    const p = start('P', repoP as Docs);
    const o = start('O', docsO);
    await settleBoth();
    await w.clock.advance(LISTEN_MS);
    const entry = { taskUrl: taskP.url, askedAt: 1, package: null, needs: [], near: 'P' };
    // the listing reaches O first; then P, which takes it and says it is full
    queueO.change((doc) => listTask(doc, 'k', entry));
    await settleBoth();
    queueP.change((doc) => listTask(doc, 'k', entry));
    await settleBoth();
    expect(runsOf(taskP).map((run) => run.pool)).toEqual(['P']);
    expect(w.net.sent.filter((it) => it.message.type === 'serving' && it.message.pool === 'P').at(-1)?.message.busy).toBe(1);
    // O's copy of the task arrives, without P's run
    away = false;
    for (const arrived of [...arrivals]) {
      arrived({ state: 'ready' });
    }
    await settleBoth();
    expect(runsOf(taskO)).toEqual([]);
    await w.clock.advance(HOLD_MS / 2);
    expect(runsOf(taskO)).toEqual([]);
    // P's run reaches O within the hold
    taskO.merge(taskP);
    await settleBoth();
    await w.clock.advance(LAPSE_MS);
    expect(runsOf(taskO).map((run) => run.pool)).toEqual(['P']);
    expect(o.workers).toHaveLength(0);
    expect(p.workers).toHaveLength(1);
  });

  it('a pool heard full when the other first sees a task is not preferred: the other takes it at once, and the full pool, freed later, does not', async () => {
    const task = made('k');
    const [P, O] = byPreference(task);
    const [p] = await w.startedAll([P], [O]);
    // P is kept busy by work only it may take, and says so as it takes it, with no beat in between
    const busy = made('busy', { needs: [`pool:${P}`] });
    list(busy);
    await settle();
    expect(poolsOf(busy)).toEqual([P]);
    const listedAt = w.clock.now();
    list(task);
    await settle();
    expect(poolsOf(task)).toEqual([O]);
    expect(startsOf(task)).toEqual([listedAt]);
    p.executor.of(lastRun(busy).id).events.done('busy');
    await settle();
    await w.clock.advance(LAPSE_MS * 2);
    expect(poolsOf(task)).toEqual([O]);
    expect(p.executor.workers.flatMap((worker) => worker.jobs)).toHaveLength(1);
  });

  it('a pool that has listened to its queue for less than LISTEN_MS takes nothing there, even alone: what it saw then it takes at LISTEN_MS; from then on, alone, it takes everything at once', async () => {
    const { executor } = w.pool('A', { slots: 3 });
    await settle();
    const startedAt = w.clock.now();
    const first = w.ask('first');
    await settle();
    expect(runsOf(first)).toEqual([]);
    await w.clock.advance(LISTEN_MS - 1);
    const edge = w.ask('edge');
    await settle();
    expect([runsOf(first), runsOf(edge)]).toEqual([[], []]);
    await w.clock.advance(1);
    expect(startsOf(first)).toEqual([startedAt + LISTEN_MS]);
    expect(runsOf(edge)).toEqual([]);
    const ready = w.ask('ready');
    await settle();
    expect(startsOf(ready)).toEqual([startedAt + LISTEN_MS]);
    // edge was seen while A was still listening, which ranks it nowhere: a HOLD_MS after that sight
    await w.clock.advance(HOLD_MS - 2);
    expect(runsOf(edge)).toEqual([]);
    await w.clock.advance(1);
    expect(startsOf(edge)).toEqual([startedAt + LISTEN_MS - 1 + HOLD_MS]);
    expect(executor.workers).toHaveLength(3);
  });

  it('a pool just started beside one that has listened holds back for it, and the other takes at once what it is preferred for', async () => {
    const task = made('k');
    const [P, O] = byPreference(task);
    const [p] = await w.startedAll([P]);
    const o = w.pool(O);
    await settle();
    const listedAt = w.clock.now();
    list(task);
    await settle();
    expect(poolsOf(task)).toEqual([P]);
    expect(startsOf(task)).toEqual([listedAt]);
    await w.clock.advance(LAPSE_MS * 2);
    expect(poolsOf(task)).toEqual([P]);
    expect(o.executor.workers).toHaveLength(0);
    expect(p.executor.workers).toHaveLength(1);
  });

  it('the preferred pool does not accept the code: the other takes it HOLD_MS after first seeing it, not before', async () => {
    const task = made('k');
    const [P, O] = byPreference(task);
    const [p, o] = await w.startedAll([P, { queues: { [w.queue.url]: [PKG] satisfies Acceptance } }], [O]);
    const seenAt = w.clock.now();
    list(task);
    await settle();
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(HOLD_MS - 1);
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(1);
    expect(poolsOf(task)).toEqual([O]);
    expect(startsOf(task)).toEqual([seenAt + HOLD_MS]);
    expect(p.executor.workers).toHaveLength(0);
    expect(o.executor.workers).toHaveLength(1);
  });

  it('a pool stopped while it holds back leaves no timer behind', async () => {
    const task = made('k');
    const [P, O] = byPreference(task);
    const [p, o] = await w.startedAll([P, { queues: { [w.queue.url]: [PKG] satisfies Acceptance } }], [O]);
    list(task);
    await settle();
    await w.clock.advance(HOLD_MS / 2);
    // O first: P's last word, no slots, would have O rank the task anew and take it at once
    await Promise.all([o.pool.stop(), p.pool.stop()]);
    expect(w.clock.pending).toBe(0);
    expect(runsOf(task)).toEqual([]);
  });

  it('a pool that stops says it has no slots and is not waited for: the run it had, recorded lost, and work listed near it afterwards are taken by the other at once, whatever its slots', async () => {
    for (const slots of [1, 2]) {
      w = world();
      const [p, o] = await w.startedAll(['P', { slots }], ['O', { slots: 2 }]);
      const had = made('had');
      list(had, 'P');
      await settle();
      expect(poolsOf(had)).toEqual(['P']);
      const said = w.net.sent.length;
      const stopping = p.pool.stop();
      await settle();
      expect(w.net.sent.slice(said).filter((it) => it.message.type === 'serving').map((it) => it.message), `${slots} slots`).toMatchObject([
        { pool: 'P', slots: 0 },
      ]);
      p.executor.of(lastRun(had).id).events.done('finished anyway');
      await stopping;
      const lostAt = w.clock.now();
      expect(statuses(had), `${slots} slots`).toEqual(['lost', 'open']);
      expect(lastRun(had)).toMatchObject({ pool: 'O', start: lostAt });

      const after = made('after');
      list(after, 'P');
      await settle();
      expect(poolsOf(after), `${slots} slots`).toEqual(['O']);
      expect(startsOf(after)).toEqual([lostAt]);
      expect(o.executor.workers).toHaveLength(2);
    }
  });

  it('a task takeable again after a run of it ends is judged afresh: the other, which held back for a pool that has since stopped, takes it at once', async () => {
    const task = made('k');
    // P finds the task's document only when the test says, so O sees it takeable first
    const late = lateDocs([task.url]);
    const [p, o] = await w.startedAll(['P', { repo: late.docs }], ['O']);
    const listedAt = w.clock.now();
    list(task, 'P');
    await settle();
    expect(runsOf(task)).toEqual([]);
    late.arrive(task.url);
    await settle();
    expect(poolsOf(task)).toEqual(['P']);
    await w.clock.advance(HOLD_MS / 2);
    const stopping = p.pool.stop();
    await settle();
    p.executor.of(lastRun(task).id).events.done('finished anyway');
    await stopping;
    expect(statuses(task)).toEqual(['lost', 'open']);
    expect(lastRun(task)).toMatchObject({ pool: 'O', start: listedAt + HOLD_MS / 2 });
    expect(o.executor.workers).toHaveLength(1);
  });

  it('a pool gone without a word is waited for HOLD_MS for each task it is preferred for, until its last word lapses; after that, not at all', async () => {
    const [p, o] = await w.startedAll(['P'], ['O', { slots: 3 }]);
    // both beat at the next beat; P is heard then for the last time
    await w.clock.advance(BEAT_MS - LISTEN_MS + BEAT_MS);
    const lastWord = w.clock.now();
    expect(w.net.sent.filter((it) => it.message.type === 'serving' && it.message.pool === 'P').length).toBeGreaterThan(0);
    p.ears.mute = true;
    p.pool.serve({});

    const [early, edge, lapsed] = ['early', 'edge', 'lapsed'].map((key) => made(key));
    list(early, 'P');
    await settle();
    expect(runsOf(early)).toEqual([]);
    await w.clock.advance(HOLD_MS);
    expect(startsOf(early)).toEqual([lastWord + HOLD_MS]);

    await w.clock.advance(LAPSE_MS - 1 - HOLD_MS);
    list(edge, 'P');
    await settle();
    expect(runsOf(edge)).toEqual([]);
    await w.clock.advance(1);
    list(lapsed, 'P');
    await settle();
    expect(startsOf(lapsed)).toEqual([lastWord + LAPSE_MS]);
    await w.clock.advance(HOLD_MS - 1);
    expect(startsOf(edge)).toEqual([lastWord + LAPSE_MS - 1 + HOLD_MS]);
    expect(o.executor.workers).toHaveLength(3);
    expect(p.executor.workers).toHaveLength(0);
  });

  it('near wins over the hash when that pool may take the task', async () => {
    const task = made('k');
    const [P, O] = byPreference(task);
    const [p] = await w.startedAll([P], [O]);
    list(task, O);
    await settle();
    expect(poolsOf(task)).toEqual([O]);
    await w.clock.advance(LAPSE_MS * 2);
    expect(poolsOf(task)).toEqual([O]);
    expect(p.executor.workers).toHaveLength(0);
  });

  it('near is ignored when that pool is not a candidate: one nobody hears, one that lacks a need, one with no free slot as heard', async () => {
    // not heard at all
    {
      const task = made('k');
      const [P, O] = byPreference(task);
      await w.startedAll([P], [O]);
      list(task, 'a pool nobody hears');
      await settle();
      expect(poolsOf(task), 'near a pool nobody hears').toEqual([P]);
    }
    // heard, but lacking what the task needs
    {
      w = world();
      const task = made('k', { needs: ['unix'] });
      const [P, O] = byPreference(task);
      await w.startedAll([P, { has: ['unix'] }], [O]);
      list(task, O);
      await settle();
      expect(poolsOf(task), 'near a pool that lacks a need').toEqual([P]);
    }
    // heard, with no free slot
    {
      w = world();
      const task = made('k');
      const [P, O] = byPreference(task);
      await w.startedAll([P], [O]);
      const busy = made('busy', { needs: [`pool:${O}`] });
      list(busy);
      await settle();
      expect(poolsOf(busy)).toEqual([O]);
      list(task, O);
      await settle();
      expect(poolsOf(task), 'near a pool with no free slot').toEqual([P]);
    }
  });

  it('needs narrow the candidates before the choice: the pool the hash prefers lacks a need, and the other takes it at once', async () => {
    const task = made('k', { needs: ['unix'] });
    const [P, O] = byPreference(task);
    const [p] = await w.startedAll([P], [O, { has: ['unix'] }]);
    const listedAt = w.clock.now();
    list(task);
    await settle();
    expect(poolsOf(task)).toEqual([O]);
    expect(startsOf(task)).toEqual([listedAt]);
    await w.clock.advance(LAPSE_MS);
    expect(p.executor.workers).toHaveLength(0);
  });

  it('three pools agree on one: each of several tasks listed at once is taken once, at once, by the pool `preferred` names', async () => {
    const ids = ['A', 'B', 'C'];
    const started = await w.startedAll(...ids.map((id): [string, Partial<PoolOptions>] => [id, { slots: 10 }]));
    const pools = Object.fromEntries(ids.map((id, i) => [id, started[i]]));
    const tasks = Array.from({ length: 9 }, (_, i) => made(`k${i}`));
    list(tasks);
    await settle();
    const choices = tasks.map((task) => preferred(task.url, null, ids.map((pool) => ({ pool, slots: 10, busy: 0 }))));
    expect(tasks.map(poolsOf)).toEqual(choices.map((choice) => [choice]));
    await w.clock.advance(LAPSE_MS * 2);
    expect(tasks.map(poolsOf)).toEqual(choices.map((choice) => [choice]));
    for (const id of ids) {
      expect(pools[id].executor.workers.flatMap((worker) => worker.jobs.map((job) => job.taskUrl)).sort()).toEqual(
        tasks.filter((_, i) => choices[i] === id).map((task) => task.url).sort(),
      );
    }
  });

  // Pools on machines of their own, each with its own Repo: a document
  // written on one reaches another only when the test has it cross; what the
  // pools say on a channel is heard at once, unless the test makes a pool's
  // ears deaf, as if what is said were still on its way to it.
  const machines = async (specs: [string, { slots?: number }?][]) => {
    const repos = specs.map(() => new Repo({ network: [] } as any));
    const works = repos.map((repo) => countingWork(repo));
    const settleAll = async () => {
      do {
        await settle();
      } while (works.some((it) => it.underWay > 0));
    };
    const queue = repos[0].create<Queue>({ title: 'q', jobs: {} });
    const queues = [queue, ...repos.slice(1).map((repo) => repo.import<Queue>(A.save(queue.doc()), { docId: queue.documentId } as any))];
    const copies: DocHandle<any>[][] = [queues];
    const pools = specs.map(([id, more], i) => {
      const executor = new FakeExecutor(w.clock);
      const ears = w.net.ears();
      const pool = new Pool({ repo: repos[i] as Docs, id, name: id, slots: more?.slots ?? 1, has: [], executor, queues: { [queue.url]: 'any' }, ears, clock: w.clock });
      return { id, pool, executor, ears };
    });
    await settleAll();
    await w.clock.advance(LISTEN_MS);
    await settleAll();
    return {
      queue,
      pools,
      settleAll,
      /** A task, a copy on each machine, in the order of `specs`. */
      make(key: string, needs: string[] = []) {
        const first = repos[0].create<Task>({ importUrl: CODE, input: key, key, needs, runs: [] });
        const all = [first, ...repos.slice(1).map((repo) => repo.import<Task>(A.save(first.doc()), { docId: first.documentId } as any))] as DocHandle<Task>[];
        copies.push(all);
        return all;
      },
      /** Lists a task on the first machine's copy of the queue, as `ask` would; it crosses with the queue. */
      list(task: DocHandle<Task>, near?: string) {
        queue.change((doc) => listTask(doc, task.doc()!.key, { taskUrl: task.url, askedAt: ++askedAt, package: null, needs: task.doc()!.needs, near }));
      },
      /** The queue's copies cross, and those of each document given, or of every document when none is. */
      async cross(...only: DocHandle<any>[]) {
        for (const all of copies) {
          if (all === queues || only.length === 0 || all.some((it) => only.includes(it))) {
            for (const a of all) {
              for (const b of all) {
                if (a !== b) {
                  a.merge(b);
                }
              }
            }
          }
        }
        await settleAll();
      },
    };
  };

  it("two machines, a pool near-preferred but full as it last said: the other takes the task at once, and the full pool, its slot freed before the other's run has crossed, does not take it (it ranks itself as it said, as the other ranked it)", async () => {
    const m = await machines([['P'], ['O']]);
    const [p, o] = m.pools;
    const [busy] = m.make('busy', ['pool:P']);
    m.list(busy, 'P');
    await m.cross();
    expect(poolsOf(busy)).toEqual(['P']);
    expect(w.net.sent.filter((it) => it.message.type === 'serving' && it.message.pool === 'P').at(-1)?.message).toMatchObject({ slots: 1, busy: 1 });

    const [onP, onO] = m.make('task');
    const listedAt = w.clock.now();
    m.list(onP, 'P');
    await m.cross(m.queue);
    // O, which heard P full, takes it at once on its own machine
    expect(poolsOf(onO)).toEqual(['O']);
    expect(startsOf(onO)).toEqual([listedAt]);
    expect(poolsOf(onP)).toEqual([]);
    // P's slot frees a moment later, before O's run has reached P
    await w.clock.advance(HOLD_MS / 10);
    p.executor.of(lastRun(busy).id).events.done('busy');
    await m.settleAll();
    expect(poolsOf(onP)).toEqual([]);
    await w.clock.advance(HOLD_MS / 2);
    await m.cross();
    await w.clock.advance(LAPSE_MS);
    await m.cross();
    expect(poolsOf(onP)).toEqual(['O']);
    expect(p.executor.workers.flatMap((worker) => worker.jobs).map((job) => job.key)).toEqual(['busy']);
    expect(o.executor.workers).toHaveLength(1);
  });

  it("two machines, a pool's word that its slot has freed still on its way as a task near it is listed: each ranks itself first, so both take it at once; once the runs cross, the later gives way (the first crossing README names)", async () => {
    const m = await machines([['P'], ['O']]);
    const [p, o] = m.pools;
    const [busy] = m.make('busy', ['pool:P']);
    m.list(busy, 'P');
    await m.cross();
    expect(poolsOf(busy)).toEqual(['P']);
    // O has heard P full; P's word that its slot has freed does not reach O yet
    o.ears.deaf = true;
    p.executor.of(lastRun(busy).id).events.done('busy');
    await m.settleAll();
    const [onP, onO] = m.make('task');
    const listedAt = w.clock.now();
    m.list(onP, 'P');
    await m.cross(m.queue);
    o.ears.deaf = false;
    expect([poolsOf(onP), poolsOf(onO)]).toEqual([['P'], ['O']]);
    expect([startsOf(onP), startsOf(onO)]).toEqual([[listedAt], [listedAt]]);
    await m.cross();
    const aborted = [p, o].flatMap(({ executor }) => executor.workers.flatMap((worker) => worker.aborts.map((it) => it.reason)));
    expect(aborted).toEqual(['yielded']);
  });

  it('a pool held back for a pool that then stops: its last word, no slots, has the task ranked anew, and the other takes it the moment that word arrives', async () => {
    const task = made('k');
    const late = lateDocs([task.url]);
    const [p, o] = await w.startedAll(['P', { repo: late.docs }], ['O']);
    const listedAt = w.clock.now();
    list(task, 'P');
    await settle();
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(HOLD_MS / 4);
    await p.pool.stop();
    await settle();
    expect(poolsOf(task)).toEqual(['O']);
    expect(startsOf(task)).toEqual([listedAt + HOLD_MS / 4]);
    expect(o.executor.workers).toHaveLength(1);
  });

  it("two machines, the preferred pool free when it first saw the task but without the task's document until past the hold: it waits a second HOLD_MS, by when the other's run has reached it, and never takes it", async () => {
    // the checker's case: P sees the listing at once, its copy of the task only late
    const repoP = new Repo({ network: [] } as any);
    const repoO = new Repo({ network: [] } as any);
    const works = [countingWork(repoP), countingWork(repoO)];
    const settleBoth = async () => {
      do {
        await settle();
      } while (works.some((it) => it.underWay > 0));
    };
    const queueP = repoP.create<Queue>({ title: 'q', jobs: {} });
    const queueO = repoO.import<Queue>(A.save(queueP.doc()), { docId: queueP.documentId } as any);
    const taskO = repoO.create<Task>({ importUrl: CODE, input: null, key: 'k', needs: [], runs: [] });
    const taskP = repoP.import<Task>(A.save(taskO.doc()), { docId: taskO.documentId } as any);
    let away = true;
    const arrivals = new Set<(state: { state: string }) => void>();
    const docsP: Docs = {
      find: (url) => (url === taskO.url && away ? Promise.reject(new Error('unavailable')) : (repoP.find(url) as any)),
      flush: (ids) => repoP.flush(ids),
      findWithProgress: (url) => ({
        peek: () => ({ state: url === taskO.url && away ? 'unavailable' : 'ready' }),
        subscribe: (onState) => (arrivals.add(onState), () => void arrivals.delete(onState)),
      }),
    };
    const start = (id: string, repo: Docs) => {
      const executor = new FakeExecutor(w.clock);
      new Pool({ repo, id, name: id, slots: 1, has: [], executor, queues: { [queueP.url]: 'any' }, ears: w.net.ears(), clock: w.clock });
      return executor;
    };
    const p = start('P', docsP);
    const o = start('O', repoO as Docs);
    await settleBoth();
    await w.clock.advance(LISTEN_MS);
    const listedAt = w.clock.now();
    queueP.change((doc) => listTask(doc, 'k', { taskUrl: taskO.url, askedAt: 1, package: null, needs: [], near: 'P' }));
    queueO.merge(queueP);
    await settleBoth();
    expect(runsOf(taskO)).toEqual([]);
    await w.clock.advance(HOLD_MS);
    await settleBoth();
    expect(poolsOf(taskO)).toEqual(['O']);
    expect(startsOf(taskO)).toEqual([listedAt + HOLD_MS]);
    // P's copy arrives now, without O's run
    await w.clock.advance(HOLD_MS / 10);
    away = false;
    for (const arrived of [...arrivals]) {
      arrived({ state: 'ready' });
    }
    await settleBoth();
    expect(runsOf(taskP)).toEqual([]);
    await w.clock.advance(HOLD_MS - HOLD_MS / 10 - 1);
    expect(runsOf(taskP)).toEqual([]);
    taskP.merge(taskO);
    await settleBoth();
    await w.clock.advance(LAPSE_MS);
    expect(poolsOf(taskP)).toEqual(['O']);
    expect(p.workers).toHaveLength(0);
    expect(o.workers).toHaveLength(1);
  });

  for (const freed of ['within the hold', 'past the hold']) {
    it(`a pool alone never waits, full or not: free, it takes a task at once; full, it takes the next the moment a slot frees, ${freed}`, async () => {
      const [a] = await w.startedAll(['A']);
      const [first, next] = [made('first'), made('next')];
      const listedAt = w.clock.now();
      list(first);
      await settle();
      expect(startsOf(first)).toEqual([listedAt]);
      list(next);
      await settle();
      expect(runsOf(next)).toEqual([]);
      await w.clock.advance(freed === 'within the hold' ? HOLD_MS / 2 : 2 * HOLD_MS);
      expect(runsOf(next)).toEqual([]);
      const freedAt = w.clock.now();
      a.executor.of(lastRun(first).id).events.done('first');
      await settle();
      expect(poolsOf(next)).toEqual(['A']);
      expect(startsOf(next)).toEqual([freedAt]);
    });
  }

  for (const how of ['near it', 'preferred by the hash']) {
    it(`a pool still listening says it has no slots and is ranked by nobody, ${how}: the other takes the task at once, the listening pool never does, and at LISTEN_MS it says its slots`, async () => {
      const task = made('k');
      const [N, O] = byPreference(task);
      const [o] = await w.startedAll([O]);
      const n = w.pool(N, { slots: 2 });
      await settle();
      const saidByN = () => w.net.sent.filter((it) => it.message.type === 'serving' && it.message.pool === N).map((it) => it.message.slots);
      expect(saidByN()).toEqual([0]);
      const listedAt = w.clock.now();
      list(task, how === 'near it' ? N : undefined);
      await settle();
      expect(poolsOf(task)).toEqual([O]);
      expect(startsOf(task)).toEqual([listedAt]);
      await w.clock.advance(LISTEN_MS);
      expect(saidByN()).toEqual([0, 0, 2]);
      expect(w.net.sent.filter((it) => it.message.type === 'serving' && it.message.pool === N).at(-1)?.message).toMatchObject({ slots: 2 });
      await w.clock.advance(LAPSE_MS * 2);
      expect(poolsOf(task)).toEqual([O]);
      expect(n.executor.workers).toHaveLength(0);
      expect(o.executor.workers).toHaveLength(1);
    });
  }

  for (const how of ['stops', 'stops serving the queue']) {
    it(`a pool that ${how} releases every hold for it at once: three tasks held back for it, first seen at three moments, are taken by the other the moment its last word arrives`, async () => {
      const tasks = ['a', 'b', 'c'].map((key) => made(key));
      const late = lateDocs(tasks.map((task) => task.url));
      const [p, o] = await w.startedAll(['P', { repo: late.docs }], ['O', { slots: 3 }]);
      for (const task of tasks) {
        list(task, 'P');
        await settle();
        await w.clock.advance(HOLD_MS / 4);
      }
      expect(tasks.map(poolsOf)).toEqual([[], [], []]);
      const wordAt = w.clock.now();
      if (how === 'stops') {
        await p.pool.stop();
      } else {
        p.pool.serve({});
      }
      await settle();
      expect(w.net.sent.filter((it) => it.message.type === 'serving' && it.message.pool === 'P').at(-1)?.message).toMatchObject({ slots: 0 });
      expect(tasks.map(poolsOf)).toEqual([['O'], ['O'], ['O']]);
      expect(tasks.map(startsOf)).toEqual([[wordAt], [wordAt], [wordAt]]);
      expect(o.executor.workers).toHaveLength(3);
    });
  }

  it('a pool heard full after a task was ranked keeps the hold for it: the other waits out the HOLD_MS all the same, and takes the task then', async () => {
    const task = made('k');
    const late = lateDocs([task.url]);
    const [p, o] = await w.startedAll(['P', { repo: late.docs }], ['O']);
    const listedAt = w.clock.now();
    list(task, 'P');
    await settle();
    await w.clock.advance(HOLD_MS / 4);
    // P fills its slot with work only it may take, and says so
    const busy = made('busy', { needs: ['pool:P'] });
    list(busy);
    await settle();
    expect(poolsOf(busy)).toEqual(['P']);
    expect(w.net.sent.filter((it) => it.message.type === 'serving' && it.message.pool === 'P').at(-1)?.message).toMatchObject({ slots: 1, busy: 1 });
    await w.clock.advance(HOLD_MS - HOLD_MS / 4 - 1);
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(1);
    expect(poolsOf(task)).toEqual(['O']);
    expect(startsOf(task)).toEqual([listedAt + HOLD_MS]);
    expect(p.executor.workers).toHaveLength(1);
    expect(o.executor.workers).toHaveLength(1);
  });

  // Three pools on three machines, each ranked by `ranked`, and each set of
  // them that never takes the task (they accept only a package it is not in):
  // the first ranked of the rest takes it in its turn, rank × HOLD_MS after it
  // was listed, and no other ever does, though a run crosses between machines
  // only at the next half hold.
  for (let never = 0; never < 8; never++) {
    const ranks = [0, 1, 2].filter((rank) => never & (1 << rank));
    const taker = [0, 1, 2].find((rank) => !(never & (1 << rank)));
    const which = (rank: number) => ['the first', 'the second', 'the third'][rank];
    it(`three machines, ${ranks.length === 0 ? 'every pool taking' : `${ranks.map(which).join(' and ')} ranked never taking`}: ${taker === undefined ? 'nobody takes the task' : `${which(taker)} takes it ${taker} HOLD_MS after it was listed, and only it`}`, async () => {
      const m = await machines([['A'], ['B'], ['C']]);
      const copies = m.make('k');
      const order = ranked(copies[0].url, null, ['A', 'B', 'C'].map((pool) => ({ pool, slots: 1, busy: 0 })));
      for (const rank of ranks) {
        m.pools.find((it) => it.id === order[rank])!.pool.serve({ [m.queue.url]: [PKG] });
      }
      const listedAt = w.clock.now();
      m.list(copies[0]);
      await m.cross(m.queue);
      for (let step = 0; step < 8; step++) {
        await w.clock.advance(HOLD_MS / 2);
        await m.settleAll();
        await m.cross();
      }
      await w.clock.advance(LAPSE_MS);
      await m.cross();
      for (const copy of copies) {
        expect(poolsOf(copy)).toEqual(taker === undefined ? [] : [order[taker]]);
        expect(startsOf(copy)).toEqual(taker === undefined ? [] : [listedAt + taker * HOLD_MS]);
      }
      expect(m.pools.map((it) => it.executor.workers.length)).toEqual(m.pools.map((it) => (it.id === order[taker ?? -1] ? 1 : 0)));
    });
  }
});

describe('the pool, when something it uses throws', () => {
  it('leaves no timer set once stop() resolves, whatever its runs were doing', async () => {
    // One run with a log line waiting to be said, one being cancelled (its
    // kill is set), one that ignores the stop, and one whose start is still
    // being saved when the pool stops.
    const talking = w.ask('talking');
    const cancelling = w.ask('cancelling');
    const ignoring = w.ask('ignoring');
    const { pool, executor } = await w.started('A', { slots: 3 });
    await settle();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const saving = w.ask('saving');
    const docs: Docs = {
      find: (url) => w.repo.find(url) as any,
      flush: (ids) => (ids?.includes(saving.documentId) && runsOf(saving).length > 0 && !runsOf(saving)[0].status ? gate : w.repo.flush(ids)),
    };
    const second = await w.started('B', { slots: 1, repo: docs });
    await settle();
    expect(statuses(saving)).toEqual(['open']);

    stop(cancelling);
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
    expect(statuses(cancelling)).toEqual(['cancelled', 'cancelled']);
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
    const { pool } = await w.started('A');
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
    const { pool } = await w.started('A', { repo: docs });
    await settle();
    expect(runsOf(stuck)).toEqual([]);
    expect(statuses(good)).toEqual(['open']);
    expect(pool.busy).toBe(1);
  });

  it('a worker whose run() throws loses the run, is ended, and frees its slot; the task is taken again, and its third loss ends it failed with LOST_TOO_OFTEN', async () => {
    const executor = new ThrowingExecutor(w.clock, 'run');
    const { pool } = await w.started('A', { executor });
    const task = w.ask('k');
    await settle();
    expect(statuses(task)).toEqual(['lost', 'lost', 'failed']);
    for (const run of runsOf(task)) {
      expect(run.logs![0].message).toBe('its worker could not be handed it: run broke');
    }
    expect(taskError(task.doc(), allHeard)).toBe(LOST_TOO_OFTEN);
    expect(executor.workers).toHaveLength(3);
    for (const worker of executor.workers) {
      expect(worker.terminations).toHaveLength(1);
    }
    expect(pool.busy).toBe(0);
    const said = w.net.sent.length;
    await w.clock.advance(BEAT_MS * 3);
    expect(w.net.sent.slice(said).filter((it) => it.message.type === 'task progress')).toEqual([]);
  });

  it('a worker whose abort() throws is still ended GRACE_MS later, and its run recorded', async () => {
    const task = w.ask('k');
    const executor = new ThrowingExecutor(w.clock, 'abort');
    const { pool } = await w.started('A', { executor });
    await settle();
    const at = w.clock.now();
    stop(task);
    await settle();
    await w.clock.advance(GRACE_MS);
    expect(executor.workers[0].terminations).toEqual([at + GRACE_MS]);
    expect(statuses(task)).toEqual(['cancelled', 'cancelled']);
    expect(pool.busy).toBe(0);
  });

  it('a worker whose terminate() throws still has its run recorded and its slot freed', async () => {
    const executor = new ThrowingExecutor(w.clock, 'terminate');
    const { pool } = await w.started('A', { executor });
    const task = w.ask('k');
    await settle();
    stop(task);
    await settle();
    await w.clock.advance(GRACE_MS);
    expect(statuses(task)).toEqual(['cancelled', 'cancelled']);
    expect(pool.busy).toBe(0);
    // and it is not used again
    w.ask('next');
    await settle();
    expect(executor.workers).toHaveLength(2);
    expect(executor.workers[0].jobs).toHaveLength(1);
  });

  it('a send that throws (a listener that throws) keeps no run from starting, beating or ending', async () => {
    const ears = w.net.ears();
    const throwing: Ears = {
      listen: ears.listen,
      send: (handle, message) => {
        ears.send(handle, message);
        throw new Error('a listener threw');
      },
    };
    const { executor, pool } = await w.started('A', { ears: throwing });
    const task = w.ask('k');
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
    const { executor } = await w.started('A');
    const first = w.ask('first');
    const second = w.ask('second');
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

// A document that arrives after its listing
//
// Each followed document is, as far as hearing of its arrival goes, in one of
// two states: not listened for, or listened for through one subscription to
// the Repo's query for it. The tests below take every way into and out of the
// second: a refusal (the first, and the ones after it), the query turning
// ready (after the subscription, or before it), the document found by the
// beat instead, and the three ways a document is let go (a task no longer
// listed, a queue no longer served, stop()), with a refusal that comes after
// it was let go.

// The Repos a pool is handed answer findWithProgress as `Query` says. The
// compiler checks this; the functions are never called.
const repoQueries: ((url: AutomergeUrl) => Query)[] = [
  (url) => (null as unknown as Repo).findWithProgress(url),
  (url) => (null as unknown as NodeRepo).findWithProgress(url),
  (url) => (null as unknown as SiteRepo).findWithProgress(url),
];
void repoQueries;

/**
 * Docs over the world's Repo in which some documents have not arrived: `find`
 * refuses them as the Repo does, and `findWithProgress` says so, until
 * `arrive` says they are there. Subscriptions are counted.
 */
function lateDocs(late: string[], { withProgress = true } = {}) {
  const away = new Set(late);
  const listeners = new Map<string, Set<(state: { state: string }) => void>>();
  const counts = { subscribed: 0, unsubscribed: 0 };
  /** Finds held back while `hold` is on, refused by `refuseHeld`. */
  const held: (() => void)[] = [];
  let holding = false;
  const refusal = (url: string) => new Error(`Document ${url} is unavailable`);
  const docs: Docs = {
    find: (url) => {
      if (!away.has(url)) {
        return w.repo.find(url) as any;
      }
      if (holding) {
        return new Promise((_, reject) => held.push(() => reject(refusal(url))));
      }
      return Promise.reject(refusal(url));
    },
    flush: (ids) => w.repo.flush(ids),
  };
  if (withProgress) {
    docs.findWithProgress = (url) => ({
      peek: () => ({ state: away.has(url) ? 'unavailable' : 'ready' }),
      subscribe: (onState) => {
        counts.subscribed++;
        if (!listeners.has(url)) {
          listeners.set(url, new Set());
        }
        const mine = (state: { state: string }) => onState(state);
        listeners.get(url)!.add(mine);
        return () => {
          if (listeners.get(url)!.delete(mine)) {
            counts.unsubscribed++;
          }
        };
      },
    });
  }
  return {
    docs,
    counts,
    /** Subscriptions not yet ended. */
    live: () => counts.subscribed - counts.unsubscribed,
    /** The document is there; its query says so (loading, then ready) unless `silent`. */
    arrive(url: string, { silent = false } = {}) {
      away.delete(url);
      if (!silent) {
        for (const listener of [...(listeners.get(url) ?? [])]) {
          listener({ state: 'loading' });
          listener({ state: 'ready' });
        }
      }
    },
    /** Its query moves to `state` without the document arriving. */
    tell(url: string, state: string) {
      for (const listener of [...(listeners.get(url) ?? [])]) {
        listener({ state });
      }
    },
    hold: () => void (holding = true),
    refuseHeld() {
      holding = false;
      for (const refuse of held.splice(0)) {
        refuse();
      }
    },
  };
}

describe('the pool, when a document arrives after its listing', () => {
  it('takes a task whose document arrives after a refused find at once, without waiting a beat', async () => {
    const task = w.make('k');
    const late = lateDocs([task.url]);
    const { executor } = await w.started('A', { repo: late.docs });
    w.list(task);
    await settle();
    expect(runsOf(task)).toEqual([]);
    expect(late.live()).toBe(1);
    const t = w.clock.t;
    late.arrive(task.url);
    await settle();
    expect(w.clock.t).toBe(t);
    expect(runsOf(task)).toHaveLength(1);
    expect(executor.workers).toHaveLength(1);
    expect(late.live()).toBe(0);
  });

  it('takes it at once when it arrived between the refusal and the subscription', async () => {
    const task = w.make('k');
    const late = lateDocs([task.url]);
    const find = late.docs.find;
    // The refusal is the last thing heard before the document is there: no state comes after it.
    late.docs.find = (url) => {
      const found = find(url);
      late.arrive(url, { silent: true });
      return found as any;
    };
    await w.started('A', { repo: late.docs });
    w.list(task);
    await settle();
    expect(runsOf(task)).toHaveLength(1);
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
  });

  it('subscribes once however many times the find is refused', async () => {
    const task = w.make('k');
    const late = lateDocs([task.url]);
    await w.started('A', { repo: late.docs });
    w.list(task);
    await settle();
    await w.clock.advance(BEAT_MS * 3);
    expect(runsOf(task)).toEqual([]);
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 0 });
    late.arrive(task.url);
    await settle();
    expect(runsOf(task)).toHaveLength(1);
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
  });

  it('stops listening when the beat finds the document first', async () => {
    const task = w.make('k');
    const late = lateDocs([task.url]);
    await w.started('A', { repo: late.docs });
    // listed as a beat comes, so that the next beat is one beat after the refusal
    await w.clock.advance(2 * BEAT_MS - LISTEN_MS);
    w.list(task);
    await settle();
    late.arrive(task.url, { silent: true });
    await w.clock.advance(BEAT_MS);
    expect(runsOf(task)).toHaveLength(1);
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
  });

  it('stops listening for a task no longer listed', async () => {
    const task = w.ask('k');
    const late = lateDocs([task.url]);
    w.pool('A', { repo: late.docs });
    await settle();
    expect(late.live()).toBe(1);
    w.queue.change((doc) => void delete doc.jobs.k);
    await settle();
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
    late.arrive(task.url);
    await settle();
    expect(runsOf(task)).toEqual([]);
  });

  it('stops listening for a queue no longer served', async () => {
    const task = w.ask('k');
    const late = lateDocs([w.queue.url]);
    const { pool } = w.pool('A', { repo: late.docs });
    await settle();
    expect(late.live()).toBe(1);
    pool.serve({});
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
    late.arrive(w.queue.url);
    await settle();
    expect(runsOf(task)).toEqual([]);
  });

  it('stops listening for everything on stop()', async () => {
    const other = w.repo.create<Queue>({ title: 'other', jobs: {} });
    const task = w.ask('k', { queue: other });
    const late = lateDocs([w.queue.url, task.url]);
    const { pool } = w.pool('A', { repo: late.docs, queues: { [w.queue.url]: 'any', [other.url]: 'any' } });
    await settle();
    expect(late.counts).toEqual({ subscribed: 2, unsubscribed: 0 });
    await pool.stop();
    expect(late.counts).toEqual({ subscribed: 2, unsubscribed: 2 });
    late.arrive(task.url);
    late.arrive(w.queue.url);
    await settle();
    expect(runsOf(task)).toEqual([]);
  });

  it('does not listen for a task let go while its find was under way', async () => {
    const task = w.ask('k');
    const late = lateDocs([task.url]);
    late.hold();
    w.pool('A', { repo: late.docs });
    await settle();
    w.queue.change((doc) => void delete doc.jobs.k);
    await settle();
    late.refuseHeld();
    await settle();
    expect(late.counts.subscribed).toBe(0);
  });

  it('does not listen for a document whose find was under way when the pool stopped', async () => {
    w.ask('k');
    const late = lateDocs([w.queue.url]);
    late.hold();
    const { pool } = w.pool('A', { repo: late.docs });
    await settle();
    await pool.stop();
    late.refuseHeld();
    await settle();
    expect(late.counts.subscribed).toBe(0);
  });

  it('serves a queue whose document arrives late as soon as it arrives: says so, and takes what it lists LISTEN_MS later, having only begun to listen', async () => {
    const task = w.ask('k');
    const late = lateDocs([w.queue.url]);
    const { executor } = w.pool('A', { repo: late.docs });
    await settle();
    expect(runsOf(task)).toEqual([]);
    const serving = () => w.net.sent.filter((it) => it.message.type === 'serving');
    expect(serving()).toEqual([]);
    const t = w.clock.t;
    late.arrive(w.queue.url);
    await settle();
    expect(w.clock.t).toBe(t);
    expect(serving().map((it) => it.message.busy)).toEqual([0]);
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(LISTEN_MS - 1);
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(1);
    // as it is found, with no slots; at the beat; at LISTEN_MS, with its slots; and as it takes the task
    expect(serving().map((it) => [it.message.slots, it.message.busy])).toEqual([[0, 0], [0, 0], [1, 0], [1, 1]]);
    expect(runsOf(task)).toHaveLength(1);
    expect(executor.workers).toHaveLength(1);
    expect(late.live()).toBe(0);
  });

  it('with a Repo that cannot say a document has arrived, looks again a beat after the refusal', async () => {
    const task = w.make('k');
    const late = lateDocs([task.url], { withProgress: false });
    await w.started('A', { repo: late.docs });
    // listed as a beat comes, so that the next beat is one beat after the refusal
    await w.clock.advance(2 * BEAT_MS - LISTEN_MS);
    w.list(task);
    await settle();
    late.arrive(task.url);
    await w.clock.advance(BEAT_MS - 1);
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(1);
    expect(runsOf(task)).toHaveLength(1);
  });

  it('with a Repo whose findWithProgress throws, looks again a beat after the refusal', async () => {
    const task = w.make('k');
    const late = lateDocs([task.url]);
    late.docs.findWithProgress = () => {
      throw new Error('Invalid AutomergeUrl');
    };
    await w.started('A', { repo: late.docs });
    // listed as a beat comes, so that the next beat is one beat after the refusal
    await w.clock.advance(2 * BEAT_MS - LISTEN_MS);
    w.list(task);
    await settle();
    late.arrive(task.url);
    await w.clock.advance(BEAT_MS - 1);
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(1);
    expect(runsOf(task)).toHaveLength(1);
  });

  it('goes on listening, once, through states other than ready', async () => {
    const task = w.make('k');
    const late = lateDocs([task.url]);
    const finds = counted(late.docs);
    await w.started('A', { repo: late.docs });
    w.list(task);
    await settle();
    const asked = finds.count;
    for (const state of ['loading', 'unavailable', 'failed', 'unavailable']) {
      late.tell(task.url, state);
    }
    await settle();
    expect(finds.count).toBe(asked);
    expect(runsOf(task)).toEqual([]);
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 0 });
    late.arrive(task.url);
    await settle();
    expect(runsOf(task)).toHaveLength(1);
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
  });

  it('listens anew, and only anew, for a task let go and then listed again', async () => {
    const task = w.make('k');
    const late = lateDocs([task.url]);
    await w.started('A', { repo: late.docs });
    w.list(task);
    await settle();
    w.queue.change((doc) => void delete doc.jobs.k);
    await settle();
    expect(late.counts).toEqual({ subscribed: 1, unsubscribed: 1 });
    w.queue.change((doc) => listTask(doc, 'k', { taskUrl: task.url, askedAt: 99, package: null }));
    await settle();
    expect(late.counts).toEqual({ subscribed: 2, unsubscribed: 1 });
    late.arrive(task.url);
    await settle();
    expect(runsOf(task)).toHaveLength(1);
    expect(late.counts).toEqual({ subscribed: 2, unsubscribed: 2 });
  });

  it('takes nothing and finds nothing when a document arrives while stop() waits for a run', async () => {
    w.ask('a-running');
    const task = w.ask('b-late');
    const late = lateDocs([task.url]);
    const finds = counted(late.docs);
    const { pool } = w.pool('A', { repo: late.docs });
    await settle();
    expect(late.live()).toBe(1);
    const stopping = pool.stop();
    await settle();
    const asked = finds.count;
    late.arrive(task.url);
    await settle();
    expect(finds.count).toBe(asked);
    expect(runsOf(task)).toEqual([]);
    await w.clock.advance(GRACE_MS);
    await stopping;
    expect(late.live()).toBe(0);
    expect(runsOf(task)).toEqual([]);
  });
});

/** Counts the calls of a Docs' find from now on. */
function counted(docs: Docs) {
  const it = { count: 0 };
  const find = docs.find;
  docs.find = (url) => {
    it.count++;
    return find(url);
  };
  return it;
}
