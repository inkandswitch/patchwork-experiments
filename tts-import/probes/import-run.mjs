// Import a mod in headless Chrome with the BUILT tool, open the game it made
// in the BUILT tabletop-game tool, set up a table, show it with the BUILT
// scene tool, and screenshot it.
//
//   pnpm build && for p in scene seats tabletop keep bag dice; do (cd ../$p && pnpm install && pnpm build); done
//   node probes/import-run.mjs                                   # the tiny fixture
//   node probes/import-run.mjs --mod "<…>/Mods/Workshop/3477136430.json" --cache "<…>/Mods" [--out dir] [--show]
//
// With --mod/--cache it drops the mod's JSON plus exactly the cache files the
// mod refers to (found by TTS's naming rule), as a user dropping them would.
// Nothing is downloaded. Prints a JSON report; exits non-zero if a check fails.
import { spawn } from "node:child_process";
import { guardChrome, killChrome } from "./chrome-guard.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readSave, collectAssets } from "../src/tts.js";
import { AssetIndex } from "../src/cache.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, ".."); // the repo: serves tts-import/, scene/dist and seats/dist
const arg = (name, d = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SHOW = process.argv.includes("--show");
const OUT = resolve(arg("out", join(process.env.TMPDIR || tmpdir(), "tts-import-probe")));
mkdirSync(OUT, { recursive: true });
for (const need of [join(PKG, "dist/index.js"), ...["scene", "seats", "tabletop", "keep", "bag", "dice"].map((p) => join(ROOT, `${p}/dist/index.js`))]) if (!existsSync(need)) throw new Error(`missing ${need}: build it first`);

// ─── what to drop ────────────────────────────────────────────────────────────
const fixture = join(PKG, "fixtures/tiny-mod");
const modPath = resolve(arg("mod", join(fixture, "Workshop/1234567890.json")));
const cacheDir = resolve(arg("cache", fixture));
const drop = [{ path: modPath, name: basename(modPath) }];
{
  const save = readSave(readFileSync(modPath, "utf8"));
  const index = new AssetIndex();
  for (const sub of ["Images", "Models", "Images Raw", "Models Raw", "PDF"]) {
    const dir = join(cacheDir, sub);
    if (existsSync(dir)) for (const f of readdirSync(dir)) index.add(join(dir, f), join(dir, f));
  }
  const seen = new Set();
  for (const a of collectAssets(save.objects, { tableURL: save.tableURL }).values()) {
    const hit = index.find(a.url);
    if (hit && !seen.has(hit.value)) {
      seen.add(hit.value);
      drop.push({ path: hit.value, name: basename(hit.value) });
    }
  }
}
const manifest = drop.map((d, i) => ({ url: `/drop/${i}`, name: d.name }));

// ─── serve ───────────────────────────────────────────────────────────────────
const PORT = Number(arg("port", 4493)), CDP = PORT + 5000;
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (pathname === "/manifest.json") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(manifest));
  const m = /^\/drop\/(\d+)$/.exec(pathname);
  const path = m ? drop[Number(m[1])]?.path : join(ROOT, pathname);
  if (!path || (!m && !path.startsWith(ROOT)) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "tts-import-chrome-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
   "--window-size=1500,900", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"].filter(Boolean), { stdio: "ignore", detached: true });
const stop = (code) => { killChrome(chrome); server.close(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
// Chrome dies with this process however it ends (chrome-guard.mjs)
guardChrome(chrome, { profile, stop });
setTimeout(() => { console.error("TIMEOUT"); stop(2); }, 600_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === "page"); } catch {} if (!target) await sleep(100); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map(); const logs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.consoleAPICalled") logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (msg.method === "Runtime.exceptionThrown") logs.push(`exception: ${msg.params.exceptionDetails?.exception?.description}`);
});
const send = (method, params = {}) => new Promise((r, no) => { const i = ++seq; pending.set(i, (x) => (x.error ? no(new Error(`${method}: ${x.error.message}`)) : r(x.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`); return r.result?.value; };
const shoot = async (name) => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const p = join(OUT, name);
  writeFileSync(p, Buffer.from(shot.data, "base64"));
  return p;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/tts-import/probes/import-probe.html${arg("query") ? `?${arg("query")}` : ""}` });
for (let i = 0; i < 6000 && !(await js("!!window.__ready").catch(() => false)); i++) await sleep(100);

const report = { mod: modPath, dropped: drop.length, checks: {}, shots: [] };
let failed = false;
const check = (name, ok) => { report.checks[name] = !!ok; if (!ok) failed = true; };
try {
  const probe = await js("window.__probe");
  Object.assign(report, { probe });
  const sc = probe.scene ?? {};
  check("no page errors", probe.errors.length === 0);
  check("import finished", probe.status === "done");
  check("Open the game opened the game it made with the tabletop-game tool", probe.opened?.[0]?.toolId === "tabletop-game");
  check("the game says which mod it came from", !!probe.game?.origin?.tts?.saveName);
  check("the game page drew every piece", probe.drawn === probe.game?.pieces && !/couldn't/i.test(probe.drawStatus));
  check("a GLB drawn from the mod's assets says which of its URLs it came from", probe.drawnOrigins > 0 || (probe.report?.counts?.assets?.cache ?? 0) === 0);
  check("Set up a table opened a scene with the scene tool", probe.tableOpened?.toolId === "scene");
  check("every card on the table is kept, by the plain keeper", sc.cards === sc.keptCards);
  check("a hand for every seat, the seats laid, and it starts in play", sc.seats?.length === probe.game?.seats?.length && probe.game.seats.every((s) => sc.hands.includes(s)) && (sc.seats.length === 0 || sc.view?.activity === "play"));
  check("a mod with bags has bags on the table, each holding its things in a bag document", (probe.report?.counts?.bags ?? 0) === 0 || sc.bags > 0);
  check("the table says which mod it came from", !!sc.origin?.tts?.saveName);
  check("every placed piece not locked can be carried (the scene's carry trait)", sc.carryable === sc.placed - sc.locked && sc.carryable > 0);
  check("every visible object loaded", probe.sceneStats && probe.sceneStats.loaded >= probe.sceneStats.visible);
  report.shots.push(await shoot("overview.png"));
  // closer looks, from the near side (+Z), at the middle of the table
  const cam = probe.camera;
  if (cam) {
    const t = cam.target;
    const span = Math.hypot(cam.position[0] - t[0], cam.position[1] - t[1], cam.position[2] - t[2]);
    await js(`window.__dbg.viewport.setCamera({ position: [${t[0]}, ${t[1] + span * 0.45}, ${t[2] + span * 0.3}], target: [${t[0]}, ${t[1]}, ${t[2] - span * 0.02}] })`);
    await sleep(600);
    report.shots.push(await shoot("closer.png"));
    if (arg("look")) {
      await js(`window.__dbg.viewport.setCamera(${arg("look")})`);
      await sleep(600);
      report.shots.push(await shoot("look.png"));
    }
  }
} catch (err) {
  check("ran", false);
  report.error = String(err?.stack || err);
}
report.logs = logs.filter((l) => !/^(debug|log)/.test(l)).slice(0, 30);
console.log(JSON.stringify(report, null, 2));
stop(failed ? 1 : 0);
