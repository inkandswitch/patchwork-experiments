/**
 * task-rules.js — the whole of the task system's rules. [kit: task-rules.js v2]
 *
 * What the documents are, and what may be read from them. Everything else (a
 * pool, an asker, a view) is these rules applied to documents and to what has
 * been heard. The canonical copy is in the tasks package; a package that asks
 * for tasks carries a copy, with task-client.js beside it.
 *
 * THREE THINGS
 *
 * A task is a document: where its code is (`importUrl`: anything `import()`
 * takes), what to hand it (`input`), the key it was asked for under, and the
 * runs it has had. Its code's default export is called with `(input, ctx)`.
 *
 * A queue is a document: the tasks asked of it that have not ended, each
 * under its key. Whoever can write a queue can ask it for work and stop that
 * work, so the queue is what is shared and what is lent workers.
 *
 * A pool is the one set of workers a machine has. It serves the queues it has
 * been told to, runs only the code it accepts from each, and has a name that
 * outlives its restarts.
 *
 * WHAT IS WRITTEN
 *
 * A pool takes a task by appending a run to the task's `runs`, and that pool
 * alone later completes that run with how it went. An asker lists a task
 * under its key, and stops one by appending a stop to the same list: a
 * record that says `cancelled`. An entry is deleted when its task has ended.
 * Nothing else is written, and nothing that says "now": no holder field, no
 * heartbeat, no flag, no outcome field. So a copy of a task or a queue is as
 * true as the original, and two changes made apart always merge to something
 * these rules read one way.
 *
 * Everything about a task is read from its own document. A queue's entry
 * says which task a key names and that the task is wanted; it never says how
 * the task went. The two documents travel separately, so a rule that read
 * "the entry is gone" as "the task is over" or "was stopped" would be wrong
 * whenever the queue's news arrived first.
 *
 * WHAT IS READ
 *
 * - A run is OPEN until its pool has completed it.
 * - A run is HEARD while its pool is saying so on the task's channel (see
 *   `isHeard`). Heard is each listener's own knowledge, never a document's.
 * - The task's HOLDER is its first open run, in list order, that is heard.
 * - The task's ENDING is the status of the first record in its list that
 *   ends it for good (`succeeded`, `failed`, `cancelled`), once no heard open
 *   run comes before that record. Until then it has not ended. Nothing else
 *   ends a task: how it went is always a record, never a count or a flag.
 *
 * List order is the same for everyone who has the same runs, and a run
 * appended by someone who had seen another lands after it. So everyone who
 * hears the same runs agrees on the holder, and a pool that takes a task
 * because it could not hear the holder gives way when it can: a wrong "it is
 * gone" costs the later run its work, never the earlier one.
 *
 * A reading of "ended" therefore changes afterwards in one circumstance
 * only: a run earlier in the list that the reader could not hear (its pool
 * was cut off, not gone) is completed later with a status that ends the
 * task. Then that earlier record is the ending, for everyone.
 *
 * HOW A RUN GOES (a pool's side)
 *
 * - A pool may TAKE a task that is still wanted (no record has ended it),
 *   that its queue lists under the task's key, that nobody heard holds, and
 *   that the pool has no open run of already (`mayClaim`).
 * - It STOPS a run of its own (`stopReason`) as soon as the task has been
 *   stopped, which makes the run `cancelled`; or the work is done elsewhere,
 *   a record before it ended the task, its key names another task, or an
 *   earlier run it can hear holds it, each of which makes it `yielded`, which
 *   ends nothing. A failure after it in the list does not stop it: it may
 *   yet do better. Stopped code is told through its signal, and its worker
 *   is ended GRACE_MS later whatever it does.
 * - A run it started and no longer has (the pool stopped, or crashed and
 *   came back) it completes as what it would have been stopped for, or else
 *   as `lost`; the task's third loss is recorded `failed`, which ends it
 *   (`gone`). Only a run's own pool says so, which makes it a fact; nobody
 *   ever records a guess about someone else's run.
 *
 * WHAT ENDS A TASK
 *
 * Its code returning, its code throwing, someone stopping it, or its
 * MAX_LOST-th run being lost; each once, for good, each a record in the list.
 * The system starts a task's code again only when a run was lost or its
 * holder can no longer be heard; never because it threw.
 *
 * WHAT AN ASKER DOES
 *
 * It lists its task under a key unless the key already names a task that has
 * not ended, and from then on follows the key: whichever task the key names
 * is the one, and when the key names nothing, the last one it named. It
 * waits for that task's own document to say how it ended. If the key names
 * nothing and the task has neither ended nor been heard for LAPSE_MS, the
 * asker lists it again (`mayRelist`): it was asked for and is still wanted.
 * Asking under a key whose task has ended is asking afresh; whether work was
 * done already is for the asker to look up where the work's result lands.
 *
 * WHAT IS PROMISED
 *
 * At least once, not exactly once: a pool that cannot be heard and a pool
 * that takes its place can both run a task to the end. Work that must not
 * happen twice guards itself: its code is handed the name of its run, which
 * is in the task's document before the code is called, and can see every
 * earlier run there.
 *
 * The same idea is used wherever this lab has one of something at a time: a
 * holder named in a document or a message, counted only while it is heard,
 * within a lapse measured from first sight or last word.
 */

// The documents

/**
 * @typedef {object} Task
 * @property {string} [title]
 * @property {string} importUrl  Where its code is: anything `import()` takes.
 * @property {any} input
 * @property {string} key  The key it was asked for under, in its queue's `jobs`.
 * @property {Run[]} runs  What has happened to it, in order: every run a pool took, and any stop someone asked for. Appended to; a run is replaced, whole, once, when it is completed.
 */

/**
 * @typedef {object} Run
 * @property {string} id  The run's name: made by the pool that took the task, never used again.
 * @property {string} [pool]  The pool that took it, and the only one that ever writes this run again. A stop has none: it is a record that was never open, written by whoever asked.
 * @property {number} start  When it was taken, by that pool's clock. For people; no rule reads it.
 * @property {number} [end]  When it was completed. This and what follows are written together, once.
 * @property {RunStatus} [status]
 * @property {any} [result]  What its code returned, as JSON, if it `succeeded`.
 * @property {LogLine[]} [logs]  The last lines its code logged.
 */

/**
 * The ways a run ends a task for good.
 * @typedef {'succeeded' | 'failed' | 'cancelled'} FinalStatus
 */

/**
 * How a run went. Besides the three that end the task: `lost`, its pool
 * stopped or restarted without it; `yielded`, its pool stopped it because the
 * task had ended another way, had lost its key, or was held by an earlier run.
 * @typedef {FinalStatus | 'lost' | 'yielded'} RunStatus
 */

/** @typedef {{ timestampMillis: number, message: string }} LogLine */

/**
 * @typedef {object} Queue
 * @property {string} [title]
 * @property {{ [key: string]: Entry }} jobs  The tasks asked for that have not ended, by key.
 */

/**
 * @typedef {object} Entry
 * @property {string} taskUrl  The task's `automerge:` url.
 * @property {number} askedAt  When it was asked for, by the asker's clock: only the order pools take work in.
 * @property {string | null} package  The package its code is in, or null for code that is in none.
 */

// The numbers

/** How often a pool says each of its runs is going on. */
export const BEAT_MS = 2_000;

/** How long a run may go unheard before a listener stops counting it as heard: four beats missed and a little over. */
export const LAPSE_MS = 10_000;

/** How long stopped code is given before its worker is ended. */
export const GRACE_MS = 5_000;

/** How many of a task's runs may be lost before it is not taken again. */
export const MAX_LOST = 3;

/** The most a run's result may come to, as JSON in UTF-8. More than this belongs in a document of its own. */
export const MAX_RESULT_BYTES = 1_000_000;

/** How many of a run's last log lines are kept with it. */
export const MAX_LOG_LINES = 200;

// Hearing

/**
 * Whether a listener counts the run with this name as heard, now.
 * @typedef {(runId: string) => boolean} Heard
 */

/**
 * For a reader that takes one look at a document with nobody listening:
 * every open run counts as heard, so nothing is read as over that might
 * still be going on.
 * @type {Heard}
 */
export const allHeard = () => true;

/**
 * Whether a run counts as heard, on the listener's own clock: it was last
 * heard less than LAPSE_MS ago, or has never been heard and the listener
 * first saw it less than that long ago (the word may be on its way). No clock
 * but the listener's is consulted.
 * @param {number | null} lastHeardAt
 * @param {number} firstSeenAt
 * @param {number} now
 */
export function isHeard(lastHeardAt, firstSeenAt, now) {
  return now - (lastHeardAt ?? firstSeenAt) < LAPSE_MS;
}

/**
 * What one listener has heard of runs: for each run's name, when the
 * listener first saw the run in a document and when the run's pool was last
 * heard saying it is going on, both on the listener's own clock. A pool keeps
 * one to decide what it may take and when to give way; a reader keeps one to
 * say which runs are going on.
 */
export class Hearing {
  /** @param {{ now(): number }} [clock] */
  constructor(clock = Date) {
    this.clock = clock;
    /** @type {Map<string, number>} */
    this.firstSeen = new Map();
    /** @type {Map<string, number>} */
    this.lastHeard = new Map();
    /**
     * Whether the run with this name counts as heard now. A run asked about
     * that was never shown is taken as seen now: it can only have come from a
     * document the listener is reading.
     * @type {Heard}
     */
    this.heard = (runId) => {
      const now = this.clock.now();
      if (!this.firstSeen.has(runId)) {
        this.firstSeen.set(runId, now);
      }
      return isHeard(this.lastHeard.get(runId) ?? null, /** @type {number} */ (this.firstSeen.get(runId)), now);
    };
  }

  /**
   * Notes the runs a document lists, each the first time it is shown. A
   * listener shows it every run it reads, as it reads them: rules that stop
   * at the first heard run do not ask about the rest, and a run first seen
   * only when it is first asked about would be counted as heard for longer
   * than it should be.
   * @param {Iterable<{ id: string }> | undefined} runs
   */
  saw(runs) {
    const now = this.clock.now();
    for (const run of runs ?? []) {
      if (!this.firstSeen.has(run.id)) {
        this.firstSeen.set(run.id, now);
      }
    }
  }

  /** Notes that the run's pool has just said it is going on. @param {string} runId */
  heardFrom(runId) {
    this.lastHeard.set(runId, this.clock.now());
  }

  /** Lets go of what is known of a run, once the listener no longer follows its task. @param {string} runId */
  forget(runId) {
    this.firstSeen.delete(runId);
    this.lastHeard.delete(runId);
  }
}

// What is read from a task

/**
 * Whether a document is a task at all: anyone can write a queue, so an entry
 * can name anything.
 * @param {unknown} doc
 * @returns {doc is Task}
 */
export function isTask(doc) {
  const it = /** @type {Task | null} */ (doc);
  return !!it && typeof it === 'object' && typeof it.importUrl === 'string' && Array.isArray(it.runs);
}

/** @param {RunStatus | undefined | null} status @returns {status is FinalStatus} */
export const isFinal = (status) =>
  status === 'succeeded' || status === 'failed' || status === 'cancelled';

/** Whether a run is still to be completed by its pool. @param {Pick<Run, 'status'>} run */
export const isOpen = (run) => run.status === undefined || run.status === null;

/**
 * The task's first open run, in list order, that is heard: the run that has the task.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @param {Heard} heard
 * @returns {Run | null}
 */
export function holder(task, heard) {
  return task?.runs?.find((run) => isOpen(run) && heard(run.id)) ?? null;
}

/**
 * The first record in list order that ends the task for good, whether or
 * not anything open comes before it. A document's word alone: where there
 * is one, the task is no longer wanted.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @returns {Run | null}
 */
export function endingRun(task) {
  return task?.runs?.find((run) => isFinal(run.status)) ?? null;
}

/** How many of the task's runs were lost. @param {Pick<Task, 'runs'> | undefined} task */
export const lostCount = (task) => task?.runs?.filter((run) => run.status === 'lost').length ?? 0;

/**
 * Whether the task is still to be run: it is a task, and no record has
 * ended it. A document's word alone; pools and askers go by it.
 * @param {unknown} task
 */
export function isWanted(task) {
  return isTask(task) && !endingRun(task);
}

/**
 * How the task ended, or null if it has not: the status of the first record
 * in its list that ends it, unless a heard open run comes before that
 * record, which may yet end it differently.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @param {Heard} heard
 * @returns {FinalStatus | null}
 */
export function ending(task, heard) {
  for (const run of task?.runs ?? []) {
    if (isFinal(run.status)) {
      return run.status;
    }
    if (isOpen(run) && heard(run.id)) {
      return null;
    }
  }
  return null;
}

/**
 * `waiting`: nobody has it; never taken, or every run of it is over without ending it.
 * `running`: a heard run has it.
 * `stalled`: runs of it are open and none is heard; its pool is gone or out of earshot, and another may take it.
 * `stopping`: someone has stopped it, and the run that has it hasn't stopped yet.
 * @typedef {'waiting' | 'running' | 'stalled' | 'stopping' | FinalStatus} TaskState
 */

/** @param {TaskState | 'missing'} state */
export const isFinished = (state) =>
  state === 'succeeded' || state === 'failed' || state === 'cancelled';

/**
 * A task's state, from its own document and from which of its runs the
 * reader hears. A task that is not here yet is waiting.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @param {Heard} heard
 * @returns {TaskState}
 */
export function taskState(task, heard) {
  const ended = ending(task, heard);
  if (ended) {
    return ended;
  }
  if (holder(task, heard)) {
    return task?.runs?.some((run) => run.status === 'cancelled') ? 'stopping' : 'running';
  }
  return task?.runs?.some(isOpen) ? 'stalled' : 'waiting';
}

/**
 * The result of a task that succeeded: that of the record that ended it.
 * @param {Pick<Task, 'runs'> | undefined} task
 */
export function taskResult(task) {
  const by = endingRun(task);
  return by?.status === 'succeeded' ? by.result : undefined;
}

/**
 * Why a task failed, for a person: the last line of the run that ended it;
 * null if it has not failed.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @param {Heard} heard
 * @returns {string | null}
 */
export function taskError(task, heard) {
  if (ending(task, heard) !== 'failed') {
    return null;
  }
  return endingRun(task)?.logs?.at(-1)?.message ?? 'failed';
}

/** The last line of a run recorded `failed` because it was the task's MAX_LOST-th loss. */
export const LOST_TOO_OFTEN = `it was lost ${MAX_LOST} times: each time, what was running it stopped before it finished`;

// What is read from a queue

/**
 * Whether what's under a key in `jobs` is an entry at all: anyone can write a queue.
 * @param {unknown} entry
 * @returns {entry is Entry}
 */
export function isEntry(entry) {
  const it = /** @type {Entry | null} */ (entry);
  return !!it && typeof it === 'object' && typeof it.taskUrl === 'string';
}

/**
 * What a queue's key says of a task: it names `this` task, it names an
 * `other`, or it names `none`.
 *
 * These are three different things. `other` means a second ask took the key
 * (two askers at once; the merge kept one), and this task is not the one
 * wanted. `none` means only that the entry is gone, which is what happens
 * when a task ends, and the queue's word of that can arrive before the
 * task's own: by itself it says nothing about the task.
 * @typedef {'this' | 'other' | 'none'} Named
 */

/**
 * @param {Pick<Queue, 'jobs'> | undefined} queue
 * @param {string} key
 * @param {string} taskUrl
 * @returns {Named}
 */
export function named(queue, key, taskUrl) {
  const entry = entryAt(queue, key);
  if (!entry) {
    return 'none';
  }
  return entry.taskUrl === taskUrl ? 'this' : 'other';
}

/**
 * The entry a queue has under `key`, or null. Only a key of the queue's own
 * counts: `jobs` is a plain object to its readers, and a name like
 * `__proto__` would otherwise be found by some of them and not by others.
 * @param {Pick<Queue, 'jobs'> | undefined} queue
 * @param {string} key
 * @returns {Entry | null}
 */
export function entryAt(queue, key) {
  const jobs = queue?.jobs;
  if (!jobs || !Object.hasOwn(jobs, key)) {
    return null;
  }
  return isEntry(jobs[key]) ? jobs[key] : null;
}

/** One piece of work a queue lists. @typedef {Entry & { key: string }} Work */

/**
 * What a queue lists, in the order to take it: oldest ask first, and by key
 * where two were asked at once, so that everyone goes through it the same way.
 * @param {Pick<Queue, 'jobs'> | undefined} queue
 * @returns {Work[]}
 */
export function waitingWork(queue) {
  return Object.entries(queue?.jobs ?? {})
    .filter(([, entry]) => isEntry(entry))
    .map(([key, entry]) => ({
      key,
      taskUrl: entry.taskUrl,
      askedAt: entry.askedAt,
      package: entry.package ?? null,
    }))
    .sort(
      (a, b) =>
        (Number(a.askedAt) || 0) - (Number(b.askedAt) || 0) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
}

// A pool's decisions

/**
 * Whether `pool` may take a task: it is still wanted, its queue's key names
 * it, no run that the pool hears has it, and the pool has no open run of it.
 * (A pool that finds an open run of its own that it is not running completes
 * it first; see `gone`.)
 *
 * Whether the pool accepts the task's code is a separate question, asked of
 * the entry before this and of the task's `importUrl` with it.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @param {string} pool
 * @param {Named} is
 * @param {Heard} heard
 */
export function mayClaim(task, pool, is, heard) {
  if (!isTask(task) || is !== 'this' || !isWanted(task)) {
    return false;
  }
  if (task.runs.some((run) => isOpen(run) && run.pool === pool)) {
    return false;
  }
  return holder(task, heard) === null;
}

/**
 * Why a pool must stop a run it has, or null to carry on.
 *
 * `cancelled`: the task has been stopped (some record says `cancelled`). The
 * run is recorded as stopped too.
 *
 * `yielded`: the work is done (some record says `succeeded`), or a record
 * before this run in the list ended the task, or its key now names another
 * task, or an earlier run that this pool hears has it. The run is recorded
 * as having given way, which ends nothing: no second ending is added to
 * compete with one that stands, and a task that lost its key is not ended
 * by the queue's say-so, because its asker, reading the task before the
 * queue, would take that for its answer.
 *
 * A record after this run that says `failed` stops nothing: this run was
 * taken first, is still going, and if it succeeds, that is how the task
 * ended. Nor does a key that names nothing (see `Named`).
 * @param {Pick<Task, 'runs'>} task
 * @param {string} runId
 * @param {Named} is
 * @param {Heard} heard
 * @returns {'cancelled' | 'yielded' | null}
 */
export function stopReason(task, runId, is, heard) {
  const runs = task?.runs ?? [];
  const at = runs.findIndex((run) => run.id === runId);
  if (at < 0 || !isOpen(runs[at])) {
    return 'yielded'; // not this pool's to run any more
  }
  if (runs.some((run) => run.status === 'cancelled')) {
    return 'cancelled';
  }
  const before = runs.slice(0, at);
  if (runs.some((run) => run.status === 'succeeded') || before.some((run) => isFinal(run.status))) {
    return 'yielded';
  }
  if (is === 'other') {
    return 'yielded';
  }
  if (before.some((run) => isOpen(run) && heard(run.id))) {
    return 'yielded';
  }
  return null;
}

/**
 * The open runs bearing `pool`'s name that it is not running (`has` says
 * which it is): runs it started and lost track of, by stopping or crashing.
 * It completes each as `gone` says.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @param {string} pool
 * @param {(runId: string) => boolean} has
 * @returns {Run[]}
 */
export function orphans(task, pool, has) {
  return (task?.runs ?? []).filter((run) => run.pool === pool && isOpen(run) && !has(run.id));
}

/**
 * What a pool records for an open run of its own that it is not running: it
 * stopped, or crashed and came back. If the task has been stopped, ended or
 * lost its key meanwhile, what the run would have been stopped for.
 * Otherwise the run was lost: `lost`, or, when the task has already lost
 * MAX_LOST - 1 runs, `failed` (with LOST_TOO_OFTEN as its last line), which
 * ends the task. Who else may hold the task is not asked: a pool that has
 * only just started has heard nobody yet, and a run that died is lost
 * whoever came after.
 *
 * Machines that lose runs of one task at the same moment each count the
 * losses they have seen, so the task may be started once more than MAX_LOST
 * times before one of them records the failure.
 * @param {Pick<Task, 'runs'>} task
 * @param {string} runId
 * @param {Named} is
 * @returns {'cancelled' | 'yielded' | 'lost' | 'failed'}
 */
export function gone(task, runId, is) {
  const stop = stopReason(task, runId, is, () => false);
  if (stop) {
    return stop;
  }
  return lostCount(task) >= MAX_LOST - 1 ? 'failed' : 'lost';
}

/**
 * Whether an entry should be deleted: it names this task, and a record has
 * ended the task (so nobody will take it again). Any pool may; the pool
 * that ended the task does at once.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @param {Named} is
 */
export function mayDelist(task, is) {
  return is === 'this' && !!endingRun(task);
}

/**
 * Whether an asker still waiting on a task should list it again: its key
 * has named nothing since `noneSince` (the asker's clock), LAPSE_MS or more
 * ago, and the task is still wanted and nobody heard has it.
 *
 * The lapse is what lets the task's own news arrive first when the entry
 * went because the task ended. Listing a task that has in fact ended costs
 * at most a run that gives way as soon as its pool learns of the ending.
 * @param {Pick<Task, 'runs'> | undefined} task
 * @param {Named} is
 * @param {Heard} heard
 * @param {number} noneSince
 * @param {number} now
 */
export function mayRelist(task, is, heard, noneSince, now) {
  return (
    is === 'none' &&
    isWanted(task) &&
    holder(task, heard) === null &&
    now - noneSince >= LAPSE_MS
  );
}

// Changes. Each is to be called inside a change to the document.

/**
 * Throws for a name that cannot be a key: an object's readers would not all
 * find `__proto__` (see `entryAt`).
 * @param {string} key
 */
export function checkKey(key) {
  if (key === '__proto__') {
    throw new Error('"__proto__" cannot be a key');
  }
}

/**
 * Lists a task under `key`, unless one is listed already. `over` names a
 * task the caller knows has ended: an entry that still names it is replaced.
 * Two askers at once each list their own; the merge keeps one, and both find
 * the same task under the key from then on.
 * @param {Queue} queue
 * @param {string} key
 * @param {Entry} entry
 * @param {string} [over]
 */
export function listTask(queue, key, entry, over) {
  checkKey(key);
  if (!queue.jobs) {
    queue.jobs = {};
  }
  const listed = entryAt(queue, key);
  if (!listed || (over !== undefined && listed.taskUrl === over)) {
    queue.jobs[key] = {
      taskUrl: entry.taskUrl,
      askedAt: entry.askedAt,
      package: entry.package ?? null,
    };
  }
}

/**
 * Deletes the entry under `key` if it names `taskUrl`.
 * @param {Queue} queue
 * @param {string} key
 * @param {string} taskUrl
 */
export function delistTask(queue, key, taskUrl) {
  if (named(queue, key, taskUrl) === 'this') {
    delete queue.jobs[key];
  }
}

/**
 * Stops a task: appends a record that says `cancelled`, unless a record has
 * ended the task already. True if it did. A task nobody has taken never
 * starts; a run that has it is stopped by its pool.
 * @param {Task} task
 * @param {{ id: string, at: number }} stop  a name for the record, and the stopper's clock
 */
export function stopTask(task, stop) {
  if (endingRun(task)) {
    return false;
  }
  task.runs.push({ id: stop.id, start: stop.at, end: stop.at, status: 'cancelled' });
  return true;
}

/**
 * Takes a task: appends a run of it. Only after `mayClaim`.
 * @param {Task} task
 * @param {Pick<Run, 'id' | 'pool' | 'start'>} run
 */
export function claimRun(task, run) {
  task.runs.push({ id: run.id, pool: run.pool, start: run.start });
}

/**
 * Completes a run, once: a run that has been completed is left as it is.
 * Only its own pool calls this.
 *
 * The completed run replaces the open one whole, as one value. So if a run
 * is ever completed twice from two places at once (a pool and a second copy
 * of itself), one of the two records stands entire, never a mixture.
 *
 * A result is kept as JSON. One that JSON cannot carry, or that comes to
 * more than MAX_RESULT_BYTES, makes the run `failed`, with a line saying so:
 * the change that ends a task has to reach everyone who reads it.
 * @param {Task} task
 * @param {string} runId
 * @param {{ status: RunStatus, result?: any, logs?: LogLine[], end: number }} how
 */
export function endRun(task, runId, how) {
  const at = task.runs.findIndex((it) => it.id === runId);
  const run = task.runs[at];
  if (!run || !isOpen(run)) {
    return;
  }
  let { status } = how;
  const logs = (how.logs ?? []).map((line) => ({
    timestampMillis: Number(line.timestampMillis) || 0,
    message: String(line.message),
  }));
  let result = null;
  if (status === 'succeeded') {
    let json = null;
    try {
      json = JSON.stringify(how.result ?? null) ?? null;
    } catch {
      // not something JSON can carry
    }
    const bytes = json === null ? 0 : new TextEncoder().encode(json).length;
    if (json === null || bytes > MAX_RESULT_BYTES) {
      status = 'failed';
      logs.push({
        timestampMillis: how.end,
        message:
          json === null
            ? 'its result is not something a document can hold'
            : `its result is ${bytes} bytes, more than the ${MAX_RESULT_BYTES} a task's document carries: write it to a document and return that document's url`,
      });
    } else {
      result = JSON.parse(json);
    }
  }
  task.runs[at] = {
    id: run.id,
    pool: run.pool,
    start: run.start,
    end: how.end,
    status,
    result,
    logs: logs.slice(-MAX_LOG_LINES),
  };
}
