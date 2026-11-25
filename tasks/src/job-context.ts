// What a task's function is handed.
//
// A task's code is a module whose default export is a function of the task's
// input. It is called with this context as `this` (as tasks always were, for
// `this.log`) and again as a second argument, for functions that would rather
// not use `this`.

import type { AutomergeUrl, Repo } from '@automerge/automerge-repo/slim';

export interface TaskContext {
  /** A line for the run's log. Whoever is watching the task sees it at once; it is kept with the run. */
  log(...args: unknown[]): void;
  /**
   * How far along the task is, as anything that can be sent: a number, a
   * sentence, `{ step, of }`. Whoever is watching sees the latest; it isn't kept.
   */
  progress(value: unknown): void;
  /**
   * Aborted when someone cancels the task. Code that takes a while should
   * stop when it is: code that doesn't is left running and its result dropped.
   */
  signal: AbortSignal;
  /** The worker's Repo, for a task whose work is on documents. */
  repo: Repo;
  /** The task's own document. */
  taskUrl: AutomergeUrl;
  /**
   * This run: the name of the one hand-out of the task that started it, never
   * used for another. A task runs at least once, so work that must not be
   * done twice says which run is doing it in what it writes (a field naming
   * its owner) and checks that before each effect: a second run finds the
   * first one's name there, and knows it is the second.
   */
  run: string;
  /** The key it was asked for under, if it was asked for by key. */
  key: string | null;
}

/**
 * A task's function: does the work and resolves to its result, which must be
 * something that can go in a document. Throwing fails the run; a task is
 * tried a few times before it is given up on.
 */
export type TaskFunction<Input = any, Result = any> = (
  this: TaskContext,
  input: Input,
  context: TaskContext,
) => Promise<Result> | Result;
