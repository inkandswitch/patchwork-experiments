// Runs the scene builds' heavy part (build-job.js) off the main thread.
//
// Jobs go to module workers (build-worker.js). A worker that finishes a job
// goes back to a small idle pool (at most two: the slice and the streamlines
// build together after every flow edit), so most builds don't pay for loading
// one, and each worker keeps its own panel-solve cache (flow.js). Idle
// workers are terminated after IDLE_MS.
//
// If a worker can't be started (no Worker, a CSP, a script it can't load), the
// job runs on the main thread instead, as every build used to, and workers
// aren't tried again this session. "Started" means the worker posted "ready":
// one that started and then crashed is an error (the scene host retries it),
// not a reason to rerun the job on the main thread.
//
// A newer build of the same flow doc (same source url) whose inputs differ
// supersedes an older one still running: the older one's worker is terminated
// and its promise rejects with an AbortError, which the scene host treats as
// cancelled, not failed. Builds of the same inputs never supersede each other
// (two renders of one flow with different params run side by side).

import workerUrl from "./build-worker.js?worker&url";
import { runJob } from "./build-job.js";

/** How long a worker may take to load. */
export const workerTimeouts = { readyMs: 15_000 };
const IDLE_MS = 30_000;
const MAX_IDLE = 2;
const NAME = "flow-field-build";

let nextId = 1;
let workersFailed = false; // a worker failed to start: stay on the main thread
const idle = []; // { worker, timer }

/** Is there a Worker to try? (False after one failed to start.) */
export function workersAvailable() {
  return typeof Worker !== "undefined" && !workersFailed;
}

export function abortError(message = "superseded: a newer build of this flow started") {
  // AbortError: the scene host treats it as cancelled, not failed (no error shown, no retry wait)
  return Object.assign(new Error(message), { name: "AbortError", superseded: true });
}

const startFailure = (message) => Object.assign(new Error(`worker unavailable: ${message}`), { workerFailed: true });

const crashed = (message) =>
  Object.assign(new Error(`the flow-field build worker crashed (${message}); try a coarser resolution or fewer seeds`), {
    workerCrashed: true,
  });

/**
 * A module worker for build-worker.js. The URL is resolved against this
 * module, never the page. A cross-origin script makes the constructor throw
 * at once (a dev server, a CDN; production serves modules same-origin through
 * the service worker): then the script is fetched and started from a blob
 * URL, which works because vite bundles the worker into one import-free file.
 */
async function spawnWorker() {
  const url = new URL(workerUrl, import.meta.url);
  try {
    return new Worker(url, { type: "module", name: NAME });
  } catch (err) {
    const crossOrigin = typeof location !== "undefined" && url.origin !== location.origin;
    if (!crossOrigin) throw err;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch the worker (HTTP ${response.status})`);
  const blobUrl = URL.createObjectURL(new Blob([await response.text()], { type: "text/javascript" }));
  try {
    return new Worker(blobUrl, { type: "module", name: NAME });
  } finally {
    // the worker has fetched it by the time it runs; the URL isn't needed after construction
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

/** A new worker that has posted "ready"; rejects with a start failure otherwise. */
async function startWorker() {
  let worker;
  try {
    worker = await spawnWorker();
  } catch (err) {
    throw startFailure(err?.message ?? String(err));
  }
  return new Promise((resolve, reject) => {
    const clear = () => {
      clearTimeout(timer);
      worker.onmessage = worker.onerror = null;
    };
    const fail = (message) => {
      clear();
      worker.terminate();
      reject(startFailure(message));
    };
    const timer = setTimeout(() => fail(`it did not start within ${Math.round(workerTimeouts.readyMs / 1000)} s`), workerTimeouts.readyMs);
    worker.onmessage = (e) => {
      if (e.data?.type !== "ready") return;
      clear();
      resolve(worker);
    };
    worker.onerror = (e) => {
      e?.preventDefault?.();
      fail(e?.message || "it failed to load");
    };
  });
}

function acquire() {
  const entry = idle.pop();
  if (entry) {
    clearTimeout(entry.timer);
    return Promise.resolve(entry.worker);
  }
  return startWorker();
}

function release(worker) {
  worker.onmessage = worker.onerror = worker.onmessageerror = null;
  if (idle.length >= MAX_IDLE) return worker.terminate();
  const entry = { worker, timer: null };
  entry.timer = setTimeout(() => {
    const i = idle.indexOf(entry);
    if (i >= 0) idle.splice(i, 1);
    worker.terminate();
  }, IDLE_MS);
  idle.push(entry);
}

/** Run a job in a worker. @returns {{ promise: Promise<{ glb, meta }>, cancel(err): void }} */
function inWorker(job) {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    let done = false;
    let worker = null;
    // keep: the worker is healthy and can take another job
    const finish = (keep, fn, value) => {
      if (done) return;
      done = true;
      if (worker) {
        if (keep) release(worker);
        else {
          worker.onmessage = worker.onerror = worker.onmessageerror = null;
          worker.terminate();
        }
      }
      fn(value);
    };
    cancel = (err) => finish(false, reject, err);
    acquire().then(
      (w) => {
        if (done) return release(w); // cancelled while it started
        worker = w;
        const id = nextId++;
        w.onmessage = (e) => {
          const m = e.data;
          if (m?.id !== id || m.type !== "done") return;
          if (m.ok) finish(true, resolve, { glb: m.glb, meta: m.meta });
          else finish(true, reject, new Error(m.error));
        };
        w.onerror = (e) => {
          e?.preventDefault?.();
          finish(false, reject, crashed(e?.message || "unknown error"));
        };
        w.onmessageerror = () => finish(false, reject, crashed("its result could not be received"));
        // No job timeout: the worst legitimate build (a 160-cell masked slice
        // past 400 panels with point elements) takes most of a minute, and a
        // job that never ends costs a worker, not the page; the next edit's
        // build supersedes it.
        try {
          w.postMessage({ id, job });
        } catch (err) {
          // the job couldn't be cloned: nothing ran, so the main thread can have it
          finish(true, reject, Object.assign(startFailure(err?.message ?? String(err)), { cloneFailed: true }));
        }
      },
      (err) => finish(false, reject, err),
    );
  });
  return { promise, cancel: (err) => cancel(err) };
}

/** The main-thread path: the job runs on the next microtask; a cancel before then rejects instead. */
function onMainThread(job) {
  let cancelled = null;
  let rejectEarly = () => {};
  const promise = new Promise((resolve, reject) => {
    rejectEarly = reject;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        resolve(runJob(job));
      } catch (err) {
        reject(err);
      }
    });
  });
  return {
    promise,
    cancel(err) {
      cancelled = err;
      rejectEarly(err);
    },
  };
}

/**
 * Start a job: in a worker if one can be started, else on the main thread.
 * @param {object} job  from build-job.js makeJob()
 * @param {{ useWorker?: boolean }} [opts]
 * @returns {{ promise: Promise<{ glb: Uint8Array, meta }>, cancel(err: Error): void }}
 */
export function startJob(job, { useWorker = workersAvailable() } = {}) {
  if (!useWorker) return onMainThread(job);
  let cancelled = null;
  let fallback = null;
  const w = inWorker(job);
  const promise = w.promise.catch((err) => {
    if (cancelled) throw cancelled;
    if (!err?.workerFailed) throw err;
    if (!err.cloneFailed) workersFailed = true;
    console.warn("[flow-field] building on the main thread:", err.message);
    fallback = onMainThread(job);
    return fallback.promise;
  });
  return {
    promise,
    cancel(err) {
      cancelled = err;
      w.cancel(err);
      fallback?.cancel(err);
    },
  };
}

// ---- supersession, per source url

let nextTicket = 1;
const running = new Map(); // url → Set<{ ticket, identity, job }>

/** Taken when build() is called, before the body is read: it orders builds by when they read the doc. */
export function takeTicket() {
  return nextTicket++;
}

/**
 * Run a job for the flow doc at `url`. Running builds of that url with a
 * different `identity` (the doc and section they read) and an older ticket
 * are cancelled; if one with a newer ticket is already running, this build
 * read an older doc and is cancelled itself.
 * @param {object} job
 * @param {{ url?: string, identity?: string, ticket?: number, useWorker?: boolean }} [o]
 */
export function runSuperseding(job, { url, identity, ticket = takeTicket(), useWorker } = {}) {
  if (!url) return startJob(job, { useWorker }).promise;
  let set = running.get(url);
  if (!set) running.set(url, (set = new Set()));
  const older = [];
  for (const other of set) {
    if (other.identity === identity) continue;
    if (other.ticket > ticket) return Promise.reject(abortError("superseded: a newer build of this flow is already running"));
    older.push(other);
  }
  for (const other of older) {
    set.delete(other);
    other.job.cancel(abortError());
  }
  const entry = { ticket, identity, job: startJob(job, useWorker === undefined ? {} : { useWorker }) };
  set.add(entry);
  const forget = () => {
    set.delete(entry);
    if (set.size === 0 && running.get(url) === set) running.delete(url);
  };
  entry.job.promise.then(forget, forget);
  return entry.job.promise;
}

/** For tests: drop the idle workers and forget a start failure. */
export function resetRunner() {
  for (const { worker, timer } of idle.splice(0)) {
    clearTimeout(timer);
    worker.terminate();
  }
  workersFailed = false;
  running.clear();
}
