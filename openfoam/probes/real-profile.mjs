// Where does the main thread go when a doc opens in the REAL Patchwork?
// Opens it in headless Chrome (a fresh profile, accepting its package offers)
// with the CPU profiler on, then reports the main thread's long stretches of
// work and the functions and files they were spent in.
//
//   node probes/real-profile.mjs <automerge url> [--wait 90] [--out profile.cpuprofile]

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, sleep } from "./cdp.mjs";

const url = process.argv[2];
const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const WAIT = Number(arg("--wait", 90));
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const b = await browser({ root: PKG, port: 4802, cdp: 9802, page: "/README.md", width: 1400, height: 950, timeout: (WAIT + 120) * 1000 });
const DEEP = `(sel) => { const out = []; const walk = (root) => { out.push(...root.querySelectorAll(sel)); for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot); }; walk(document); return out; }`;
await b.send("Profiler.enable");
await b.send("Profiler.setSamplingInterval", { interval: 500 });
await b.send("Profiler.start");
const t0 = Date.now();
await b.send("Page.navigate", { url: `https://patchwork.inkandswitch.com/#doc=${url}` });
const marks = [];
for (let t = 0; t < WAIT; t++) {
  await sleep(1000);
  const r = await Promise.race([
    b.js(`(() => { const hits = (${DEEP})("button").filter((x) => /^\\s*(load|load (it|them|package|packages))\\b/i.test(x.innerText ?? "")); setTimeout(() => hits.forEach((x) => x.click()), 0); const chip = (${DEEP})(".openfoam .hull-chip")[0]?.innerText ?? null; const figs = (${DEEP})(".openfoam .preflight-figures tr").length; return { clicked: hits.length, chip, figs }; })()`),
    sleep(4000).then(() => ({ blocked: true })),
  ]);
  marks.push({ s: (Date.now() - t0) / 1000, ...r });
  try {
    await b.send("Page.handleJavaScriptDialog", { accept: true });
  } catch {}
}
const { profile } = await b.send("Profiler.stop");
if (arg("--out")) writeFileSync(arg("--out"), JSON.stringify(profile));

// ---- read the profile: self time by function and by file, and the long stretches
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const label = (n) => {
  const f = n.callFrame;
  const file = (f.url || "").split("/").slice(-2).join("/").replace(/%3A/g, ":").slice(-60);
  return { fn: f.functionName || "(anonymous)", file: file || `(${f.functionName})`, line: f.lineNumber + 1 };
};
const idle = new Set(["(idle)", "(program)", "(garbage collector)"]);
const self = new Map();
const files = new Map();
const dts = profile.timeDeltas;
const busy = []; // [start ms, end ms, top function]
let t = profile.startTime / 1000;
let run = null;
for (let i = 0; i < profile.samples.length; i++) {
  t += dts[i] / 1000;
  const n = byId.get(profile.samples[i]);
  const L = label(n);
  const ms = dts[i + 1] ? dts[i + 1] / 1000 : 0.5;
  const isIdle = idle.has(n.callFrame.functionName) && n.callFrame.functionName !== "(garbage collector)";
  if (!isIdle) {
    const k = `${L.fn}  ${L.file}:${L.line}`;
    self.set(k, (self.get(k) ?? 0) + ms);
    files.set(L.file, (files.get(L.file) ?? 0) + ms);
    if (!run) run = { start: t, end: t, fns: new Map() };
    run.end = t + ms;
    run.fns.set(k, (run.fns.get(k) ?? 0) + ms);
  } else if (run) {
    if (run.end - run.start > 50) busy.push(run);
    run = null;
  }
}
if (run && run.end - run.start > 50) busy.push(run);
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const t00 = profile.startTime / 1000;
console.log(`\nlong stretches of main-thread work (> 50 ms), ${busy.length}:`);
for (const r of busy.sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 12))
  console.log(`  at ${((r.start - t00) / 1000).toFixed(1)} s for ${(r.end - r.start).toFixed(0)} ms: ${top(r.fns, 3).map(([k, v]) => `${k.split("  ")[0]} ${v.toFixed(0)}ms`).join(", ")}`);
console.log(`\nself time by file (ms):`);
for (const [k, v] of top(files, 14)) console.log(`  ${v.toFixed(0).padStart(7)}  ${k}`);
console.log(`\nself time by function (ms):`);
for (const [k, v] of top(self, 25)) console.log(`  ${v.toFixed(0).padStart(7)}  ${k}`);
console.log(`\nwhat the page showed:`);
for (const m of marks.filter((_, i) => i % 5 === 0 || marks[i].blocked)) console.log(`  ${m.s.toFixed(0)} s ${m.blocked ? "(page didn't answer within 4 s)" : `chip ${JSON.stringify((m.chip ?? "").slice(0, 70))}, ${m.figs} figure rows`}`);
b.stop(0);
