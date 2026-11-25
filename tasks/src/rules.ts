// The whole of the task system's rules: what the documents are, and what may
// be read from them. Everything else (a pool, an asker, a view) is these rules
// applied to documents and to what has been heard.
//
// THREE THINGS
//
// A task is a document: where its code is (`importUrl`: anything `import()`
// takes), what to hand it (`input`), the key it was asked for under, and the
// runs it has had. Its code's default export is called with `(input, ctx)`
// (see job-context.ts).
//
// A queue is a document: the tasks asked of it that have not ended, each
// under its key. Whoever can write a queue can ask it for work and stop that
// work, so the queue is what is shared and what is lent workers.
//
// A pool is the one set of workers a machine has. It serves the queues it has
// been told to, runs only the code it accepts from each (acceptance.ts), and
// has a name that outlives its restarts.
//
// WHAT IS WRITTEN
//
// A pool takes a task by appending a run to the task's `runs`, and that pool
// alone later completes that run with how it went. An asker lists a task
// under its key, and may flag the task `cancelled`. An entry is deleted when
// its task has ended. Nothing else is written, and nothing that says "now":
// no holder field, no heartbeat, no outcome field. So a copy of a task or a
// queue is as true as the original, and two changes made apart always merge
// to something these rules read one way.
//
// Everything about a task is read from its own document. A queue's entry
// says which task a key names and that the task is wanted; it never says how
// the task went. The two documents travel separately, so a rule that read
// "the entry is gone" as "the task is over" or "was stopped" would be wrong
// whenever the queue's news arrived first.
//
// WHAT IS READ
//
// - A run is OPEN until its pool has completed it.
// - A run is HEARD while its pool is saying so on the task's channel (see
//   `isHeard`). Heard is each listener's own knowledge, never a document's.
// - The task's HOLDER is its first open run, in list order, that is heard.
// - The task's ENDING is the status of its first run, in list order, that
//   ended for good (`succeeded`, `failed`, `cancelled`). Failing that, it is
//   `failed` once MAX_LOST of its runs were lost, and `cancelled` once it is
//   flagged. Otherwise it has not ended.
//
// List order is the same for everyone who has the same runs, and a run
// appended by someone who had seen another lands after it. So everyone who
// hears the same runs agrees on the holder, and a pool that takes a task
// because it could not hear the holder gives way when it can: a wrong "it is
// gone" costs the later run its work, never the earlier one.
//
// HOW A RUN GOES (a pool's side)
//
// - A pool may TAKE a task that its queue lists under the task's key, that
//   has no ending, that nobody heard holds, and that the pool has no open run
//   of already (`mayClaim`).
// - It STOPS a run of its own as soon as the task has ended some other way,
//   is flagged, has lost its key to another task, or is held by an earlier
//   run it can hear (`stopReason`). Only the flag makes the run `cancelled`,
//   which ends the task; the others make it `yielded`, which ends nothing.
//   Stopped code is told through its signal, and its worker is ended GRACE_MS
//   later whatever it does.
// - It records a run it started and no longer has (the pool stopped, or
//   crashed and came back) as `lost`. Only a run's own pool says so, which
//   makes it a fact; nobody ever records a guess about someone else's run.
//
// WHAT ENDS A TASK
//
// Its code returning, its code throwing, or someone stopping it; each once,
// for good. The system starts a task's code again only when a run was lost
// (MAX_LOST times at most: then the task has failed) or its holder can no
// longer be heard; never because it threw.
//
// WHAT AN ASKER DOES
//
// It lists its task under a key unless the key already names a task that has
// not ended, and from then on follows the key: whichever task the key names
// is the one, and when the key names nothing, the last one it named. It
// waits for that task's own document to say how it ended. If the key names
// nothing and the task has neither ended nor been heard for LAPSE_MS, the
// asker lists it again (`mayRelist`): it was asked for and is still wanted.
// Asking under a key whose task has ended is asking afresh; whether work was
// done already is for the asker to look up where the work's result lands.
//
// WHAT IS PROMISED
//
// At least once, not exactly once: a pool that cannot be heard and a pool
// that takes its place can both run a task to the end, and then the first in
// list order is the ending. Work that must not happen twice guards itself:
// its code is handed the name of its run, which is in the task's document
// before the code is called, and can see every earlier run there.
//
// The same idea is used wherever this lab has one of something at a time: a
// holder named in a document or a message, counted only while it is heard,
// within a lapse measured from first sight or last word.

import type { AutomergeUrl } from '@automerge/automerge-repo/slim';

// The documents

export interface Task<Input = unknown, Result = unknown> {
  title?: string;
  /** Where its code is: anything `import()` takes. */
  importUrl: string;
  input: Input;
  /** The key it was asked for under, in its queue's `jobs`. */
  key: string;
  /** Every run it has had, in the order pools took it. Only ever appended to. */
  runs: Run<Result>[];
  /** Someone has asked for it to stop. Never unset. */
  cancelled?: true;
}

export interface Run<Result = unknown> {
  /** The run's name: made by the pool that took the task, never used again. */
  id: string;
  /** The pool that took it. The only one that ever writes this run again. */
  pool: string;
  /** When it was taken, by that pool's clock. For people; no rule reads it. */
  start: number;

  // The rest is written once, in one change, by the same pool, when the run is over.

  end?: number;
  status?: RunStatus;
  /** What its code returned, if it `succeeded`. */
  result?: Result | null;
  /** The last lines its code logged. */
  logs?: LogLine[];
}

/** The ways a run ends a task for good. */
export type FinalStatus = 'succeeded' | 'failed' | 'cancelled';

/**
 * How a run went. Besides the three that end the task: `lost`, its pool
 * stopped or restarted without it; `yielded`, its pool stopped it because the
 * task had ended another way or an earlier run held it.
 */
export type RunStatus = FinalStatus | 'lost' | 'yielded';

export interface LogLine {
  timestampMillis: number;
  message: string;
}

export interface Queue {
  title?: string;
  /** The tasks asked for that have not ended, by key. */
  jobs: { [key: string]: Entry };
}

export interface Entry {
  taskUrl: AutomergeUrl;
  /** When it was asked for, by the asker's clock: only the order pools take work in. */
  askedAt: number;
  /** The package its code is in (see import-url.ts), or null for code that is in none. */
  package: string | null;
}

// The numbers

/** How often a pool says each of its runs is going on. */
export const BEAT_MS = 2_000;

/**
 * How long a run may go unheard before a listener stops counting it as
 * heard: four beats missed and a little over.
 */
export const LAPSE_MS = 10_000;

/** How long stopped code is given before its worker is ended. */
export const GRACE_MS = 5_000;

/** How many of a task's runs may be lost before the task has failed. */
export const MAX_LOST = 3;

/** The most a run's result may come to, as JSON. More than this belongs in a document of its own. */
export const MAX_RESULT_BYTES = 1_000_000;

/** How many of a run's last log lines are kept with it. */
export const MAX_LOG_LINES = 200;

// Hearing

/** Whether a listener counts the run with this name as heard, now. */
export type Heard = (runId: string) => boolean;

/**
 * Whether a run counts as heard, on the listener's own clock: it was last
 * heard less than LAPSE_MS ago, or has never been heard and the listener
 * first saw it less than that long ago (the word may be on its way). No clock
 * but the listener's is consulted.
 */
export function isHeard(lastHeardAt: number | null, firstSeenAt: number, now: number): boolean {
  return now - (lastHeardAt ?? firstSeenAt) < LAPSE_MS;
}

// What is read from a task

type Runs = Pick<Task<any, any>, 'runs'>;

export const isFinal = (status: RunStatus | undefined | null): status is FinalStatus =>
  status === 'succeeded' || status === 'failed' || status === 'cancelled';

/** Whether a run is still to be completed by its pool. */
export const isOpen = (run: Pick<Run, 'status'>) => run.status === undefined || run.status === null;

/** The task's first open run, in list order, that is heard: the run that has the task. */
export function holder<Result>(task: Pick<Task<any, Result>, 'runs'> | undefined, heard: Heard) {
  return task?.runs?.find((run) => isOpen(run) && heard(run.id)) ?? null;
}

/** The run that ended the task for good: the first in list order that ended it. */
export function endingRun<Result>(task: Pick<Task<any, Result>, 'runs'> | undefined) {
  return task?.runs?.find((run) => isFinal(run.status)) ?? null;
}

/** How many of the task's runs were lost. */
export const lostCount = (task: Runs | undefined) =>
  task?.runs?.filter((run) => run.status === 'lost').length ?? 0;

/**
 * How the task ended, or null if it has not. The first run that ended it
 * says; with no such run, too many lost runs is `failed`, and the flag is
 * `cancelled`.
 */
export function ending(
  task: Pick<Task<any, any>, 'runs' | 'cancelled'> | undefined,
): FinalStatus | null {
  const by = endingRun(task);
  if (by) {
    return by.status as FinalStatus;
  }
  if (lostCount(task) >= MAX_LOST) {
    return 'failed';
  }
  return task?.cancelled ? 'cancelled' : null;
}

export type TaskState =
  /** Nobody has it: never taken, or every run of it is over without ending it. */
  | 'waiting'
  /** A heard run has it. */
  | 'running'
  /** Runs of it are open, and none is heard: its pool is gone or out of earshot. Another may take it. */
  | 'stalled'
  /** Flagged, and the run that has it hasn't stopped yet. */
  | 'stopping'
  | FinalStatus;

export const isFinished = (state: TaskState) =>
  state === 'succeeded' || state === 'failed' || state === 'cancelled';

/**
 * A task's state, from its own document and from which of its runs the
 * reader hears. A task that is not here yet is waiting.
 */
export function taskState(
  task: Pick<Task<any, any>, 'runs' | 'cancelled'> | undefined,
  heard: Heard,
): TaskState {
  const ended = ending(task);
  const held = holder(task, heard) !== null;
  if (ended === 'cancelled' && !endingRun(task)) {
    // flagged, and no run has said it stopped
    return held ? 'stopping' : 'cancelled';
  }
  if (ended) {
    return ended;
  }
  if (held) {
    return 'running';
  }
  return task?.runs?.some(isOpen) ? 'stalled' : 'waiting';
}

/** The result of a task that succeeded: that of the run that ended it. */
export function taskResult<Result>(
  task: Pick<Task<any, Result>, 'runs' | 'cancelled'> | undefined,
): Result | null | undefined {
  const by = endingRun(task);
  return by?.status === 'succeeded' ? by.result : undefined;
}

/** Why a task failed, for a person; null if it has not. */
export function taskError(task: Pick<Task<any, any>, 'runs' | 'cancelled'> | undefined): string | null {
  if (ending(task) !== 'failed') {
    return null;
  }
  const by = endingRun(task);
  if (by) {
    return by.logs?.at(-1)?.message ?? 'failed';
  }
  return `the machine running it stopped ${MAX_LOST} times before it finished`;
}

// What is read from a queue

/** Whether what's under a key in `jobs` is an entry at all: anyone can write a queue. */
export function isEntry(entry: unknown): entry is Entry {
  const it = entry as Entry | null;
  return !!it && typeof it === 'object' && typeof it.taskUrl === 'string';
}

/**
 * What a queue's key says of a task: it names `this` task, it names an
 * `other`, or it names `none`.
 *
 * These are three different things. `other` means a second ask took the key
 * (two askers at once; the merge kept one), and this task will never be
 * wanted. `none` means only that the entry is gone, which is what happens
 * when a task ends, and the queue's word of that can arrive before the
 * task's own: by itself it says nothing about the task.
 */
export type Named = 'this' | 'other' | 'none';

export function named(
  queue: Pick<Queue, 'jobs'> | undefined,
  key: string,
  taskUrl: AutomergeUrl,
): Named {
  const entry = queue?.jobs?.[key];
  if (!isEntry(entry)) {
    return 'none';
  }
  return entry.taskUrl === taskUrl ? 'this' : 'other';
}

/** One piece of work a queue lists. */
export interface Work extends Entry {
  key: string;
}

/**
 * What a queue lists, in the order to take it: oldest ask first, and by key
 * where two were asked at once, so that everyone goes through it the same way.
 */
export function waitingWork(queue: Pick<Queue, 'jobs'> | undefined): Work[] {
  return Object.entries(queue?.jobs ?? {})
    .filter(([, entry]) => isEntry(entry))
    .map(([key, entry]) => ({ key, taskUrl: entry.taskUrl, askedAt: entry.askedAt, package: entry.package ?? null }))
    .sort((a, b) => (a.askedAt || 0) - (b.askedAt || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// A pool's decisions

/**
 * Whether `pool` may take a task: its queue's key names it, it has not ended,
 * no run that the pool hears has it, and the pool has no open run of it. (A
 * pool that finds an open run of its own that it is not running records it
 * `lost` first; see `endRun`.)
 *
 * Whether the pool accepts the task's code is a separate question, asked of
 * the entry before this and of the task's `importUrl` after (acceptance.ts).
 */
export function mayClaim(
  task: Pick<Task<any, any>, 'runs' | 'cancelled'> | undefined,
  pool: string,
  is: Named,
  heard: Heard,
): boolean {
  if (!task || is !== 'this' || ending(task) !== null) {
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
 * `cancelled`: the task is flagged. The run is recorded as stopped, which
 * ends the task: a fact about the task, in the task's own document.
 *
 * `yielded`: the task has ended some other way, its key now names another
 * task, or an earlier run that this pool hears has it. The run is recorded
 * as having given way, which ends nothing. Where a run that ended the task
 * is already known, no second ending is added to compete with it; and a task
 * that lost its key is not ended by the queue's say-so, because its asker,
 * reading the task before the queue, would take that for its answer.
 *
 * A key that names nothing stops nothing (see `Named`).
 */
export function stopReason(
  task: Pick<Task<any, any>, 'runs' | 'cancelled'>,
  runId: string,
  is: Named,
  heard: Heard,
): 'cancelled' | 'yielded' | null {
  const at = task.runs.findIndex((run) => run.id === runId);
  if (at < 0 || !isOpen(task.runs[at])) {
    return 'yielded'; // not this pool's to run any more
  }
  if (endingRun(task) || lostCount(task) >= MAX_LOST) {
    return 'yielded';
  }
  if (task.cancelled) {
    return 'cancelled';
  }
  if (is === 'other') {
    return 'yielded';
  }
  if (task.runs.slice(0, at).some((run) => isOpen(run) && heard(run.id))) {
    return 'yielded';
  }
  return null;
}

/**
 * Whether an asker still waiting on a task should list it again: its key
 * has named nothing since `noneSince` (the asker's clock), LAPSE_MS or more
 * ago, and the task has not ended and nobody heard has it.
 *
 * The lapse is what lets the task's own news arrive first when the entry
 * went because the task ended. Listing a task that has in fact ended costs
 * at most a run that gives way as soon as its pool learns of the ending.
 */
export function mayRelist(
  task: Pick<Task<any, any>, 'runs' | 'cancelled'> | undefined,
  is: Named,
  heard: Heard,
  noneSince: number,
  now: number,
): boolean {
  return (
    !!task &&
    is === 'none' &&
    ending(task) === null &&
    holder(task, heard) === null &&
    now - noneSince >= LAPSE_MS
  );
}

/**
 * Whether an entry should be deleted: its task has ended and it still names
 * that task. Any pool may; the pool that ended the task does at once.
 */
export function mayDelist(
  task: Pick<Task<any, any>, 'runs' | 'cancelled'> | undefined,
  is: Named,
): boolean {
  return is === 'this' && ending(task) !== null;
}

// Changes. Each is to be called inside a change to the document.

/**
 * Lists a task under `key`, unless one is listed already. `over` names a
 * task the caller knows has ended: an entry that still names it is replaced.
 * Two askers at once each list their own; the merge keeps one, and both find
 * the same task under the key from then on.
 */
export function listTask(queue: Queue, key: string, entry: Entry, over?: AutomergeUrl) {
  if (!queue.jobs) {
    queue.jobs = {};
  }
  const listed = queue.jobs[key];
  if (!isEntry(listed) || (over !== undefined && listed.taskUrl === over)) {
    queue.jobs[key] = {
      taskUrl: entry.taskUrl,
      askedAt: entry.askedAt,
      package: entry.package ?? null,
    };
  }
}

/** Deletes the entry under `key` if it names `taskUrl`. */
export function delistTask(queue: Queue, key: string, taskUrl: AutomergeUrl) {
  if (named(queue, key, taskUrl) === 'this') {
    delete queue.jobs[key];
  }
}

/** Takes a task: appends a run of it. Only after `mayClaim`. */
export function claimRun(task: Task<any, any>, run: Pick<Run, 'id' | 'pool' | 'start'>) {
  task.runs.push({ id: run.id, pool: run.pool, start: run.start });
}

/**
 * Completes a run, once: a run that has been completed is left as it is.
 * Only its own pool calls this.
 *
 * A result too large to be part of the task's document makes the run
 * `failed`, with a line saying so: the change that ends a task has to reach
 * everyone who reads it.
 */
export function endRun<Result>(
  task: Task<any, Result>,
  runId: string,
  how: { status: RunStatus; result?: Result | null; logs?: LogLine[]; end: number },
) {
  const run = task.runs.find((it) => it.id === runId);
  if (!run || !isOpen(run)) {
    return;
  }
  let { status } = how;
  const logs = (how.logs ?? []).slice(-MAX_LOG_LINES).map((line) => ({ ...line }));
  let result: Result | null = null;
  if (status === 'succeeded') {
    let size: number | null = null;
    try {
      size = JSON.stringify(how.result ?? null).length;
    } catch {
      // not something a document can hold
    }
    if (size === null || size > MAX_RESULT_BYTES) {
      status = 'failed';
      logs.push({
        timestampMillis: how.end,
        message:
          size === null
            ? 'its result is not something a document can hold'
            : `its result is ${size} bytes, more than the ${MAX_RESULT_BYTES} a task's document carries: write it to a document and return that document's url`,
      });
    } else {
      result = how.result ?? null;
    }
  }
  run.end = how.end;
  run.status = status;
  run.result = result;
  run.logs = logs;
}
