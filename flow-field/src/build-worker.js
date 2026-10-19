// Module worker for the scene builds (build-runner.js starts it from a
// `?worker&url` import, so vite bundles it into one file with no imports,
// which also runs from a blob URL). Each message is one job (build-job.js);
// the GLB comes back transferred, not copied.
//
// Protocol:
//   → { type: "ready" }                                   once this module has loaded
//   ← { id, job }
//   → { id, type: "done", ok: true, glb, meta } | { id, type: "done", ok: false, error }
//
// "ready" lets the page tell a worker that never started (build on the main
// thread instead) from one that crashed mid-job (an error; the host retries).

import { handleMessage } from "./build-job.js";

self.onmessage = (event) => {
  const { message, transfer } = handleMessage(event.data);
  self.postMessage(message, transfer);
};

self.postMessage({ type: "ready" });
