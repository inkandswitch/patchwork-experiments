// The arena, played with a real mouse and keyboard in headless Chrome.
//
//   (in scene/ and arena/) pnpm build
//   node probes/arena-run.mjs [--show] [--shots <dir>]
//
// Mounts the BUILT scene tool with the BUILT arena plugins on an empty scene
// (two views of one doc: A makes it and plays, B joins and watches), picks
// "Arena level" on the empty scene's start screen, which lays out the sample
// arena and starts the scene in play: A, and B joining after, are both in the
// game, with no editor, each camera framing the whole level.
// A switches to Edit (the editor and the arena's edit commands) and back to
// Play, presses Play, walks with W/A/S/D, runs into a wall, climbs the ramp
// onto the tower, jumps, turns to a target and shoots it with a click, stops
// with Esc. B must see A's avatar move and A's tracer. Then a "hybrid"
// scene: a tilted deck GLB that knows nothing of arenas, made a level from
// the inspector's "Add behaviour…", a target put on it with "Add target",
// played and walked on.
// Prints a JSON report; exits non-zero if any check fails.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["arena/dist/index.js", "scene/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const SHOW = process.argv.includes("--show");
const si = process.argv.indexOf("--shots");
const SHOTS = si > 0 ? resolve(process.argv[si + 1]) : join(process.env.TMPDIR || tmpdir(), "arena-shots");
mkdirSync(SHOTS, { recursive: true });
const PORT = 4640, CDP = 9640;
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
// serve only the two packages
const ALLOWED = [join(ROOT, "scene") + sep, join(ROOT, "arena") + sep];
const server = createServer((req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!ALLOWED.some((a) => path.startsWith(a)) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "arena-probe-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
   "--window-size=1400,700", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"].filter(Boolean), { stdio: "ignore" });
const stop = (code) => { try { chrome.kill(); } catch {} server.close(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
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
const until = async (expr, ms = 10_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr).catch(() => false)) return true; await sleep(50); } return false; };

const EXPECTED = /KHR_parallel_shader_compile|pointer lock refused/;
const errorsNow = async () => (await P("errors")).filter((e) => !EXPECTED.test(e));
const checks = {}, report = { checks, steps: {} };
let failed = false;
const check = (name, ok, detail) => { checks[name] = !!ok; if (!ok) failed = true; if (detail !== undefined) report.steps[name] = detail; };
const shot = async (name, clip) => { const s = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); const f = join(SHOTS, `arena-${name}.png`); writeFileSync(f, Buffer.from(s.data, "base64")); (report.shots ??= []).push(f); };

const mouse = (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
async function click({ x, y }) {
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y, 1);
  await sleep(30);
  await mouse("mouseReleased", x, y, 0);
  await sleep(60);
}
const KEYS = { KeyW: ["w", 87], KeyA: ["a", 65], KeyS: ["s", 83], KeyD: ["d", 68], Space: [" ", 32], Escape: ["Escape", 27], Enter: ["Enter", 13], KeyR: ["r", 82] };
const keyDown = (code) => send("Input.dispatchKeyEvent", { type: "keyDown", code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] });
const keyUp = (code) => send("Input.dispatchKeyEvent", { type: "keyUp", code, key: KEYS[code][0], windowsVirtualKeyCode: KEYS[code][1] });
async function hold(code, ms) { await keyDown(code); await sleep(ms); await keyUp(code); }

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
    await sleep(60);
  }
  return false;
}
/** Walk (W held) toward [x, z], steering, until within `tol` or `ms` pass. Returns the eye. */
async function walkTo([x, z], { ms = 8000, tol = 0.6 } = {}) {
  const t0 = Date.now();
  let p = await eye();
  await face(aimYaw(p, [x, 0, z]));
  await keyDown("KeyW");
  try {
    while (Date.now() - t0 < ms) {
      await sleep(80);
      p = await eye();
      const d = Math.hypot(x - p[0], z - p[2]);
      if (d < tol) break;
      const want = aimYaw(p, [x, 0, z]);
      if (Math.abs(wrap(want - (await yaw()))) > 0.15) { await keyUp("KeyW"); await face(want); await keyDown("KeyW"); }
    }
  } finally { await keyUp("KeyW"); }
  await sleep(300);
  return eye();
}
const r3 = (p) => p.map((v) => +v.toFixed(2));
/** Is it there and laid out (a hidden element has no size)? */
const shown = async (sel, w = "a") => { const r = await P(`rect('${sel}', '${w}')`); return !!r && r.w > 0 && r.h > 0; };
/** Wait for an element to be shown and stay put (the editor's edges arrive one by one, moving what's centred in the view). */
async function steady(sel, w = "a", ms = 6000) {
  for (let last = null, same = 0, t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) {
    const now = JSON.stringify(await P(`rect('${sel}', '${w}')`));
    same = now === last && now !== "null" && JSON.parse(now).w > 0 ? same + 1 : 0;
    if (same >= 3) return true;
    last = now;
  }
  return false;
}
/** Wait for a view's running set to stop changing (lingering parts each stop on their own timer). */
async function settled(w, ms = 4000) {
  for (let last = null, t0 = Date.now(); ; await sleep(100)) {
    const now = JSON.stringify(await P(`running('${w}')`));
    if (now === last) return true;
    last = now;
    if (Date.now() - t0 > ms) return false;
  }
}
const sorted = async (w) => [...(await P(`running('${w}')`))].sort();

try {
  // ─── the sample arena ────────────────────────────────────────────────────
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/arena/probes/arena-probe.html?mode=empty` });
  await until("!!window.__ready", 20_000);
  check("page set up", (await js("window.__ready")) === true, await P("errors"));
  // an empty scene: only editing is offered (no switcher), and the add
  // part's start screen offers the templates
  const startBtn = `.add-template[data-template="arena-level"]`;
  const haveStart = (await until(`!!window.__p.hostA.querySelector('${startBtn}')`)) && (await steady(startBtn));
  check("an empty scene's start screen offers the Arena level template, and Blank", haveStart && (await shown(startBtn)) && (await shown('.add-template[data-template=""]')), await P("text('.add-template')"));
  check("an empty scene offers only editing, so no Play | Edit switch", JSON.stringify(await P("activities('a')")) === '["edit"]' && (await P("activity('a')")) === "edit" && !(await shown(".activity-switch")), { activities: await P("activities('a')"), running: await P("running('a')") });
  await shot("start");
  await click(await P(`rect('${startBtn}')`));
  await until("window.__p.objects().length >= 29");
  // B joins the level A just made
  await P("joinB()");
  const allLoaded = await until("(() => { const a = window.__p.loaded('a'), b = window.__p.loaded('b'); return a.total >= 29 && a.loaded === a.total && b.loaded === b.total; })()", 30_000);
  const lv = await P("loaded('a')");
  const traits = await js(`(() => { const os = Object.values(window.__p.doc().objects); return { level: !!window.__p.doc().traits?.["arena.level"], kinds: Object.keys(window.__p.doc().traits?.["arena.level"]?.kinds ?? {}), targets: os.filter((o) => o.traits?.["arena.target"]).length, spawns: os.filter((o) => o.traits?.["arena.spawn"]).length }; })()`);
  check("Arena level lays out the level (a level trait, 8 targets, 4 spawns)", traits.level && traits.targets === 8 && traits.spawns === 4 && traits.kinds.length === 7, traits);
  check("and starts the scene in play (doc.view.activity)", (await P("doc()")).view?.activity === "play", (await P("doc()")).view);
  check("every block's GLB loads in both views", allLoaded, { a: lv, b: await P("loaded('b')") });
  await until("window.__p.running('a').includes('arena') && window.__p.running('b').includes('arena')");
  check("the arena runs in both views (play, and the level trait)", (await P("running('a')")).includes("arena") && (await P("running('b')")).includes("arena"), { a: await P("running('a')"), b: await P("running('b')") });
  check("the HUD shows Play and 8 standing (and nothing stray)", (await P("text('.arena-count')"))[0] === "8 of 8 targets standing" && !!(await P("rect('.arena-play')")) && !/null/.test((await P("text('.arena-hud')"))[0]), await P("text('.arena-hud')"));

  // ─── a level opens as a game ─────────────────────────────────────────────
  // Both views start where the doc says, in play: A, who chose the template
  // (a template starts its maker as joining does), and B, who joined the
  // level. Each runs only what playing calls for: the arena, what it requires
  // (keys, notices, framing) and the switcher.
  const GAME = ["arena", "scene.activity", "scene.autoframe", "scene.keys", "scene.notices"];
  const inGame = async (w) => {
    const ok = (await until(`!window.__p.running('${w}').includes('scene.toolbar')`, 6000)) && (await settled(w));
    return { ok, activity: await P(`activity('${w}')`), run: await sorted(w) };
  };
  const aGame = await inGame("a");
  check("creator A is in play: only the game, its requires and the switcher", aGame.ok && aGame.activity === "play" && JSON.stringify(aGame.run) === JSON.stringify(GAME), aGame);
  const bGame = await inGame("b");
  check("player B is in play too: the same", bGame.ok && bGame.activity === "play" && JSON.stringify(bGame.run) === JSON.stringify(GAME), bGame);
  const bChrome = await P("chrome('b')");
  const bView = { toolbar: !!(await P("rect('.toolbar', 'b')")), sidebar: !!(await P("rect('.sidebar', 'b')")), start: await shown(".add-start", "b"), switch: await P("rect('.activity-switch', 'b')"), play: !!(await P("rect('.arena-play', 'b')")), layers: await P("layers('b')"), chrome: bChrome };
  check("player B sees no toolbar, sidebar or start screen, no grid or axes: the level, the HUD's Play and a small Play | Edit switch", !bView.toolbar && !bView.sidebar && !bView.start && bView.play && !!bView.switch && bView.switch.w > 0 && bView.switch.w < 200 && bView.switch.h < 44 && !bView.layers.some((l) => /grid|axes|bounds|gizmo|handles/.test(l)), bView);
  const options = await js(`[...window.__p.hostA.querySelectorAll(".activity-option")].map((b) => [b.dataset.activity, b.textContent.trim(), b.getAttribute("aria-pressed")])`);
  check("the switch offers Play and Edit, with Play pressed", JSON.stringify(options) === JSON.stringify([["play", "Play", "true"], ["edit", "Edit", "false"]]), options);
  // and neither opens staring into a wall: framing came with the arena, so
  // each untouched camera frames the level as it loads (from outside it,
  // every corner of the level on screen)
  const framed = (w) => js(`(() => { const v = window.__p.${w}.viewport, b = v.sceneBox(), c = v.getCamera().position; if (b.isEmpty()) return { box: null }; const lo = b.min.toArray(), hi = b.max.toArray(); const inside = [0, 1, 2].every((i) => c[i] > lo[i] && c[i] < hi[i]); const corners = []; for (const x of [lo[0], hi[0]]) for (const z of [lo[2], hi[2]]) corners.push(v.project([x, lo[1], z])?.visible ?? false); return { inside, corners, camera: c.map((n) => +n.toFixed(2)) }; })()`);
  await until("(() => { const v = window.__p.B.viewport, b = v.sceneBox(), c = v.getCamera().position; return !b.isEmpty() && ![0, 1, 2].every((i) => c[i] > b.min.toArray()[i] && c[i] < b.max.toArray()[i]); })()", 4000);
  const fA = await framed("A"), fB = await framed("B");
  check("both open framing the whole level, not inside it", [fA, fB].every((f) => f.inside === false && f.corners.length === 4 && f.corners.every(Boolean)), { A: fA, B: fB });
  await shot("game");

  // ─── the designer edits, and comes back ──────────────────────────────────
  const addTargetBtn = `[data-ext="arena.edit"][data-command="add-target"]`;
  await click(await P(`rect('.activity-option[data-activity="edit"]')`));
  await until(`window.__p.running('a').includes('scene.toolbar') && !!window.__p.hostA.querySelector('${addTargetBtn}')`, 6000);
  await settled("a");
  const aEdit = { activity: await P("activity('a')"), run: await P("running('a')"), toolbar: await shown(".toolbar"), addTarget: await shown(addTargetBtn), play: !!(await P("rect('.arena-play')")) };
  check("switched to Edit, A has the editor and the arena's edit commands (toolbar, sidebar, grid, Add target), not the game", aEdit.activity === "edit" && ["scene.toolbar", "scene.sidebar", "scene.grid", "arena.edit"].every((id) => aEdit.run.includes(id)) && !aEdit.run.includes("arena") && aEdit.toolbar && aEdit.addTarget && !aEdit.play, aEdit);
  check("only for A: B is still playing", (await P("activity('b')")) === "play" && JSON.stringify(await sorted("b")) === JSON.stringify(GAME), await P("running('b')"));
  check("the doc still starts people in play", (await P("doc()")).view?.activity === "play");
  await shot("edit");
  await click(await P(`rect('.activity-option[data-activity="play"]')`));
  const backInPlay = (await until("window.__p.running('a').includes('arena') && !window.__p.running('a').includes('scene.toolbar')", 6000)) && (await settled("a"));
  check("switching back to Play: the game again, and no editor", backInPlay && (await P("activity('a')")) === "play" && JSON.stringify(await sorted("a")) === JSON.stringify(GAME) && !!(await P("rect('.arena-play')")) && !(await P("rect('.toolbar')")), await P("running('a')"));

  // the level's look: the arena's atmosphere, in both views (a sky, haze, a sun casting shadows on every block)
  const look = (w) => js(`(() => { const v = window.__p.${w}.viewport; let meshes = 0, cast = 0; v.content.traverse((o) => { if (o.isMesh) { meshes++; if (o.castShadow && o.receiveShadow) cast++; } }); return { atmosphere: v.atmosphere, sky: !!v.sky?.visible, fog: !!v.scene.fog, shadowMap: v.renderer.shadowMap.enabled, sunCasts: v.keyLight.castShadow, meshes, cast }; })()`);
  await until("!!window.__p.A.viewport.atmosphere && !!window.__p.B.viewport.atmosphere", 3000);
  const looks = { a: await look("A"), b: await look("B") };
  check("a laid-out level has the arena's look in both views: sky, haze, and a sun whose shadows every block casts and takes", ["a", "b"].every((w) => looks[w].sky && looks[w].fog && looks[w].shadowMap && looks[w].sunCasts && looks[w].meshes > 0 && looks[w].cast === looks[w].meshes), looks);

  await js("window.__p.A.viewport.frame(window.__p.A.viewport.sceneBox())");
  await sleep(400);
  await shot("level");

  // ─── play ────────────────────────────────────────────────────────────────
  // spawn deterministically at Spawn 1 (-15, 0, 15), facing the middle
  await js("Math.random = () => 0");
  const camBefore = await P("cam()");
  await click(await P("rect('.arena-play')"));
  await sleep(500);
  const lockState = { locked: await P("locked()"), element: await P("lockElement()"), armed: await P("armed()"), held: await P("held()"), hud: await P("text('.arena-hud')") };
  report.steps.lock = lockState;
  check("Play arms the arena and holds the camera", lockState.armed === "arena" && lockState.held, lockState);
  if (!lockState.locked) turnMode = "drag";
  report.steps.turnMode = turnMode;
  const e0 = await eye();
  check("you start at a spawn point, eye 1.6 m over its pad", Math.abs(e0[0] + 15) < 0.05 && Math.abs(e0[2] - 15) < 0.05 && Math.abs(e0[1] - (1.6 + 0.05)) < 0.1, r3(e0));
  check("play isn't paused (no 'carry on' button)", !(await P("rect('.arena-resume')")), await P("text('.arena-hud')"));
  if (!lockState.locked) check("refused the lock, the HUD says drag to look", /Drag to look/.test((await P("text('.arena-help')"))[0] ?? ""), await P("text('.arena-help')"));
  await shot("play-start");

  // walk forward
  await hold("KeyW", 900);
  await sleep(300);
  const e1 = await eye();
  const moved = Math.hypot(e1[0] - e0[0], e1[2] - e0[2]);
  check("W walks forward (toward the middle)", moved > 2 && e1[0] > e0[0] && e1[2] < e0[2], { from: r3(e0), to: r3(e1), moved: +moved.toFixed(2) });
  check("and stays on the floor", Math.abs(e1[1] - 1.6) < 0.05, r3(e1));
  // strafe
  const yw = await yaw();
  await hold("KeyD", 600);
  await sleep(300);
  const e2 = await eye();
  const right = [Math.cos(yw), -Math.sin(yw)]; // +X at yaw 0
  const side = (e2[0] - e1[0]) * right[0] + (e2[2] - e1[2]) * right[1];
  check("D strafes right", side > 1, { side: +side.toFixed(2) });
  await hold("KeyA", 600);
  await hold("KeyS", 400);
  await sleep(300);
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
  for (let i = 0; i < 2; i++) { await sleep(40); peak = Math.max(peak, (await eye())[1]); }
  await keyUp("Space");
  for (let i = 0; i < 12; i++) { await sleep(40); peak = Math.max(peak, (await eye())[1]); }
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
  else { await mouse("mousePressed", c.x, c.y, 1); await sleep(30); await mouse("mouseReleased", c.x, c.y, 0); }
  await sleep(40);
  await sleep(300);
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
  for (let i = 0; i < 10; i++) { await sleep(50); samples.push((await P("drawn('b')")).avatars[0]); }
  await keyUp("KeyS");
  await sleep(1200); // landed (walking back may step off the tower), and a presence tick later
  // a fall off the tower can still be landing: give B a few more ticks to catch up
  const caughtUp = async () => { const s = await P("drawn('b')"), p = await eye(); return s.avatars.length === 1 && Math.hypot(s.avatars[0][0] - p[0], s.avatars[0][2] - p[2]) < 0.05 && Math.abs(s.avatars[0][1] - (p[1] - 1.6)) < 0.05; };
  for (let t0 = Date.now(); Date.now() - t0 < 2000 && !(await caughtUp()); ) await sleep(100);
  const seen1 = await P("drawn('b')");
  const pos1 = await eye();
  const distinct = new Set(samples.map((s) => JSON.stringify(s))).size;
  check("B sees one avatar, where A stands", seen1.avatars.length === 1 && Math.hypot(seen1.avatars[0][0] - pos1[0], seen1.avatars[0][2] - pos1[2]) < 0.05 && Math.abs(seen1.avatars[0][1] - (pos1[1] - 1.6)) < 0.05, { avatar: seen1.avatars, eye: r3(pos1) });
  check("and sees it move while A walks (several updates in 0.5 s)", distinct >= 4 && Math.hypot(seen1.avatars[0][0] - seen0.avatars[0]?.[0], seen1.avatars[0][2] - seen0.avatars[0]?.[2]) > 0.5, { distinct, from: seen0.avatars, to: seen1.avatars, eyeFrom: r3(pos0) });
  check("B labels the avatar", (await P("labels('b')")).length > 0, await P("labels('b')"));
  check("A draws no avatar of its own", (await P("drawn('a')")).avatars.length === 0, await P("drawn('a')"));

  // Esc stops play and gives the camera back
  if (await P("locked()")) {
    // a locked browser's Esc takes the lock first (CDP can't do that for us): lose it, then Esc
    await js("document.exitPointerLock()");
    await sleep(200);
    report.steps.afterLockLost = await P("text('.arena-hud')");
  }
  await hold("Escape", 50);
  await sleep(300);
  const after = { armed: await P("armed()"), held: await P("held()"), locked: await P("locked()"), play: !!(await P("rect('.arena-play')")) };
  check("Esc stops play: disarmed, camera back, Play button again", after.armed === null && !after.held && !after.locked && after.play, after);
  await sleep(400);
  check("B's avatar goes when A stops", (await P("drawn('b')")).avatars.length === 0, await P("drawn('b')"));
  // Enter plays too (the play command's key, through the key map), and Esc stops it again
  await hold("Enter", 50);
  await sleep(300);
  const byEnter = await P("armed()");
  await hold("Escape", 50);
  await sleep(300);
  check("Enter starts play (the key map), Esc stops it", byEnter === "arena" && (await P("armed()")) === null, { byEnter });
  // orbit works again: a drag moves the camera
  const ccam = await P("cam()");
  const cc = await P("canvasCentre()");
  await mouse("mouseMoved", cc.x, cc.y); await mouse("mousePressed", cc.x, cc.y, 1);
  for (let k = 1; k <= 8; k++) await mouse("mouseMoved", cc.x + k * 15, cc.y, 1);
  await mouse("mouseReleased", cc.x + 120, cc.y, 0);
  await sleep(300);
  check("orbit works again after Esc", Math.hypot(...(await P("cam()")).position.map((v, i) => v - ccam.position[i])) > 0.05);
  // stand them up
  await click(await P("rect('.arena-reset')"));
  await sleep(200);
  const reset = await js(`window.__p.doc().objects['${tid}']`);
  check("Stand them up stands it back where it was", !reset.traits["arena.target"].down && reset.transform.rotation.every((v, i) => Math.abs(v - [0, tdoc.traits["arena.target"].stand?.rotation?.[1] ?? 0, 0][i]) < 1e-6), reset.transform);

  // ─── the player plays: B, who has only the game ──────────────────────────
  // B gets the big view for this (A shrinks); the stage follows its port's size
  await P("resize('a', 320, 240)");
  const vh = await js("window.innerHeight");
  await P(`resize('b', 1060, ${vh})`);
  await sleep(800);
  const bRect = await P("viewRect('b')");
  const bCan = await js("(() => { const r = window.__p.B.viewport.canvas.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()");
  check("player B's view follows its new size", Math.abs(bCan[0] - 1060) < 4 && Math.abs(bCan[1] - vh) < 4, { bCan, vh });
  await js("window.__p.B.viewport.frame(window.__p.B.viewport.sceneBox())");
  await sleep(500);
  await shot("player-lobby", bRect);
  report.steps.playerLobby = { chrome: await P("chrome('b')"), hud: await P("text('.arena-hud', 'b')") };
  // a click in B's view brings the keys there; Enter is the play command's key (scene.keys, required by the arena)
  const bc = await P("canvasCentre('b')");
  await click({ x: bc.x + 200, y: bc.y + 150 });
  await js("Math.random = () => 0");
  await hold("Enter", 50);
  await sleep(500);
  const bPlay = { armed: await P("armed('b')"), held: await P("held('b')"), aArmed: await P("armed('a')"), focus: await js("document.activeElement?.closest?.('#a, #b')?.id ?? null"), eye: r3((await P("cam('b')")).position) };
  check("Enter plays in B's view (the key map came with the arena's requires), and not in A's", bPlay.armed === "arena" && bPlay.held && bPlay.aArmed === null, bPlay);
  const be0 = (await P("cam('b')")).position;
  await hold("KeyW", 700);
  await sleep(300);
  const be1 = (await P("cam('b')")).position;
  check("W walks B forward", Math.hypot(be1[0] - be0[0], be1[2] - be0[2]) > 1.5 && Math.abs(be1[1] - 1.6) < 0.06, { from: r3(be0), to: r3(be1) });
  await shot("player-play", bRect);
  // shoot (unlocked: a tap shoots), and A sees B's avatar
  const bTr0 = await P("tracersSeen('b')");
  await click(await P("canvasCentre('b')"));
  await shot("player-shot", bRect);
  await sleep(400);
  const bTr1 = await P("tracersSeen('b')");
  const aSees = await P("drawn('a')");
  check("B shoots (a tracer, 11 rounds), and A sees B's avatar", bTr1 > bTr0 && /11 \/ 12/.test((await P("text('.arena-hud', 'b')"))[0]) && aSees.avatars.length === 1, { bTr0, bTr1, hud: await P("text('.arena-hud', 'b')"), aSees });
  report.steps.playerPlaying = { chrome: await P("chrome('b')"), layers: await P("layers('b')") };
  check("playing, B still shows no editor (no toolbar, sidebar, grid)", !(await P("rect('.toolbar', 'b')")) && !(await P("rect('.sidebar', 'b')")) && !(await P("layers('b')")).some((l) => /grid|axes/.test(l)), report.steps.playerPlaying);
  await hold("Escape", 50);
  await sleep(300);
  check("Esc stops B's play: Play is back", (await P("armed('b')")) === null && !(await P("held('b')")) && !!(await P("rect('.arena-play', 'b')")));
  await shot("player-after", bRect);

  check("no errors in the arena run", (await errorsNow()).length === 0, await errorsNow());

  // ─── hybrid: a deck that knows nothing about arenas ──────────────────────
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/arena/probes/arena-probe.html?mode=hybrid` });
  await sleep(300);
  await until("window.__ready === true", 20_000);
  await until("(() => { const a = window.__p.loaded('a'); return a.loaded === a.total; })()", 20_000);
  check("hybrid: the arena isn't running before any arena trait", !(await P("running('a')")).includes("arena"), await P("running('a')"));
  check("hybrid: a deck offers only editing, and none of the arena's commands", JSON.stringify(await P("activities('a')")) === '["edit"]' && !(await P("running('a')")).includes("arena.edit") && !(await shown(".activity-switch")), { activities: await P("activities('a')"), running: await P("running('a')") });
  // nothing selected: the inspector's Scene section, whose "Add behaviour…"
  // offers what the arena describes for a scene (the level)
  await until("!!window.__p.hostA.querySelector('.behaviour-add')");
  const madeLevel = await P("addBehaviour('arena.level')");
  check("hybrid: the inspector's Add behaviour… makes the scene an arena level", madeLevel && !!(await P("doc()")).traits?.["arena.level"], { madeLevel, traits: (await P("doc()")).traits });
  const hTarget = `[data-ext="arena.edit"][data-command="add-target"]`;
  check("hybrid: an arena trait brings the arena's edit commands, and offers Play", (await until(`!!window.__p.hostA.querySelector('${hTarget}')`)) && JSON.stringify(await P("activities('a')")) === '["edit","play"]' && (await P("activity('a')")) === "edit", { activities: await P("activities('a')"), running: await P("running('a')") });
  // look at a spot on the deck (the target goes where you're looking)
  await js("window.__p.A.viewport.setCamera({ position: [8, 9, 12], target: [1, 0.3, 4] })");
  await sleep(200);
  const deckTop = await js("(() => { const h = window.__p.A.viewport.raycast([1, 50, 4], [0, -1, 0]); return h && h.point; })()");
  await click(await P(`rect('${hTarget}')`));
  await until("window.__p.objects().length === 3", 5000);
  await until("(() => { const a = window.__p.loaded('a'); return a.loaded === a.total; })()", 10_000);
  const htid = await js("window.__p.objects().find((id) => window.__p.doc().objects[id].traits?.['arena.target'])");
  const ht = await js(`window.__p.doc().objects['${htid}']?.transform`);
  check("Add target puts a target on the deck where you look", !!ht && Math.abs(ht.position[0] - 1) < 0.05 && Math.abs(ht.position[2] - 4) < 0.05 && Math.abs(ht.position[1] - deckTop[1]) < 0.05, { ht, deckTop });
  check("hybrid: editing, the arena's game isn't running", !(await P("running('a')")).includes("arena"), await P("running('a')"));
  await click(await P(`rect('.activity-option[data-activity="play"]')`));
  await until("window.__p.running('a').includes('arena')");
  check("hybrid: switching to Play starts the arena", (await P("running('a')")).includes("arena") && (await P("activity('a')")) === "play", await P("running('a')"));
  const hv = await js("(() => { const v = window.__p.A.viewport; return { atmosphere: v.atmosphere, sky: !!v.sky, fog: v.scene.fog, shadowMap: v.renderer.shadowMap.enabled, key: [v.keyLight.intensity, v.keyLight.position.toArray()] }; })()");
  check("hybrid: a deck with a target keeps the stage's own look (no arena sky, haze or sun)", hv.atmosphere === null && !hv.sky && hv.fog === null && !hv.shadowMap && hv.key[0] === 1.5, hv);
  await js("Math.random = () => 0");
  await until("!!window.__p.hostA.querySelector('.arena-play')");
  await click(await P("rect('.arena-play')"));
  await sleep(500);
  if (!(await P("locked()"))) turnMode = "drag";
  const s0 = await eye();
  await sleep(1800);
  const s1 = await eye();
  const under = await js(`window.__p.A.viewport.raycast([${s1[0]}, 50, ${s1[2]}], [0, -1, 0])?.point[1]`);
  check("hybrid: with no spawn point you start above the scene and land on the deck", s0[1] > s1[1] + 3 && Math.abs(s1[1] - 1.6 - under) < 0.05, { s0: r3(s0), s1: r3(s1), deckY: under });
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
  // the page says the canvas holds the lock; the router then builds locked
  // events (movementX/Y as dx/dy, the ray down the middle) and the arena turns by them
  await js(`(() => { const cv = window.__p.A.viewport.canvas; Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => window.__fakeLock ? cv : null }); window.__fakeLock = true; document.dispatchEvent(new Event("pointerlockchange")); })()`);
  await sleep(100);
  check("locked: the HUD goes back to mouse-look help", !/Drag to look/.test((await P("text('.arena-help')"))[0] ?? ""), await P("text('.arena-help')"));
  turnMode = "nudge";
  const ht2 = await js(`window.__p.world('${htid}')`);
  const me = await eye();
  const aimOk = await face(aimYaw(me, ht2), Math.atan2(ht2[1] + 1.55 - me[1], Math.hypot(ht2[0] - me[0], ht2[2] - me[2])));
  check("locked: mouse movement (dx, dy) turns you to face the deck's target", aimOk, { yawPitch: await P("yawPitch()") });
  const cc2 = await P("canvasCentre()");
  // a press shoots at once under the lock (no release needed)
  await mouse("mousePressed", cc2.x, cc2.y, 1);
  await sleep(150);
  const downAtPress = await js(`window.__p.doc().objects['${htid}'].traits['arena.target'].down?.by ?? null`);
  await mouse("mouseReleased", cc2.x, cc2.y, 0);
  check("locked: a press shoots the deck's target over", downAtPress === "viewer:a", { downAtPress });
  // losing the lock (a browser's Esc) pauses: keys don't walk, a button offers to carry on
  await js(`(() => { window.__fakeLock = false; document.dispatchEvent(new Event("pointerlockchange")); })()`);
  await sleep(150);
  const pz = await eye();
  await hold("KeyW", 400);
  await sleep(150);
  const pz2 = await eye();
  check("lost lock: paused, with 'Click to carry on', and W does nothing", !!(await P("rect('.arena-resume')")) && Math.hypot(pz2[0] - pz[0], pz2[2] - pz[2]) < 0.01, { resume: await P("rect('.arena-resume')"), pz: r3(pz), pz2: r3(pz2) });
  // carrying on is refused here (headless): play goes on without the lock
  await click(await P("rect('.arena-resume')"));
  await sleep(300);
  await hold("KeyW", 300); // (backwards is the mast)
  await sleep(150);
  const pz3 = await eye();
  check("carry on, refused: plays on without the lock (W walks again)", !(await P("rect('.arena-resume')")) && Math.hypot(pz3[0] - pz2[0], pz3[2] - pz2[2]) > 0.3, { pz3: r3(pz3), focus: await js("document.activeElement.className"), armed: await P("armed()"), hud: await P("text('.arena-hud')"), yp: await P("yawPitch()"), ahead: await js("(() => { const c = window.__p.A.viewport.getCamera(); const d = c.target.map((v, i) => v - c.position[i]); d[1] = 0; return [0.5, 1.25].map((h) => window.__p.A.viewport.raycast([c.position[0], c.position[1] - 1.6 + h, c.position[2]], d)); })()") });
  await js("delete document.pointerLockElement");
  await hold("Escape", 50);
  await sleep(200);
  check("hybrid: no errors", (await errorsNow()).length === 0, await errorsNow());
} catch (err) {
  check("ran", false, String(err?.stack || err));
  try { await shot("failure"); } catch {}
}
report.logs = logs.filter((l) => !/^(debug|log)/.test(l)).slice(0, 40);
console.log(JSON.stringify(report, null, 2));
stop(failed ? 1 : 0);
