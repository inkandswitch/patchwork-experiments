// convert3dm, in a module worker when one starts, else on the main thread.
//
// One worker is kept while it's used and closed after 30 s idle. A worker
// that can't be made (no Worker, a page whose modules come from another
// origin) or doesn't say it's ready within 15 s means the main thread does
// the work, and workers aren't tried again in this page. The
// bytes are copied once and the copy transferred: posting a view clones its
// whole underlying buffer, which for a doc's content can be far bigger than
// the file.

let worker = null;
let ready = null;
let broken = false;
let idle = null;
let seq = 0;
const waiting = new Map();

function start() {
  if (broken || typeof Worker !== "function") return null;
  if (worker) return ready;
  try {
    worker = new Worker(new URL("./convert-worker.js", import.meta.url), { type: "module" });
  } catch {
    broken = true;
    return null;
  }
  ready = new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 15000);
    worker.addEventListener("message", (e) => {
      if (e.data?.ready) {
        clearTimeout(t);
        resolve(true);
        return;
      }
      const w = waiting.get(e.data?.id);
      if (!w) return;
      waiting.delete(e.data.id);
      e.data.ok ? w.resolve({ kind: "glb", glb: e.data.glb, meta: e.data.meta }) : w.reject(new Error(e.data.error));
    });
    worker.addEventListener("error", () => {
      clearTimeout(t);
      resolve(false);
      for (const w of waiting.values()) w.reject(new Error("the 3dm worker stopped"));
      waiting.clear();
      stop();
      broken = true;
    });
  });
  return ready;
}

function stop() {
  worker?.terminate();
  worker = null;
  ready = null;
}

/** convert3dm's result, made in a worker if this page can run one. */
export async function convertOffThread(bytes, params = {}, name = "3DM") {
  const ok = await start();
  if (!ok) {
    if (worker) {
      stop();
      broken = true;
    }
    const { convert3dm } = await import("./source.js");
    return convert3dm(bytes, params, name);
  }
  clearTimeout(idle);
  const copy = bytes.slice().buffer;
  const id = ++seq;
  try {
    return await new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, bytes: copy, params, name }, [copy]);
    });
  } finally {
    if (!waiting.size) idle = setTimeout(stop, 30000);
  }
}
