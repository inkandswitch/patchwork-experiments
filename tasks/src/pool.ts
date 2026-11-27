// A pool: the one set of workers a machine has. It follows the queues it
// serves and the tasks they list, takes a task when it has a free slot and
// the rules say it may, runs it in a run worker it owns, says that the run is
// going on, stops it when the rules say it must, and records how it went.
// Every decision is a rule in task-rules.js; this file only applies them to
// the documents and to what has been heard.
//
// It takes only work it has what for (`has`, see `satisfies`), and of what it
// may take, it holds back for the pools ranked before it: it hears the other
// pools serving each queue (their `serving`, within the lapse), and ranks
// them once, when it first sees a task listed that it may take (as the entry
// says, before the task's document is here), with itself as it last said it
// was, never as it is this instant: every pool then ranks from the same
// words. Ranked n-th from 0, it takes the task from n HOLD_MS after then, as
// soon as it has a free slot; a HOLD_MS past its turn, only once every ranked
// pool has had its turn, by when what another took has reached it. The
// ranking is kept while the task stays takeable, so nothing is decided again
// when another pool's slots fill or free; it is made anew only when a pool
// ranked before this one says it has no slots, since that pool will not take
// the task. Until it has listened to a queue for LISTEN_MS it does not know
// who else serves it, and says it has no slots there (it is not taking), so
// that nobody ranks it, itself included, and takes nothing there. It says `serving` every beat and whenever how many of
// its slots are busy changes, and as it stops (or stops serving a queue) it
// says it has no slots, so that nobody holds back for it.
//
// A run SETTLES (`settles`) once the pool has held it for BEAT_MS from when
// its taking was saved and nothing stops it: the pool then tells its worker,
// once, which resolves the code's `ctx.settled`.
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
  LAPSE_MS,
  LISTEN_MS,
  LOST_TOO_OFTEN,
  MAX_LOG_LINES,
  mayClaim,
  mayDelist,
  named,
  orphans,
  ranked,
  satisfies,
  settles,
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
  /** Resolves the code's `ctx.settled`, if `runId` is still the worker's job. Said at most once per run, after `run`. */
  settle(runId: string): void;
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
  /** The queues it serves. Changed later with `serve`. */
  queues?: AutomergeUrl[];
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
  /** Clears the timer set to look again later (a hold's end; for a queue, the end of its listening), while one is set. */
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
  /** How this pool ranked the pools for the task, and when; kept until the task is found not takeable, or a pool `ahead` says it has no slots. */
  firstSight?: Sight;
}

/**
 * A ranking made when a task was first seen takeable: when, on this pool's
 * clock, on which queue, this pool's place (0 is preferred), how many were
 * ranked, and the pools ranked before this one, which it holds back for.
 */
interface Sight {
  at: number;
  queue: AutomergeUrl;
  rank: number;
  of: number;
  ahead: string[];
}

/** Another pool heard serving a queue: what it last said of itself, and when, on this pool's clock. */
interface HeardPool {
  has: string[];
  slots: number;
  busy: number;
  at: number;
}

interface Served extends Followed<Queue> {
  /** The other pools heard serving it, by id. */
  heard: Map<string, HeardPool>;
  /** When this pool began listening to the queue's channel, on its own clock. */
  listeningSince?: number;
  /** What this pool last said of itself on the queue's channel: how it ranks itself, as the others rank it. */
  said?: { slots: number; busy: number };
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
  /** When its start was saved and its job handed over, on the pool's clock: what settling is counted from. */
  heldSince?: number;
  /** Its worker has been told it settled: said once, never again. */
  settled: boolean;
  /** Looks again when the run will have been held for BEAT_MS. */
  settleTimer?: unknown;
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
        this.sayServing(queue);
      }
      this.review();
    }, BEAT_MS);
    this.serve(options.queues ?? []);
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
  serve(queues: AutomergeUrl[]) {
    for (const [url, queue] of this.queues) {
      if (!queues.includes(url)) {
        this.sayServing(queue, true);
        letGo(queue);
        this.queues.delete(url);
      }
    }
    for (const url of queues) {
      if (!this.queues.has(url)) {
        this.queues.set(url, { heard: new Map() });
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
      // its last word on each queue: no slots, so that nobody holds back for it
      for (const queue of this.queues.values()) {
        this.sayServing(queue, true);
      }
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
      if (!run.stopping && !run.over && run.slot && !run.settled) {
        attempt('deciding whether a run has settled', () => this.settleIfDue(run, now));
      }
    }

    for (const { work, queue, served } of listed) {
      const followed = this.tasks.get(work.taskUrl as AutomergeUrl);
      if (!followed) {
        continue;
      }
      attempt('looking at a task its queue lists', () => {
        // What it needs is asked of the entry first and of the task last (see `mayClaim`).
        if (this.stopped || !satisfies(this.has, work.needs)) {
          followed.firstSight = undefined;
          followed.unhold?.();
          return;
        }
        // The pool ranks as soon as the entry says it may take the task,
        // before the task's document is here: by the time that has been
        // fetched, the preferred pool may have taken the task and said it is
        // full, and a pool that ranked then would read that as room left for it.
        followed.firstSight ??= this.rank(work, queue.url, served, now);
        const handle = followed.handle;
        const task = !handle || handle.isDeleted?.() ? undefined : handle.doc();
        if (!handle || !task) {
          return;
        }
        const is = named(queue.doc(), work.key, work.taskUrl);
        const heard = this.heardOf(work.taskUrl as AutomergeUrl);
        if (mayDelist(task, is)) {
          queue.change((doc) => delistTask(doc, work.key, work.taskUrl));
        }
        // A task that has ended is not wanted, so `mayClaim` refuses one just let go above.
        const takeable = mayClaim(task, id, is, heard) && satisfies(this.has, task.needs);
        if (!takeable) {
          followed.firstSight = undefined;
          followed.unhold?.();
          return;
        }
        // A pool still listening says it is not taking, and takes nothing: the listening's end looks again.
        if (this.runs.size < slots && !this.listening(served, now) && this.mayTakeNow(followed, served, work, now)) {
          this.claim(work, queue, handle, task);
        }
      });
    }
  }

  /**
   * Ranks the pools for a task (`ranked`): those heard serving the queue
   * within the lapse that have what the entry says the task needs, each as it
   * last said, and this pool as it last said too, so that its place is the one
   * the others give it. The entry's `near` is the asker's word for which pool
   * it is next to. Where none is ranked, this pool is first if it said it has
   * slots and hears no other that has: a pool alone never waits, full or not.
   * A pool still listening said it has no slots, and so is ranked nowhere.
   */
  private rank(work: Work, queue: AutomergeUrl, served: Served, now: number): Sight {
    const { id } = this.options;
    const others = [...served.heard]
      .filter(([, pool]) => now - pool.at < LAPSE_MS && satisfies(pool.has, work.needs))
      .map(([pool, { slots, busy }]) => ({ pool, slots, busy }));
    const said = served.said ?? { slots: 0, busy: 0 };
    let order = ranked(work.taskUrl, work.near ?? null, [{ pool: id, ...said }, ...others]);
    if (order.length === 0 && said.slots > 0 && !this.othersCould(served, work, now)) {
      order = [id];
    }
    const placed = order.indexOf(id);
    const rank = placed >= 0 ? placed : Math.max(1, order.length);
    return { at: now, queue, rank, of: order.length, ahead: order.slice(0, rank) };
  }

  /**
   * Whether to take a task this pool may take, now that it has a free slot.
   * Ranked n-th, from n HOLD_MS after it ranked, for a HOLD_MS, which is its
   * turn; past that, only once every ranked pool has had its turn, so that a
   * run another took in its turn reaches this one first, unless it hears no
   * other pool that could have taken it. Where it may not yet, a timer is set
   * to look again at the moment it may.
   */
  private mayTakeNow(followed: FollowedTask, served: Served, work: Work, now: number): boolean {
    const { at, rank, of } = followed.firstSight!;
    const waited = now - at;
    const turn = rank * HOLD_MS;
    const from = waited < turn + HOLD_MS || !this.othersCould(served, work, now) ? turn : Math.max(turn, of * HOLD_MS);
    if (waited >= from) {
      followed.unhold?.();
      return true;
    }
    if (!followed.unhold) {
      const timer = this.clock.setTimeout(() => {
        followed.unhold = undefined;
        this.review();
      }, from - waited);
      followed.unhold = () => {
        this.clock.clearTimeout(timer);
        followed.unhold = undefined;
      };
    }
    return false;
  }

  /** Whether a pool heard serving the queue within the lapse, with slots, has what the entry says the task needs. */
  private othersCould(served: Served, work: Work, now: number): boolean {
    return [...served.heard.values()].some((pool) => now - pool.at < LAPSE_MS && pool.slots > 0 && satisfies(pool.has, work.needs));
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
          this.startListening(followed as unknown as Served);
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
   * Another pool's word, on a queue's channel, that it serves the queue, with
   * how many slots it has free. A pool that stops says it has none.
   */
  private onQueueMessage(served: Served, handle: Handle<any>, message: Partial<ServingMessage> | null) {
    if (message?.type !== 'serving' || typeof message.pool !== 'string' || message.pool === this.options.id) {
      return;
    }
    if (this.queues.get(handle.url) !== served) {
      return; // a queue no longer served
    }
    const slots = Number(message.slots) || 0;
    served.heard.set(message.pool, {
      has: Array.isArray(message.has) ? message.has.filter((label): label is string => typeof label === 'string') : [],
      slots,
      busy: Number(message.busy) || 0,
      at: this.clock.now(),
    });
    if (slots <= 0) {
      // A pool that says it is not taking will not take what this one holds back for it: those are ranked anew.
      for (const task of this.tasks.values()) {
        if (task.firstSight?.queue === handle.url && task.firstSight.ahead.includes(message.pool)) {
          task.firstSight = undefined;
          task.unhold?.();
        }
      }
    }
    this.review();
  }

  /** Whether this pool has listened to the queue for less than LISTEN_MS, and so does not yet know who else serves it. */
  private listening(served: Served, now: number) {
    return served.listeningSince === undefined || now - served.listeningSince < LISTEN_MS;
  }

  /**
   * Begins listening to a queue whose document has been found: says at once
   * that it serves it with no slots, and at LISTEN_MS, having heard the
   * others, says its slots and looks at the queue again.
   */
  private startListening(served: Served) {
    served.listeningSince = this.clock.now();
    this.sayServing(served);
    const timer = this.clock.setTimeout(() => {
      served.unhold = undefined;
      this.sayServing(served);
      this.review();
    }, LISTEN_MS);
    served.unhold = () => {
      this.clock.clearTimeout(timer);
      served.unhold = undefined;
    };
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

  /**
   * Tells a run's worker that the run has settled, the first time `settles`
   * says so; until then, makes sure the pool looks again the moment it has
   * held the run for BEAT_MS (a timer may fire a little early on the clock it
   * is read by). Only for a run with a worker that is not being stopped.
   */
  private settleIfDue(run: Running, now: number) {
    const task = run.task.isDeleted?.() ? undefined : run.task.doc();
    if (!task || run.heldSince === undefined) {
      return;
    }
    const queue = run.queue.isDeleted?.() ? undefined : run.queue.doc();
    if (settles(task, run.id, named(queue, run.key, run.task.url), this.heardOf(run.task.url), run.heldSince, now)) {
      run.settled = true;
      this.clock.clearTimeout(run.settleTimer);
      run.settleTimer = undefined;
      const worker = run.slot!.worker;
      attempt('telling a run it has settled', () => worker.settle(run.id));
    } else if (run.settleTimer === undefined && now - run.heldSince < BEAT_MS) {
      this.lookWhenHeld(run, BEAT_MS - (now - run.heldSince));
    }
  }

  /** Looks again in `ms`, when the run will have been held for BEAT_MS. */
  private lookWhenHeld(run: Running, ms: number) {
    run.settleTimer = this.clock.setTimeout(() => {
      run.settleTimer = undefined;
      this.review();
    }, ms);
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
      settled: false,
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
    // Held from now: its start is saved, and its code is about to be called.
    run.heldSince = this.clock.now();
    this.say(run, true);
    run.beat = this.clock.setInterval(() => this.say(run, true), BEAT_MS);
    this.lookWhenHeld(run, BEAT_MS);
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
    // A run being stopped never settles.
    this.clock.clearTimeout(run.settleTimer);
    run.settleTimer = undefined;
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
    this.clock.clearTimeout(run.settleTimer);
    run.settleTimer = undefined;
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
   * slots are busy changes: every pool, itself included, ranks pools by the
   * free slots they last said they had, and a count a beat old would have
   * them hold back for a pool that cannot take the task.
   */
  private sayBusy() {
    if (!this.stopped) {
      for (const queue of this.queues.values()) {
        this.sayServing(queue);
      }
    }
  }

  /**
   * Says it serves the queue, with its slots; with none while it is still
   * listening to the queue, and none, `leaving`, as its last word there. What
   * it says is what it ranks itself by.
   */
  private sayServing(served: Served, leaving = false) {
    const handle = served.handle;
    if (handle) {
      const { id: pool, name } = this.options;
      const slots = leaving || this.listening(served, this.clock.now()) ? 0 : this.options.slots;
      served.said = { slots, busy: this.busy };
      this.send(handle, { type: 'serving', pool, name, slots, busy: this.busy, has: this.has } satisfies Omit<ServingMessage, keyof Stamp>);
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
