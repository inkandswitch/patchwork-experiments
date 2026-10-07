// Drives probes/solander-probe.html in headless Chrome (real WebGL) against the
// Solander 38 site's ORIGINAL GLBs and a scene doc of the importer's shape
// (IMPORT-PLAN (b)4 targets), and prints one JSON report.
//
//   pnpm build
//   node probes/solander-run.mjs --geom <…/frontend/public> --scene <scene.json> --out <dir> [--site] [--mbps 50] [--latency 20]
//
// --geom   the site's public/ folder (holds models-1789414952, models-battery-…, models-jig-…)
// --scene  a scene doc as the importer writes it (plan/dry/scene.json), with pending: urls
// --site   also screenshot https://solander38.com/anatomy for comparison
// Network is throttled over CDP (default 50 Mbit/s, 20 ms) to stand in for broadband.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []),
);
const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const geom = resolve(args.geom ?? "");
const sceneFile = resolve(args.scene ?? "");
const out = resolve(args.out ?? join(tmpdir(), "solander-probe"));
const port = Number(args.port ?? 4471);
const cdpPort = Number(args["cdp-port"] ?? 9471);
const mbps = Number(args.mbps ?? 50);
const latency = Number(args.latency ?? 20);
const [W, H] = String(args.size ?? "1600x1000").split("x").map(Number);
mkdirSync(out, { recursive: true });
const SETS = { main: "models-1789414952", battery: "models-battery-1789233002", jig: "models-jig-1761244560" };
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html", ".glb": "model/gltf-binary" };

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "http://x");
  let path;
  const g = /^\/geom\/(main|battery|jig)\/(.+)$/.exec(url.pathname);
  if (g) path = join(geom, SETS[g[1]], decodeURIComponent(g[2]));
  else if (url.pathname === "/fixture/scene.json") path = sceneFile;
  else path = join(pkg, decodeURIComponent(url.pathname));
  if (!existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "content-length": statSync(path).size });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(port, r));

const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "solander-chrome-"));
const chromeArgs = [
  "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
  `--remote-debugging-port=${cdpPort}`, `--window-size=${W},${H}`, "--enable-webgl", "--ignore-gpu-blocklist",
  ...(args.swiftshader ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []),
  ...(typeof args.flags === "string" ? args.flags.split(/\s+/).filter(Boolean) : []),
  "about:blank",
];
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", chromeArgs, { stdio: "ignore" });
const done = (code) => { try { chrome.kill(); } catch {} server.close(); process.exit(code); };
setTimeout(() => { console.error("TIMEOUT"); done(2); }, Number(args.timeout ?? 600_000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      const t = list.find((x) => x.type === "page");
      if (t) return t;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error("no page target");
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.exceptionThrown") logs.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const shot = async (file) => {
    const s = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, file), Buffer.from(s.result.data, "base64"));
    return join(out, file);
  };
  return { ws, send, evaluate, shot, logs, open: new Promise((r) => ws.addEventListener("open", r, { once: true })) };
}

const report = { config: { mbps, latency, size: `${W}x${H}`, chromeArgs: chromeArgs.filter((a) => !a.includes("user-data-dir")) } };
try {
  const t = await target();
  const c = connect(t.webSocketDebuggerUrl);
  await c.open;
  await c.send("Runtime.enable");
  await c.send("Page.enable");
  await c.send("Network.enable");
  await c.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (mbps > 0) await c.send("Network.emulateNetworkConditions", { offline: false, latency, downloadThroughput: (mbps * 1e6) / 8, uploadThroughput: (20 * 1e6) / 8 });
  await c.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.navigate", { url: `http://localhost:${port}/probes/solander-probe.html${args.query ? `?${args.query}` : ""}` });
  let phase = null;
  if (args["early-ms"]) {
    // a look while it's still loading: placeholders from hint.bounds, framing
    for (let i = 0; i < 600 && (await c.evaluate("window.__probe?.phase").catch(() => null)) !== "loading"; i++) await sleep(20);
    await sleep(Number(args["early-ms"]));
    report.early = { at: Number(args["early-ms"]), stats: await c.evaluate("window.__sceneDebug?.stats()"), shot: await c.shot("early.png") };
  }
  for (let i = 0; i < 3000; i++) {
    phase = await c.evaluate("window.__probe?.phase").catch(() => null);
    if (phase === "default-ready" || phase === "fatal") break;
    await sleep(100);
  }
  if (phase !== "default-ready") throw new Error(`probe never got ready (${phase}): ${await c.evaluate("window.__probe?.fatal").catch(() => "")}\n${c.logs.join("\n")}`);
  report.gpu = await c.evaluate("window.__probe.gpu");
  report.open = await c.evaluate("window.__probe.open");
  report.screens = { default: await c.shot("default.png") };
  report.benchDefault = await c.evaluate("window.__probe.benchDefault()");
  report.search = await c.evaluate(`window.__probe.searchSelect("mesh hull")`);
  report.search.clickedHull = await c.evaluate(`(async () => { const ok = window.__probe.selectFirst("HULL"); await new Promise((r) => setTimeout(r, 300)); return { ok, about: document.querySelector(".inspector .about-title")?.textContent ?? null, status: document.querySelector(".inspector .status-line")?.textContent ?? null }; })()`);
  report.screens.inspector = await c.shot("inspector-hull.png");
  report.search.afterEsc = await c.evaluate("window.__probe.clearSearch()");
  report.screens.outline = await c.shot("outline-revealed.png");
  await c.evaluate("window.__probe.deselect()");
  if (args.quick) throw Object.assign(new Error("quick"), { quick: true });
  await c.evaluate("window.__probe.setXray(true)");
  await sleep(500);
  report.screens.xray = await c.shot("default-xray.png");
  await c.evaluate("window.__probe.setXray(false)");
  report.noTransmission = await c.evaluate("window.__probe.noTransmission()");
  report.battery = await c.evaluate("window.__probe.showBattery()");
  report.screens.battery = await c.shot("battery.png");
  await c.evaluate("window.__probe.frameAll()");
  report.screens.batteryFramed = await c.shot("battery-framed.png");
  report.all = await c.evaluate("window.__probe.showAll()");
  report.screens.all = await c.shot("all.png");
  report.errors = await c.evaluate("window.__probe.errors");
  report.consoleLogs = c.logs.slice(-30);

  if (args.site) {
    await c.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await c.send("Page.navigate", { url: "https://solander38.com/anatomy" });
    await sleep(Number(args["site-wait"] ?? 25000));
    report.screens.site = await c.shot("site-anatomy.png");
  }
} catch (err) {
  if (!err?.quick) report.fatal = String(err?.stack || err);
}
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
done(report.fatal ? 1 : 0);
