// What a task's function is handed.
//
// A task's code is a module whose default export is a function of the task's
// input. It is called with this context as `this` (as tasks always were, for
// `this.log`) and again as a second argument, for functions that would rather
// not use `this`.
//
// A worker may run several tasks one after another, so code should not leave
// timers or unawaited work behind when it returns.

import type { AutomergeUrl, Repo } from '@automerge/automerge-repo/slim';

export interface TaskContext {
  /** A line for the run's log. Whoever is watching the task hears it at once; the last lines are kept with the run. */
  log(...args: unknown[]): void;
  /**
   * How far along the task is, as anything that can be sent: a number, a
   * sentence, `{ step, of }`. Whoever is watching hears the latest; it isn't kept.
   */
  progress(value: unknown): void;
  /**
   * Aborted when the run must stop, with the reason as `signal.reason`:
   * `'cancelled'` (someone stopped the task), `'yielded'` (another run has
   * the task, or has ended it) or `'stopping'` (the machine's pool is shutting
   * down, and the task will be taken again). GRACE_MS after the abort the
   * code's worker is ended, whatever it is doing, so code that holds
   * something outside its worker (a child process, a lock on a file) lets go
   * of it when this aborts. What the code returns or throws after an abort
   * is not counted, but what it writes before returning (a run document's
   * "cancelled") is saved like any other write, within the same GRACE_MS.
   */
  signal: AbortSignal;
  /**
   * Resolves once the pool has held this run for a beat (BEAT_MS, from when
   * its taking was saved) without anything stopping it. An earlier run of the
   * task makes this one yield before it settles when its record reaches the
   * pool within that beat: one taken before this run by a pool heard within
   * the beat, and one taken at about the same moment by a pool whose round
   * trip to this one is under the beat. So code awaits it before doing what
   * cannot be undone (a payment, a message sent). It resolves at most once,
   * and never after `signal` aborts: then it rejects, with "the run stopped
   * before it settled (<reason>)". It is not exclusivity: an earlier run
   * whose record arrives later than that (its pool cut off for longer than
   * the beat, or a round trip longer than the beat) still aborts `signal`
   * with `yielded`, with what was done already done. Code that never looks
   * at it is not affected.
   */
  settled: Promise<void>;
  /**
   * The worker's Repo, for a task whose work is on documents. It reaches
   * documents, the task's included, through its host's Repo, which has them
   * with no network if it has them kept.
   *
   * One thing differs from the Repo itself: `find` waits for a document that
   * has not arrived yet (asking again for about half a minute, as
   * `findWhenThere` in task-client.js does) instead of rejecting at once,
   * because what a task is handed was often made a moment before it was
   * asked, elsewhere. A url the Repo cannot read, and a `signal` passed to
   * `find` aborting, end the asking at once. Everything else is the Repo's
   * own, and the Repo's own workings still use its own `find`.
   *
   * What the code changes through it the Repo saves and sends in its own
   * time; the run is said to have ended as soon as the code returns.
   */
  repo: Repo;
  /** The task's own document. */
  taskUrl: AutomergeUrl;
  /**
   * This run's id. It is in the task's `runs` before the code is called, with
   * every earlier run of the task before it. A task runs at least once, not
   * exactly once, so work that must not be done twice says which run is
   * doing it in what it writes (a field naming its owner) and checks that
   * before each effect: a second run finds the first one's name there, and
   * knows it is the second.
   */
  run: string;
  /** The key the task was asked for under, in its queue's `jobs`. */
  key: string | null;
}

/**
 * A task's function: does the work and resolves to its result, which must be
 * something JSON can carry, of at most MAX_RESULT_BYTES. Throwing ends the
 * task as failed, with the error as the run's last log line; it is not run
 * again for that.
 */
export type TaskFunction<Input = any, Result = any> = (
  this: TaskContext,
  input: Input,
  context: TaskContext,
) => Promise<Result> | Result;
