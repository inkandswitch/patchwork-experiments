// scene:source "implicit-mesh" — mesh an implicit surface for the Scene tool.
//
// Output is glTF 2.0, Y-up, metres: the language itself is Y-up metres, so no
// conversion is needed. The mesh carries NORMAL (from the SDF gradient, or
// flat per face when smoothNormals is off) and a per-vertex _CURVATURE field
// (mean curvature in 1/m, from the field's Laplacian).
//
// Meshing runs in a module worker so a big build never blocks the page. If a
// worker can't be started (no Worker, a CSP, a bundle served somewhere workers
// can't load from), it falls back to the main thread, yielding to the event
// loop between slabs and blocks of normals so the UI stays responsive.

import { fingerprintDoc } from "./doc.js";
import { DEFAULT_RESOLUTION, meshJob } from "./mesh/job.js";

let nextId = 1;

function jobFor(doc, params = {}) {
  return {
    source: String(doc?.source ?? ""),
    bounds: doc?.bounds ? { min: [...doc.bounds.min], max: [...doc.bounds.max] } : null,
    resolution: params.resolution ?? DEFAULT_RESOLUTION,
    smoothNormals: params.smoothNormals ?? true,
    finish: params.finish ?? "matte",
    name: String(doc?.title || "Implicit surface"),
  };
}

function inWorker(job) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL("./mesh/worker.js", import.meta.url), { type: "module", name: "implicit-mesh" });
    } catch (err) {
      reject(Object.assign(new Error(`worker unavailable: ${err?.message ?? err}`), { workerFailed: true }));
      return;
    }
    const id = nextId++;
    worker.onmessage = (e) => {
      if (e.data?.id !== id) return;
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    // an error event before any message means the worker script itself failed to load
    worker.onerror = (e) => {
      e.preventDefault?.();
      worker.terminate();
      reject(Object.assign(new Error(`worker failed: ${e.message ?? "load error"}`), { workerFailed: true }));
    };
    worker.postMessage({ id, job });
  });
}

/** Main-thread fallback: same job, a step at a time, yielding every ~12 ms. */
export async function onMainThread(job) {
  const gen = meshJob(job);
  let last = performance.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (performance.now() - last > 12) {
      await new Promise((res) => setTimeout(res, 0));
      last = performance.now();
    }
  }
}

export async function runJob(job, { useWorker = typeof Worker !== "undefined" } = {}) {
  if (useWorker) {
    try {
      return await inWorker(job);
    } catch (err) {
      if (!err.workerFailed) throw err;
      console.warn("[implicit-mesh] meshing on the main thread:", err.message);
    }
  }
  return onMainThread(job);
}

export default {
  fingerprint(doc) {
    return fingerprintDoc(doc);
  },
  async build({ doc, params }) {
    const result = await runJob(jobFor(doc, params ?? {}));
    return { kind: "glb", glb: result.glb, meta: { bounds: result.bounds, notes: result.notes } };
  },
};
