// scene:source "implicit-mesh" — mesh an implicit surface for the Scene tool.
//
// Output is glTF 2.0, Y-up, metres: the language itself is Y-up metres, so no
// conversion is needed. The mesh carries NORMAL (from the SDF gradient, or
// flat per face when smoothNormals is off) and a per-vertex _CURVATURE field
// (mean curvature in 1/m, from the field's Laplacian).
//
// A build has an expensive stage (evaluate the field, surface nets, field
// normals: depends on the doc's fingerprint and the resolution) and a cheap one
// (flat normals, material, GLB encode: smoothNormals and finish). The
// expensive stage's output is kept in a small LRU here, so changing a cheap
// param only refinishes the cached surface.
//
// The expensive stage runs in a module worker (one per job, terminated after)
// so a big build never blocks the page. If a worker can't be started (no
// Worker, a CSP, a bundle served somewhere workers can't load from), it falls
// back to the main thread, yielding to the event loop between steps. A worker
// that started and then crashed is an error (the scene host retries it), not
// a reason to rerun the whole job on the main thread. A new build of the same
// source url with a different fingerprint supersedes a running one: its worker
// is terminated and its promise rejects with a "superseded" error.

import { fingerprintDoc } from "./doc.js";
import { clampResolution, DEFAULT_RESOLUTION, finishMesh, meshSurface, surfaceBytes } from "./mesh/job.js";

let nextId = 1;

/** How long a worker may take to load, and to go quiet mid-job (it reports progress about once a second). */
export const workerTimeouts = { readyMs: 15_000, stallMs: 30_000 };

/** A small LRU of meshed surfaces, by `${fingerprint}|r${resolution}`. */
export function createMeshCache({ entries = 3, bytes = 128_000_000 } = {}) {
  const map = new Map(); // insertion order = least recently used first
  let total = 0;
  const drop = (key) => {
    const s = map.get(key);
    if (!s) return;
    total -= surfaceBytes(s);
    map.delete(key);
  };
  return {
    get(key) {
      const s = map.get(key);
      if (!s) return undefined;
      map.delete(key);
      map.set(key, s);
      return s;
    },
    set(key, surface) {
      drop(key);
      map.set(key, surface);
      total += surfaceBytes(surface);
      // the newest entry always stays, even alone over the byte budget
      while (map.size > 1 && (map.size > entries || total > bytes)) drop(map.keys().next().value);
    },
    has: (key) => map.has(key),
    keys: () => [...map.keys()],
    clear() {
      map.clear();
      total = 0;
    },
    get size() {
      return map.size;
    },
    get bytes() {
      return total;
    },
  };
}

export const meshCache = createMeshCache();

/** Running expensive stages, by cache key: { fingerprint, job: { promise, cancel }, waiters: Set<{ url, reject }> }. */
const inflight = new Map();

function jobFor(doc, params = {}) {
  return {
    source: String(doc?.source ?? ""),
    bounds: doc?.bounds ? { min: [...doc.bounds.min], max: [...doc.bounds.max] } : null,
    resolution: clampResolution(params.resolution ?? DEFAULT_RESOLUTION),
    smoothNormals: params.smoothNormals ?? true,
    finish: params.finish ?? "matte",
  };
}

const finishKey = (job) => `${job.smoothNormals !== false}|${job.finish ?? "matte"}|${job.name ?? ""}`;

function startFailure(message) {
  return Object.assign(new Error(`worker unavailable: ${message}`), { workerFailed: true });
}

function crashed(job, message) {
  return Object.assign(
    new Error(
      `The mesher crashed at resolution ${job.resolution ?? DEFAULT_RESOLUTION} (${message}). ` +
        `It may have run out of memory: try a lower resolution or tighter bounds.`,
    ),
    { workerCrashed: true },
  );
}

export function supersededError() {
  return Object.assign(new Error("superseded: a newer build of this document started"), { superseded: true });
}

/**
 * Run a job in a fresh module worker.
 * @returns {{ promise: Promise<{ surface, result }>, cancel(err: Error): void }}
 */
function inWorker(job) {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL("./mesh/worker.js", import.meta.url), { type: "module", name: "implicit-mesh" });
    } catch (err) {
      reject(startFailure(err?.message ?? String(err)));
      return;
    }
    const id = nextId++;
    let ready = false;
    let settled = false;
    let heard = Date.now();
    let timer = null;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      fn(value);
    };
    // Timers can fire late (background tabs), so judge by the time since we last heard.
    const watch = () => {
      clearTimeout(timer);
      const limit = ready ? workerTimeouts.stallMs : workerTimeouts.readyMs;
      timer = setTimeout(() => {
        if (Date.now() - heard < limit) return watch();
        if (ready) settle(reject, crashed(job, `the worker stopped responding for ${Math.round(limit / 1000)} s`));
        else settle(reject, startFailure(`it did not start within ${Math.round(limit / 1000)} s`));
      }, Math.max(0, limit - (Date.now() - heard)));
    };
    worker.onmessage = (e) => {
      const m = e.data;
      heard = Date.now();
      if (m?.type === "ready") {
        ready = true;
        watch();
        return;
      }
      if (m?.id !== id || m.type !== "done") return; // progress: `heard` is all it's for
      if (m.ok) settle(resolve, { surface: m.surface, result: m.result });
      else settle(reject, new Error(m.error));
    };
    worker.onerror = (e) => {
      e?.preventDefault?.();
      const message = e?.message || "unknown error";
      settle(reject, ready ? crashed(job, message) : startFailure(message));
    };
    worker.onmessageerror = () => settle(reject, crashed(job, "its result could not be received"));
    cancel = (err) => settle(reject, err);
    watch();
    worker.postMessage({ id, job }); // queued until the module has loaded
  });
  return { promise, cancel: (err) => cancel(err) };
}

/** Drain a generator, yielding to the event loop about every 12 ms; stops at the next step once `state.cancelled` is set. */
async function drainYielding(gen, state = {}) {
  let last = performance.now();
  for (;;) {
    if (state.cancelled) throw state.cancelled;
    const r = gen.next();
    if (r.done) return r.value;
    if (performance.now() - last > 12) {
      await new Promise((res) => setTimeout(res, 0));
      last = performance.now();
    }
  }
}

function mainThreadJob(job) {
  const state = { cancelled: null };
  const promise = (async () => {
    const surface = await drainYielding(meshSurface(job), state);
    const result = await drainYielding(finishMesh(surface, job), state);
    return { surface, result };
  })();
  return { promise, cancel: (err) => (state.cancelled = err) };
}

/**
 * Start both stages of a job: in a worker if possible, else on the main thread.
 * @returns {{ promise: Promise<{ surface, result }>, cancel(err: Error): void }}
 */
export function startJob(job, { useWorker = typeof Worker !== "undefined" } = {}) {
  if (!useWorker) return mainThreadJob(job);
  let cancelled = null;
  let fallback = null;
  const w = inWorker(job);
  const promise = w.promise.catch((err) => {
    if (!err.workerFailed || cancelled) throw cancelled ?? err;
    console.warn("[implicit-mesh] meshing on the main thread:", err.message);
    fallback = mainThreadJob(job);
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

/** Main-thread fallback for a whole job (no cache), yielding every ~12 ms. */
export async function onMainThread(job) {
  return (await mainThreadJob(job).promise).result;
}

/** A whole job (no cache): worker if possible, else main thread. Resolves to { glb, bounds, notes, stats }. */
export async function runJob(job, opts) {
  return (await startJob(job, opts).promise).result;
}

/** Reject every waiter for `url` on a running job of another fingerprint, and stop jobs nobody waits for any more. */
function supersede(url, fingerprint) {
  for (const [key, entry] of inflight) {
    if (entry.fingerprint === fingerprint) continue;
    for (const w of entry.waiters) {
      if (w.url !== url) continue;
      entry.waiters.delete(w);
      w.reject(supersededError());
    }
    if (entry.waiters.size === 0) {
      inflight.delete(key);
      entry.job.cancel(supersededError());
    }
  }
}

/** The surface for `key`: joins a running job for it, or starts one. Resolves to { surface, result, finishKey }. */
function surfaceFor(key, fingerprint, url, job) {
  let entry = inflight.get(key);
  if (!entry) {
    const started = startJob(job);
    entry = { fingerprint, job: started, waiters: new Set(), finishKey: finishKey(job) };
    const mine = entry;
    inflight.set(key, entry);
    started.promise.then(
      ({ surface }) => {
        if (inflight.get(key) === mine) inflight.delete(key);
        meshCache.set(key, surface);
      },
      () => {
        if (inflight.get(key) === mine) inflight.delete(key);
      },
    );
  }
  const joined = entry;
  return new Promise((resolve, reject) => {
    const waiter = { url, reject };
    joined.waiters.add(waiter);
    joined.job.promise.then(
      (out) => {
        joined.waiters.delete(waiter);
        resolve({ ...out, finishKey: joined.finishKey });
      },
      (err) => {
        joined.waiters.delete(waiter);
        reject(err);
      },
    );
  });
}

export default {
  fingerprint(doc) {
    return fingerprintDoc(doc);
  },
  async build({ doc, params, url }) {
    const job = jobFor(doc, params ?? {});
    const fingerprint = fingerprintDoc(doc);
    const key = `${fingerprint}|r${job.resolution}`;
    if (url) supersede(url, fingerprint);
    let result;
    const cached = meshCache.get(key);
    if (cached) {
      result = await drainYielding(finishMesh(cached, { ...job, cached: true }));
    } else {
      const out = await surfaceFor(key, fingerprint, url ?? null, job);
      result = out.finishKey === finishKey(job) ? out.result : await drainYielding(finishMesh(out.surface, { ...job, cached: true }));
    }
    return { kind: "glb", glb: result.glb, meta: { bounds: result.bounds, notes: result.notes } };
  },
};
