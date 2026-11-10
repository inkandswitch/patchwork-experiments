// Module worker for the statics and the polar (statics-runner.js starts it from a
// `?worker&url` import, so vite bundles it into one import-free file, which
// also runs from a blob URL). Each message is one job (statics-job.js).
//
//   → { type: "ready" }              once loaded
//   ← { id, job }
//   → { id, type: "done", ok: true, result } | { id, type: "done", ok: false, error }

import { handleMessage } from "./statics-job.js";

self.onmessage = (event) => self.postMessage(handleMessage(event.data));
self.postMessage({ type: "ready" });
