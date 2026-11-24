// Session-doc shape measurements for the machine host.
// A: one doc, 4 seats each writing a 1 s chunk per second (4 writers, keys "<seat>/<n>").
// B: one doc per seat, its holder the only writer, keys "<n>".
// Measures, at 10/30/60 min: saved bytes, cold load (all docs a joiner needs),
// and the receive cost of one second's changes on a replica that has everything.
// Usage: node bench/doc-shape.mjs [minutes]   (prints a line at 10, 30, 60, 120, 180 min)
import * as A from "@automerge/automerge";
const P = 4, HZ = 35, B = 8, MIN = Number(process.argv[2] ?? 60);
const marks = new Set([10, 30, 60, 120, 180].filter((m) => m <= MIN));
// Inputs shaped like the spike's: held keys for runs of ticks, two players turning by mouse.
let seed = 1; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const held = Array.from({ length: P }, () => new Uint8Array(B));
function chunk(p) {
  const out = new Uint8Array(HZ * B);
  for (let t = 0; t < HZ; t++) {
    if (rnd() < 0.08) for (let i = 0; i < 4; i++) held[p][i] = rnd() < 0.5 ? 0 : (rnd() * 256) | 0;
    if (p < 2) held[p][2] = (rnd() * 256) | 0; // mouse turn
    out.set(held[p], t * B);
  }
  return out;
}
const time = (f) => { const t = process.hrtime.bigint(); const r = f(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };
// writers' own docs
const actor = (i) => (i + 1).toString(16).padStart(32, "0");
let a = Array.from({ length: P }, (_, p) => A.init({ actor: actor(p) })); // shape A: each writer's replica of the one doc
let a0 = A.change(A.init({ actor: actor(9) }), (d) => { d.inputs = {}; });
a = a.map((d) => A.merge(d, a0));
let aR = A.merge(A.init({ actor: actor(10) }), a0); // reader
let b = Array.from({ length: P }, (_, p) => A.change(A.init({ actor: actor(p) }), (d) => { d.chunks = {}; }));
let bR = b.map((d) => A.merge(A.init({ actor: actor(10 + 1) }), d));
const rows = [];
for (let s = 0; s < MIN * 60; s++) {
  const cs = Array.from({ length: P }, (_, p) => chunk(p));
  // A
  const aChanges = [];
  for (let p = 0; p < P; p++) {
    const before = A.getHeads(a[p]);
    a[p] = A.change(a[p], (d) => { d.inputs[`s${p}/${s}`] = cs[p]; });
    aChanges.push(...A.getChanges(A.view(a[p], before), a[p]));
  }
  const [, aRecv] = time(() => { aR = A.applyChanges(aR, aChanges)[0]; });
  // writers in A also receive each other's changes (each pays for 3 others)
  // B
  let bRecv = 0;
  for (let p = 0; p < P; p++) {
    const before = A.getHeads(b[p]);
    b[p] = A.change(b[p], (d) => { d.chunks[String(s)] = cs[p]; });
    const ch = A.getChanges(A.view(b[p], before), b[p]);
    const [, ms] = time(() => { bR[p] = A.applyChanges(bR[p], ch)[0]; });
    bRecv += ms;
  }
  rows.push({ aRecv, bRecv });
  const min = (s + 1) / 60;
  if (marks.has(min)) {
    const last = rows.slice(-60);
    const avg = (k) => last.reduce((x, r) => x + r[k], 0) / last.length;
    const aBytes = A.save(aR); const bBytes = bR.map((d) => A.save(d));
    const [, aLoad] = time(() => A.load(aBytes));
    const [, bLoad] = time(() => bBytes.forEach((x) => A.load(x)));
    console.log(JSON.stringify({ min, A: { bytes: aBytes.length, load_ms: +aLoad.toFixed(1), recv_ms_per_s: +avg("aRecv").toFixed(2) }, B: { bytes: bBytes.reduce((x, y) => x + y.length, 0), per_seat: bBytes[0].length, load_ms: +bLoad.toFixed(1), recv_ms_per_s: +avg("bRecv").toFixed(2) } }));
  }
}
