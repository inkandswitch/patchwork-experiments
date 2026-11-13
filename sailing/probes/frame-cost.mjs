// What a frame of the page's clock costs on the aboard page (aboard-run.mjs's
// scene, built the same way, both views seated and dealt): how long n frames
// take to step undrawn, and drawn one by one; with --profile, where the time
// goes (a CPU profile's top self times, and the stack under the first).
//
//   (as aboard-run.mjs) pnpm build in each package
//   node probes/frame-cost.mjs [--frames 120] [--profile]
//
// Simulated time makes a probe's cost its frames: undrawn they're cheap
// (the loops and the sim), drawn they're SwiftShader's. A probe that samples
// the world frame by frame steps with { draw: false }.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "./cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, d) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : d;
};
const N = Number(arg("--frames", 120));
const b = await browser({ root: ROOT, port: 4782, cdp: 9782, page: "/sailing/probes/aboard-probe.html?held", width: 1416, height: 530, timeout: 600_000 });
const out = {};

/** A CPU profile's top self times, with the stack under the top one. */
function top(profile) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const f = n.callFrame;
    const key = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber}:${f.columnNumber}`;
    const e = self.get(key) ?? { ms: 0, node: n.id };
    e.ms += (profile.timeDeltas[i] ?? 0) / 1000;
    self.set(key, e);
  }
  const rows = [...self].sort((a, c) => c[1].ms - a[1].ms).slice(0, 20);
  const stack = [];
  for (let id = rows[0]?.[1].node; id != null; id = parent.get(id)) {
    const f = byId.get(id).callFrame;
    stack.push(`${f.functionName || "(anon)"} ${f.url.split("/").slice(-1)}:${f.lineNumber}:${f.columnNumber}`);
  }
  return { rows: rows.map(([k, e]) => `${e.ms.toFixed(0).padStart(6)} ms  ${k}`), stack: stack.slice(0, 25) };
}

try {
  await b.waitFor("window.__ready", 60_000);
  await b.waitFor("window.__p.templates('a').includes('ship-at-anchor')", 20_000);
  await b.js("window.__p.build()");
  await b.js("window.__p.openB()");
  await b.waitFor("window.__p.loaded('a').loaded === window.__p.loaded('a').total && window.__p.loaded('b').loaded === window.__p.loaded('b').total", 120_000);
  await b.js("window.__p.pick('a', 'p1')");
  await b.js("window.__p.pick('b', 'p2')");
  await b.hold("window.__p.phase() === 'playing' && window.__p.faces('a').length >= 8 && window.__p.faces('b').length >= 8", 120_000);
  await b.js("window.__p.resume()");
  const ms = (expr) => b.js(`(async () => { const t = performance.now(); await ${expr}; return Math.round(performance.now() - t); })()`);
  out.undrawn = { frames: N, ms: await ms(`window.__time.step(${N}, { draw: false })`) };
  out.drawn = { frames: 10, ms: await ms(`(async () => { for (let i = 0; i < 10; i++) await window.__time.step(1); })()`) };
  if (process.argv.includes("--profile")) {
    await b.send("Profiler.enable");
    await b.send("Profiler.setSamplingInterval", { interval: 200 });
    await b.send("Profiler.start");
    await b.js(`window.__time.step(${N}, { draw: false })`);
    out.profile = top((await b.send("Profiler.stop")).profile);
  }
} catch (err) {
  out.error = String(err?.stack ?? err);
}
console.log(JSON.stringify(out, null, 2));
b.stop(out.error ? 1 : 0);
