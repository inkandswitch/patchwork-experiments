// Where the work gets done: in a worker when there is one, and otherwise right here.
//
// The rest of the UI doesn't know which. It asks a Backend to evaluate the sheet, to
// search for scenarios that match the filters, and to count them exactly, and gets told
// about runs, focuses and counts as they progress.

import type { Filters } from '../model/analysis';
import type { CompiledSheet } from '../model/compile';
import { ExactCounter } from '../model/exact';
import { Focuser, type FocusSettings } from '../model/focus';
import { RemoteEvaluator, type FromWorker, type RemoteCallbacks, type ToWorker } from '../model/remote';
import { Evaluation, Runner, type EvalSettings } from '../model/run';

export interface Backend {
  evaluate(compiled: CompiledSheet, data: unknown, settings: EvalSettings): void;
  sampleMore(count: number): void;
  focus(compiled: CompiledSheet, filters: Filters, settings: FocusSettings): void;
  stopFocus(): void;
  exact(compiled: CompiledSheet, filters: Filters): void;
  stopExact(): void;
  dispose(): void;
}

/** Everything on the UI thread, in slices. */
function localBackend(callbacks: RemoteCallbacks): Backend {
  const runner = new Runner(callbacks.onRun);
  const focuser = new Focuser(callbacks.onFocus);
  const counter = new ExactCounter(callbacks.onExact);
  return {
    evaluate: (compiled, _data, settings) => runner.start(compiled, settings),
    sampleMore: (count) => runner.sampleMore(count),
    focus: (compiled, filters, settings) => focuser.start(compiled, filters, settings),
    stopFocus: () => focuser.stop(),
    exact: (compiled, filters) => counter.start(compiled, filters),
    stopExact: () => counter.stop(),
    dispose: () => {
      runner.stop();
      focuser.stop();
      counter.stop();
    },
  };
}

/** How long to work on a sheet here before handing it to the worker. */
const FIRST_SLICE_MS = 8;

/**
 * Small sheets are evaluated right here, at once: that takes a few milliseconds, and it
 * means that what is on screen is never out of date. Anything that isn't finished by
 * then goes to the worker, as do searches and exact counts.
 */
function workerBackend(worker: Worker, callbacks: RemoteCallbacks): Backend {
  const remote = new RemoteEvaluator((message: ToWorker) => worker.postMessage(message), callbacks);
  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => remote.receive(event.data));
  return {
    evaluate(compiled, data, settings) {
      const evaluation = new Evaluation(compiled, settings);
      evaluation.advance(FIRST_SLICE_MS);
      const { run } = evaluation;
      remote.setSheet(compiled, data, settings, !run.done);
      if (run.done) remote.adopt(run.columns);
      callbacks.onRun({ ...run });
    },
    sampleMore: (count) => remote.sampleMore(count),
    focus: (_compiled, filters, settings) => remote.focus(filters, settings),
    stopFocus: () => remote.stopFocus(),
    exact: (_compiled, filters) => remote.exact(filters),
    stopExact: () => remote.stopExact(),
    dispose: () => worker.terminate(),
  };
}

/** How long the worker has to show a sign of life before it is given up on. */
const WORKER_GRACE_MS = 4_000;

/**
 * A backend that uses a worker if one can be started, and quietly carries on without one
 * if it can't (or if it dies): whatever had been asked for is asked for again, locally.
 */
export function createBackend(callbacks: RemoteCallbacks): Backend {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../model/worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return localBackend(callbacks);
  }

  let active = workerBackend(worker, callbacks);
  let usingWorker = true;
  // what to ask for again if the worker has to be given up on
  let lastSheet: Parameters<Backend['evaluate']> | null = null;
  let lastFocus: Parameters<Backend['focus']> | null = null;
  let lastExact: Parameters<Backend['exact']> | null = null;

  const giveUpOnWorker = () => {
    if (!usingWorker) return;
    usingWorker = false;
    active.dispose();
    active = localBackend(callbacks);
    if (lastSheet) active.evaluate(...lastSheet);
    if (lastFocus) active.focus(...lastFocus);
    if (lastExact) active.exact(...lastExact);
  };

  const grace = setTimeout(giveUpOnWorker, WORKER_GRACE_MS);
  worker.addEventListener('message', () => clearTimeout(grace), { once: true });
  worker.addEventListener('error', giveUpOnWorker);
  worker.addEventListener('messageerror', giveUpOnWorker);
  worker.postMessage({ type: 'ping' } satisfies ToWorker);

  return {
    evaluate(...args) {
      [lastSheet, lastFocus, lastExact] = [args, null, null];
      active.evaluate(...args);
    },
    sampleMore: (count) => active.sampleMore(count),
    focus(...args) {
      lastFocus = args;
      active.focus(...args);
    },
    stopFocus() {
      lastFocus = null;
      active.stopFocus();
    },
    exact(...args) {
      lastExact = args;
      active.exact(...args);
    },
    stopExact() {
      lastExact = null;
      active.stopExact();
    },
    dispose() {
      clearTimeout(grace);
      active.dispose();
    },
  };
}
