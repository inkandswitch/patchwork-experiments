// The arena, played with a real mouse and keyboard in headless Chrome.
//
//   (in scene/, walk/ and arena/) pnpm build
//   node probes/arena-run.mjs [--show] [--shots <dir>]
//
// Mounts the BUILT scene tool with the BUILT arena and walk plugins on an empty scene
// (two views of one doc: A makes it and plays, B joins and watches), picks
// "Arena level" on the empty scene's start screen, which lays out the sample
// arena and starts people walking at a spawn point (view.start): A, and B
// joining after, both arrive walking there. A leaves walking and opens the
// parts bin (a drawer tab: no mode), shuts it, presses Play on the bar of
// tools (a world command, at the bar's right end in every body: scene/STAGE.md
// §6; the walk body at a spawn, the gun in hand: §4), walks with W/A/S/D, runs into a wall, climbs the ramp
// onto the tower, jumps, turns to a target and shoots it with a click; Esc
// puts the gun down (never the body) and the body chip's Leave stops walking;
// the bar's Stand targets up raises the target. Outside Edit the bar holds
// only the arena's world commands, the HUD no button, and the canvas stays
// put looking, walking, holding the gun and as Stand targets up comes.
// B must see A's avatar move and A's tracer. Then a "hybrid"
// scene: a tilted deck GLB that knows nothing of arenas (the inspector's
// "Add behaviour…" offers the arena's level), a target put on it by clicking
// it in the parts bin while looking at the deck, which puts it under the deck
// and makes the scene a level, played and walked on.
// Prints a JSON report; exits non-zero if any check fails.
//
// Simulated time: both views run on the page's manual clock (window.__time,
// scene's manualTime), so walking, falling, a tracer's life and presence move
// only as this steps frames, as fast as the CPU allows. A wait on the world is
// frames of that clock (until, rest), never a sleep; the wall (loads) is for
// loading only.
import { spawn } from "node:child_process";
import { guardChrome, killChrome } from "./chrome-guard.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["arena/dist/index.js", "scene/dist/index.js", "walk/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const SHOW = process.argv.includes("--show");
const si = process.argv.indexOf("--shots");
const SHOTS = si > 0 ? resolve(process.argv[si + 1]) : join(process.env.TMPDIR || tmpdir(), "arena-shots");
mkdirSync(SHOTS, { recursive: true });
const PORT = 4640, CDP = 9640;
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
// serve only the three packages
const ALLOWED = [join(ROOT, "scene") + sep, join(ROOT, "arena") + sep, join(ROOT, "walk") + sep];
const server = createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!ALLOWED.some((a) => path.startsWith(a)) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "arena-probe-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [SHOW ? "" : "--headless=new", "--no-first-run", "--mute-audio", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
   "--window-size=1400,700", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"].filter(Boolean), { stdio: "ignore", detached: true });
const stop = (code) => { killChrome(chrome); server.close(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
// Chrome dies with this process however it ends (chrome-guard.mjs)
guardChrome(chrome, { profile, stop });
setTimeout(() => { console.error("TIMEOUT"); console.log(JSON.stringify(report, null, 2)); stop(2); }, 360_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === "page"); } catch {} if (!target) await sleep(100); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map(); const logs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails?.exception?.description}`);
});
const send = (method, params = {}) => new Promise((r, no) => { const i = ++seq; pending.set(i, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`); return r.result?.value; };
const P = (e) => js(`window.__p.${e}`);
const FRAME = 1000 / 60;
/** n frames of the page's clock, back to back (only the last draws). */
// (then one of the browser's own rendering steps: the drawn frame presented, layout and resize observers run)
const step = (n = 1) => js(`window.__time.step(${Math.max(0, Math.round(n))}).then(() => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 100); }))`);
/** ms of the page's clock, in frames. */
const rest = (ms) => step(Math.max(1, Math.round(ms / FRAME)));
/** Frame by frame until `expr` holds, for at most ms of the page's clock → its value, or false. */
const until = async (expr, ms = 10_000) => {
  try {
    return await js(`window.__time.until(() => (${expr}), { frames: ${Math.ceil(ms / FRAME)} })`);
  } catch (err) {
    if (/after \d+ frames/.test(String(err?.message))) return false;
    throw err;
  }
};
/** Loading: the wall's, up to ms, the page's frames going at its pace meanwhile. */
const loads = async (expr, ms = 10_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (await js(expr).catch(() => false)) return true;
    if (await js("!!window.__time").catch(() => false)) await step(1);
    await sleep(50);
  }
  return false;
};

const EXPECTED = /KHR_parallel_shader_compile|pointer lock refused/;
const errorsNow = async () => (await P("errors")).filter((e) => !EXPECTED.test(e));
const checks = {}, report = { checks, steps: {} };
let failed = false;
const check = (name, ok, detail) => { checks[name] = !!ok; if (!ok) failed = true; if (detail !== undefined) report.steps[name] = detail; };
const shot = async (name, clip) => { await step(1); /* a frame drawn: waits draw nothing */ const s = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); const f = join(SHOTS, `arena-${name}.png`); writeFileSync(f, Buffer.from(s.data, "base64")); (report.shots ??= []).push(f); };

const mouse = (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
async function click({ x, y }) {
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y, 1);
  await rest(30);
  await mouse("mouseReleased", x, y, 0);
  await rest(60);
}
const KEYS = { KeyW: ["w", 87], KeyA: ["a", 65], KeyS: ["s", 83], KeyD: ["d", 68], Space: [" ", 32], Escape: ["Escape", 27], Enter: ["Enter", 13], KeyR: ["r", 82] };
const keyDown = (code) => send("Input.dispatchKeyEvent", { type: "keyDown", code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] });
const keyUp = (code) => send("Input.dispatchKeyEvent", { type: "keyUp", code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] });
async function hold(code, ms) { await keyDown(code); await rest(ms); await keyUp(code); }

// the eye (camera position) and which way it looks
const eye = async () => (await P("cam()")).position;
const yaw = async () => (await P("yawPitch()")).yaw;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const aimYaw = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
let turnMode = "mouse"; // how look is driven: "mouse" (real moves under lock), "drag" (unlocked fallback), "nudge"
/** Turn to face yaw `want` (and level the pitch) by real mouse movement. */
async function face(want, pitchWant = 0) {
  for (let i = 0; i < 12; i++) {
    const { yaw: y, pitch } = await P("yawPitch()");
    const dy = wrap(want - y), dp = pitchWant - pitch;
    if (Math.abs(dy) < 0.004 && Math.abs(dp) < 0.004) return true;
    // look(): yaw -= dx * 0.0022, pitch -= dy * 0.0022
    const mx = Math.round(-dy / 0.0022), my = Math.round(-dp / 0.0022);
    if (turnMode === "nudge") await P(`nudge(${mx}, ${my})`);
    else if (turnMode === "drag") {
      const c = await P("canvasCentre()");
      // a drag (not a tap): the fallback turns by how far the mouse travelled
      await mouse("mouseMoved", c.x, c.y);
      await mouse("mousePressed", c.x, c.y, 1);
      const n = 8;
      for (let k = 1; k <= n; k++) await mouse("mouseMoved", c.x + (mx * k) / n, c.y + (my * k) / n, 1);
      await mouse("mouseReleased", c.x + mx, c.y + my, 0);
    } else {
      const c = await P("canvasCentre()");
      await mouse("mouseMoved", c.x, c.y);
      await mouse("mouseMoved", c.x + mx, c.y + my);
    }
    await rest(60);
  }
  return false;
}
/** Walk (W held) toward [x, z], steering, until within `tol` or `ms` (of the page's clock) pass. Returns the eye. */
async function walkTo([x, z], { ms = 8000, tol = 0.6 } = {}) {
  let p = await eye();
  await face(aimYaw(p, [x, 0, z]));
  await keyDown("KeyW");
  try {
    for (let t = 0; t < ms; t += 80) {
      await rest(80);
      p = await eye();
      const d = Math.hypot(x - p[0], z - p[2]);
      if (d < tol) break;
      const want = aimYaw(p, [x, 0, z]);
      if (Math.abs(wrap(want - (await yaw()))) > 0.15) { await keyUp("KeyW"); await face(want); await keyDown("KeyW"); }
    }
  } finally { await keyUp("KeyW"); }
  await rest(300);
  return eye();
}
const r3 = (p) => p.map((v) => +v.toFixed(2));
/** The arena's world commands on the bar of tools (scene/EDITOR.md, "The interface"). */
const PLAY = `.toolbar [data-command="play"]`;
const RESET = `.toolbar [data-command="reset"]`;
/** View w's bar of tools: whether it's laid out, and its two clusters' commands (the editor's, the world's). */
const bar = (w = "a") => js(`(() => { const h = window.__p.host${w.toUpperCase()}; const t = h.querySelector('.toolbar'); const ids = (c) => [...h.querySelectorAll('.toolbar .' + c + ' [data-command]')].map((e) => e.dataset.command); return { shown: !!t && t.getBoundingClientRect().height > 0, tools: ids('tools'), world: ids('world') }; })()`);
/** View w's canvas on the page: [x, y, width, height]. */
const canvasRect = (w = "a") => js(`(() => { const r = window.__p.${w.toUpperCase()}.viewport.canvas.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10); })()`);
/** The HUD's buttons in view w (it only reads: none). */
const hudButtons = (w = "a") => js(`window.__p.host${w.toUpperCase()}.querySelectorAll('.arena button').length`);
const J = JSON.stringify;
/** Is it there and laid out (a hidden element has no size)? */
const shown = async (sel, w = "a") => { const r = await P(`rect('${sel}', '${w}')`); return !!r && r.w > 0 && r.h > 0; };
/** Wait for an element to be shown and stay put (the editor's edges arrive one by one, moving what's centred in the view). */
async function steady(sel, w = "a", ms = 6000) {
  for (let last = null, same = 0, t = 0; t < ms; t += 100, await rest(100)) {
    const now = JSON.stringify(await P(`rect('${sel}', '${w}')`));
    same = now === last && now !== "null" && JSON.parse(now).w > 0 ? same + 1 : 0;
    if (same >= 3) return true;
    last = now;
  }
  return false;
}
/** Wait for a view's running set to stop changing (lingering parts each stop on their own timer). */
async function settled(w, ms = 4000) {
  for (let last = null, t = 0; ; t += 100, await rest(100)) {
    const now = JSON.stringify(await P(`running('${w}')`));
    if (now === last) return true;
    last = now;
    if (t > ms) return false;
  }
}
const sorted = async (w) => [...(await P(`running('${w}')`))].sort();
/** Leave the top body of view w by its body chip's "Leave (…)": true if the chip offered it. */
async function leaveBody(w = "a") {
  const chip = await P(`chip('${w}')`);
  if (!chip) return false;
  await click(chip);
  await until(`!!window.__p.chipItem('${w}', 'Leave')`, 3000);
  const item = await P(`chipItem('${w}', 'Leave')`);
  if (item) await click(item);
  await rest(300);
  return !!item;
}

try {
  // ─── the sample arena ────────────────────────────────────────────────────
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/arena/probes/arena-probe.html?mode=empty` });
  await loads("!!window.__ready", 20_000);
  check("page set up", (await js("window.__ready")) === true, await P("errors"));
  // an empty scene: only editing is offered (no switcher), and the add
  // part's start screen offers the templates
  const startBtn = `.add-template[data-template="arena-level"]`;
  const haveStart = (await loads(`!!window.__p.hostA.querySelector('${startBtn}')`)) && (await steady(startBtn));
  check("an empty scene's start screen offers the Arena level template, and Blank", haveStart && (await shown(startBtn)) && (await shown('.add-template[data-template=""]')), await P("text('.add-template')"));
  check("an empty scene: A in Look holding the editor, where a scene made new starts people (view.start says edit)", (await P("body('a')")) === "look" && (await P("editing('a')")) && (await P("doc()")).view?.start?.edit === true, { body: await P("body('a')"), view: (await P("doc()")).view });
  await shot("start");
  await click(await P(`rect('${startBtn}')`));
  await loads("window.__p.objects().length >= 29");
  // B joins the level A just made
  await P("joinB()");
  const allLoaded = await loads("(() => { const a = window.__p.loaded('a'), b = window.__p.loaded('b'); return a.total >= 29 && a.loaded === a.total && b.loaded === b.total; })()", 30_000);
  const lv = await P("loaded('a')");
  const traits = await js(`(() => { const os = Object.values(window.__p.doc().objects); return { level: !!window.__p.doc().traits?.["arena.level"], kinds: Object.keys(window.__p.doc().assets ?? {}).filter((k) => k.startsWith("arena/")), targets: os.filter((o) => o.traits?.["arena.target"]).length, spawns: os.filter((o) => o.traits?.["walk.spawn"]).length }; })()`);
  check("Arena level lays out the level (a level trait, 8 targets, 4 spawns, a GLB per kind in the scene's assets)", traits.level && traits.targets === 8 && traits.spawns === 4 && traits.kinds.length === 7, traits);
  const start = (await P("doc()")).view?.start;
  const startPad = start?.place ? (await P("doc()")).objects[start.place] : null;
  check("and starts people walking at a spawn point (doc.view.start)", start?.body === "walk" && !!startPad?.traits?.["walk.spawn"] && !("activity" in ((await P("doc()")).view ?? {})), (await P("doc()")).view);
  check("every block's GLB loads in both views", allLoaded, { a: lv, b: await P("loaded('b')") });
  await loads("window.__p.running('a').includes('arena') && window.__p.running('b').includes('arena')");
  check("the arena runs in both views (its level trait), and so do the walk body and the spawn points' part", (await P("running('a')")).includes("arena") && (await P("running('b')")).includes("walk.spawn") && (await P("running('a')")).includes("walk"), { a: await P("running('a')"), b: await P("running('b')") });

  // ─── a level opens as a game: both arrive walking, at the doc's spawn point ─
  // Arriving (scene/STAGE.md, "Arriving"): A, who chose the template, and B, who
  // joined the level, each enter the walk body at view.start's place once its
  // content is in. What runs is the doc's alone (H1): the same in both views.
  const arrived = await loads("window.__p.body('a') === 'walk' && window.__p.body('b') === 'walk'", 25_000);
  const padAt = await P(`world(${JSON.stringify(start?.place)})`);
  const eA = (await P("cam('a')")).position, eB = (await P("cam('b')")).position;
  check("both arrive walking (the walk body, the only body over Look), at the start's spawn point", arrived && JSON.stringify(await P("stack()")) === '["look","walk"]' && [eA, eB].every((e) => !!padAt && Math.hypot(e[0] - padAt[0], e[2] - padAt[2]) < 0.6), { a: await P("body('a')"), b: await P("body('b')"), padAt, eA: r3(eA), eB: r3(eB) });
  await settled("a");
  await settled("b");
  check("what runs is the same in both views: the doc's", JSON.stringify(await sorted("a")) === JSON.stringify(await sorted("b")), { a: await sorted("a"), b: await sorted("b") });
  check("the HUD shows 8 standing (and nothing stray), and no button: the bar offers Pick up the gun", (await P("text('.arena-count')"))[0] === "8 of 8 targets standing" && (await P(`text('${PLAY}')`))[0] === "Pick up the gun" && !/null/.test((await P("text('.arena-hud')"))[0]) && (await hudButtons()) === 0, { hud: await P("text('.arena-hud')"), bar: await bar() });
  const canvasAt = { walking: await canvasRect() };
  const bView = { start: await shown(".add-start", "b"), layers: await P("layers('b')"), chrome: await P("chrome('b')") };
  check("walking, B sees no start screen, and no grid, axes or bounds (they're Edit's)", !bView.start && !bView.layers.some((l) => /grid|axes|bounds|halo|handles/.test(l)), bView);
  await shot("game");

  // ─── the designer edits, in the same running level ───────────────────────
  // A leaves walking (Look: nothing of the editor), picks up the editor (Edit,
  // beside the body chip: scene HISTORY.md, Kernel step 1), opens the parts bin
  // from the toolbar, and B goes on walking.
  const leftToLook = await leaveBody("a");
  await settled("a");
  const lookBar = await bar();
  canvasAt.look = await canvasRect();
  const playInLook = await P(`rect('${PLAY}')`);
  check("A leaves walking: Look, where no editing aids are drawn, and the bar holds only the world's commands (Play), no editor command", leftToLook && (await P("body('a')")) === "look" && !(await P("layers('a')")).some((l) => /scene\\.(grid|axes)/.test(l)) && lookBar.shown && lookBar.tools.length === 0 && J(lookBar.world) === J(["play"]) && (await P(`text('${PLAY}')`))[0] === "Play", { body: await P("body('a')"), layers: await P("layers('a')"), bar: lookBar });
  const toggle = await P("editToggle('a')");
  if (toggle) await click(toggle);
  const toEdit = !!toggle && (await until("window.__p.editing('a')", 3000));
  check("A picks up the editor (Edit, beside the body chip): the axes are drawn (the editor's aids)", toEdit && (await P("body('a')")) === "look" && (await until("window.__p.layers('a').some((l) => /scene\\.(grid|axes)/.test(l))", 3000)), { body: await P("body('a')"), layers: await P("layers('a')") });
  const editBar = await bar();
  check("in Edit the bar holds the editor's tools, and Play at its right end, where it was in Look", editBar.tools.includes("parts") && !editBar.tools.includes("play") && J(editBar.world) === J(["play"]) && !!playInLook && Math.abs((await P(`rect('${PLAY}')`)).x - playInLook.x) < 1, { ...editBar, playInLook, playInEdit: await P(`rect('${PLAY}')`) });
  await click(await P(`rect('.toolbar [data-command="parts"]')`));
  check("Parts, from the toolbar: a drawer tab", await until("window.__p.tab('a', 'parts')", 4000), await P("running('a')"));
  const binParts = await js(`[...window.__p.hostA.querySelectorAll('.scene-parts .parts-group[data-category="Arena"] .part')].map((b) => b.dataset.part)`);
  check("the bin offers the arena's parts, under Arena", JSON.stringify(binParts) === JSON.stringify(["arena.target", "arena.crate", "arena.spawn"]), binParts);
  check("only for A: B is still walking, and runs what A runs", (await P("body('b')")) === "walk" && JSON.stringify(await sorted("b")) === JSON.stringify(await sorted("a")), { b: await P("body('b')"), running: await P("running('b')") });
  check("the doc still starts people walking", (await P("doc()")).view?.start?.body === "walk");
  await shot("edit");
  await click(await P(`rect('.toolbar [data-command="parts"]')`));
  check("Parts shut again", await until("window.__p.tab('a', 'parts') === false", 4000));

  // the level's look: the arena's atmosphere, in both views (a sky, haze, a sun casting shadows on every block)
  const look = (w) => js(`(() => { const v = window.__p.${w}.viewport; let meshes = 0, cast = 0; v.content.traverse((o) => { if (o.isMesh) { meshes++; if (o.castShadow && o.receiveShadow) cast++; } }); return { atmosphere: v.atmosphere, sky: !!v.sky?.visible, fog: !!v.scene.fog, shadowMap: v.renderer.shadowMap.enabled, sunCasts: v.lights.key.castShadow, meshes, cast }; })()`);
  await until("!!window.__p.A.viewport.atmosphere && !!window.__p.B.viewport.atmosphere", 3000);
  const looks = { a: await look("A"), b: await look("B") };
  check("a laid-out level has the arena's look in both views: sky, haze, and a sun whose shadows every block casts and takes", ["a", "b"].every((w) => looks[w].sky && looks[w].fog && looks[w].shadowMap && looks[w].sunCasts && looks[w].meshes > 0 && looks[w].cast === looks[w].meshes), looks);

  await js("window.__p.A.viewport.frame(window.__p.A.viewport.sceneBox())");
  await rest(400);
  await shot("level");
  // the editor put down to play (holding it, a walk looks by drag: it wants the pointer free)
  const untoggle = await P("editToggle('a')");
  if (untoggle) await click(untoggle);
  check("A puts the editor down to play", !!untoggle && (await until("!window.__p.editing('a')", 3000)), await P("editing('a')"));

  // ─── play ────────────────────────────────────────────────────────────────
  // spawn deterministically at Spawn 1 (-15, 0, 15), facing the middle
  await js("Math.random = () => 0");
  const camBefore = await P("cam()");
  await click(await P(`rect('${PLAY}')`));
  await rest(500);
  const holdBar = await bar();
  canvasAt.holding = await canvasRect();
  check("holding the gun the bar is still up and holds nothing (Play and Stand targets up don't apply), and the HUD no button", holdBar.shown && holdBar.tools.length === 0 && holdBar.world.length === 0 && (await hudButtons()) === 0, holdBar);
  const lockState = { locked: await P("locked()"), element: await P("lockElement()"), body: await P("body()"), stack: await P("stack()"), tool: await P("tool()"), held: await P("held()"), pointer: await P("pointer()"), chip: await P("chip()"), hud: await P("text('.arena-hud')") };
  report.steps.lock = lockState;
  check("Play walks in from Look (the walk body over Look) with the gun in hand (the held tool); the walk body holds the camera; the chip says Walk", lockState.body === "walk" && JSON.stringify(lockState.stack) === '["look","walk"]' && lockState.tool === "gun" && lockState.held && /Walk/.test(lockState.chip?.text ?? ""), lockState);
  if (!lockState.locked) turnMode = "drag";
  report.steps.turnMode = turnMode;
  const e0 = await eye();
  check("you start at a spawn point, eye 1.6 m over its pad", Math.abs(e0[0] + 15) < 0.05 && Math.abs(e0[2] - 15) < 0.05 && Math.abs(e0[1] - (1.6 + 0.05)) < 0.1, r3(e0));
  if (!lockState.locked) check("refused the lock (headless): the pointer says so, and the body looks by drag", lockState.pointer?.refused === true && lockState.pointer?.lock === true, lockState.pointer);
  await shot("play-start");

  // walk forward
  await hold("KeyW", 900);
  await rest(300);
  const e1 = await eye();
  const moved = Math.hypot(e1[0] - e0[0], e1[2] - e0[2]);
  check("W walks forward (toward the middle)", moved > 2 && e1[0] > e0[0] && e1[2] < e0[2], { from: r3(e0), to: r3(e1), moved: +moved.toFixed(2) });
  check("and stays on the floor", Math.abs(e1[1] - 1.6) < 0.05, r3(e1));
  // strafe
  const yw = await yaw();
  await hold("KeyD", 600);
  await rest(300);
  const e2 = await eye();
  const right = [Math.cos(yw), -Math.sin(yw)]; // +X at yaw 0
  const side = (e2[0] - e1[0]) * right[0] + (e2[2] - e1[2]) * right[1];
  check("D strafes right", side > 1, { side: +side.toFixed(2) });
  await hold("KeyA", 600);
  await hold("KeyS", 400);
  await rest(300);
  const e3 = await eye();
  check("A and S move back", Math.hypot(e3[0] - e1[0], e3[2] - e1[2]) < Math.hypot(e2[0] - e1[0], e2[2] - e1[2]) + 2, r3(e3));

  // look: turn to face west, with the mouse
  const turned = await face(Math.PI / 2);
  check(`look turns the view (${turnMode})`, turned && Math.abs(wrap((await yaw()) - Math.PI / 2)) < 0.02, { yaw: await yaw() });

  // a wall: the west wall's inner face is x = -19.7
  const ew = await walkTo([-25, (await eye())[2]], { ms: 3000, tol: 0.1 });
  check("the west wall stops you (radius off its face)", ew[0] > -19.7 && ew[0] < -19.0 && Math.abs(ew[1] - 1.6) < 0.05, r3(ew));

  // jump
  const yBefore = (await eye())[1];
  // a tap, not a hold: held Space hops again on landing, and at swiftshader's
  // frame rate (dt clamped to 50 ms) a long hold outlasts the first hop
  await keyDown("Space");
  let peak = yBefore;
  for (let i = 0; i < 2; i++) { await rest(40); peak = Math.max(peak, (await eye())[1]); }
  await keyUp("Space");
  for (let i = 0; i < 12; i++) { await rest(40); peak = Math.max(peak, (await eye())[1]); }
  await until(`Math.abs(window.__p.cam().position[1] - ${yBefore}) < 0.01`, 3000);
  const yAfter = (await eye())[1];
  check("Space jumps (about 0.8 m) and lands back", peak - yBefore > 0.5 && Math.abs(yAfter - yBefore) < 0.05, { peak: +(peak - yBefore).toFixed(2), back: +yAfter.toFixed(2) });

  // the ramp: from (0, 9) walk up -Z onto the tower (top y = 2.4)
  await walkTo([-3, 11], { ms: 9000 });
  await walkTo([0, 9], { ms: 5000, tol: 0.3 });
  const foot = await eye();
  const onTower = await walkTo([0, 0.6], { ms: 6000, tol: 0.3 });
  check("you climb the ramp onto the tower", Math.abs(onTower[1] - (2.4 + 1.6)) < 0.08 && Math.abs(onTower[2] - 0.6) < 0.8, { foot: r3(foot), top: r3(onTower) });
  await shot("tower");

  // shoot a target: Target 4 at (16, 4), seen from the tower (Target 7, right behind you, stays up)
  const tid = await P("byName('Target 4')");
  const tpos = await P(`world('${tid}')`);
  const here = await eye();
  // aim at the bull (1.55 m over its foot)
  const dist = Math.hypot(tpos[0] - here[0], tpos[2] - here[2]);
  await face(aimYaw(here, tpos), Math.atan2(tpos[1] + 1.55 - here[1], dist));
  const aimed = await js("(() => { const c = window.__p.A.viewport.getCamera(); const d = c.target.map((v, i) => v - c.position[i]); return window.__p.A.viewport.raycast(c.position, d)?.id ?? null; })()");
  check("turned to face it, the crosshair is on the target", aimed === tid, { aimed, tid });
  await P("watchTracers('a')"); await P("watchTracers('b')");
  const before = { a: await P("tracersSeen('a')"), b: await P("tracersSeen('b')") };
  const c = await P("canvasCentre()");
  if (turnMode === "drag") await click(c);
  else { await mouse("mousePressed", c.x, c.y, 1); await rest(30); await mouse("mouseReleased", c.x, c.y, 0); }
  await rest(40);
  await rest(300);
  const tracerA = await P("tracersSeen('a')");
  const tracerB = await P("tracersSeen('b')");
  const tdoc = await js(`window.__p.doc().objects['${tid}']`);
  check("a click shoots the target over: down.by is you", tdoc.traits["arena.target"].down?.by === "viewer:a" && !!tdoc.traits["arena.target"].stand, tdoc.traits["arena.target"]);
  check("its transform is knocked over (tilted ~90°)", Math.abs(Math.cos(tdoc.transform.rotation[0]) * Math.cos(tdoc.transform.rotation[2])) < 0.1, tdoc.transform.rotation);
  check("you see your tracer, and so does B", tracerA > before.a && tracerB > before.b, { tracerA, tracerB, before });
  const hud = await P("text('.arena-hud')");
  check("the HUD shows 7 of 8 standing, your score and 11 rounds", /7 of 8 standing/.test(hud[0]) && /You1/.test(hud[0]) && /11 \/ 12/.test(hud[0]), hud);
  check("B's view of the scores counts it too", /Player1|Someone1/.test((await P("text('.arena-hud', 'b')"))[0] ?? "") || (await P("text('.arena-count', 'b')"))[0] === "7 of 8 targets standing", await P("text('.arena-hud', 'b')"));
  await shot("shot");
  // B isn't playing, so nothing of B's own prunes per frame: the tracer must still go
  check("the tracer goes from B's view in a moment (B only watching)", await until("window.__p.drawn('b').tracers === 0", 1500), await P("drawn('b')"));

  // the other view sees the avatar move, at presence rate
  const seen0 = await P("drawn('b')");
  const pos0 = (await eye());
  await keyDown("KeyS");
  const samples = [];
  for (let i = 0; i < 10; i++) { await rest(50); samples.push((await P("drawn('b')")).avatars[0]); }
  await keyUp("KeyS");
  await rest(1200); // landed (walking back may step off the tower), and a presence tick later
  // a fall off the tower can still be landing: give B a few more ticks to catch up
  const caughtUp = async () => { const s = await P("drawn('b')"), p = await eye(); return s.avatars.length === 1 && Math.hypot(s.avatars[0][0] - p[0], s.avatars[0][2] - p[2]) < 0.05 && Math.abs(s.avatars[0][1] - (p[1] - 1.6)) < 0.05; };
  for (let t = 0; t < 2000 && !(await caughtUp()); t += 100) await rest(100);
  const seen1 = await P("drawn('b')");
  const pos1 = await eye();
  const distinct = new Set(samples.map((s) => JSON.stringify(s))).size;
  check("B sees one avatar, where A stands", seen1.avatars.length === 1 && Math.hypot(seen1.avatars[0][0] - pos1[0], seen1.avatars[0][2] - pos1[2]) < 0.05 && Math.abs(seen1.avatars[0][1] - (pos1[1] - 1.6)) < 0.05, { avatar: seen1.avatars, eye: r3(pos1) });
  check("and sees it move while A walks (several updates in 0.5 s)", distinct >= 4 && Math.hypot(seen1.avatars[0][0] - seen0.avatars[0]?.[0], seen1.avatars[0][2] - seen0.avatars[0]?.[2]) > 0.5, { distinct, from: seen0.avatars, to: seen1.avatars, eyeFrom: r3(pos0) });
  check("B labels the avatar", (await P("labels('b')")).length > 0, await P("labels('b')"));
  // (B walks too, standing at the spawn point it arrived at: A draws B, never itself)
  const aDraws = (await P("drawn('a')")).avatars;
  const posA = await eye();
  check("A draws no avatar of its own (only B's, where B stands)", aDraws.length === 1 && Math.hypot(aDraws[0][0] - posA[0], aDraws[0][2] - posA[2]) > 1, { aDraws, eye: r3(posA) });

  // Esc puts the gun down (the ladder's tool rung), never the body
  if (await P("locked()")) {
    // a locked browser's Esc takes the lock first (CDP can't do that for us): lose it, then Esc
    await js("document.exitPointerLock()");
    await rest(200);
    report.steps.afterLockLost = await P("text('.arena-hud')");
  }
  const escHint = await P("text('.body-escape')");
  await hold("Escape", 50);
  await rest(300);
  const putDown = { tool: await P("tool()"), body: await P("body()"), held: await P("held()"), play: await P(`text('${PLAY}')`), hint: escHint };
  check("Esc (its hint says so) puts the gun down and leaves A walking: the camera still the body's, the bar offers the gun again", /put down/.test(escHint[0] ?? "") && putDown.tool === null && putDown.body === "walk" && putDown.held && putDown.play[0] === "Pick up the gun", putDown);
  // the body chip's Leave stops walking and gives the camera back
  const left = await leaveBody("a");
  const after = { left, body: await P("body()"), stack: await P("stack()"), held: await P("held()"), locked: await P("locked()"), play: await P(`text('${PLAY}')`) };
  check("the body chip's Leave stops walking: Look, camera back, Play on the bar again", left && after.body === "look" && JSON.stringify(after.stack) === '["look"]' && !after.held && !after.locked && after.play[0] === "Play", after);
  await rest(400);
  check("B's avatar goes when A stops walking", (await P("drawn('b')")).avatars.length === 0, await P("drawn('b')"));
  // Enter plays too (the play command's key, through the key map); Esc puts the gun down, Leave stops walking
  await click(await P("canvasCentre()")); // (the keys to A's view; in Look a click selects nothing)
  await hold("Enter", 50);
  await rest(300);
  const byEnter = { body: await P("body()"), tool: await P("tool()") };
  await hold("Escape", 50);
  await rest(300);
  const escAgain = { body: await P("body()"), tool: await P("tool()") };
  const leftAgain = await leaveBody("a");
  check("Enter starts play (the key map): walking, the gun in hand; Esc puts it down; Leave stops walking", byEnter.body === "walk" && byEnter.tool === "gun" && escAgain.body === "walk" && escAgain.tool === null && leftAgain && (await P("body()")) === "look", { byEnter, escAgain, leftAgain });
  // Look's orbit camera works again: a drag moves the camera
  const ccam = await P("cam()");
  const cc = await P("canvasCentre()");
  await mouse("mouseMoved", cc.x, cc.y); await mouse("mousePressed", cc.x, cc.y, 1);
  for (let k = 1; k <= 8; k++) await mouse("mouseMoved", cc.x + k * 15, cc.y, 1);
  await mouse("mouseReleased", cc.x + 120, cc.y, 0);
  await rest(300);
  check("Look's orbit drag works again after Leave", Math.hypot(...(await P("cam()")).position.map((v, i) => v - ccam.position[i])) > 0.05);
  // stand them up: the bar's Stand targets up, there while a target is down
  const downBar = await bar();
  canvasAt.lookWithReset = await canvasRect();
  const playWithReset = await P(`rect('${PLAY}')`);
  check("a target down, Look: the bar holds Stand targets up then Play, no editor command", downBar.tools.length === 0 && J(downBar.world) === J(["reset", "play"]), downBar);
  check("Play stays put as Stand targets up comes (it appears to Play's left): a click meant for Play never lands on it", !!playWithReset && J(playWithReset) === J(playInLook), { playInLook, playWithReset });
  check("the bar's height is the same looking, walking, holding the gun and as Stand targets up comes: the canvas never moves", Object.values(canvasAt).every((r) => J(r) === J(canvasAt.look)), canvasAt);
  await click(await P(`rect('${RESET}')`));
  await rest(200);
  const reset = await js(`window.__p.doc().objects['${tid}']`);
  check("Stand targets up (the bar's) stands it back where it was, and goes from the bar", !reset.traits["arena.target"].down && reset.transform.rotation.every((v, i) => Math.abs(v - [0, tdoc.traits["arena.target"].stand?.rotation?.[1] ?? 0, 0][i]) < 1e-6) && (await until(`!window.__p.hostA.querySelector('${RESET}')`, 2000)), reset.transform);
  check("and Play stays put as it goes", J(await P(`rect('${PLAY}')`)) === J(playInLook), { playInLook, playAfter: await P(`rect('${PLAY}')`) });

  // ─── the player plays: B, who has only the game ──────────────────────────
  // B gets the big view for this (A shrinks); the stage follows its port's size
  await P("resize('a', 320, 240)");
  const vh = await js("window.innerHeight");
  await P(`resize('b', 1060, ${vh})`);
  await rest(800);
  const bRect = await P("viewRect('b')");
  const bCan = await js("(() => { const r = window.__p.B.viewport.canvas.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()");
  // (its canvas fills the width; the toolbar along the top takes some of the height)
  check("player B's view follows its new size", Math.abs(bCan[0] - 1060) < 4 && bCan[1] <= vh && bCan[1] > vh - 120, { bCan, vh });
  await js("window.__p.B.viewport.frame(window.__p.B.viewport.sceneBox())");
  await rest(500);
  await shot("player-lobby", bRect);
  report.steps.playerLobby = { chrome: await P("chrome('b')"), hud: await P("text('.arena-hud', 'b')") };
  // a click in B's view brings the keys there; Enter is the play command's key (scene.keys, required by the arena)
  const bc = await P("canvasCentre('b')");
  await click({ x: bc.x + 200, y: bc.y + 150 });
  await js("Math.random = () => 0");
  await hold("Enter", 50);
  await rest(500);
  const bPlay = { body: await P("body('b')"), tool: await P("tool('b')"), held: await P("held('b')"), aBody: await P("body('a')"), focus: await js("document.activeElement?.closest?.('#a, #b')?.id ?? null"), eye: r3((await P("cam('b')")).position) };
  check("Enter plays in B's view (the key map came with the arena's requires): walking with the gun, and not in A's", bPlay.body === "walk" && bPlay.tool === "gun" && bPlay.held && bPlay.aBody === "look", bPlay);
  const be0 = (await P("cam('b')")).position;
  await hold("KeyW", 700);
  await rest(300);
  const be1 = (await P("cam('b')")).position;
  check("W walks B forward", Math.hypot(be1[0] - be0[0], be1[2] - be0[2]) > 1.5 && Math.abs(be1[1] - 1.6) < 0.06, { from: r3(be0), to: r3(be1) });
  await shot("player-play", bRect);
  // shoot (unlocked: a tap shoots), and A sees B's avatar
  const bTr0 = await P("tracersSeen('b')");
  await click(await P("canvasCentre('b')"));
  await shot("player-shot", bRect);
  await rest(400);
  const bTr1 = await P("tracersSeen('b')");
  const aSees = await P("drawn('a')");
  check("B shoots (a tracer, 11 rounds), and A sees B's avatar", bTr1 > bTr0 && /11 \/ 12/.test((await P("text('.arena-hud', 'b')"))[0]) && aSees.avatars.length === 1, { bTr0, bTr1, hud: await P("text('.arena-hud', 'b')"), aSees });
  report.steps.playerPlaying = { chrome: await P("chrome('b')"), layers: await P("layers('b')") };
  check("playing, B's view draws no grid or axes (Edit's), and no drawer is open", !(await P("layers('b')")).some((l) => /grid|axes/.test(l)) && !(await P("rect('.stage-drawer', 'b')")), report.steps.playerPlaying);
  await hold("Escape", 50);
  await rest(300);
  const bDown = { tool: await P("tool('b')"), body: await P("body('b')") };
  const bLeft = await leaveBody("b");
  check("Esc puts B's gun down; the chip's Leave stops B walking: Play is back", bDown.tool === null && bDown.body === "walk" && bLeft && (await P("body('b')")) === "look" && !(await P("held('b')")) && (await P(`text('${PLAY}', 'b')`))[0] === "Play" && (await hudButtons("b")) === 0, { bDown, bLeft, body: await P("body('b')"), bar: await bar("b") });
  await shot("player-after", bRect);

  check("no errors in the arena run", (await errorsNow()).length === 0, await errorsNow());

  // ─── hybrid: a deck that knows nothing about arenas ──────────────────────
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/arena/probes/arena-probe.html?mode=hybrid` });
  await sleep(300);
  await loads("window.__ready === true", 20_000);
  await loads("(() => { const a = window.__p.loaded('a'); return a.loaded === a.total; })()", 20_000);
  check("hybrid: the arena isn't running before any arena trait", !(await P("running('a')")).includes("arena"), await P("running('a')"));
  check("hybrid: a scene made new starts A holding the editor, where the toolbar is", (await P("editing('a')")) && (await loads("!!window.__p.hostA.querySelector('.toolbar [data-command=\"inspector\"]')", 5000)), { body: await P("body('a')"), toolbar: await js(`[...window.__p.hostA.querySelectorAll('.toolbar [data-command]')].map((e) => e.dataset.command)`), start: (await P("doc()")).view?.start });
  // nothing selected: the inspector (opened from the toolbar) on the Scene,
  // whose "Add behaviour…" offers what the arena describes for a scene (the level)
  await click(await P(`rect('.toolbar [data-command="inspector"]')`));
  await until("!!window.__p.hostA.querySelector('.behaviour-add')");
  check("hybrid: the inspector's Add behaviour… offers the arena level", (await P("behaviours()")).includes("arena.level"), await P("behaviours()"));
  // the bin's Target, clicked while looking at a spot on the deck: it goes
  // there (the middle of the view), under the deck, standing upright
  const deckTop = await js("(() => { const h = window.__p.A.viewport.raycast([1, 50, 4], [0, -1, 0]); return h && h.point; })()");
  await js(`window.__p.A.viewport.setCamera({ position: [8, 9, 12], target: ${JSON.stringify(deckTop)} })`);
  await rest(200);
  const binTarget = `.scene-parts .part[data-part="arena.target"]`;
  await click(await P(`rect('.toolbar [data-command="parts"]')`));
  await until("window.__p.tab('a', 'parts')", 4000);
  await js(`window.__p.hostA.querySelector('${binTarget}')?.scrollIntoView({ block: "center" })`);
  check("hybrid: the parts bin offers the arena's target in a scene that isn't a level", await shown(binTarget), await P("text('.scene-parts')"));
  await click(await P(`rect('${binTarget}')`));
  await loads("window.__p.objects().length === 3", 5000);
  const htid = await js("window.__p.objects().find((id) => window.__p.doc().objects[id].traits?.['arena.target']) ?? null");
  check("hybrid: the target part makes the scene a level, with the scene's own look", !!htid && JSON.stringify((await P("doc()")).traits?.["arena.level"]) === "{}", { htid, traits: (await P("doc()")).traits });
  check("hybrid: the level's trait starts the arena (its Play, its gun)", (await loads("window.__p.running('a').includes('arena')")) && !!(await until(`!!window.__p.hostA.querySelector('${PLAY}')`, 4000)), { running: await P("running('a')") });
  check("hybrid: the new target is selected", !!htid && (await P("A.local.get().selected")) === htid, await P("A.local.get().selected"));
  // the inspector and the bin put away: an open drawer wants the pointer (no lock while it's open)
  await click(await P(`rect('.toolbar [data-command="inspector"]')`));
  await click(await P(`rect('.toolbar [data-command="parts"]')`));
  await loads("(() => { const a = window.__p.loaded('a'); return a.total === 3 && a.loaded === a.total; })()", 10_000);
  const ht = await P(`world('${htid}')`);
  const htUp = await js(`(() => { const m = window.__p.A.viewport.worldOf('${htid}'); return m && [m[4], m[5], m[6]].map((v) => v / Math.hypot(m[4], m[5], m[6])); })()`);
  check("hybrid: it goes under the deck, on it where you're looking, upright", (await P("doc()")).objects[htid]?.parent === "deck" && !!ht && Math.hypot(ht[0] - deckTop[0], ht[1] - deckTop[1], ht[2] - deckTop[2]) < 0.05 && htUp?.[1] > 0.999, { ht, deckTop, up: htUp });
  const hv = await js("(() => { const v = window.__p.A.viewport; return { atmosphere: v.atmosphere, sky: !!v.sky, fog: v.scene.fog, shadowMap: v.renderer.shadowMap.enabled, key: [v.lights.key.intensity, v.lights.key.position.toArray()] }; })()");
  check("hybrid: a deck with a target keeps the stage's own look (no arena sky, haze or sun)", hv.atmosphere === null && !hv.sky && hv.fog === null && !hv.shadowMap && hv.key[0] === 1.5, hv);
  // Escape lets the new target go (in Edit, holding nothing: the ladder's selection rung), so nothing wants the pointer
  await P("focusA()");
  await hold("Escape", 50);
  await rest(200);
  check("hybrid: Esc deselects (Edit, nothing held)", (await P("A.local.get().selected")) == null, await P("A.local.get().selected"));
  // the editor put down to play, as in the level (the scene was made new, so A arrived holding it; holding it,
  // a walk looks by drag and never asks for the lock)
  const hUntoggle = await P("editToggle('a')");
  if (hUntoggle) await click(hUntoggle);
  check("hybrid: A puts the editor down to play", !!hUntoggle && (await until("!window.__p.editing('a')", 3000)), await P("editing('a')"));
  await js("Math.random = () => 0");
  await until(`!!window.__p.hostA.querySelector('${PLAY}')`);
  // look at the deck from above it: with no spawn point, walking starts at the eye (scene/STAGE.md, "Bodies")
  await js("window.__p.A.viewport.setCamera({ position: [0, 6, 2], target: [0, 3, -2] })");
  await rest(200);
  const camEye = (await P("cam()")).position;
  await click(await P(`rect('${PLAY}')`));
  // (the eye as walking begins: a few frames in, before the fall has carried it far)
  if (!(await P("locked()"))) turnMode = "drag";
  const s0 = await eye();
  await rest(1800);
  const s1 = await eye();
  const under = await js(`window.__p.A.viewport.raycast([${s1[0]}, 50, ${s1[2]}], [0, -1, 0])?.point[1]`);
  check("hybrid: with no spawn point you start at the eye (where the view was) and land on the deck under it", Math.hypot(s0[0] - camEye[0], s0[2] - camEye[2]) < 0.2 && s0[1] > s1[1] + 2 && Math.abs(s1[1] - 1.6 - under) < 0.05, { cam: r3(camEye), s0: r3(s0), s1: r3(s1), deckY: under });
  // walk along the deck: down its length (it climbs toward -z… or falls; it's tilted 6°)
  const d0 = await eye();
  await walkTo([d0[0], d0[2] + 6], { ms: 3000, tol: 0.3 });
  const d1 = await eye();
  const top1 = await js(`(() => { const h = window.__p.A.viewport.raycast([${d1[0]}, 50, ${d1[2]}], [0, -1, 0]); return h && h.point[1]; })()`);
  check("hybrid: walking on the tilted deck keeps your feet on it", Math.abs(d1[2] - d0[2]) > 4 && Math.abs(d1[1] - 1.6 - top1) < 0.08, { d0: r3(d0), d1: r3(d1), deckY: top1 });
  // run into the mast
  const mastHit = await walkTo([0, -10], { ms: 6000, tol: 0.3 });
  check("hybrid: the mast stops you", mastHit[2] > -4 + 0.2 && Math.hypot(mastHit[0], mastHit[2] + 4) < 1.2, r3(mastHit));
  await shot("hybrid");

  // ─── under the lock (simulated: headless Chrome refuses it) ──────────────
  // the canvas's requestPointerLock grants and exitPointerLock lets go, as a
  // browser does; the router then builds locked events (movementX/Y as dx/dy,
  // the ray down the middle) and the walk body turns by them. The lock was
  // refused when walking began; a new body starts afresh (STAGE.md, "Bodies"), so
  // leave walking and walk in again from here (the chip's Walk).
  await js(`(() => { const cv = window.__p.A.viewport.canvas; const changed = () => setTimeout(() => document.dispatchEvent(new Event("pointerlockchange")), 0); Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => window.__fakeLock ? cv : null }); cv.requestPointerLock = () => { window.__fakeLock = true; changed(); return Promise.resolve(); }; document.exitPointerLock = () => { window.__fakeLock = false; changed(); }; })()`);
  const refusedBefore = (await P("pointer()"))?.refused;
  await leaveBody("a");
  const chipW = await P("chip()");
  if (chipW) await click(chipW);
  await until("!!window.__p.chipItem('a', 'Walk')", 3000);
  const walkItem = await P("chipItem('a', 'Walk')");
  if (walkItem) await click(walkItem);
  await rest(300);
  const lockedNow = await P("pointer()");
  check("locked: a new body starts afresh: walking again from the chip, the lock granted (lock ∧ ¬wanted ∧ ¬released ∧ ¬refused)", refusedBefore === true && (await P("body()")) === "walk" && lockedNow?.locked === true && lockedNow.refused === false && lockedNow.wanted === false && (await P("locked()")), { refusedBefore, pointer: lockedNow, body: await P("body()"), tool: await P("tool()") });
  turnMode = "nudge";
  const ht2 = await js(`window.__p.world('${htid}')`);
  const me = await eye();
  const aimOk = await face(aimYaw(me, ht2), Math.atan2(ht2[1] + 1.55 - me[1], Math.hypot(ht2[0] - me[0], ht2[2] - me[2])));
  check("locked: mouse movement (dx, dy) turns you to face the deck's target", aimOk, { yawPitch: await P("yawPitch()") });
  const cc2 = await P("canvasCentre()");
  // a press shoots at once under the lock (no release needed)
  await mouse("mousePressed", cc2.x, cc2.y, 1);
  await rest(150);
  const downAtPress = await js(`window.__p.doc().objects['${htid}'].traits['arena.target'].down?.by ?? null`);
  await mouse("mouseReleased", cc2.x, cc2.y, 0);
  check("locked: a press shoots the deck's target over", downAtPress === "viewer:a", { downAtPress });
  // losing the lock (the browser's Esc, rung 0 of the ladder, unseen by the
  // page): released, and the body walks on; the next press on the world only
  // relocks (no shot)
  await js(`(() => { window.__fakeLock = false; document.dispatchEvent(new Event("pointerlockchange")); })()`);
  await rest(150);
  const released = await P("pointer()");
  const pz = await eye();
  await hold("KeyW", 300); // (backwards is the mast)
  await rest(150);
  const pz2 = await eye();
  check("lost lock (the browser's Esc): released; still walking with the gun, and W walks", released?.released === true && (await P("body()")) === "walk" && (await P("tool()")) === "gun" && Math.hypot(pz2[0] - pz[0], pz2[2] - pz[2]) > 0.3, { released, pz: r3(pz), pz2: r3(pz2) });
  const ammo0 = (await P("text('.arena-ammo')"))[0];
  const cc3 = await P("canvasCentre()");
  await click(cc3);
  await rest(200);
  check("after a release, the next press only relocks: no shot, locked again", (await P("text('.arena-ammo')"))[0] === ammo0 && (await P("pointer()"))?.released === false && (await P("locked()")), { ammo0, ammo1: (await P("text('.arena-ammo')"))[0], pointer: await P("pointer()") });
  await js("delete document.pointerLockElement");
  await hold("Escape", 50);
  await rest(200);
  check("hybrid: no errors", (await errorsNow()).length === 0, await errorsNow());
} catch (err) {
  check("ran", false, String(err?.stack || err));
  try { await shot("failure"); } catch {}
}
report.logs = logs.filter((l) => !/^(debug|log)/.test(l)).slice(0, 40);
report.frames = await js("window.__time?.frames() ?? null").catch(() => null); // of the page's clock
console.log(JSON.stringify(report, null, 2));
stop(failed ? 1 : 0);
