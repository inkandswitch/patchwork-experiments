// Converts a .3dm to GLB off the main thread (see offthread.js). Reading a
// big Rhino file is seconds of wasm and JS: 2 s for a 92 MB, 6,000-object
// model on an M4, all of it blocking the page when done on the main thread.
import { convert3dm } from "./source.js";

self.onmessage = async (e) => {
  const { id, bytes, params, name } = e.data ?? {};
  try {
    const r = await convert3dm(new Uint8Array(bytes), params, name);
    self.postMessage({ id, ok: true, glb: r.glb, meta: r.meta }, [r.glb.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
self.postMessage({ ready: true });
