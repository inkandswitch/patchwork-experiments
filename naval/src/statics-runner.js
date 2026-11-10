// Runs the worker's jobs (statics-job.js: a Chartroom table from the hull
// mesh, ~0.2 s for a camber hull; the VPP's polar, ~0.3 s) off the main
// thread, after the design has been still for a moment, so dragging never
// waits on them. The tool keeps one runner per kind of job, so a polar
// never supersedes a table.
//
// One worker, kept while the tool is open. A newer job supersedes an older
// one still running (its promise rejects with an AbortError). If no worker
// can start (no Worker, a CSP, a script it can't load), jobs run on the main
// thread after a yield, and workers aren't tried again this session. This is
// flow-field's build-runner.js pattern, cut down to one job at a time.

import workerUrl from "./worker.js?worker&url";
import { runJob } from "./statics-job.js";

const NAME = "rig-worker";
const READY_MS = 15_000;
let workersFailed = false;

export const abortError = () => Object.assign(new Error("superseded"), { name: "AbortError" });

async function spawn(name = NAME) {
  const url = new URL(workerUrl, import.meta.url);
  try {
    return new Worker(url, { type: "module", name });
  } catch (err) {
    const crossOrigin = typeof location !== "undefined" && url.origin !== location.origin;
    if (!crossOrigin) throw err;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch the worker (HTTP ${res.status})`);
  const blobUrl = URL.createObjectURL(new Blob([await res.text()], { type: "text/javascript" }));
  try {
    return new Worker(blobUrl, { type: "module", name });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

/** Resolves with the worker once it says "ready"; on a timeout or a load error it terminates it and rejects. */
function ready(worker) {
  return new Promise((resolve, reject) => {
    const fail = (err) => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      try {
        worker.terminate();
      } catch {
        // already gone
      }
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("the statics worker did not start")), READY_MS);
    worker.onmessage = (e) => {
      if (e.data?.type !== "ready") return;
      clearTimeout(timer);
      worker.onmessage = null;
      resolve(worker);
    };
    worker.onerror = (e) => {
      e?.preventDefault?.();
      fail(new Error(e?.message || "the statics worker failed to load"));
    };
  });
}

/**
 * A runner: run(job) → Promise<result>; dispose().
 * @param {{ name?: string, spawnWorker?: (name: string) => Promise<Worker> }} [opts] spawnWorker: tests only
 */
export function createStaticsRunner({ name = NAME, spawnWorker = spawn } = {}) {
  let worker = null;
  let starting = null;
  let current = null; // { id, reject }
  let nextId = 1;
  // bumped by dispose(): anything still awaiting a worker from before it is abandoned
  let generation = 0;

  const getWorker = async () => {
    if (worker) return worker;
    const gen = generation;
    starting ??= spawnWorker(name).then(ready);
    const mine = starting;
    let w;
    try {
      w = await mine;
    } catch (err) {
      if (gen !== generation) throw abortError();
      workersFailed = true;
      if (starting === mine) starting = null;
      throw err;
    }
    if (gen !== generation) {
      // disposed while it started: nobody else will ever terminate it
      w.terminate();
      throw abortError();
    }
    worker = w;
    return worker;
  };

  const onMain = (job, id) =>
    new Promise((resolve, reject) => {
      current = { id, reject };
      setTimeout(() => {
        if (current?.id !== id) return;
        current = null;
        try {
          resolve(runJob(job));
        } catch (err) {
          reject(err);
        }
      }, 0);
    });

  async function run(job) {
    current?.reject(abortError());
    const id = nextId++;
    current = null;
    if (typeof Worker === "undefined" || workersFailed) return onMain(job, id);
    const gen = generation;
    let w;
    try {
      w = await getWorker();
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      return onMain(job, id);
    }
    // disposed, or superseded by a newer run, while the worker started
    if (gen !== generation || id !== nextId - 1) throw abortError();
    return new Promise((resolve, reject) => {
      current = { id, reject };
      w.onmessage = (e) => {
        const m = e.data;
        if (m?.id !== id) return;
        if (current?.id === id) current = null;
        if (m.ok) resolve(m.result ?? m.table);
        else reject(new Error(m.error));
      };
      w.onerror = (e) => {
        e?.preventDefault?.();
        if (current?.id === id) current = null;
        // a crash: start a fresh worker next time
        worker?.terminate();
        worker = null;
        starting = null;
        reject(new Error(e?.message || "the statics worker crashed"));
      };
      w.postMessage({ id, job });
    });
  }

  function dispose() {
    generation++;
    current?.reject(abortError());
    current = null;
    worker?.terminate();
    worker = null;
    // a worker still starting is terminated when it arrives (getWorker)
    starting = null;
  }

  return { run, dispose };
}
