// States and custom dice in headless Chrome, with the BUILT package, scene
// and seats, in an in-memory repo, offline: a game library imports a
// Tabletop Simulator mod from this machine (Arcs by default: its JSON and
// whatever of its assets TTS cached, which is little), sets up a table for
// four through the launcher's New game, turns a ship to its Damaged state
// and back with the States verb (PgDn), and rolls a custom die.
// Screenshots each step. Every host but this one is refused (Chrome's
// resolver), and the page answers every web asset the cache hasn't with a
// STAND-IN of about the real one's size (states-probe.html): a ship's two
// OBJs shaped apart, a die's six cells painted with their values. So what
// is checked of the art is the importer's and the drawer's handling of it,
// never Arcs's own pictures.
//
//   pnpm build && for p in scene seats; do (cd ../$p && pnpm install && pnpm build); done
//   node probes/states-run.mjs [--mod <…>/Workshop/<id>.json] [--cache <…>/Mods] [--players 4] [--out dir] [--show]
//
// Prints a JSON report; exits non-zero if a check fails.
import { spawn } from "node:child_process";
import { guardChrome, killChrome } from "./chrome-guard.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readSave, collectAssets } from "../src/tts/tts.js";
import { AssetIndex } from "../src/tts/cache.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, ".."); // the repo: serves tabletop/, scene/dist and seats/dist
const arg = (name, d = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SHOW = process.argv.includes("--show");
const OUT = resolve(arg("out", join(process.env.TMPDIR || tmpdir(), "states-probe")));
const PLAYERS = Number(arg("players", 4));
mkdirSync(OUT, { recursive: true });
for (const need of [join(PKG, "dist/index.js"), ...["scene", "seats"].map((p) => join(ROOT, `${p}/dist/index.js`))]) if (!existsSync(need)) throw new Error(`missing ${need}: build it first`);

// ─── what to drop ────────────────────────────────────────────────────────────
const MODS = join(homedir(), "Library", "Tabletop Simulator", "Mods");
const modPath = resolve(arg("mod", join(MODS, "Workshop/2787734760.json")));
const cacheDir = resolve(arg("cache", MODS));
if (!existsSync(modPath)) throw new Error(`no mod at ${modPath}`);
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
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "states-chrome-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
   // no network: every host but this one is refused, so nothing is fetched from the web (assets come from the cache)
   "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
   "--window-size=1500,900", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"].filter(Boolean), { stdio: "ignore", detached: true });
const stop = (code) => { killChrome(chrome); server.close(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
guardChrome(chrome, { profile, stop });
setTimeout(() => { console.error("TIMEOUT"); stop(2); }, 480_000);
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
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/tabletop/probes/states-probe.html` });
for (let i = 0; i < 600 && !(await js("!!window.__ready").catch(() => false)); i++) await sleep(100);

const report = { checks: {}, steps: {}, shots: [], cached: drop.length - 1 };
let failed = false;
const check = (name, ok) => { report.checks[name] = !!ok; if (!ok) failed = true; };
const J = JSON.stringify;
const step = async (name, a) => (report.steps[name] = await js(`window.__step(${J(name)}, ${J(a ?? null)})`));
try {
  const im = await step("importMod");
  check("the mod imports into Games with its ships' States as states (Ship → Ship (Damaged))", im?.stated?.length > 0 && im.stated.every((s) => s.length === 2 && /Damaged/.test(s[1])));
  check("its custom d6s import with pictured faces", im?.customDice > 0);
  report.shots.push(await shoot("1-imported.png"));

  const ng = await step("newGame", { players: PLAYERS });
  check(`New game for ${PLAYERS} (the launcher's newSession): a session with ${PLAYERS} seats`, ng?.seats?.length === PLAYERS);
  check("every ship on the table can be turned (its trait names both looks)", ng?.ships === 75);
  check("setting up drew no state but the ones laid out (none turned yet)", ng?.drawnStates === 0);
  check("every visible object loaded (stand-ins for the assets the cache hasn't)", ng?.stats?.loaded >= ng?.stats?.visible);
  report.shots.push(await shoot("2-table.png"));

  const tu = await step("turnShip");
  check("PgDn over a ship offers “Turn to … Ship (Damaged)”", /^Turn to (Imperial )?Ship \(Damaged\)$/.test(tu?.offered?.label ?? ""));
  check("turning it is one write: its trait shows look 1, its own file unchanged", tu?.after?.trait?.shown === 1 && tu.after.trait.own === 0 && tu.sourceUrl === true);
  check("it's drawn as its Damaged look (another shape: the stand-in's lower, shorter hull)", tu?.before?.box && tu?.after?.box && tu.after.box.max[1] < tu.before.box.max[1]);
  check("the Damaged look was drawn the first time it was shown, and kept in the game's drawn under its ref", tu?.kept === true && /#1$/.test(tu?.ref ?? "") && tu.drawnAfter === tu.drawnBefore + 1);
  report.shots.push(await shoot("3-ship-damaged.png"));
  const back = await step("turnBack");
  check("PgDn again turns it back to its own look, shown as it was laid out", /^Turn to (Imperial )?Ship$/.test(back?.offered?.label ?? "") && back?.shown === 0 && J(back?.box) === J(tu?.before?.box));
  report.shots.push(await shoot("4-ship-again.png"));

  const ro = await step("rollDie");
  check("a custom die's GLB carries a picture on each of its six sides", ro?.pictured === 6);
  check("its faces read as TTS's values", J([...(ro?.labels ?? [])].sort()) === J(["1", "2", "3", "4", "5", "6"]));
  check("Roll rolls it (by lots): it moved, and lies showing a face", ro?.rolled === true && ro?.shows?.label != null);
  check("the side up is pictured: the face it reads is the face it shows", ro?.upPictured === true);
  report.shots.push(await shoot("5-die-rolled.png"));

  const probe = await js("window.__probe");
  report.errors = probe.errors;
  report.standIns = probe.standIns;
  check("no page errors", probe.errors.length === 0);
} catch (err) {
  check("ran", false);
  report.error = String(err?.stack || err);
}
report.logs = logs.filter((l) => !/^(debug|log)/.test(l)).slice(0, 30);
console.log(JSON.stringify(report, null, 2));
stop(failed ? 1 : 0);
