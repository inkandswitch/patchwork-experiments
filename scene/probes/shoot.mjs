// Screenshot a page in headless Chrome over the DevTools protocol, after an
// in-page condition becomes true. (--screenshot + --virtual-time-budget never
// settles for a page with a live requestAnimationFrame loop.)
//
//   node probes/shoot.mjs <url> <out.png> [waitExpr] [beforeShotExpr] [WxH]
//
// waitExpr defaults to "window.__probeCleanup"; beforeShotExpr runs (awaited)
// right before the capture, e.g. to switch themes.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, waitExpr = "window.__probeCleanup", beforeShot = "", size = "1100x700"] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
// 9400–9799: clear of the 9222/9333/9334 debugging ports long-lived Chromes use
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scene-shot-"));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
   `--window-size=${w},${h}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"],
  { stdio: "ignore" },
);
const bail = (msg, code = 1) => { console.error(msg); chrome.kill(); process.exit(code); };
setTimeout(() => bail("TIMEOUT", 2), 90_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 100 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === "page");
  } catch { /* not up yet */ }
  if (!target) await sleep(100);
}
if (!target) bail("no page target");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.consoleAPICalled") logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (msg.method === "Runtime.exceptionThrown") logs.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
let ok = false;
for (let i = 0; i < 600; i++) {
  if (await evaluate(`!!(${waitExpr})`)) { ok = true; break; }
  await sleep(100);
}
if (!ok) bail(`condition never true: ${waitExpr}\n${logs.join("\n")}`);
if (beforeShot) await evaluate(`(async () => { ${beforeShot} })()`);
await sleep(400);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(JSON.stringify({ out, logs: logs.slice(-20) }, null, 2));
ws.close();
chrome.kill();
process.exit(0);
