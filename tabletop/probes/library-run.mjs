// The game library's launcher in headless Chrome, with the BUILT package,
// scene and seats, in an in-memory repo (no network, no sync server):
// make a library, add the built-in games (twice: once each), start Lost
// Cities for 2, sit, fork the session, import the tiny TTS fixture mod and
// start a game of it, open the library as a folder. Screenshots each step.
//
//   pnpm build && for p in scene seats; do (cd ../$p && pnpm install && pnpm build); done
//   node probes/library-run.mjs [--out dir] [--show]
//
// Prints a JSON report; exits non-zero if a check fails.
import { spawn } from "node:child_process";
import { guardChrome, killChrome } from "./chrome-guard.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, ".."); // the repo: serves tabletop/, scene/dist and seats/dist
const arg = (name, d = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SHOW = process.argv.includes("--show");
const OUT = resolve(arg("out", join(process.env.TMPDIR || tmpdir(), "library-probe")));
mkdirSync(OUT, { recursive: true });
for (const need of [join(PKG, "dist/index.js"), ...["scene", "seats"].map((p) => join(ROOT, `${p}/dist/index.js`))]) if (!existsSync(need)) throw new Error(`missing ${need}: build it first`);

// the tiny mod's files, as a person picks them: its JSON and its cache
const mod = join(PKG, "fixtures/tiny-mod");
const drop = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (!/^\.|\.md$/.test(e.name)) drop.push({ path: p, name: basename(p) });
  }
};
walk(mod);
const manifest = drop.map((d, i) => ({ url: `/drop/${i}`, name: d.name }));

const PORT = Number(arg("port", 4497)), CDP = PORT + 5000;
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
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "library-chrome-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
   "--window-size=1500,900", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"].filter(Boolean), { stdio: "ignore", detached: true });
const stop = (code) => { killChrome(chrome); server.close(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
guardChrome(chrome, { profile, stop });
setTimeout(() => { console.error("TIMEOUT"); stop(2); }, 300_000);
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
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/tabletop/probes/library-probe.html` });
for (let i = 0; i < 600 && !(await js("!!window.__ready").catch(() => false)); i++) await sleep(100);

const report = { checks: {}, steps: {}, shots: [] };
let failed = false;
const check = (name, ok) => { report.checks[name] = !!ok; if (!ok) failed = true; };
const step = async (name) => (report.steps[name] = await js(`window.__step(${JSON.stringify(name)})`));
try {
  const empty = await step("empty");
  check("a new library holds Games and Sessions, linked as folders", empty?.ready && JSON.stringify(empty.folders) === JSON.stringify([["Games", "folder"], ["Sessions", "folder"]]));
  report.shots.push(await shoot("1-empty.png"));

  const b = await step("builtIns");
  check("Add the built-in games lists Santorini, Lost Cities, Draw Dominoes and Liar's dice", JSON.stringify(b?.games) === JSON.stringify(["Santorini", "Lost Cities", "Draw Dominoes", "Liar's dice"]));
  check("Draw Dominoes offers 2, 3 or 4 players", JSON.stringify(b?.variants) === JSON.stringify(["2 players", "3 players", "4 players"]));
  const again = await step("again");
  check("adding them again adds none", again?.games === 4 && /here already/.test(again.status));
  report.shots.push(await shoot("2-games.png"));

  const ng = await step("newGame");
  check("New game on Lost Cities opens a scene in the scene tool", ng?.opened?.toolId === "scene");
  check("the session is in Sessions, named by the game and the date", /^Lost Cities, \d{4}-\d\d-\d\d \d\d:\d\d$/.test(ng?.sessions?.[0] ?? ""));
  check("the description lists it, and drew what the table lays out", ng?.tables?.length === 1 && ng.drawn.length > 0);
  check("the table: 60 cards, each kept by the joint keeper; two seats, empty", ng?.scene?.cards === 60 && ng.scene.keptCards === 60 && JSON.stringify(ng.scene.seats) === JSON.stringify({ p1: null, p2: null }));
  check("every visible object loaded", ng?.scene?.stats?.loaded >= ng?.scene?.stats?.visible);
  report.shots.push(await shoot("3-lost-cities.png"));

  await step("sit");
  const f = await step("fork");
  check("Fork lists the copy first, saying where it came from", /\(copy\)/.test(f?.sessions?.[0] ?? "") && f.sessions.length === 2);
  check("the copy: the same things, its cards bare backs (no keeper), its seats empty, forkedFrom with heads", f?.scene?.placed === ng?.scene?.placed && f.scene.keptCards === 0 && JSON.stringify(f.scene.seats) === JSON.stringify({ p1: null, p2: null }) && f.scene.forkedFrom?.url === ng.opened.url && Array.isArray(f.scene.forkedFrom.heads));
  check("the fork's view loaded", f?.scene?.stats?.loaded >= f?.scene?.stats?.visible);
  report.shots.push(await shoot("4-fork.png"));

  const im = await step("importMod");
  check("Import puts the mod's game in Games", im?.games?.length === 5 && im.link?.type === "tabletop-game" && !!im.origin?.tts?.saveName);
  check("its assets that came with it are cached by URL", im?.assets > 0);
  report.shots.push(await shoot("5-imported.png"));
  const pi = await step("playImported");
  check("New game on the imported game opens its table", pi?.opened?.toolId === "scene" && pi.scene?.placed > 0 && pi.scene.stats.loaded >= pi.scene.stats.visible);
  report.shots.push(await shoot("6-imported-table.png"));

  const af = await step("asFolder");
  check("Open as folder opens the library in the folder tool", af?.opened?.toolId === "folder-viewer" && af.opened.url === af.library);

  const probe = await js("window.__probe");
  report.errors = probe.errors;
  check("no page errors", probe.errors.length === 0);
} catch (err) {
  check("ran", false);
  report.error = String(err?.stack || err);
}
report.logs = logs.filter((l) => !/^(debug|log)/.test(l)).slice(0, 30);
console.log(JSON.stringify(report, null, 2));
stop(failed ? 1 : 0);
