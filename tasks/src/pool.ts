// A pool: the one set of workers a machine has. It follows the queues it
// serves and the tasks they list, takes a task when it has a free slot and
// the rules say it may, runs it in a run worker it owns, says that the run is
// going on, stops it when the rules say it must, and records how it went.
// Every decision is a rule in task-rules.js; this file only applies them to
// the documents and to what has been heard.
//
// It takes only work it has what for (`has`, see `satisfies`), and of what it
// may take, it holds back for the task's preferred pool: it hears the other
// pools serving each queue (their `serving`, within the lapse), takes a task
// at once when `preferred` names it, and otherwise only once it has seen the
// task takeable for HOLD_MS. A pool that hears nobody else is always the one.
// So that the others choose from what is so, it says `serving` every beat,
// whenever how many of its slots are busy changes, and at once to a pool it
// hears for the first time; and it says which tasks it has runs of, so that
// a pool that hears it full never reads that as room for a task it is
// running already, and leaves alone what another says it runs before the
// task's document shows that run.
//
// It writes three things and nothing else: a run appended when it takes a
// task, that run completed when it is over, and an entry deleted when its
// task has ended. Whether a run is going on is said on the task's channel
// (`task progress`), never written.
//
// It runs anywhere: the documents come from anything with `find` and
// `flush` (and `findWithProgress`, to hear at once that a document it could
// not find has arrived), messages go through `ears`, time comes from `clock`, and the code
// runs in whatever the executor starts (a worker thread in Node, a dedicated
// worker in a browser).

import type { AutomergeUrl, DocumentId } from '@automerge/automerge-repo/slim';
import { accepts, acceptsPackage, type Acceptance } from './acceptance';
import * as channel from './task-client.js';
import type { RunProgressMessage, ServingMessage } from './task-client.js';
import {
  BEAT_MS,
  claimRun,
  delistTask,
  endRun,
  gone,
  GRACE_MS,
  Hearing,
  HOLD_MS,
  isOpen,
  LAPSE_MS,
  LOST_TOO_OFTEN,
  MAX_LOG_LINES,
  mayClaim,
  mayDelist,
  named,
  orphans,
  preferred,
  recordsOf,
  satisfies,
  stopReason,
  waitingWork,
} from './task-rules.js';
import type { Heard, LogLine, Queue, RunStatus, Task, Work } from './task-rules.js';

/** Who sent a message and its number in that sender's series (see task-client.js). */
type Stamp = { from: string; seq: number };

/** Why a run's code is told to stop: the first two are rules.ts's, `stopping` is the pool shutting down. */
export type StopReason = 'cancelled' | 'yielded' | 'stopping';

/** What a run worker is handed: the code and input exactly as the pool read them when it took the task. */
export interface Job {
  taskUrl: AutomergeUrl;
  runId: string;
  importUrl: string;
  input: unknown;
  key: string;
}

/** What a run worker says, each delivered on the pool's thread. */
export interface WorkerEvents {
  /** A line its code logged. */
  log(message: string): void;
  /** How far along its code says it is. */
  progress(value: unknown): void;
  /** Its code returned this, and what the code wrote is saved. */
  done(result: unknown): void;
  /** Its code threw, or would not load. */
  threw(message: string): void;
  /** The worker is gone, expected or not. Said at most once. */
  exit(): void;
}

export interface RunWorker {
  /** Imports the job's code and calls it. Called only while the worker has no job. */
  run(job: Job): void;
  /** Aborts the code's signal with this reason. The code may still finish; the pool ignores what it says. */
  abort(reason: StopReason): void;
  /** Ends the worker at once, whatever its code is doing. It says nothing after this but, perhaps, `exit`. */
  terminate(): void;
}

/** Starts run workers: a worker thread in Node, a dedicated worker in a browser. */
export interface Executor {
  /** Starts one run worker, which tells `events` what it says. It is given one job at a time. */
  start(events: WorkerEvents): RunWorker;
}

/** The part of a DocHandle a pool uses. */
export interface Handle<T> {
  readonly url: AutomergeUrl;
  readonly documentId: DocumentId;
  doc(): T | undefined;
  change(fn: (doc: T) => void): void;
  on(event: 'change' | 'delete', fn: () => void): unknown;
  off(event: 'change' | 'delete', fn: () => void): unknown;
  isDeleted?(): boolean;
}

/**
 * The part of a Repo's query for one document (what `findWithProgress`
 * returns) that a pool uses: the state it is in now, and each state it moves
 * to after `subscribe`, until the function `subscribe` returns is called.
 */
export interface Query {
  peek(): { state: string };
  subscribe(onState: (state: { state: string }) => void): () => void;
}

/** The part of a Repo a pool uses. */
export interface Docs {
  find<T>(url: AutomergeUrl): Promise<Handle<T>>;
  flush(documents?: DocumentId[]): Promise<void>;
  /**
   * The Repo's query for a document, through which the pool hears that one
   * it could not find has arrived. Without it, such a document is looked for
   * again a beat later.
   */
  findWithProgress?(url: AutomergeUrl): Query;
}

/** How messages are sent and heard on a document's channel (task-client.js, unless a test hands its own). */
export interface Ears {
  send(handle: Handle<any>, message: Stamp & { type: string }): void;
  listen(handle: Handle<any>, onMessage: (message: any) => void): () => void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(timer: unknown): void;
}

export interface PoolOptions {
  repo: Docs;
  /** Outlives restarts: a pool owns every run bearing its id. */
  id: string;
  /** For people. */
  name: string;
  slots: number;
  /**
   * What this machine has, as plain labels (`node`, `browser`, `unix`): it
   * takes only work that needs nothing else. `pool:<id>` is added.
   */
  has: string[];
  executor: Executor;
  /** The queues it serves, and the code it runs from each. Changed later with `serve`. */
  queues?: Record<AutomergeUrl, Acceptance>;
  ears?: Ears;
  clock?: Clock;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
};

const realEars: Ears = { send: channel.send, listen: channel.listen };

/** At the least, how long between two messages about a run's logs and progress. */
const SAY_EVERY_MS = 100;

/**
 * A document followed: its handle once found. One that cannot be found yet is
 * found again the moment the Repo says it has arrived, or else a beat later.
 */
interface Followed<T> {
  handle?: Handle<T>;
  loading?: boolean;
  retryAt?: number;
  /** Stops listening to the document's handle and channel, once it is found. */
  stop?: () => void;
  /** Stops listening for its arrival, while it is listened for (see `awaitArrival`). */
  unawait?: () => void;
  /** Clears the timer that looks again once a hold for the preferred pool is over, while one is set. */
  unhold?: () => void;
}

/** Lets go of a followed document: nothing it listens to calls the pool again. */
function letGo(followed: Followed<unknown>) {
  followed.stop?.();
  followed.stop = undefined;
  followed.unawait?.();
  followed.unawait = undefined;
  followed.unhold?.();
}

/**
 * A task followed, with what has been heard of its runs. Each task has its
 * own: a copy of a task carries the original's runs, names and all, and what
 * is heard of the original says nothing about the copy.
 */
interface FollowedTask extends Followed<Task> {
  hearing: Hearing;
  /** When this pool first saw the task takeable, on its own clock, until it is no longer. */
  takeableSince?: number;
}

/** Another pool heard serving a queue: what it last said of itself, and when, on this pool's clock. */
interface HeardPool {
  has: string[];
  slots: number;
  busy: number;
  /** The tasks it said it has runs of. */
  running: string[];
  at: number;
}

interface Served extends Followed<Queue> {
  acceptance: Acceptance;
  /** The other pools heard serving it, by id. */
  heard: Map<string, HeardPool>;
}

interface Slot {
  worker: RunWorker;
  run: Running | null;
  /** Terminated or exited: it says nothing more that counts, and is never handed a job. */
  gone: boolean;
}

interface Running {
  id: string;
  key: string;
  task: Handle<Task>;
  queue: Handle<Queue>;
  /** Null until the run's start is saved and its job handed over. */
  slot: Slot | null;
  /** Why it is being stopped, once that is decided; its status is this, whatever its code does. */
  stopping: StopReason | null;
  /** Its completion has been written: nothing more is done for it. */
  over: boolean;
  logs: LogLine[];
  unsaid: LogLine[];
  progress: unknown;
  progressNew: boolean;
  beat?: unknown;
  sayTimer?: unknown;
  kill?: unknown;
  finished: Promise<void>;
  finish: () => void;
}

export class Pool {
  private readonly clock: Clock;
  private readonly ears: Ears;
  private readonly queues = new Map<AutomergeUrl, Served>();
  private readonly tasks = new Map<AutomergeUrl, FollowedTask>();
  private readonly runs = new Map<string, Running>();
  private idle: Slot[] = [];
  private stopped = false;
  private reviewing = false;
  private again = false;
  private readonly tick: unknown;
  private readonly stamp = channel.stamper();
  /** What this pool has: what it was told, and its own `pool:<id>`. */
  readonly has: string[];

  constructor(private readonly options: PoolOptions) {
    this.clock = options.clock ?? realClock;
    this.ears = options.ears ?? realEars;
    this.has = [...new Set([...options.has, `pool:${options.id}`])];
    // The beat: says the pool serves, and looks again, so that a run gone
    // unheard is noticed without anything changing.
    this.tick = this.clock.setInterval(() => {
      for (const queue of this.queues.values()) {
        this.sayServing(queue.handle);
      }
      this.review();
    }, BEAT_MS);
    this.serve(options.queues ?? {});
  }

  /** How many slots have a run in them, from the moment it is taken until its end is saved. */
  get busy() {
    return this.runs.size;
  }

  /**
   * Which runs of one task this pool counts as heard: its own run of that
   * task always, and the rest as that task's channel has said.
   */
  heardOf(taskUrl: AutomergeUrl): Heard {
    const hearing = this.tasks.get(taskUrl)?.hearing;
    return (runId) =>
      this.runs.get(runId)?.task.url === taskUrl || (hearing ? hearing.heard(runId) : true);
  }

  /** Sets the queues served. A run from a queue no longer served goes on to its end. */
  serve(queues: Record<AutomergeUrl, Acceptance>) {
    for (const [url, queue] of this.queues) {
      if (!(url in queues)) {
        letGo(queue);
        this.queues.delete(url);
      }
    }
    for (const [url, acceptance] of Object.entries(queues) as [AutomergeUrl, Acceptance][]) {
      const queue = this.queues.get(url);
      if (queue) {
        queue.acceptance = acceptance;
      } else {
        this.queues.set(url, { acceptance, heard: new Map() });
      }
    }
    this.review();
  }

  /**
   * Takes nothing more, stops every run with `stopping`, which records it
   * `lost` (killing its worker GRACE_MS later if need be), saves, and resolves.
   */
  async stop() {
    if (!this.stopped) {
      this.stopped = true;
      this.clock.clearInterval(this.tick);
      for (const run of this.runs.values()) {
        this.stopRun(run, 'stopping');
      }
    }
    await Promise.all([...this.runs.values()].map((run) => run.finished));
    for (const slot of this.idle) {
      this.endWorker(slot);
    }
    this.idle = [];
    for (const followed of [...this.queues.values(), ...this.tasks.values()]) {
      letGo(followed);
    }
    await this.options.repo.flush().catch((error) => console.error('pool: saving on stop failed', error));
  }

  /** Looks at everything again. Called whenever a document or what is heard changes, and every beat. */
  private review = () => {
    // A change this makes calls back here at once; it is looked at once this pass is done.
    if (this.reviewing) {
      this.again = true;
      return;
    }
    this.reviewing = true;
    try {
      do {
        this.again = false;
        this.reviewOnce();
      } while (this.again);
    } finally {
      this.reviewing = false;
    }
  };

  // Anyone can write a queue or a task, so each document, run and piece of
  // work is looked at on its own (`attempt`): one that throws spoils only its
  // own part of the pass.
  private reviewOnce() {
    const { id, slots } = this.options;
    const now = this.clock.now();

    // What the served queues list, in the order to take it. A queue whose document is gone lists nothing.
    const listed: { work: Work; queue: Handle<Queue>; served: Served }[] = [];
    for (const [url, served] of this.queues) {
      if (!served.handle) {
        this.load(url, served, () => this.queues.get(url) === served, false);
        continue;
      }
      for (const work of waitingWork(served.handle.isDeleted?.() ? undefined : served.handle.doc())) {
        listed.push({ work, queue: served.handle, served });
      }
    }
    // waitingWork's order, across queues
    listed.sort(
      ({ work: a }, { work: b }) =>
        (Number(a.askedAt) || 0) - (Number(b.askedAt) || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );

    // Follow every task listed and every task this pool has a run of; let go of the rest.
    const wanted = new Set<AutomergeUrl>(listed.map(({ work }) => work.taskUrl as AutomergeUrl));
    for (const run of this.runs.values()) {
      wanted.add(run.task.url);
    }
    for (const url of wanted) {
      if (!this.tasks.has(url)) {
        this.tasks.set(url, { hearing: new Hearing(this.clock) });
      }
    }
    for (const [url, followed] of this.tasks) {
      if (!wanted.has(url)) {
        letGo(followed);
        this.tasks.delete(url);
        continue;
      }
      if (!followed.handle) {
        this.load(url, followed, () => this.tasks.get(url) === followed, true);
        continue;
      }
      const handle = followed.handle;
      attempt('reading a task', () => {
        const task = handle.isDeleted?.() ? undefined : handle.doc();
        followed.hearing.saw(task?.runs);
        // Its own past: runs it started and no longer has. A task followed
        // without a run of this pool's is one a served queue lists.
        for (const run of orphans(task, id, (runId) => this.runs.get(runId)?.task.url === url)) {
          handle.change((doc) => {
            const status = gone(doc, run.id, 'this');
            const logs = status === 'failed' ? [{ timestampMillis: now, message: LOST_TOO_OFTEN }] : [];
            endRun(doc, run.id, { status, end: now, logs });
          });
        }
      });
    }

    for (const run of this.runs.values()) {
      if (!run.stopping && !run.over) {
        attempt('deciding whether to stop a run', () => {
          const reason = this.stopFor(run);
          if (reason) {
            this.stopRun(run, reason);
          }
        });
      }
    }

    for (const { work, queue, served } of listed) {
      const followed = this.tasks.get(work.taskUrl as AutomergeUrl);
      const handle = followed?.handle;
      if (!followed || !handle) {
        continue;
      }
      attempt('looking at a task its queue lists', () => {
        const task = handle.isDeleted?.() ? undefined : handle.doc();
        if (!task) {
          return;
        }
        const is = named(queue.doc(), work.key, work.taskUrl);
        const heard = this.heardOf(work.taskUrl as AutomergeUrl);
        const { acceptance } = served;
        if (mayDelist(task, is)) {
          queue.change((doc) => delistTask(doc, work.key, work.taskUrl));
        }
        // Whose code it is and what it needs are asked of the entry first
        // and of the task last (see `mayClaim`). A task that has ended is not
        // wanted, so `mayClaim` refuses one just let go above. One that a
        // pool heard within the lapse says it runs is left to it: its run is
        // on its way, and the word of it is quicker than the document.
        const takeable =
          !this.stopped &&
          acceptsPackage(acceptance, work.package) &&
          satisfies(this.has, work.needs) &&
          mayClaim(task, id, is, heard) &&
          accepts(acceptance, task.importUrl) &&
          satisfies(this.has, task.needs) &&
          !this.runElsewhere(served, task, work.taskUrl, now);
        if (!takeable) {
          followed.takeableSince = undefined;
          followed.unhold?.();
          return;
        }
        followed.takeableSince ??= now;
        if (this.runs.size < slots && this.mayTakeNow(followed, work, served, task, now)) {
          this.claim(work, queue, handle, task);
        }
      });
    }
  }

  /**
   * Whether a pool heard serving the queue within the lapse says it has a run
   * of this task that the task's document does not show over. Its word counts
   * only until the document catches up: once the document shows that pool's
   * runs of the task and every one of them completed (a pool that stopped
   * records its run lost and says nothing more), the word is older than the
   * document, and the task is as takeable as the rules read it.
   */
  private runElsewhere(served: Served, task: Task, taskUrl: string, now: number): boolean {
    const runs = recordsOf(task);
    for (const [id, pool] of served.heard) {
      if (now - pool.at >= LAPSE_MS || !pool.running.includes(taskUrl)) {
        continue;
      }
      const its = runs.filter((run) => run.pool === id);
      if (its.length === 0 || its.some(isOpen)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether to take a task this pool may take, now: at once if `preferred`
   * names this pool among the pools heard serving the queue within the lapse
   * that have what the task needs (this pool counted with its own free
   * slots), and otherwise once it has been takeable for HOLD_MS, with a timer
   * set to look again then. The task's own needs narrow the others; the
   * entry's `near` is the asker's word for which pool it is next to.
   */
  private mayTakeNow(followed: FollowedTask, work: Work, served: Served, task: Task, now: number): boolean {
    const { id, slots } = this.options;
    const others = [...served.heard]
      .filter(([, pool]) => now - pool.at < LAPSE_MS && satisfies(pool.has, task.needs))
      .map(([pool, { slots, busy }]) => ({ pool, slots, busy }));
    const choice = preferred(work.taskUrl, work.near ?? null, [{ pool: id, slots, busy: this.runs.size }, ...others]);
    const waited = now - (followed.takeableSince ?? now);
    if (choice === id || waited >= HOLD_MS) {
      followed.unhold?.();
      return true;
    }
    if (!followed.unhold) {
      const timer = this.clock.setTimeout(() => {
        followed.unhold = undefined;
        this.review();
      }, HOLD_MS - waited);
      followed.unhold = () => {
        this.clock.clearTimeout(timer);
        followed.unhold = undefined;
      };
    }
    return false;
  }

  /**
   * Finds a document, unless that is under way, or it failed less than a beat
   * ago and the Repo has not said since that it has arrived.
   */
  private load<T>(url: AutomergeUrl, followed: Followed<T>, still: () => boolean, isTask: boolean) {
    if (this.stopped || followed.loading || this.clock.now() < (followed.retryAt ?? 0)) {
      return;
    }
    followed.loading = true;
    this.options.repo.find<T>(url).then(
      (handle) => {
        followed.loading = false;
        if (!still() || this.stopped) {
          return;
        }
        followed.unawait?.();
        followed.unawait = undefined;
        followed.handle = handle;
        const onChange = () => this.review();
        handle.on('change', onChange);
        handle.on('delete', onChange);
        const unlisten = isTask
          ? this.ears.listen(handle, (message) => this.onTaskMessage(url, message))
          : this.ears.listen(handle, (message) => this.onQueueMessage(followed as unknown as Served, handle as Handle<any>, message));
        followed.stop = () => {
          handle.off('change', onChange);
          handle.off('delete', onChange);
          unlisten?.();
        };
        if (!isTask) {
          this.sayServing(handle as Handle<any>);
        }
        this.review();
      },
      () => {
        // not found yet: never an error, only something to try again
        followed.loading = false;
        followed.retryAt = this.clock.now() + BEAT_MS;
        if (still() && !this.stopped) {
          this.awaitArrival(url, followed);
        }
      },
    );
  }

  /**
   * Finds a document again the moment it arrives. A listing can reach the
   * pool before the listed task's document can be fetched; the refused find
   * has asked the sync server for it already, and the server sends it when it
   * has it without being asked again, so the Repo's query for it turns ready
   * by itself. The pool listens to that query, once per document, from its
   * first refusal until it is found or let go; the beat stays as the fallback
   * for a Repo that cannot say.
   */
  private awaitArrival<T>(url: AutomergeUrl, followed: Followed<T>) {
    if (followed.unawait || !this.options.repo.findWithProgress) {
      return;
    }
    let query: Query;
    try {
      query = this.options.repo.findWithProgress(url);
    } catch {
      // A url the Repo cannot read never arrives; the beat goes on refusing it, as find does.
      return;
    }
    const arrived = () => {
      followed.unawait?.();
      followed.unawait = undefined;
      followed.retryAt = 0;
      this.review();
    };
    followed.unawait = query.subscribe((state) => {
      if (state?.state === 'ready') {
        arrived();
      }
    });
    // It may have arrived between the refusal and now, and then no state comes after.
    if (query.peek().state === 'ready') {
      arrived();
    }
  }

  /** A pool's word, on one task's channel, that a run of that task is going on. */
  private onTaskMessage(taskUrl: AutomergeUrl, message: Partial<RunProgressMessage> | null) {
    if (message?.type === 'task progress' && typeof message.run === 'string') {
      this.tasks.get(taskUrl)?.hearing.heardFrom(message.run);
      this.review();
    }
  }

  /**
   * Another pool's word, on a queue's channel, that it serves the queue. One
   * heard for the first time, or again after a lapse, is told at once that
   * this pool serves it too, so that a pool just started knows whom to hold
   * back for within a crossing rather than a beat.
   */
  private onQueueMessage(served: Served, handle: Handle<any>, message: Partial<ServingMessage> | null) {
    if (message?.type !== 'serving' || typeof message.pool !== 'string' || message.pool === this.options.id) {
      return;
    }
    if (this.queues.get(handle.url) !== served) {
      return; // a queue no longer served
    }
    const now = this.clock.now();
    const before = served.heard.get(message.pool);
    served.heard.set(message.pool, {
      has: Array.isArray(message.has) ? message.has.filter((label): label is string => typeof label === 'string') : [],
      slots: Number(message.slots) || 0,
      busy: Number(message.busy) || 0,
      running: Array.isArray(message.running) ? message.running.filter((url): url is string => typeof url === 'string') : [],
      at: now,
    });
    if (!before || now - before.at >= LAPSE_MS) {
      this.sayServing(handle);
    }
    this.review();
  }

  /** Why a run of this pool's must stop, or null. A task whose document is gone is wanted by nobody. */
  private stopFor(run: Running): StopReason | null {
    const task = run.task.isDeleted?.() ? undefined : run.task.doc();
    if (!task) {
      return 'cancelled';
    }
    const queue = run.queue.isDeleted?.() ? undefined : run.queue.doc();
    return stopReason(task, run.id, named(queue, run.key, run.task.url), this.heardOf(run.task.url));
  }

  /** What a stopped run is recorded as: its reason, and for a pool that is itself stopping, a run it no longer has. */
  private statusOf(run: Running, reason: StopReason): RunStatus {
    return reason === 'stopping' ? this.lostAs(run) : reason;
  }

  /**
   * What a run this pool no longer has is recorded as (see `gone`): the pool
   * is stopping, or the run's worker died or could not be started. None of
   * these is the task's doing, so the run is lost, not failed; when it is the
   * last loss a task may have, its log says so.
   */
  private lostAs(run: Running): RunStatus {
    const task = run.task.isDeleted?.() ? undefined : run.task.doc();
    const queue = run.queue.isDeleted?.() ? undefined : run.queue.doc();
    const status = task ? gone(task, run.id, named(queue, run.key, run.task.url)) : 'lost';
    if (status === 'failed') {
      this.log(run, LOST_TOO_OFTEN);
    }
    return status;
  }

  /**
   * Takes a task: appends a run, saves it, and only then hands the job, as
   * read now, to a run worker. The slot is the run's from this moment.
   */
  private claim(work: Work, queue: Handle<Queue>, task: Handle<Task>, read: Task) {
    let finish!: () => void;
    const run: Running = {
      id: crypto.randomUUID(),
      key: work.key,
      task,
      queue,
      slot: null,
      stopping: null,
      over: false,
      logs: [],
      unsaid: [],
      progress: undefined,
      progressNew: false,
      finished: new Promise<void>((resolve) => (finish = resolve)),
      finish: () => finish(),
    };
    const job: Job = { taskUrl: task.url, runId: run.id, importUrl: read.importUrl, input: read.input, key: work.key };
    // The run is counted only once it is appended: a change that throws takes nothing.
    task.change((doc) => claimRun(doc, { id: run.id, pool: this.options.id, start: this.clock.now() }));
    this.runs.set(run.id, run);
    this.sayBusy();
    this.options.repo.flush([task.documentId]).then(
      () => this.begin(run, job),
      (error) => {
        // Its start is not saved, so its code is not called: a run this pool
        // no longer has, recorded as `gone` says, so that a pool that can
        // never save ends the task on its third loss instead of taking it for ever.
        console.error('pool: saving a run before starting it failed', error);
        this.complete(run, { status: this.lostAs(run) });
      },
    );
  }

  private begin(run: Running, job: Job) {
    const reason = run.stopping ?? this.stopFor(run);
    if (reason) {
      this.complete(run, { status: this.statusOf(run, reason) });
      return;
    }
    let slot: Slot;
    try {
      slot = this.idle.pop() ?? this.startWorker();
    } catch (error) {
      this.log(run, `a worker could not be started: ${(error as Error)?.message ?? error}`);
      this.complete(run, { status: this.lostAs(run) });
      return;
    }
    slot.run = run;
    run.slot = slot;
    this.say(run, true);
    run.beat = this.clock.setInterval(() => this.say(run, true), BEAT_MS);
    try {
      slot.worker.run(job);
    } catch (error) {
      // A worker that cannot take its job is in a state nobody knows: it is ended, not kept.
      this.log(run, `its worker could not be handed it: ${(error as Error)?.message ?? error}`);
      this.kill(run);
      this.complete(run, { status: this.lostAs(run) });
    }
  }

  private startWorker(): Slot {
    const slot = { run: null, gone: false } as unknown as Slot;
    // What a worker says counts only while it is handed a run and has not been ended.
    const forRun =
      <Args extends unknown[]>(fn: (run: Running, ...args: Args) => void) =>
      (...args: Args) => {
        if (!slot.gone && slot.run) {
          fn(slot.run, ...args);
        }
      };
    const fail = (run: Running, message: string) => {
      this.log(run, message);
      this.ended(run, { status: 'failed' });
    };
    slot.worker = this.options.executor.start({
      log: forRun((run, message: string) => this.log(run, message)),
      progress: forRun((run, value: unknown) => {
        run.progress = value;
        run.progressNew = true;
        this.saySoon(run);
      }),
      done: forRun((run, result: unknown) => this.ended(run, { status: 'succeeded', result })),
      threw: forRun(fail),
      exit: () => {
        const run = slot.gone ? null : slot.run;
        slot.gone = true;
        this.idle = this.idle.filter((it) => it !== slot);
        if (run) {
          this.log(run, 'its worker died');
          this.ended(run, { status: this.lostAs(run) });
        }
      },
    });
    return slot;
  }

  /** Its code is over by itself. A run being stopped is recorded with its reason, and its worker is not kept. */
  private ended(run: Running, how: { status: RunStatus; result?: unknown }) {
    if (run.stopping) {
      this.kill(run);
      this.complete(run, { status: this.statusOf(run, run.stopping) });
      return;
    }
    const slot = run.slot!;
    slot.run = null;
    if (!slot.gone) {
      this.idle.push(slot);
    }
    this.complete(run, how);
  }

  private stopRun(run: Running, reason: StopReason) {
    if (run.stopping || run.over) {
      return;
    }
    run.stopping = reason;
    if (!run.slot) {
      return; // not started: `begin` records it once the start is saved
    }
    // The kill is set first, so that a worker that throws or answers at once from `abort` is still ended.
    run.kill = this.clock.setTimeout(() => {
      this.kill(run);
      this.complete(run, { status: this.statusOf(run, reason) });
    }, GRACE_MS);
    const worker = run.slot.worker;
    attempt('aborting a run', () => worker.abort(reason));
  }

  private kill(run: Running) {
    if (run.slot) {
      this.endWorker(run.slot);
    }
  }

  private endWorker(slot: Slot) {
    if (!slot.gone) {
      slot.gone = true;
      slot.run = null;
      attempt('ending a worker', () => slot.worker.terminate());
    }
  }

  /** Writes the run's end, once; saves it; then lets the entry go if the task has ended, and frees the slot. */
  private complete(run: Running, how: { status: RunStatus; result?: unknown }) {
    if (run.over) {
      return;
    }
    run.over = true;
    this.clock.clearInterval(run.beat);
    this.clock.clearTimeout(run.sayTimer);
    this.clock.clearTimeout(run.kill);
    const end = this.clock.now();
    try {
      run.task.change((doc) => endRun(doc, run.id, { status: how.status, result: how.result, logs: run.logs, end }));
    } catch (error) {
      console.error('pool: recording the end of a run failed', error); // its document is gone
    }
    this.options.repo
      .flush([run.task.documentId])
      .catch((error) => console.error('pool: saving the end of a run failed', error))
      .then(() => {
        try {
          const queue = run.queue.isDeleted?.() ? undefined : run.queue.doc();
          const is = named(queue, run.key, run.task.url);
          if (mayDelist(run.task.doc(), is)) {
            run.queue.change((doc) => delistTask(doc, run.key, run.task.url));
          }
        } catch (error) {
          console.error('pool: letting an entry go failed', error);
        }
        this.runs.delete(run.id);
        this.sayBusy();
        run.finish();
        this.review();
      });
  }

  private log(run: Running, message: string) {
    const line = { timestampMillis: this.clock.now(), message };
    run.logs.push(line);
    if (run.logs.length > 2 * MAX_LOG_LINES) {
      run.logs.splice(0, run.logs.length - MAX_LOG_LINES);
    }
    run.unsaid.push(line);
    this.saySoon(run);
  }

  private saySoon(run: Running) {
    if (run.sayTimer === undefined && !run.over) {
      run.sayTimer = this.clock.setTimeout(() => {
        run.sayTimer = undefined;
        this.say(run, false);
      }, SAY_EVERY_MS);
    }
  }

  /** Says the run is going on (`again`), or only that there is news of it, if there is. */
  private say(run: Running, again: boolean) {
    if (run.over || (!again && !run.progressNew && run.unsaid.length === 0)) {
      return;
    }
    const withProgress = run.progressNew || (again && run.progress !== undefined);
    this.send(run.task, {
      type: 'task progress',
      run: run.id,
      ...(withProgress ? { progress: sendable(run.progress) } : {}),
      ...(run.unsaid.length > 0 ? { logs: run.unsaid } : {}),
    } satisfies Omit<RunProgressMessage, keyof Stamp>);
    run.unsaid = [];
    run.progressNew = false;
  }

  /**
   * Says it serves, on every queue it serves, as soon as how many of its
   * slots are busy changes: the others choose a task's preferred pool among
   * those with a free slot, and a count a beat old would have them hold back
   * for a pool that cannot take the task.
   */
  private sayBusy() {
    if (!this.stopped) {
      for (const queue of this.queues.values()) {
        this.sayServing(queue.handle);
      }
    }
  }

  private sayServing(handle: Handle<Queue> | undefined) {
    if (handle) {
      const { id: pool, name, slots } = this.options;
      const running = [...new Set([...this.runs.values()].map((run) => run.task.url))];
      this.send(handle, { type: 'serving', pool, name, slots, busy: this.busy, has: this.has, running } satisfies Omit<ServingMessage, keyof Stamp>);
    }
  }

  private send(handle: Handle<any>, message: { type: string; [field: string]: unknown }) {
    // What is said is advice to listeners; a listener that throws must not stop the pool.
    attempt('saying something', () => this.ears.send(handle, { ...message, ...this.stamp(handle.url) }));
  }
}

/** Does one part of the pool's work, so that what throws there is reported and spoils nothing else. */
function attempt(what: string, fn: () => void) {
  try {
    fn();
  } catch (error) {
    console.error(`pool: ${what} failed`, error);
  }
}

/** A copy that can be sent in a message. */
function sendable(value: unknown): unknown {
  try {
    return value === undefined ? null : (JSON.parse(JSON.stringify(value)) ?? null);
  } catch {
    return String(value);
  }
}
