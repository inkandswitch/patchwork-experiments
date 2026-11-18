// A TTS mod end to end with its REAL art, in headless Chrome, with the BUILT
// package, scene and seats, in an in-memory repo (no sync server): Sovereign:
// Fall of Wormwood by default (2–4 players, no Lua, nothing of it in TTS's
// cache). sovereign-probe.html imports its JSON alone into a game library, so
// every asset is fetched when something first needs it; New game for four;
// four views of the session (four peers: each its own viewer and its own
// card drawer), each sitting in a seat; Start if the import made a recipe
// with start steps, else each seat draws five from a deck it turned face
// down; then what each view really draws for every hand card (the GLB it
// shows, as the game's kind: a face or a back; loaded; lying face up), once
// drawing has settled. Screenshots the four views, and the table from seats 1 and 3.
//
// The page's fetch of a web asset is answered from files fetched beforehand
// (fetch-assets.mjs, its --out dir here as --assets), with the CORS header the
// host sent, so what is shown is what a viewer would see if their fetches
// succeed as the recorded ones did. Every other host is refused (Chrome's
// resolver): nothing reaches the network.
//
//   node probes/fetch-assets.mjs --mod <mod.json> --out <dir>     (once)
//   pnpm build && for p in scene seats; do (cd ../$p && pnpm install && pnpm build); done
//   node probes/sovereign-run.mjs --assets <dir> [--mod <mod.json>] [--players 4] [--out dir] [--show]
//
// Prints a JSON report; exits non-zero if a check fails. Heavy: the mod's ten
// player decks are 7700 × 3174 PNG sheets of ~33 MB each.
import { spawn } from "node:child_process";
import { guardChrome, killChrome } from "./chrome-guard.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, ".."); // the repo: serves tabletop/, scene/dist and seats/dist
const arg = (name, d = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SHOW = process.argv.includes("--show");
const OUT = resolve(arg("out", join(process.env.TMPDIR || tmpdir(), "sovereign-probe")));
const PLAYERS = Number(arg("players", 4));
const ASSETS = arg("assets") && resolve(arg("assets"));
const modPath = resolve(arg("mod", join(homedir(), "Library", "Tabletop Simulator", "Mods", "Workshop", "1839962766.json")));
mkdirSync(OUT, { recursive: true });
for (const need of [join(PKG, "dist/index.js"), ...["scene", "seats"].map((p) => join(ROOT, `${p}/dist/index.js`))]) if (!existsSync(need)) throw new Error(`missing ${need}: build it first`);
if (!existsSync(modPath)) throw new Error(`no mod at ${modPath}`);
if (!ASSETS || !existsSync(join(ASSETS, "index.json"))) throw new Error("--assets <dir>: fetch-assets.mjs's --out (its index.json and files/)");
const web = JSON.parse(readFileSync(join(ASSETS, "index.json"), "utf8"));

// the mod's JSON alone, as someone drops it with nothing cached
const drop = [{ path: modPath, name: basename(modPath) }];
const manifest = drop.map((d, i) => ({ url: `/drop/${i}`, name: d.name }));

const PORT = Number(arg("port", 4497)), CDP = PORT + 5000;
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
const server = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const pathname = decodeURIComponent(u.pathname);
  if (pathname === "/manifest.json") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(manifest));
  if (pathname === "/web-asset") {
    const e = web[u.searchParams.get("u")];
    // (599: the host couldn't be had when it was fetched; the page fails it as a network error)
    if (!e || !existsSync(join(ASSETS, e.file))) return void res.writeHead(599).end();
    res.writeHead(200, { "content-type": e.contentType || "application/octet-stream", "x-recorded-acao": e.acao ?? "", "cache-control": "no-store" });
    return void createReadStream(join(ASSETS, e.file)).pipe(res);
  }
  const m = /^\/drop\/(\d+)$/.exec(pathname);
  const path = m ? drop[Number(m[1])]?.path : join(ROOT, pathname);
  if (!path || (!m && !path.startsWith(ROOT)) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "sovereign-chrome-"));
const W = 1900, H = 1000;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
   // no network: every host but this one is refused
   "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
   `--window-size=${W},${H}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"].filter(Boolean), { stdio: "ignore", detached: true });
const stop = (code) => { killChrome(chrome); server.close(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
guardChrome(chrome, { profile, stop });
setTimeout(() => { console.error("TIMEOUT"); stop(2); }, 1_500_000);
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
const shoot = async (name, clip = null) => {
  const shot = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  const p = join(OUT, name);
  writeFileSync(p, Buffer.from(shot.data, "base64"));
  return p;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/tabletop/probes/sovereign-probe.html` });
for (let i = 0; i < 600 && !(await js("!!window.__ready").catch(() => false)); i++) await sleep(100);

const report = { checks: {}, steps: {}, shots: [] };
let failed = false;
const check = (name, ok) => { report.checks[name] = !!ok; if (!ok) failed = true; };
const J = JSON.stringify;
const step = async (name, a, key = name) => (report.steps[key] = await js(`window.__step(${J(name)}, ${J(a ?? null)})`));
const t0 = Date.now();
const lap = (what) => console.error(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${what}`);
try {
  const im = await step("importMod");
  lap("imported");
  check("the mod's JSON alone imports into Games", im?.pieces > 0);
  check("nothing is fetched at import (assets by URL, fetched when first drawn)", im?.fetchedAtImport === 0 && im?.assetsCached === 0);
  report.shots.push(await shoot("1-imported.png"));

  const ng = await step("newGame", { players: PLAYERS });
  lap("new game");
  check(`New game for ${PLAYERS}: a session with ${PLAYERS} seats`, ng?.seats?.length === PLAYERS);
  check("setting up fetched what the table lays out, and nothing it lays out is drawn without its art", ng?.fetchedForSetup > 0 && ng?.missing?.length === 0);

  // the first peer arrives, and draws what everyone is shown (the face-up cards); then the others
  const v0 = await step("openView", { w: 0 }, "openView0");
  lap("view 1 open");
  check("view 1: every object loaded, none in error", v0?.loaded && v0.errors.length === 0);
  check("view 1: the faces everyone is shown (the face-up decks) drawn and kept in the game", v0?.kept);
  report.shots.push(await shoot("2-first-view.png"));
  for (const w of [1, 2, 3]) {
    const v = await step("openView", { w }, `openView${w}`);
    lap(`view ${w + 1} open`);
    check(`view ${w + 1}: every object loaded, none in error`, v?.loaded && v.errors.length === 0);
  }
  const after = await step("gameState", null, "afterViews");
  check("each web asset was fetched once, by the first viewer: the later ones draw from what the game keeps", Object.values(after?.asked ?? {}).every((n) => n === 1));
  check("every web asset the table uses is cached in the game (an image too big to keep, made smaller)", after?.assetsCached === Object.keys(after?.asked ?? {}).length);

  for (let w = 0; w < PLAYERS; w++) {
    const s = await step("sit", { w, k: w }, `sit${w}`);
    check(`view ${w + 1} sits in seat ${w + 1} (${s?.seat}) by its picker`, s?.ok);
  }
  const sb = await step("startButton", { w: 0 });
  report.recipeStart = im?.startSteps ?? 0;
  if (im?.startSteps > 0) {
    check("Start game is offered once every seat is taken", sb?.button && !sb.disabled);
    const st = await step("start", { w: 0 });
    check("Start game starts it", st?.ok);
  } else {
    check("no start steps in the recipe: no Start game on the bar", !sb?.button);
    const ps = await step("piles");
    report.steps.pilesBefore = ps?.slice(0, 12);
    for (let w = 0; w < PLAYERS; w++) {
      await step("turnDown", { k: w }, `turnDown${w}`);
      await sleep(800);
      const d = await step("drawFrom", { w, k: w, n: 5 }, `draw${w}`);
      lap(`seat ${w + 1} drew`);
      check(`seat ${w + 1} draws five into its hand (D)`, d?.drawn?.length === 5);
      check(`seat ${w + 1} draws them from the deck it turned face down`, d?.fromTurned);
    }
  }
  const pv = await step("privacy");
  lap("privacy");
  const seats = pv?.seats ?? [];
  // what each view really draws for each hand card (rendered, sovereign-probe.html): the GLB it shows, as the game's kind
  const own = (w) => pv?.rendered?.[w]?.[seats[w]] ?? [];
  report.hands = pv?.rendered?.map((by, w) => own(w).map((r) => `${r.as}${r.faceUp ? "" : " (face down)"} ${r.image ?? "-"}`)) ?? null;
  check("drawing settled before the screenshots: each view draws its own hand's faces from their kept docs, loaded, and every other hand as backs", pv?.settled);
  check("each view draws its own hand's 5 faces: each card's GLB is its face's (not a back, not bytes, not the veil), loaded with its art", seats.every((_, w) => own(w).length === 5 && own(w).every((r) => r.as === "face" && r.loaded && r.textured)));
  check("…lying face up (its face toward the seat's camera)", seats.every((_, w) => own(w).every((r) => r.faceUp)));
  check("…and no face shown is drawn from a card back's image", seats.every((_, w) => own(w).every((r) => r.imageIsABack === false)));
  check("…and every other seat's hand as backs (no face, no veil): drawn as the shown, and its GLB a back's", !!pv && pv.tallies.every((t, w) => seats.every((s, k) => k === w || !t[s] || (t[s].face === 0 && t[s].veil === 0))) && seats.every((s, w) => seats.every((o, k) => k === w || (pv.rendered[w][o] ?? []).every((r) => r.as === "back"))));
  report.shots.push(await shoot("3-four-views.png"));
  for (const w of [0, 2]) {
    await step("lookFromSeat", { w, k: w }, `look${w}`);
    report.shots.push(await shoot(`4-seat-${w + 1}.png`, await js(`window.__step("rect", { w: ${w} })`)));
  }
  report.game = await step("gameState", null, "end");
  const probe = await js("window.__probe");
  report.errors = probe.errors;
  report.warnings = probe.warnings.slice(0, 20);
  check("no page errors", probe.errors.length === 0);
} catch (err) {
  check("ran", false);
  report.error = String(err?.stack || err);
}
report.logs = logs.filter((l) => !/^(debug|log)/.test(l)).slice(0, 30);
console.log(JSON.stringify(report, null, 2));
stop(failed ? 1 : 0);
