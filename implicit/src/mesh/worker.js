// Module worker: runs one mesh job and posts back the surface (for the
// provider's cache) and the finished GLB, both transferred, not copied.
// Spawned by scene-source.js with
// new Worker(new URL("./mesh/worker.js", import.meta.url), { type: "module" }).
//
// Protocol:
//   → { type: "ready" }                          once this module has loaded
//   ← { id, job }
//   → { id, type: "progress", step }             about once a second while working
//   → { id, type: "done", ok: true, surface, result } | { id, type: "done", ok: false, error }
//
// "ready" lets the page tell a worker that never started (fall back to the
// main thread) from one that crashed mid-job (report it); "progress" lets it
// notice a worker that died silently.

import { finishMesh, meshSurface } from "./job.js";

const PROGRESS_MS = 1000;

function run(id, gen) {
  let last = Date.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    const now = Date.now();
    if (now - last >= PROGRESS_MS) {
      last = now;
      self.postMessage({ id, type: "progress", step: r.value });
    }
  }
}

self.onmessage = (event) => {
  const { id, job } = event.data ?? {};
  try {
    const surface = run(id, meshSurface(job));
    const result = run(id, finishMesh(surface, job));
    const buffers = [surface.positions, surface.indices, surface.normals, surface.curvature, result.glb].map((a) => a.buffer);
    self.postMessage({ id, type: "done", ok: true, surface, result }, [...new Set(buffers)]);
  } catch (err) {
    self.postMessage({ id, type: "done", ok: false, error: String(err?.message ?? err) });
  }
};

self.postMessage({ type: "ready" });
