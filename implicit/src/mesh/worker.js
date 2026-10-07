// Module worker: runs one mesh job per message and posts the GLB back
// (transferred, not copied). Spawned by scene-source.js with
// new Worker(new URL("./mesh/worker.js", import.meta.url), { type: "module" }).

import { meshJob } from "./job.js";
import { drain } from "./surface-nets.js";

self.onmessage = (event) => {
  const { id, job } = event.data ?? {};
  try {
    const result = drain(meshJob(job));
    self.postMessage({ id, ok: true, result }, [result.glb.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
