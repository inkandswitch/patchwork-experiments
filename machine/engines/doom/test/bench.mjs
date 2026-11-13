// What the Doom engine costs: `node engines/doom/test/bench.mjs`, after
// fetch-freedoom.sh. Plays each bot demo and times boot, steps, frames,
// snapshots, restores and hashes.
import { readFileSync, statSync } from "node:fs";
import { compile } from "../../../src/engine.js";
import { content, demo } from "../../../src/doom.js";

const here = new URL(".", import.meta.url);
const wasmPath = new URL("../dist/doom.wasm", here);
const iwad = readFileSync(process.env.FREEDOOM1 ?? new URL("freedoom1.wad", here));
const now = () => performance.now();
const ms = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.floor(p * (s.length - 1))].toFixed(3);
  return `mean ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3)} p50 ${at(0.5)} p99 ${at(0.99)} ms`;
};
const time = (n, fn) => Array.from({ length: n }, () => {
  const t = now();
  fn();
  return now() - t;
});

let t = now();
const machine = await compile(readFileSync(wasmPath));
console.log(`doom.wasm: ${statSync(wasmPath).size} bytes, compiled in ${(now() - t).toFixed(1)} ms`);

for (const n of [1, 2, 4]) {
  const { args, tics } = demo(readFileSync(new URL(`bot${n}p.lmp`, here)));
  const c = content({ wads: [iwad], args });
  let e;
  const boot = time(5, () => (e = machine.boot(c)));
  let i = 0;
  const sim = time(tics.length, () => e.step(tics[i++]));
  const drawn = machine.boot(c);
  i = 0;
  const frame = [];
  const both = time(tics.length, () => {
    drawn.step(tics[i++]);
    const t = now();
    drawn.frame(0);
    frame.push(now() - t);
  });
  let s;
  const snapshot = time(200, () => (s = e.snapshot()));
  const reused = time(200, () => e.snapshot(s));
  const restore = time(200, () => e.restore(s));
  const hash = time(50, () => e.hash());
  console.log(`${n}p, ${tics.length} tics: boot ${ms(boot)}`);
  console.log(`  step ${ms(sim)}; step and draw ${ms(both)} (draw ${ms(frame)})`);
  console.log(`  snapshot ${s.length} bytes: new ${ms(snapshot)}, reused ${ms(reused)}; restore ${ms(restore)}; hash ${ms(hash)}`);
}
