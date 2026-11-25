// Tasks asked for by key, stopped, and watched: what this adds to a task.
//
// A task is what it always was: a doc with an input, the URL of the code to
// run on it, and the runs it has had. Three things are added, none of which
// changes what a task is.
//
// - A key. A queue's `pending` list runs whatever is pushed onto it, twice if
//   it's pushed twice. A queue's `jobs` map lists a task under a key, so two
//   askers of one key (two tabs that both see a result is out of date) get
//   one task: both write the entry, the merge keeps one, the same one for
//   everybody, and both follow that. The entry stays when the task is over,
//   which makes it the answer to "has this been worked out already": derive
//   the key from the code and the input, and asking again is free.
//
//   One task is not yet one run: a router may have handed out the first ask's
//   task before the second ask arrived and took its place under the key. Two
//   rules make it one run all the same. A router hands out nothing for a key
//   while a task for that key is out (a worker's doc says which key it is
//   on). And a task that has run is the one the key names: its worker puts it
//   there as it marks the key finished. So the other ask's task is never
//   handed out, and both askers find the run that happened. (Not when the run
//   is over before the second ask has reached its worker: then the second
//   runs too. That takes a task quicker than a document crosses the network,
//   which is a task cheap to run twice.)
//
// - Stopping. `cancelled` in the task doc aborts the signal its function was
//   handed, wherever it is running, and nothing un-cancels a task.
//
// - Watching. The worker on a task says how it is going on the task doc's own
//   channel, as ephemeral messages: progress and log lines reach whoever has
//   the task open, on this computer or another, and nothing is written for
//   them. The doc itself says only what must outlast the run: that it's
//   running and where (`current`), each run's outcome and log, and how the
//   task ended for good (`outcome`).
//
// So everything about a task is read from its own doc and heard on its own
// channel. A queue's entry is for routers: which task a key names, and
// whether to stop handing it out.
//
// What ends a task: its code returning, its code throwing, or someone
// stopping it. Each is final. A task whose code threw is not run again by the
// system: whoever asked decides whether to ask again, and knows what it cost.
// The one thing the system does again by itself is a run that never said how
// it ended, because its worker went away: the next worker to start the task
// records that run as `lost` and runs it afresh, up to MAX_LOST times, after
// which the task has failed. So a task ends after a bounded number of starts,
// whatever goes wrong.
//
// What it promises is the framework's promise: a task runs at least once, not
// exactly once. Its code must be safe to run twice, or must guard itself: it
// is handed the name of its run (see job-context.ts) for that.

import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import type { JobEntry, RunStatus, TaskDoc, TaskQueueDoc, WorkerDoc } from './datatype';
import { acceptanceOf, acceptsPackage, type Acceptance } from './acceptance';

/** How many of a task's runs may be lost (see `lostRuns`) before the task has failed. */
export const MAX_LOST = 3;

/**
 * How long a run may go unheard before a reader stops taking it for running.
 * Its worker says it is on it every two seconds (worker.ts), so this is four
 * of those missed and a little over.
 */
export const HEARD_WITHIN_MS = 10_000;

// What a queue has waiting

/** One piece of waiting work. */
export interface Work {
  taskUrl: AutomergeUrl;
  /** The key it is listed under, or null for a task on the `pending` list. */
  key: string | null;
  /**
   * The package its code is in (see import-url.ts), null if it is in none,
   * and undefined where the queue doesn't say: a task on the `pending` list
   * is only a url there.
   */
  package: string | null | undefined;
}

/** Whether what's under a key in `jobs` is an entry at all: anyone can write a queue. */
export function isJobEntry(entry: unknown): entry is JobEntry {
  const job = entry as JobEntry | null;
  return !!job && typeof job === 'object' && typeof job.taskUrl === 'string';
}

/**
 * Everything a queue has waiting to be handed out, in the order to hand it
 * out: its `pending` tasks as listed, then its unfinished keyed ones, oldest
 * ask first. One at a time, because a router mostly wants the first few of a
 * long list.
 */
export function* eachWaiting(queue: Pick<TaskQueueDoc, 'pending' | 'jobs'>): Generator<Work> {
  for (const taskUrl of queue.pending ?? []) {
    yield { taskUrl, key: null, package: undefined };
  }
  const jobs = Object.entries(queue.jobs ?? {})
    .filter(([, job]) => isJobEntry(job) && !job.done)
    .sort(([keyA, a], [keyB, b]) => (a.askedAt || 0) - (b.askedAt || 0) || (keyA < keyB ? -1 : 1));
  for (const [key, job] of jobs) {
    yield { taskUrl: job.taskUrl, key, package: job.package ?? null };
  }
}

/** All of {@link eachWaiting} at once. */
export const waitingWork = (queue: Pick<TaskQueueDoc, 'pending' | 'jobs'>): Work[] => [
  ...eachWaiting(queue),
];

/** Whether a queue has anything waiting at all. */
export function hasWaitingWork(queue: Pick<TaskQueueDoc, 'pending' | 'jobs'>) {
  return (
    (queue.pending?.length ?? 0) > 0 ||
    Object.values(queue.jobs ?? {}).some((job) => isJobEntry(job) && !job.done)
  );
}

// What a worker takes

/** What a worker takes from one queue, as its own doc says. */
export interface Taking {
  /** Whether it knows about keys at all. One that doesn't would never mark a key finished. */
  keyed: boolean;
  /** Whose code it runs from this queue; undefined for none. */
  acceptance: Acceptance | undefined;
}

/**
 * What a worker's doc says it takes from `queueUrl`. A worker from before any
 * of this says nothing: it runs whatever it's handed, and knows no keys.
 */
export function takingOf(
  worker: Pick<WorkerDoc, 'accepts'> | undefined,
  queueUrl: AutomergeUrl,
): Taking {
  if (!worker?.accepts || typeof worker.accepts !== 'object') {
    return { keyed: false, acceptance: 'any' };
  }
  const said = worker.accepts[queueUrl];
  return { keyed: true, acceptance: said === 'any' ? 'any' : acceptanceOf({ packages: said }) };
}

/**
 * Whether a worker taking this can be handed this work. A task on the
 * `pending` list is only a url to a router, which can't tell whose code it
 * is: it goes to a worker that takes any.
 */
export function canRun(taking: Taking, work: Pick<Work, 'key' | 'package'>) {
  if (work.key !== null && !taking.keyed) {
    return false;
  }
  if (work.package === undefined) {
    return taking.acceptance === 'any';
  }
  return acceptsPackage(taking.acceptance, work.package);
}

// Changes to a queue's keyed tasks. Each is to be called inside a change to the doc.

/**
 * Lists a task under `key`, unless one is there. A queue from before there
 * were keys gets its map here; two askers who both give it one keep one map,
 * and with it one's entries, which is why an asker looks again (see `run` in
 * job-client.ts) rather than taking its first write as the last word.
 */
export function listJob(
  queue: TaskQueueDoc,
  key: string,
  entry: Pick<JobEntry, 'taskUrl' | 'askedAt' | 'package'>,
) {
  if (!queue.jobs) {
    queue.jobs = {};
  }
  if (!isJobEntry(queue.jobs[key])) {
    queue.jobs[key] = {
      taskUrl: entry.taskUrl,
      askedAt: entry.askedAt,
      package: entry.package ?? null,
    };
  }
}

/**
 * Marks the key finished with, by `taskUrl`, unless it is marked already or
 * there's nothing under the key any more (it was forgotten).
 *
 * The task that ran is the one the key names from now on. It may have named
 * another meanwhile, the task of a second ask that took the first's place
 * while the first was out being run; that one never ran, and now never will.
 */
export function finishJob(queue: TaskQueueDoc, key: string, taskUrl: AutomergeUrl) {
  const job = queue.jobs?.[key];
  if (!isJobEntry(job) || job.done) {
    return;
  }
  if (job.taskUrl !== taskUrl) {
    job.taskUrl = taskUrl;
  }
  job.done = true;
}

/** Takes the key off the list, so that asking for it again is a new task. */
export function forgetJob(queue: TaskQueueDoc, key: string) {
  if (queue.jobs && key in queue.jobs) {
    delete queue.jobs[key];
  }
}

// What has become of a task

export type TaskState =
  /** Not running: never handed out yet, or between tries. */
  | 'waiting'
  /** A worker is on it. */
  | 'running'
  /** Asked to stop, and the worker on it hasn't yet. */
  | 'stopping'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export const isFinished = (state: TaskState) =>
  state === 'succeeded' || state === 'failed' || state === 'cancelled';

/**
 * A task's state, from its own doc and from whether its run is being heard.
 *
 * How it ended, and that it was stopped, are read from the doc: the run that
 * ends a task and the word that it has ended are one change to one document,
 * so a reader has both or neither. That a run is going on is never taken on
 * the doc's word alone. `current` says a run started; only the worker saying
 * so, heard on the task's channel, says it is still going (`heard`: true
 * while it is, see `isHeard`). A run whose worker has died therefore reads as
 * waiting, which is what it is: waiting to be handed out again.
 */
export function taskState(
  task: Pick<TaskDoc<any, any>, 'current' | 'cancelled' | 'outcome'> | undefined,
  heard = true,
): TaskState {
  if (task?.outcome) {
    return task.outcome;
  }
  const running = !!task?.current && heard;
  if (task?.cancelled) {
    return running ? 'stopping' : 'cancelled';
  }
  return running ? 'running' : 'waiting';
}

/**
 * Whether a run is being heard, on the reader's own clock: its worker was
 * last heard less than HEARD_WITHIN_MS ago, or has never been heard and the
 * reader first saw the run less than that long ago (the word may be on its
 * way). No clock but the reader's is consulted.
 */
export function isHeard(
  lastHeardAt: number | null,
  firstSeenAt: number,
  now: number,
): boolean {
  return now - (lastHeardAt ?? firstSeenAt) < HEARD_WITHIN_MS;
}

/** The result of a task that succeeded: its last successful run's. */
export function taskResult<Result>(task: Pick<TaskDoc<any, Result>, 'runs'> | undefined) {
  return task?.runs?.findLast((run) => run.status === 'succeeded')?.result;
}

/**
 * The runs of a task that were started and never said how they ended, by
 * name: each recorded `lost` by a later run, and with no record of its own.
 * A run that was wrongly given up for lost, and then finished, has both, and
 * is not counted: it was only slow to be heard. Nor is one counted twice
 * because two later runs both said it was lost.
 */
export function lostRuns(task: Pick<TaskDoc<any, any>, 'runs'>): string[] {
  const reported = new Set<string>();
  const lost = new Set<string>();
  for (const run of task.runs) {
    if (run.run) {
      (run.status === 'lost' ? lost : reported).add(run.run);
    }
  }
  return [...lost].filter((run) => !reported.has(run));
}

/** Whether a task has lost as many runs as it may, and so has failed. */
export function lostTooOften(task: Pick<TaskDoc<any, any>, 'runs'>) {
  return lostRuns(task).length >= MAX_LOST;
}
