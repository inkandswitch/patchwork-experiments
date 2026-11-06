// Screenshots of the ship, to look at: renders probes/ship-probe.html in
// headless Chrome (SwiftShader WebGL) from several views and writes PNGs.
//
//   node probes/ship-shots.mjs [<dir>] [view …]
//
// Needs the scene package installed beside this one (the page borrows its
// three.js); nothing else. Plain node, no dependencies.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
const args = process.argv.slice(2);
const OUT = resolve(args[0] ?? join(process.env.TMPDIR || tmpdir(), "ship-shots"));
const VIEWS = args.length > 1 ? args.slice(1) : ["quarter", "far", "side", "bow", "top", "under", "helm", "foredeck"];
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4710, CDP = 9710;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(join(ROOT, "scene/node_modules/three"))) throw new Error("install the scene package first: the probe page borrows its three.js");
mkdirSync(OUT, { recursive: true });

const MIME = { ".js": "text/javascript", ".html": "text/html" };
const ALLOWED = [join(ROOT, "sailing") + sep, join(ROOT, "scene/node_modules/three") + sep];
const server = createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!ALLOWED.some((a) => path.startsWith(a)) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "ship-probe-"));
const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, "--window-size=1280,800", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const done = (code) => {
  chrome.kill();
  server.close();
  setTimeout(() => {
    rmSync(profile, { recursive: true, force: true });
    process.exit(code);
  }, 300);
};

let target;
for (let i = 0; i < 150 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === "page");
  } catch {}
  if (!target) await sleep(100);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id);
  if (m.method === "Runtime.exceptionThrown") logs.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}) => new Promise((r) => {
  const id = ++seq;
  pending.set(id, r);
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const shots = [];
for (const view of VIEWS) {
  const water = view === "under" || view === "side" ? 0 : 1;
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/sailing/probes/ship-probe.html?view=${view}&water=${water}` });
  let ok = false;
  for (let i = 0; i < 300 && !ok; i++) {
    await sleep(100);
    ok = await js("window.ready === true");
  }
  if (!ok) {
    console.error(`${view}: page never got ready`, logs);
    done(1);
  }
  await sleep(200);
  const r = await send("Page.captureScreenshot", { format: "png" });
  const path = join(OUT, `ship-${view}.png`);
  writeFileSync(path, Buffer.from(r.result.data, "base64"));
  shots.push(path);
}
console.log(JSON.stringify({ shots, logs }, null, 2));
done(0);
