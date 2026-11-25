// A task that does nothing useful, slowly: for trying a queue out, and for
// the probes. It waits `ms`, saying how far along it is, then gives back
// `value`; `fail` makes it throw instead. It stops at once when cancelled.
//
// It imports nothing, so it runs wherever a task can: a browser's worker, or
// a Node process (src/node).

import type { TaskFunction } from '../job-context';

export interface WaitInput {
  /** How long to wait, in milliseconds. */
  ms?: number;
  /** What to give back. */
  value?: unknown;
  /** Throw at the end rather than give anything back. */
  fail?: boolean;
}

const STEP_MS = 100;

const wait: TaskFunction<WaitInput | null, unknown> = async function (input, { signal, log, progress }) {
  const ms = Math.max(0, Number(input?.ms ?? 1_000));
  log(`waiting ${ms} ms`);
  const started = Date.now();
  while (Date.now() - started < ms) {
    signal.throwIfAborted();
    progress(Math.min(1, (Date.now() - started) / ms));
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(STEP_MS, ms - (Date.now() - started)));
      signal.addEventListener('abort', done);
    });
  }
  signal.throwIfAborted();
  progress(1);
  if (input?.fail) {
    throw new Error('asked to fail');
  }
  return input?.value ?? null;
};

export default wait;
