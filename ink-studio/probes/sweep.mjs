// Every example in the built tool, in one real Chrome (real GPU): for each,
// probe.html mounts it, waits until a world is drawn or an error shows, lets
// it play a moment, and screenshots it. One TSV row each: name, state
// (drawn | blank | error | timeout), splats, build ms, distinct colours in the
// shot's view area, message. Blank = fewer than 4 colours (a lone background).
//
//   node probes/probe-server.mjs 4790 --keep &
//   node probes/sweep.mjs <names.txt | -> <out dir> [--port 4790] [--wait 90000]
//
// names: one example file name per line (survey.mjs's ok rows), or "-" for stdin.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardChrome, killChrome } from "./chrome-guard.mjs";

const require = createRequire(import.meta.url);
const png = require("../vendor/ink-studio/cli/png.js");
const [list, out] = process.argv.slice(2);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const port = Number(arg("--port", 4790));
const WAIT = Number(arg("--wait", 90000));
const names = readFileSync(list === "-" ? 0 : list, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
mkdirSync(out, { recursive: true });

const [W, H] = [800, 520];
const debug = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "ink-sweep-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--no-first-run", "--mute-audio", "--no-default-browser-check", `--user-data-dir=${profile}`,
   `--remote-debugging-port=${debug}`, `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore", detached: true });
const done = (code) => { killChrome(chrome); try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); };
guardChrome(chrome, { profile, stop: done });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 100 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
  if (!target) await sleep(100);
}
if (!target) { console.error("no page target"); done(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").slice(0, 200);
console.log(["name", "state", "splats", "build_ms", "colours", "message"].join("\t"));
for (const name of names) {
  await send("Page.navigate", { url: `http://localhost:${port}/probes/probe.html?example=${encodeURIComponent(name)}` });
  await sleep(300);
  let ready = null;
  const t0 = Date.now();
  while (Date.now() - t0 < WAIT) {
    ready = await evaluate("window.__ready ? JSON.stringify({ ...window.__ready, errors: window.__errors }) : null").catch(() => null);
    if (ready) break;
    await sleep(200);
  }
  if (!ready) { console.log([name, "timeout", "", "", "", ""].join("\t")); continue; }
  const r = JSON.parse(ready);
  await sleep(1200); // let it play
  const after = JSON.parse(await evaluate("JSON.stringify({ message: document.querySelector('.ink-studio .message')?.textContent ?? '', errors: window.__errors })"));
  const shot = Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64");
  const file = join(out, name.replace(/\W+/g, "-") + ".png");
  writeFileSync(file, shot);
  const img = png.raster(shot);
  const colours = new Set();
  const bar = 44; // the tool's bar at the bottom
  for (let y = 0; y < img.h - bar; y += 2) for (let x = 0; x < img.w; x += 2) {
    const i = (y * img.w + x) * 3;
    colours.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
    if (colours.size > 64) break;
  }
  const splats = (/([\d,]+) splats/.exec(r.stats)?.[1] ?? "").replace(/,/g, "");
  const ms = /built in (\d+) ms/.exec(r.stats)?.[1] ?? "";
  const message = after.message || after.errors?.join(" | ") || "";
  const state = /rror/.test(after.message) || after.errors?.length ? "error" : colours.size < 4 ? "blank" : "drawn";
  console.log([name, state, splats, ms, colours.size, clean(message)].join("\t"));
}
ws.close();
done(0);
