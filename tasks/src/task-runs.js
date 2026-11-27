/**
 * task-runs.js — a run document, asked of a machine as a task: asking, stopping, reading, and the run's side.
 *
 * For a package whose work is a long run on another machine (a solver), kept
 * in a document of its own. It applies task-rules.js's rules and
 * task-client.js's asking, and other packages get it with them from the
 * registry (client.js). It works in a page and in a task's code in Node alike.
 *
 * TWO DOCUMENTS
 *
 * The RUN DOCUMENT is the record of the run: what was asked, frozen when it
 * was asked, then the run's progress and results. The TASK that asks a
 * machine for it is keyed by the run document's url, so asking twice is
 * asking once; its input is `{ run: <that url> }`, its code is a file in the
 * package (`codeUrl`), and it says only whether a machine has the run.
 *
 * What this file reads and writes of a run document; the rest is the package's:
 *
 *   '@patchwork'.type  the package's run type
 *   server      the queue it is asked of, set when the package makes it
 *   task        the task's url, set once it is asked for (`askRun`)
 *   status      `queued` until its code says more; then the package's own
 *               working statuses; `done`, `failed` or `cancelled` once it has
 *               ended (RUN_ENDED)
 *   error       why it failed, for a person
 *   finishedAt  when it ended
 *   stages      if it has them, a list of `{ status, endedAt, note }`; the
 *               one `running` is marked failed when the run stops or fails
 *
 * People make a run document and its asker sets `task`; the run's code writes
 * the rest. A person who cancels writes a stop in the task (task-client.js's
 * `cancel`), never the run document, so what a person sees is read from both
 * (`shownRun`): a run cancelled before it started, or one whose code never
 * ran to its end, has nobody to write its document.
 *
 * NEVER RUN TWICE UNASKED
 *
 * A task runs at least once, not exactly once: a machine that stops mid-run
 * leaves its run to be taken again. A long run must not start over unasked,
 * so a run's code reads its task's list first (`earlier`). A run before it in
 * the list (a record with a pool: a stop has none) that has been completed
 * means this run was interrupted once already: the code marks the run
 * document so (NOT_RESTARTED) and throws, and the task ends failed. One still
 * open means another machine may be running it now and writing the run
 * document, so the code throws without touching the document (EARLIER_OPEN).
 *
 * STOPPING
 *
 * A run's code is told to stop by its signal, with a reason (STOP_REASONS):
 * `cancelled`, someone stopped it; `stopping`, its machine is shutting down;
 * `yielded`, another run of the task has it. The runner writes the first two
 * to the run document (`markStopped`) and kills what it runs. The task's
 * thread is ended GRACE_MS after the abort, and what the code wrote is saved
 * only once the code returns, so a stopped run's code returns within
 * `stopWait` of the abort, whatever its runner is still waiting on.
 */

import { ask, cancel, findWhenThere, inSamePackage, served } from './task-client.js';

export { findWhenThere };
import { BEAT_MS, GRACE_MS, allHeard, isOpen, isTask, recordsOf, taskError, taskState, waitingWork } from './task-rules.js';

/** @typedef {import('./task-rules.js').Task} Task */
/** @typedef {import('./task-rules.js').Run} Run */
/** @typedef {import('./task-rules.js').Queue} Queue */
/** @typedef {import('./task-client.js').Serving} Serving */

/**
 * The part of a run document this file reads and writes.
 * @typedef {object} RunDoc
 * @property {string} [server]
 * @property {string | null} [task]
 * @property {string} [status]
 * @property {string | null} [error]
 * @property {number | null} [finishedAt]
 * @property {{ status?: string, endedAt?: number | null, note?: string | null }[]} [stages]
 */

// The run document's statuses

/** The statuses that say a run has ended: a run document that has one of these says how it went, whatever its task says. */
export const RUN_ENDED = Object.freeze(['done', 'failed', 'cancelled']);

/** @param {unknown} status */
export const isRunEnded = (status) => RUN_ENDED.includes(/** @type {string} */ (status));

/** Why a run's code is told to stop: its task's signal's reason. */
export const STOP_REASONS = Object.freeze(['cancelled', 'stopping', 'yielded']);

/** What a run document says when the machine running it stopped mid-run. */
export const MACHINE_STOPPED = 'The machine running this stopped while it ran; run it again.';

/** What a run document says when its task is taken again after its machine stopped: it is not run twice unasked. */
export const NOT_RESTARTED =
  "This run was interrupted (the machine running it stopped) and was not started again, so that it isn't run twice without anyone asking; run it again.";

/** Why a run's code did not start because an earlier run of its task is still open. The run document is that run's, and is not written. */
export const EARLIER_OPEN =
  "Another machine took this run first and hasn't finished it (it may still be running it), so this one didn't start it again.";

/** Why a run's code did not start because it cannot find itself in its task. */
export const NOT_LISTED =
  "This run isn't in its task's document, so whether it ran before can't be told; it was not started.";

// Writes to a run document. Each is to be called inside a change to it.

/**
 * Marks the run that is going on failed. Its running stage, if it has
 * stages, is marked failed too. A run document that says how it ended keeps
 * that.
 * @param {RunDoc} run
 * @param {string} error
 * @param {number} now
 */
export function markFailed(run, error, now) {
  if (isRunEnded(run.status)) {
    return;
  }
  run.status = 'failed';
  run.error = error;
  run.finishedAt = now;
  for (const stage of run.stages ?? []) {
    if (stage.status === 'running') {
      stage.status = 'failed';
      stage.endedAt = now;
    }
  }
}

/**
 * What a runner writes when its signal stops it: `cancelled` says cancelled,
 * `stopping` (its machine is shutting down) says failed with MACHINE_STOPPED,
 * and the running stage says which. `yielded` writes nothing: another run of
 * the task has it. A run document that says how it ended keeps that.
 * @param {RunDoc} run
 * @param {string} reason  one of STOP_REASONS
 * @param {number} now
 */
export function markStopped(run, reason, now) {
  if (reason === 'yielded' || isRunEnded(run.status)) {
    return;
  }
  const cancelled = reason === 'cancelled';
  run.status = cancelled ? 'cancelled' : 'failed';
  run.error = cancelled ? null : MACHINE_STOPPED;
  run.finishedAt = now;
  for (const stage of run.stages ?? []) {
    if (stage.status === 'running') {
      stage.status = 'failed';
      stage.endedAt = now;
      stage.note = cancelled ? 'cancelled' : 'stopped';
    }
  }
}

/**
 * What a run's code writes when it finds its run was interrupted before:
 * failed, not started again (NOT_RESTARTED). A run document that says how it
 * ended keeps that.
 * @param {RunDoc} run
 * @param {number} now
 */
export function markInterrupted(run, now) {
  markFailed(run, NOT_RESTARTED, now);
}

// Asking (a page's side)

/** @type {string | null} */
let givenPackage = null;

/**
 * Names this package (`automerge:<id>`) for code that isn't loaded from it
 * (tests, a probe in Node). Otherwise the url a task names its code by is
 * read from where this module was loaded.
 * @param {string | null} packageUrl
 */
export function setPackageUrl(packageUrl) {
  givenPackage = packageUrl;
}

/**
 * The url a task names the file at `path` in this package by. Throws a plain
 * sentence when this package can't be named.
 * @param {string} path  within the package: `daemon/run-task.mjs`
 * @returns {string}
 */
export function codeUrl(path) {
  const here = inSamePackage(import.meta.url, path);
  if (here) {
    return here;
  }
  if (givenPackage) {
    return `/${encodeURIComponent(givenPackage)}/${path}`;
  }
  throw new Error(
    "This copy of the tool wasn't loaded from its package, so it can't name the code that does its runs; open it from Patchwork.",
  );
}

/**
 * Whether a document is a task queue: what a run's `server` names.
 * @param {unknown} doc
 */
export const isQueue = (doc) => {
  const jobs = /** @type {{ jobs?: unknown } | null} */ (doc)?.jobs;
  return !!doc && typeof doc === 'object' && !!jobs && typeof jobs === 'object';
};

/**
 * Asks a queue for a run: a task keyed by the run document's url, whose code
 * is the file at `code` in this package, with `{ run }` for its input. Then
 * records the task's url in the run document, in a change made with
 * `options` (its message, say). Asking again while the task is wanted is the
 * same task.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {any} runHandle  the run document's handle
 * @param {string} code  the run's code, within this package
 * @param {object} [options]  for the run document's change
 * @returns {Promise<string>} the task's url
 */
export async function askRun(repo, queueUrl, runHandle, code, options) {
  const { taskUrl } = await ask(repo, queueUrl, {
    importUrl: codeUrl(code),
    input: { run: runHandle.url },
    key: runHandle.url,
  });
  runHandle.change((/** @type {RunDoc} */ doc) => {
    doc.task = taskUrl;
  }, options);
  return taskUrl;
}

/**
 * Cancels a run: appends a stop to its task and takes it off its queue. A run
 * waiting never starts; one running is stopped within seconds and its runner
 * says cancelled. False when its queue no longer lists it, or its task had
 * ended already.
 * @param {any} repo
 * @param {RunDoc | undefined | null} run  the run document
 * @param {string} runUrl
 * @returns {Promise<boolean>}
 */
export function cancelRun(repo, run, runUrl) {
  if (!run?.server) {
    return Promise.resolve(false);
  }
  return cancel(repo, run.server, runUrl);
}

/**
 * What one look at a run's task reads, for `shownRun`.
 * @typedef {{ state: string, error: string | null, runs: Run[] }} TaskLook
 */

/**
 * A run's task as one look at its document reads it, with nobody listening
 * (an open run counts as going on), or null when the run names no task or
 * it can't be read here.
 * @param {any} repo
 * @param {RunDoc | undefined | null} run
 * @returns {Promise<TaskLook | null>}
 */
export async function lookAtTask(repo, run) {
  if (!run?.task) {
    return null;
  }
  try {
    const doc = (await repo.find(run.task)).doc();
    if (!isTask(doc)) {
      return null;
    }
    return { state: taskState(doc, allHeard), error: taskError(doc, allHeard), runs: doc.runs };
  } catch {
    return null;
  }
}

/**
 * The machines heard serving a queue within `ms` (by default a little over
 * one beat): resolves as soon as one is heard, else with an empty list.
 * @param {any} repo
 * @param {string} queueUrl
 * @param {number} [ms]
 * @returns {Promise<Serving[]>}
 */
export function hearServing(repo, queueUrl, ms = BEAT_MS + 500) {
  return new Promise((resolve) => {
    /** @type {(() => void) | null} */
    let stop = null;
    let done = false;
    /** @param {Serving[]} pools */
    const finish = (pools) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(pools);
    };
    const timer = setTimeout(() => finish([]), ms);
    stop = served(repo, queueUrl, (pools) => {
      if (pools.length) {
        finish(pools);
      }
    });
    // heard before `stop` was known: it is let go of now
    if (done) {
      stop();
    }
  });
}

/**
 * A queue as people see it: how many of what it lists are running (what the
 * machines heard serving it say they are busy with), how many wait, and how
 * many runs its machines take at once.
 * @param {Pick<Queue, 'jobs'> | undefined} queueDoc
 * @param {{ slots?: number, busy?: number }[]} pools
 */
export function queueCounts(queueDoc, pools) {
  const listed = waitingWork(queueDoc).length;
  const running = Math.min(listed, pools.reduce((n, pool) => n + (pool.busy || 0), 0));
  return { listed, running, waiting: listed - running, slots: pools.reduce((n, pool) => n + (pool.slots || 0), 0) };
}

/**
 * How many runs a queue lists ahead of this one (asked earlier, not ended),
 * or null when it doesn't list it.
 * @param {Pick<Queue, 'jobs'> | undefined} queueDoc
 * @param {string} runUrl
 */
export function aheadOf(queueDoc, runUrl) {
  const at = waitingWork(queueDoc).findIndex((work) => work.key === runUrl);
  return at < 0 ? null : at;
}

/**
 * Who serves a queue, for people: "Mac Studio (2 at once)", or null when
 * nobody is heard.
 * @param {{ name?: string, slots?: number }[]} pools
 */
export function servedBy(pools) {
  if (!pools.length) {
    return null;
  }
  return pools.map((pool) => `${pool.name || 'a machine'}${(pool.slots ?? 0) > 1 ? ` (${pool.slots} at once)` : ''}`).join(', ');
}

/** The note beside a run that is being cancelled. */
export const CANCELLING = 'cancelling…';
/** The note beside a run whose machine has fallen silent. */
export const UNHEARD = "the machine running it isn't heard from";
/** The note beside a run whose machine stopped without it: taken again, it won't start (see NOT_RESTARTED). */
export const STOPPED_WITHOUT_IT = "the machine running it stopped; it won't be started again, so run it again";
/** The note beside a run cancelled before any machine took it. */
export const CANCELLED_BEFORE = 'cancelled before it started';

/**
 * The status a person sees for a run: its document's, unless its task says
 * what the document can't. `note` is a few words beside the status, for what
 * is under way and isn't a status of its own.
 *
 * Read from the task: its state, its error, and whether a machine ever took
 * it (a record in its list with a pool; a stop has none). Whether it was
 * taken is read from the task, not from the run document's status, because
 * the two travel separately: a run document can say more than its task has
 * yet, and a reader that hasn't loaded the task reads it waiting, with no runs.
 * - a run document that has ended says, whatever the task says; so does one
 *   whose task is not known yet.
 * - cancelled: cancelled; "before it started" when no machine ever took it.
 * - failed: failed, with the task's error.
 * - stopping (a stop, and a run still has it): the document's, "cancelling…".
 * - stalled (a run has it and isn't heard): the document's, with a note.
 * - waiting, and a machine took it once: that machine stopped without it,
 *   and the run won't start again, so the note says to run it again. Waiting
 *   and never taken: the document's, no note.
 * - running, succeeded (the document's own ending is on its way), missing:
 *   the document's.
 * @param {RunDoc | undefined | null} run
 * @param {{ state: string, error?: string | null, runs?: unknown } | null} task  the task as its reader has it (task-client.js's watch view, or `lookAtTask`), or null while unknown
 * @returns {{ status: string, error: string | null, note: string | null }}
 */
export function shownRun(run, task) {
  const status = run?.status ?? 'queued';
  if (isRunEnded(status) || !task) {
    return { status, error: run?.error ?? null, note: null };
  }
  const taken = recordsOf(/** @type {Pick<Task, 'runs'>} */ (task)).some((record) => typeof record?.pool === 'string');
  switch (task.state) {
    case 'cancelled':
      return { status: 'cancelled', error: null, note: taken ? null : CANCELLED_BEFORE };
    case 'failed':
      return { status: 'failed', error: task.error ?? 'it failed', note: null };
    case 'stopping':
      return { status, error: null, note: CANCELLING };
    case 'stalled':
      return { status, error: null, note: UNHEARD };
    case 'waiting':
      return { status, error: null, note: taken ? STOPPED_WITHOUT_IT : null };
    default:
      return { status, error: null, note: null };
  }
}

// The run's side: its task's code

/**
 * What came before the run named `runId` in its task's list: `none`, no run
 * (a stop is not a run); `open`, a run some machine has not completed;
 * `closed`, runs, every one completed (lost, yielded, or any other way);
 * `unlisted`, the run isn't in the list, so nothing can be told.
 * @param {Pick<Task, 'runs'> | undefined | null} task
 * @param {string} runId
 * @returns {'none' | 'open' | 'closed' | 'unlisted'}
 */
export function earlier(task, runId) {
  const records = recordsOf(task).filter((record) => !!record && typeof record === 'object');
  const at = records.findIndex((record) => record.id === runId);
  if (at < 0) {
    return 'unlisted';
  }
  const runs = records.slice(0, at).filter((record) => typeof record.pool === 'string');
  if (runs.some(isOpen)) {
    return 'open';
  }
  return runs.length ? 'closed' : 'none';
}

/**
 * What a run's code is handed by the task system (see task-rules.js).
 * @typedef {object} RunContext
 * @property {any} repo
 * @property {string} taskUrl
 * @property {string} run  this run's name in the task's list
 * @property {AbortSignal} signal
 * @property {(message: string) => void} log
 * @property {(progress: unknown) => void} progress
 */

/**
 * What a package's runner is handed for one run.
 * @typedef {object} RunJob
 * @property {any} repo
 * @property {any} handle  the run document's
 * @property {any} facts  what `machine` returned
 * @property {AbortSignal} signal
 * @property {(message: string) => void} say
 */

/** @param {unknown} err */
const sentence = (err) => String(/** @type {Error} */ (err)?.message ?? err);

const clock = () => new Date().toTimeString().slice(0, 8);

/**
 * A task's code that does one run, made from what is the package's own.
 *
 * It finds the run document (`find`: by default `findWhenThere`) and checks
 * its type; reads the task's list (`earlier`) and does not run twice
 * unasked; asks `machine` for this machine's facts (a throw is a sentence
 * saying why this machine can't run it, and fails the run document too);
 * echoes `progressOf(run document)` to the task's view whenever it changes,
 * logging its `stage` each time that changes; holds the machine awake
 * (`awake`, which returns how to let go, let go of the moment the run is
 * told to stop); then calls `runJob`, which returns the run document's
 * status when it is over (`done`, or `stopped` when its signal stopped it).
 *
 * It returns `{ status: 'done' }`, or throws: the run document's error when
 * the run ended otherwise; `stopped (<reason>)` when the signal stopped it,
 * whatever the runner said after; and the runner's own error when it threw,
 * written to the run document too unless the run was being stopped. Told to
 * stop, it gives the runner `stopWait` to return and then returns without
 * it, so that what was written is saved before the thread is ended.
 * @param {object} o
 * @param {string} o.type  the run document's `@patchwork` type
 * @param {string} o.what  a run, in a sentence: "an OpenFOAM run"
 * @param {() => any} o.machine  this machine's facts, or a throw saying why it can't run this
 * @param {(job: RunJob) => Promise<string>} o.runJob
 * @param {(run: any) => { stage?: string | null } & Record<string, unknown>} o.progressOf  what a task's view is told
 * @param {(run: any, now: number) => void} [o.interrupted]  what a run interrupted before writes: `markInterrupted`, unless the package's documents say more
 * @param {() => () => void} [o.awake]
 * @param {(message: string) => void} [o.say]  the host's log
 * @param {(repo: any, url: string) => Promise<any>} [o.find]
 * @param {number} [o.stopWait]  how long a runner told to stop is given to return, inside GRACE_MS
 * @returns {(input: { run?: unknown } | null | undefined, ctx: RunContext) => Promise<{ status: string }>}
 */
export function makeRunTask({
  type,
  what,
  machine,
  runJob,
  progressOf,
  interrupted = markInterrupted,
  awake = () => () => {},
  say = (message) => console.log(`${clock()} ${message}`),
  find = findWhenThere,
  stopWait = GRACE_MS - 1_000,
}) {
  return async function runTask(input, ctx) {
    const runUrl = input?.run;
    if (typeof runUrl !== 'string' || !runUrl.startsWith('automerge:')) {
      throw new Error(`The task names no run: its input is { run: <${what}'s url> }.`);
    }
    const handle = await find(ctx.repo, runUrl);
    if (handle.doc()?.['@patchwork']?.type !== type) {
      throw new Error(`${runUrl} isn't ${what}.`);
    }

    const before = earlier((await ctx.repo.find(ctx.taskUrl)).doc(), ctx.run);
    if (before === 'unlisted') {
      throw new Error(NOT_LISTED);
    }
    if (before === 'open') {
      ctx.log('an earlier run is still open: not started');
      throw new Error(EARLIER_OPEN);
    }
    if (before === 'closed') {
      handle.change((/** @type {RunDoc} */ doc) => interrupted(doc, Date.now()));
      ctx.log('interrupted before: not started again');
      throw new Error(NOT_RESTARTED);
    }

    let facts;
    try {
      facts = await machine();
    } catch (err) {
      handle.change((/** @type {RunDoc} */ doc) => markFailed(doc, sentence(err), Date.now()));
      throw err;
    }

    let last = '';
    /** @type {string | null | undefined} */
    let lastStage = null;
    const echo = () => {
      const progress = progressOf(handle.doc());
      const json = JSON.stringify(progress);
      if (json === last) {
        return;
      }
      last = json;
      ctx.progress(progress);
      if (progress.stage && progress.stage !== lastStage) {
        ctx.log(progress.stage);
      }
      lastStage = progress.stage;
    };
    handle.on('change', echo);
    echo();

    const release = awake();
    ctx.signal.addEventListener('abort', release, { once: true });
    say(`run ${runUrl}: ${handle.doc().title ?? ''}`);
    // Told to stop, a runner writes the stop and kills what it runs, but some
    // of its waits may watch no signal (a document arriving, the sync server
    // acknowledging one), and the thread is ended GRACE_MS after the abort.
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let giveUp;
    /** @type {() => void} */
    let onStop = () => {};
    /** @type {Promise<string>} */
    const givenUp = new Promise((resolve) => {
      onStop = () => {
        giveUp = setTimeout(() => resolve('stopped'), stopWait);
      };
    });
    if (ctx.signal.aborted) {
      onStop();
    } else {
      ctx.signal.addEventListener('abort', onStop, { once: true });
    }
    let status;
    try {
      status = await Promise.race([runJob({ repo: ctx.repo, handle, facts, signal: ctx.signal, say }), givenUp]);
    } catch (err) {
      if (!ctx.signal.aborted) {
        handle.change((/** @type {RunDoc} */ doc) => markFailed(doc, sentence(err), Date.now()));
      }
      throw err;
    } finally {
      clearTimeout(giveUp);
      ctx.signal.removeEventListener('abort', onStop);
      handle.off('change', echo);
      ctx.signal.removeEventListener('abort', release);
      release();
    }
    if (ctx.signal.aborted || status === 'stopped') {
      throw new Error(`stopped (${ctx.signal.reason ?? 'stopping'})`);
    }
    if (status !== 'done') {
      throw new Error(handle.doc().error ?? `the run ${status}`);
    }
    ctx.log('done');
    return { status };
  };
}
