// Checkpoint costs: gzip via CompressionStream (what browsers and Node both
// have), per MB, on the toy's snapshot and on incompressible bytes; and an
// Automerge doc holding one compressed checkpoint: change, save, load.
import { readFileSync } from "node:fs";
// Usage: node bench/checkpoint.mjs
import * as A from "@automerge/automerge";
const M = new URL("../src/", import.meta.url).pathname;
const { compile } = await import(M + "engine.js");
const machine = await compile(readFileSync(M + "../engines/toy/dist/toy.wasm"));
const e = machine.boot(new Uint8Array(3));
for (let i = 0; i < 1000; i++) e.step(new Uint8Array([1, 1, 2, 1, 3, 2, 0, 1]));
const toy = e.snapshot();
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const gz = (b) => pipe(b, new CompressionStream("gzip"));
const gunz = (b) => pipe(b, new DecompressionStream("gzip"));
async function time(f, n = 5) { let best = Infinity, r; for (let i = 0; i < n; i++) { const t = performance.now(); r = await f(); best = Math.min(best, performance.now() - t); } return [r, best]; }
let s = 7; const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0); const rnd = new Uint8Array(4 << 20).map(() => next() >>> 24);
// a "heap-like" 8 MB: mostly zeros with 25% pseudo-random words, as a middle case
const heap = new Uint8Array(8 << 20); for (let i = 0; i < heap.length; i += 16) { next(); heap.set([s & 255, (s >> 8) & 255, (s >> 16) & 255, s >>> 24], i); }
for (const [name, b] of [["toy", toy], ["random 4MB", rnd], ["heap-like 8MB", heap]]) {
  const [z, tz] = await time(() => gz(b));
  const [, tu] = await time(() => gunz(z));
  const mb = b.length / 2 ** 20;
  const [doc, tc] = await time(() => A.change(A.init(), (d) => { d.tick = 2100; d.hash = "0123456789abcdef"; d.state = z; }), 3);
  const [saved, ts] = await time(() => A.save(doc), 3);
  const [, tl] = await time(() => A.toJS(A.load(saved)).state.length, 3);
  const [rawDoc, trc] = await time(() => A.change(A.init(), (d) => { d.state = b; }), 3);
  const [rawSaved, trs] = await time(() => A.save(rawDoc), 3);
  const [, trl] = await time(() => A.toJS(A.load(rawSaved)).state.length, 3);
  console.log(JSON.stringify({ raw_in_automerge: { change_ms: +trc.toFixed(1), save_ms: +trs.toFixed(1), saved_kb: (rawSaved.length / 1024) | 0, load_ms: +trl.toFixed(1) } }));
  console.log(JSON.stringify({ name, raw_kb: (b.length / 1024) | 0, gz_kb: (z.length / 1024) | 0, gzip_ms_per_mb: +(tz / mb).toFixed(2), gunzip_ms_per_mb: +(tu / mb).toFixed(2), am_change_ms: +tc.toFixed(1), am_save_ms: +ts.toFixed(1), am_saved_kb: (saved.length / 1024) | 0, am_load_ms: +tl.toFixed(1) }));
}
