// Sailing, crewed by two people in headless Chrome.
//
//   (in scene/ and sailing/) pnpm build
//   node probes/sailing-run.mjs [--shots <dir>] [--show] [--swiftshader]
//
// It renders on the machine's GPU: under SwiftShader two views of the ocean
// shader run at a few frames a second, too few to see whether the hull moves
// smoothly (--swiftshader runs it there anyway).
//
// Mounts the BUILT scene tool with the BUILT sailing plugins on an empty
// scene, twice on one doc (A and B, with real presence between them). A picks
// "Ship at sea" on the start screen and B joins. Then the two crew her:
// - who simulates (the "sim" claim), and the other following;
// - the hull floating and rocking on the waves, played back smoothly;
// - B weighs the anchor at the windlass (hold F, through the use prompt);
//   she lay with her sail down, so she falls off the wind; B raises the
//   sail looking at the mast;
// - B takes the helm, A finds it taken, B bears away onto a beam reach and
//   she picks up speed; B lets go and A can take it;
// - A lowers the sail and she slows;
// - B stands on the moving deck, and A draws B there;
// - B goes over the side, swims, and climbs the ladder back aboard;
// - the doc hears of the hull now and then, not every frame;
// - A, the simulator, leaves, and B carries on from where she was.
// Headless Chrome refuses pointer lock, so both views play on without it
// (drag to look), and the use prompt looks at what's under the pointer.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["sailing/dist/index.js", "scene/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "sailing-shots"));
const UNTIL = arg("--until"); // stop after this section (for working on the probe)

const b = await browser({ root: ROOT, port: 4760, cdp: 9760, page: "/sailing/probes/sailing-probe.html", width: 1616, height: 530, show: process.argv.includes("--show"), gpu: !process.argv.includes("--swiftshader"), timeout: 900_000 });
// every page call has a deadline, so a hang says where it was
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], measured: {} };
const EXPECTED = /KHR_parallel_shader_compile|pointer lock refused|GPU stall due to ReadPixels/;
const errorsNow = async () => (await P("errors")).filter((e) => !EXPECTED.test(e));
const shot = async (name, w, clip) => {
  const r = w ? await P(`viewRect('${w}')`) : null;
  const c = clip && r ? { x: r.x + clip.x, y: r.y + clip.y, width: clip.width, height: clip.height } : r ?? undefined;
  report.shots.push(await b.shot(join(SHOTS, `sailing-${name}.png`), c));
};
const r3 = (p) => p?.map((v) => +v.toFixed(3));
/** How far a view's camera is from the hull (m). */
const quarterDistance = async (w) => { const c = (await P(`cam('${w}')`)).position; const m = await P(`worldOf('${report.ids.hull}', '${w}')`); return n2(Math.hypot(c[0] - m[12], c[1] - m[13], c[2] - m[14])); };
const n2 = (v) => +(+v).toFixed(2);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const T0 = Date.now();
const section = (name) => { report.measured.lastSection = name; console.error(`---- ${name} done at ${((Date.now() - T0) / 1000).toFixed(0)} s`); return UNTIL && name === UNTIL; };
class Done extends Error {}

// the ship's frame: a point local to the hull, through a displayed world matrix
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const headingOf = (m) => Math.atan2(m[8], m[10]); // yaw of the bow (−Z)
// compass heading (0 north = −Z, toward +X east) of a hull matrix
const compassOf = (m) => Math.atan2(-m[8], m[10]);

// keys, sent to whichever view has focus
const KEY = { q: ["q", "KeyQ", 81], e: ["e", "KeyE", 69], f: ["f", "KeyF", 70], d: ["d", "KeyD", 68], a: ["a", "KeyA", 65], w: ["w", "KeyW", 87], s: ["s", "KeyS", 83], Escape: ["Escape", "Escape", 27], Enter: ["Enter", "Enter", 13] };
const keyDown = (k) => b.send("Input.dispatchKeyEvent", { type: "keyDown", key: KEY[k][0], code: KEY[k][1], windowsVirtualKeyCode: KEY[k][2], ...(k.length === 1 ? { text: k } : {}) });
const keyUp = (k) => b.send("Input.dispatchKeyEvent", { type: "keyUp", key: KEY[k][0], code: KEY[k][1], windowsVirtualKeyCode: KEY[k][2] });
async function press(k, ms = 60) { await keyDown(k); await sleep(ms); await keyUp(k); await sleep(60); }

/**
 * A simple helmsman at B's wheel (B's view focused): steer `hull` onto the
 * compass course `want` (radians), holding A or D, until on course and
 * making `speed` for `settle` s of sea time, or `ms` pass. The wheel goes
 * toward a little of the error, and is backed while she has sternway (in
 * irons, off the anchor), when the rudder works the other way.
 * @returns {{ onCourse: number | null, reached: { sea, speed } | null, trace }}  sea times since the start
 */
async function steer(ids, sim, want, { ms = 150_000, speed = 2, settle = 6 } = {}) {
  const t0 = Date.now(), sea0 = await P(`clock('${sim}')`);
  const trace = [];
  let held = null, onCourse = null, reached = null;
  const hold = async (k) => { if (held === k) return; if (held) await keyUp(held); held = k; if (k) await keyDown(k); };
  try {
    while (Date.now() - t0 < ms) {
      const m = await P(`worldOf('${ids.hull}', 'b')`);
      const rd = await P(`read('${ids.hull}', 'b')`);
      const angle = (await P(`value('${ids.wheel}', 'b')`)).angle;
      const err = wrap(want - compassOf(m)); // + : turn to starboard
      const goal = (rd?.speed ?? 0) < 0.3 ? -Math.sign(err) : Math.max(-1, Math.min(1, err * 1.5));
      await hold(Math.abs(goal - angle) < 0.08 ? null : goal > angle ? "d" : "a");
      const sea = (await P(`clock('${sim}')`)) - sea0;
      trace.push([n2(sea), n2(rd?.speed ?? 0), n2(err), n2(angle)]);
      if (onCourse == null && Math.abs(err) < 0.35) onCourse = sea;
      if (!reached && onCourse != null && (rd?.speed ?? 0) > speed && Math.abs(err) < 0.35) reached = { sea, speed: rd.speed };
      if (reached && sea - reached.sea > settle) break;
      await sleep(150);
    }
  } finally {
    await hold(null);
  }
  return { onCourse, reached, trace };
}

/** Point at an object in a view (the use prompt reads what's under the pointer, unlocked). */
async function pointAt(id, w) {
  const at = await P(`aimAt('${id}', '${w}')`);
  if (!at) return null;
  await b.move(at.x, at.y);
  await sleep(120);
  return at;
}
/** Focus a view: a tap on its canvas (a tap while playing is nothing; not playing, it comes aboard). */
async function focus(w, where) {
  const c = where ?? (await P(`canvasCentre('${w}')`));
  await b.click(c.x, c.y);
  await sleep(150);
}

try {
  check("page set up", await until("window.__ready === true", 20_000), await P("errors"));

  // ─── opening ─────────────────────────────────────────────────────────────
  const startBtn = `.add-template[data-template="ship-at-sea"]`;
  check("the empty scene's start screen offers Ship at sea", await until(`!!window.__p.hostA.querySelector('${startBtn}')`));
  await sleep(400);
  const sb = await P(`rect('${startBtn}', 'a')`);
  await b.click(sb.x, sb.y);
  await until("window.__p.objects().length >= 10", 20_000);
  await P("joinB()");
  const allLoaded = await until("(() => { const a = window.__p.loaded('a'), b = window.__p.loaded('b'); return a.total >= 10 && a.loaded === a.total && b.loaded === b.total; })()", 40_000);
  check("every part loads in both views", allLoaded, { a: await P("loaded('a')"), b: await P("loaded('b')") });
  await until("!!window.__p.ctx('a') && !!window.__p.ctx('b')", 10_000);
  const ids = await js(`(() => { const by = window.__p.byName; return { hull: by("Sloop"), wheel: by("Wheel"), rig: by("Boom and sail"), windlass: by("Windlass"), ladder: by("Ladder"), anchor: by("Anchor"), mast: by("Mast") }; })()`);
  report.ids = ids;
  const { hull, wheel, rig, windlass, ladder } = ids;
  const local = async (id) => (await P("doc()")).objects[id].transform.position;

  // both in play, running only the sailing extension and what it requires
  const PLAY = ["sailing", "scene.activity", "scene.keys", "scene.notices", "scene.use"];
  await sleep(2500); // lingering parts each stop on their own timer
  const run = { a: [...(await P("running('a')"))].sort(), b: [...(await P("running('b')"))].sort() };
  check("both views open in play", (await P("activity('a')")) === "play" && (await P("activity('b')")) === "play");
  check("only sailing, what it requires and the Play | Edit switch run: no editor parts", ["a", "b"].every((w) => JSON.stringify(run[w]) === JSON.stringify(PLAY)), run);
  check("the HUD offers to come aboard in both views", (await P("text('.sail-hint button', 'a')"))[0] === "Click to come aboard" && (await P("text('.sail-hint button', 'b')"))[0] === "Click to come aboard");
  const looks = { a: await P("look('a')"), b: await P("look('b')") };
  check("the sea's sky, haze and sun in both views", ["a", "b"].every((w) => looks[w].sky && looks[w].fog && !!looks[w].atmosphere), looks);
  await shot("opening");

  // ─── who simulates ───────────────────────────────────────────────────────
  if (section("opening")) throw new Done();
  const sess = { a: await P("session('a')"), b: await P("session('b')") };
  const simClaim = (await P("doc()")).claims?.sim ?? null;
  const simA = await P("simulating('a')"), simB = await P("simulating('b')");
  check("exactly one view simulates, and the doc's sim claim names its session", simA !== simB && simClaim?.session === (simA ? sess.a : sess.b), { simA, simB, simClaim, sess });
  const SIM = simA ? "a" : "b", FOL = simA ? "b" : "a";
  report.measured.simulator = SIM;
  // the clock: how fast sea time runs against the wall, and the follower's lag
  const c0 = { s: await P(`clock('${SIM}')`), f: await P(`clock('${FOL}')`), t: Date.now() };
  await sleep(3000);
  const c1 = { s: await P(`clock('${SIM}')`), f: await P(`clock('${FOL}')`), t: Date.now() };
  const rate = (c1.s - c0.s) / ((c1.t - c0.t) / 1000);
  report.measured.clock = { rate: n2(rate), lag: n2(c1.s - c1.f) };
  check("the follower's sea clock runs with the simulator's, a little behind", Math.abs((c1.f - c0.f) - (c1.s - c0.s)) < 0.3 && c1.s - c1.f > 0 && c1.s - c1.f < 0.5, { c0, c1 });
  const frames = { a: await P(`sampleFrames('${hull}', 'a', 1000)`), b: await P(`sampleFrames('${hull}', 'b', 1000)`) };
  report.measured.fps = { a: frames.a.length, b: frames.b.length };

  // ─── the template starts her under way ───────────────────────────────────
  const way = { s: await P(`read('${hull}', '${SIM}')`), f: await P(`read('${hull}', '${FOL}')`) };
  const start = (await P("doc()")).objects;
  check("the template starts her under way: sail up, anchor up, making way on both views", start[rig].traits["sailing.sail"].raised === 1 && start[windlass].traits["sailing.anchor"].down === false && way.s?.speed > 1 && way.f?.speed > 1, { speed: { sim: n2(way.s?.speed), follower: n2(way.f?.speed) } });
  await shot("under-way", FOL);

  // Then lay her to her anchor, head to wind with the sail down, as someone
  // editing the scene would (a moved hull restarts at rest where it was put),
  // so the anchor and the stations can be worked from there.
  const windFrom = (await P("doc()")).traits["sailing.sea"].wind.from;
  await js(`window.__p.change((d) => {
    const o = d.objects;
    o['${hull}'].transform.rotation[1] = ${(-windFrom * Math.PI) / 180};
    o['${rig}'].traits['sailing.sail'].raised = 0;
    o['${windlass}'].traits['sailing.anchor'].down = true;
    o['${windlass}'].traits['sailing.anchor'].rode = 25;
  })`);
  await sleep(1500);

  // ─── floating at anchor ──────────────────────────────────────────────────
  if (section("sim")) throw new Done();
  const docAnchor = async () => (await P("doc()")).objects[windlass].traits["sailing.anchor"];
  await until(`Array.isArray(window.__p.doc().objects['${windlass}'].traits['sailing.anchor'].at)`, 5000);
  const anchorAt = (await docAnchor()).at;
  const float = {};
  for (const w of ["a", "b"]) {
    const s = await P(`sampleFrames('${hull}', '${w}', 2500)`);
    const over = await P(`sampleFloat('${hull}', '${w}', 2500)`);
    const ys = s.map((f) => f[2]), rolls = s.map((f) => f[5]);
    float[w] = { overWater: n2(mean(over)), offWater: n2(mean(over.map(Math.abs))), heave: n2(Math.max(...ys) - Math.min(...ys)), roll: +(Math.max(...rolls) - Math.min(...rolls)).toFixed(4), maxRoll: +Math.max(...rolls.map(Math.abs)).toFixed(3), n: s.length };
  }
  check("she floats at her waterline in both views (her body's y = 0 rides the water under her)", ["a", "b"].every((w) => Math.abs(float[w].overWater) < 0.25 && float[w].offWater < 0.35), float);
  check("and rocks a little on the waves (moving, never far over)", ["a", "b"].every((w) => (float[w].heave > 0.02 || float[w].roll > 0.003) && float[w].maxRoll < 0.2), float);
  const m0 = await P(`worldOf('${hull}', '${SIM}')`);
  const anchorDist = Math.hypot(m0[12] - anchorAt[0], m0[14] - anchorAt[2]);
  check("at anchor: the anchor lies on the bottom under her, and she rides near it", anchorAt[1] < -1 && anchorDist < 20, { anchorAt, hull: r3([m0[12], m0[13], m0[14]]), anchorDist: n2(anchorDist) });
  await shot("at-anchor", FOL);

  // ─── B comes aboard and weighs the anchor ────────────────────────────────
  if (section("float")) throw new Done();
  await focus("b"); // a click on the view comes aboard
  check("a click in B's view comes aboard: B plays (the lock refused, it plays on without)", await until("window.__p.me('b')?.playing === true && window.__p.me('b')?.on != null", 3000), await P("me('b')"));
  await until("window.__p.me('b')?.free === true", 2000);
  check("refused the lock, B's HUD says drag to look", /Drag to look/.test((await P("text('[data-k=\"hint\"]', 'b')"))[0] ?? ""), await P("text('.sail-hint', 'b')"));
  // stand just aft of the windlass, looking down at it
  const wl = await local(windlass);
  await P(`place('b', '${hull}', [${wl[0]}, ${wl[1]}, ${wl[2] + 0.9}], 0, -0.75)`);
  await sleep(500);
  const aimW = await pointAt(windlass, "b");
  const verbsW = await P("verbs('b')");
  check("at the windlass, B's use prompt offers to raise the anchor (hold F)", !!aimW && verbsW.some((v) => v.command === "weigh" && !v.disabled), { aimW, verbsW, me: await P("me('b')"), hovered: await P("hovered('b')") });
  await keyDown("f");
  await sleep(400);
  const weighing = await P("verbs('b')");
  const windlassClaim = (await P("doc()")).objects[windlass].claims?.station ?? null;
  const live = await P(`value('${windlass}', 'a')`);
  await until(`window.__p.doc().objects['${windlass}'].traits['sailing.anchor'].down === false`, 12000);
  await keyUp("f");
  await sleep(300);
  const up = await docAnchor();
  check("holding F winds it up: the doc says the anchor's up, its spot cleared", up.down === false && !up.at, { up, weighing, live });
  check("while F is held the windlass is B's (its station claim), and let go once it's up", windlassClaim?.session === sess.b && !(await P("doc()")).objects[windlass].claims?.station, { windlassClaim });
  check("the windlass said how much chain was out while it wound", weighing.some((v) => v.command === "weigh" && /m of chain/.test(v.name)) || /m of chain/.test(JSON.stringify(verbsW)), { verbsW, weighing });
  await sleep(1000);

  // she lay with her sail down, as a sailor leaves her: free of the anchor she falls off the wind, not into irons
  const awa0 = Math.abs((await P(`read('${hull}', 'b')`)).apparentWind.angle);
  const fell = await until(`Math.abs(window.__p.read('${hull}', 'b')?.apparentWind?.angle ?? 0) > 0.25`, 40_000);
  const awa1 = (await P(`read('${hull}', 'b')`)).apparentWind.angle;
  check("anchor up with the sail down, she falls off the wind rather than lying head to it", fell, { awa0: n2(awa0), awa1: n2(awa1) });
  // the tack she fell off on: +1 starboard (the wind on her port side), −1 port
  const side = awa1 < 0 ? 1 : -1;
  report.measured.tack = side > 0 ? "starboard" : "port";
  // B raises the sail: looking at the mast offers the sail's verbs
  const mastAt = await local(ids.mast);
  const rigAt = await local(rig);
  await P(`place('b', '${hull}', [0.4, ${mastAt[1] + 0.3}, ${rigAt[2] + 1.3}], 0, -0.8)`); // looking down at its foot
  await sleep(500);
  const aimM = await pointAt(ids.mast, "b");
  const verbsM = await P("verbs('b')");
  check("looking at the mast, B's prompt offers to raise the sail (hold F)", !!aimM && verbsM.some((v) => v.command === "sail" && /Raise/.test(v.name)), { aimM, verbsM });
  await keyDown("f");
  await until(`window.__p.value('${rig}', 'a').raised > 0.95`, 10000);
  await keyUp("f");
  await sleep(300);
  check("holding F there raises it: the doc says raised 1", (await P("doc()")).objects[rig].traits["sailing.sail"].raised > 0.95, (await P("doc()")).objects[rig].traits["sailing.sail"]);

  // ─── the helm ────────────────────────────────────────────────────────────
  if (section("anchor")) throw new Done();
  const wh = await local(wheel);
  await P(`place('b', '${hull}', [${wh[0]}, ${wh[1] - 0.6}, ${wh[2] + 0.75}], 0, -0.45)`);
  await sleep(500);
  const aimH = await pointAt(wheel, "b");
  check("at the wheel, B's prompt offers the helm", !!aimH && (await P("verbs('b')")).some((v) => v.command === "helm" && !v.disabled), { aimH, verbs: await P("verbs('b')"), hovered: await P("hovered('b')") });
  await press("f");
  await sleep(300);
  const bAtHelm = await P("me('b')");
  const helmClaim = (await P("doc()")).objects[wheel].claims?.station ?? null;
  check("F takes the helm: B stands at it, and the doc's station claim names B", bAtHelm.station === wheel && helmClaim?.session === sess.b, { bAtHelm, helmClaim });
  check("B's HUD says how to steer", /steer/.test((await P("text('[data-k=\"hint\"]', 'b')"))[0] ?? ""), await P("text('[data-k=\"hint\"]', 'b')"));
  await shot("helm", "b");

  // A comes aboard too, and finds the helm taken
  await focus("a");
  await until("window.__p.me('a')?.playing === true", 3000);
  await P(`place('a', '${hull}', [${wh[0] + 0.8}, ${wh[1] - 0.6}, ${wh[2] + 1.2}], 0.5, -0.45)`);
  await sleep(500);
  const aimHA = await pointAt(wheel, "a");
  const verbsA = await P("verbs('a')");
  check("A, beside the wheel, sees 'Someone's at the helm', disabled", !!aimHA && verbsA.some((v) => v.command === "helm" && v.disabled && /Someone/.test(v.name)), { aimHA, verbsA });
  await press("f");
  await sleep(300);
  check("and F does nothing for A: the claim stays B's", (await P("me('a')")).station == null && (await P("doc()")).objects[wheel].claims?.station?.session === sess.b);

  // ─── under sail: bear away onto a beam reach ─────────────────────────────
  if (section("helm")) throw new Done();
  // a beam reach on the tack she fell off on: the wind from 45°, on starboard tack she heads 135° (the wind on her port beam)
  const wind = (await P("doc()")).traits["sailing.sea"].wind;
  const want = ((wind.from + side * 90) * Math.PI) / 180;
  await focus("b", aimH); // B's keys again
  const reach = await steer(ids, SIM, want);
  const { onCourse, reached } = reach;
  report.measured.reach = reach.trace.filter((_, i) => i % 8 === 0);
  const rdB = await P(`read('${hull}', 'b')`), rdA = await P(`read('${hull}', 'a')`);
  check("bearing away onto a beam reach she gains speed to 2–5 m/s within a minute of sea time", onCourse != null && !!reached && reached.sea - onCourse < 60 && rdB.speed > 2 && rdB.speed < 5, { onCourse, reached, speed: rdB?.speed });
  check("both views read the same speed and heading (the simulator's, through presence)", Math.abs(rdA.speed - rdB.speed) < 0.3 && Math.abs(wrap(rdA.heading - rdB.heading)) < 0.05, { a: rdA, b: rdB });
  // heel: + to starboard; leeward is starboard on starboard tack; averaged, as each wave rolls her
  const heels = [];
  for (let i = 0; i < 12; i++) { heels.push((await P(`read('${hull}', 'b')`)).heel); await sleep(250); }
  check("she heels to leeward under sail (on the mean, as the waves roll her)", side * mean(heels) > 0.03, { mean: +mean(heels).toFixed(3), heels: heels.map((h) => +h.toFixed(3)) });

  // B steers: hold D, the wheel goes over (live, through presence), and she turns in both views
  const h0 = { a: compassOf(await P(`worldOf('${hull}', 'a')`)), b: compassOf(await P(`worldOf('${hull}', 'b')`)) };
  await keyDown("d");
  await sleep(1500);
  const wheelLive = await P(`value('${wheel}', '${SIM}')`);
  await keyUp("d");
  await sleep(2500);
  const h1 = { a: compassOf(await P(`worldOf('${hull}', 'a')`)), b: compassOf(await P(`worldOf('${hull}', 'b')`)) };
  check("B holds D: the wheel goes to starboard (the simulator hears it live) and she turns to starboard in both views", wheelLive.angle > 0.5 && wrap(h1.a - h0.a) > 0.1 && wrap(h1.b - h0.b) > 0.1, { wheelLive, h0, h1 });
  await steer(ids, SIM, want, { ms: 40_000, settle: 4 }); // and back onto the reach

  // the follower's view of the hull under way: every frame a small step, no 20 Hz jumps
  const fs = await P(`sampleFrames('${hull}', '${FOL}', 2000)`);
  const steps = fs.slice(1).map((f, i) => Math.hypot(f[1] - fs[i][1], f[3] - fs[i][3]) / Math.max(1, f[0] - fs[i][0]));
  const still = steps.filter((s) => s < 1e-6).length;
  const smooth = { frames: fs.length, still, med: +(median(steps) * 1000).toFixed(3), max: +(Math.max(...steps) * 1000).toFixed(3) };
  check("on the follower the hull moves smoothly: every frame a step, none much bigger than the rest", fs.length > 10 && still <= fs.length * 0.1 && Math.max(...steps) < median(steps) * 3.5, smooth);

  // screenshots: B at the helm under sail, and the HUD
  await shot("helm-under-sail", "b");
  await shot("hud", "b", { x: 0, y: 330, width: 340, height: 160 });

  // the sheet's led aft: at the wheel, E eases it out
  const sheetH0 = (await P(`value('${rig}', 'b')`)).sheet;
  await keyDown("e");
  await sleep(800);
  await keyUp("e");
  await sleep(300);
  const sheetH1 = (await P("doc()")).objects[rig].traits["sailing.sail"].sheet;
  check("at the helm, holding E eases the sheet (it's led aft): the doc has it further out", sheetH1 > sheetH0 + 0.1, { sheetH0, sheetH1 });

  // B lets go (F); A can take it now
  await press("f");
  await sleep(400);
  check("B lets go of the helm (F): the claim goes, the angle stays in the doc", (await P("me('b')")).station == null && !(await P("doc()")).objects[wheel].claims?.station && Number.isFinite((await P("doc()")).objects[wheel].traits["sailing.helm"].angle));
  await P(`place('a', '${hull}', [${wh[0] + 0.8}, ${wh[1] - 0.6}, ${wh[2] + 1.2}], 0.5, -0.45)`);
  await sleep(300);
  const aimHA2 = await pointAt(wheel, "a");
  check("then A's prompt offers the helm, and A takes it", !!aimHA2 && (await P("verbs('a')")).some((v) => v.command === "helm" && !v.disabled), { verbs: await P("verbs('a')") });
  await focus("a", aimHA2);
  await press("f");
  await sleep(300);
  check("A is at the helm", (await P("me('a')")).station === wheel && (await P("doc()")).objects[wheel].claims?.station?.session === sess.a, await P("me('a')"));
  await press("f"); // and leaves it
  await sleep(300);

  // B hauls in the sheet at the mast (hold Q): she heels more
  const mast = await local(ids.mast);
  const rg = await local(rig);
  const atMast = `[0.4, ${mast[1] + 0.3}, ${rg[2] + 1.3}]`;
  await P(`place('b', '${hull}', ${atMast}, 0, -0.25)`);
  await sleep(500);
  const aimQ = await pointAt(rig, "b");
  const verbsQ = await P("verbs('b')");
  check("at the mast, B's prompt offers the sail (hold F) and the sheet (hold Q, E)", !!aimQ && ["sail", "haul", "ease"].every((c) => verbsQ.some((v) => v.command === c)), { aimQ, verbsQ });
  const sheet0 = (await P(`value('${rig}', 'b')`)).sheet;
  await focus("b", aimQ);
  await keyDown("q");
  await sleep(800);
  await keyUp("q");
  await sleep(300);
  const sheet1 = (await P("doc()")).objects[rig].traits["sailing.sail"].sheet;
  check("holding Q hauls the sheet in: the doc has it tighter", sheet1 < sheet0 - 0.1, { sheet0, sheet1 });
  await sleep(6000);

  // a view from off the quarter, A not aboard: Esc stops A's play
  await focus("a", await P("canvasCentre('a')"));
  await press("Escape");
  await sleep(2500);
  check("Esc stops A's play: the camera goes back off the quarter, and follows her", (await P("me('a')")).playing === false && !(await P("held('a')")) && (await quarterDistance("a")) < 30, { me: await P("me('a')"), distance: await quarterDistance("a") });
  report.measured.heelAtQuarterShot = n2((await P(`read('${hull}', 'a')`)).heel);
  await shot("quarter-heeled", "a");

  // ─── walking the moving deck ─────────────────────────────────────────────
  if (section("sail")) throw new Done();
  // B stands still for a while up on the cabin top, to windward of the boom, looking
  // forward past the mast (dropped from a little above it: the walker lands on what's there)
  await P(`place('b', '${hull}', [${-0.35 * side}, ${mast[1] + 1.0}, ${mast[2] + 1.4}], 0.1, -0.1)`);
  await sleep(1200);
  const s0 = { me: await P("me('b')"), m: await P(`worldOf('${hull}', 'b')`) };
  await shot("deck-forward", "b");
  await sleep(2500);
  const s1 = { me: await P("me('b')"), m: await P(`worldOf('${hull}', 'b')`) };
  const localMoved = Math.hypot(...s1.me.position.map((v, i) => v - s0.me.position[i]));
  const worldMoved = Math.hypot(s1.me.eye[0] - s0.me.eye[0], s1.me.eye[2] - s0.me.eye[2]);
  check("standing on the moving deck: B's world position goes with her, its place on deck stays put", s1.me.on === hull && localMoved < 0.08 && worldMoved > 2, { localMoved: n2(localMoved), worldMoved: n2(worldMoved), position: r3(s1.me.position) });
  const eyeOnDeck = apply(s1.m, s1.me.position);
  check("and B's feet are on the deck as drawn (eye 1.6 m over them)", Math.abs(s1.me.eye[1] - eyeOnDeck[1] - 1.6) < 0.1, { eye: r3(s1.me.eye), feet: r3(eyeOnDeck) });
  // A draws B's avatar there, in A's own view of the hull
  await sleep(300);
  const av = await P("avatars('a')");
  const bMe = await P("me('b')");
  const bInA = apply(await P(`worldOf('${hull}', 'a')`), bMe.position);
  const near = av.map((p) => Math.hypot(p[0] - bInA[0], p[1] - bInA[1], p[2] - bInA[2]));
  check("A draws B's avatar on A's own deck, where B stands", av.length === 1 && near[0] < 0.6, { av: av.map(r3), bInA: r3(bInA), near });
  // B walks forward a few steps: the deck position changes
  await focus("b");
  await keyDown("w");
  await sleep(700);
  await keyUp("w");
  await sleep(300);
  const s2 = await P("me('b')");
  check("W walks B along the deck (in the ship's frame)", s2.on === hull && Math.hypot(s2.position[0] - s1.me.position[0], s2.position[2] - s1.me.position[2]) > 0.5, { from: r3(s1.me.position), to: r3(s2.position) });


  // ─── lowering the sail ───────────────────────────────────────────────────
  if (section("deck")) throw new Done();
  const sp0 = (await P(`read('${hull}', 'b')`)).speed;
  // B at the gooseneck, looking at the boom
  await P(`place('b', '${hull}', ${atMast}, 0, -0.25)`);
  await sleep(500);
  const aimS = await pointAt(rig, "b");
  const verbsS = await P("verbs('b')");
  check("the sail's verb says what it'll do: Lower sail", !!aimS && verbsS.some((v) => v.command === "sail" && /Lower/.test(v.name)), { aimS, verbsS });
  await focus("b", aimS);
  await keyDown("f");
  await until(`window.__p.value('${rig}', 'a').raised < 0.05`, 8000);
  await sleep(300);
  await keyUp("f");
  await sleep(400);
  const sailDoc = (await P("doc()")).objects[rig].traits["sailing.sail"];
  check("holding F lowers it: the doc says raised 0", sailDoc.raised < 0.05, sailDoc);
  const slowing = [];
  for (let i = 0; i < 6; i++) { await sleep(4000); slowing.push(n2((await P(`read('${hull}', 'b')`)).speed)); }
  // (an 8 t sloop carries her way: in calm water she'd be at about half speed after 24 s; each wave surges her a little)
  check("with the sail down she carries her way, and slows", slowing.at(-1) < sp0 * 0.7 && mean(slowing.slice(-2)) < mean(slowing.slice(0, 2)) - 0.3, { before: n2(sp0), every4s: slowing });

  // ─── over the side, and back by the ladder ───────────────────────────────
  if (section("lower")) throw new Done();
  const ld = await local(ladder);
  await P(`place('b', '${hull}', [${ld[0] + 1.0}, ${ld[1] + 0.2}, ${ld[2]}], -1.57, -0.2)`); // past the rail, over the water
  await until("window.__p.me('b')?.swimming === true", 5000);
  await sleep(800);
  const sw = await P("me('b')");
  const water = await js(`window.__p.ctx('b').sea.ocean.heightAt(${sw.eye[0]}, ${sw.eye[2]}, window.__p.clock('b'))`);
  check("past the rail B falls in and swims, the eye just over the water", sw.swimming && sw.on == null && Math.abs(sw.eye[1] - water - 0.3) < 0.15, { eye: r3(sw.eye), water: n2(water) });
  // swim to the ladder: put the swimmer beside it, facing the hull
  const mL = await P(`worldOf('${hull}', 'b')`);
  const offL = apply(mL, [ld[0] + 4.5, 0, ld[2] + 2]);
  await P(`place('b', null, [${offL[0]}, 0, ${offL[2]}], ${headingOf(mL) + Math.PI / 2 - 0.35}, 0.12)`);
  await sleep(700);
  await shot("swimming", "b");
  const mL2 = await P(`worldOf('${hull}', 'b')`); // she's moved on
  const besideL = apply(mL2, [ld[0] + 0.9, 0, ld[2]]);
  await P(`place('b', null, [${besideL[0]}, 0, ${besideL[2]}], ${headingOf(mL2) + Math.PI / 2}, 0.1)`);
  await sleep(500);
  const aimL = (await pointAt(ladder, "b")) ?? (await pointAt(hull, "b"));
  const verbsL = await P("verbs('b')");
  check("in the water by the ladder, B's prompt offers to climb aboard", !!aimL && verbsL.some((v) => v.command === "climb"), { aimL, verbsL, me: await P("me('b')") });
  await focus("b", aimL);
  await press("f");
  await sleep(600);
  const back = await P("me('b')");
  const mB = await P(`worldOf('${hull}', 'b')`);
  check("F climbs the ladder: B is back on deck, by the ladder", back.on === hull && !back.swimming && Math.hypot(back.position[0] - ld[0], back.position[2] - ld[2]) < 1.5 && back.eye[1] > mB[13] + 1.6, { back: { on: back.on, position: r3(back.position), eye: r3(back.eye) } });

  // ─── the doc hears of her now and then ───────────────────────────────────
  if (section("swim")) throw new Done();
  // raise the sail again from A's view (not aboard: the use prompt is only in first person… so B does it)
  await P(`place('b', '${hull}', ${atMast}, 0, -0.25)`);
  await sleep(400);
  const aimS2 = await pointAt(rig, "b");
  await focus("b", aimS2);
  await keyDown("f");
  await until(`window.__p.value('${rig}', 'a').raised > 0.95`, 8000);
  await keyUp("f");
  await P(`watchDoc('${hull}')`);
  const wall0 = Date.now();
  await sleep(25_000);
  const seen = await P("docSeen");
  const fps = report.measured.fps[SIM];
  check("the doc gets the hull's transform now and then, not every frame", seen.n >= 1 && seen.n <= 5, { changes: seen.n, writes: seen.writes, seconds: n2((Date.now() - wall0) / 1000), framesPerSecond: fps });

  // ─── handoff: the simulator leaves ───────────────────────────────────────
  if (section("doc")) throw new Done();
  const before = await P(`read('${hull}', '${FOL}')`);
  const sampling = js(`window.__p.sampleFrames('${hull}', '${FOL}', 4000)`);
  await sleep(1000);
  await P(`close('${SIM}')`);
  const across = await sampling;
  const stepsH = across.slice(1).map((f, i) => Math.hypot(f[1] - across[i][1], f[3] - across[i][3]));
  const took = await until(`window.__p.simulating('${FOL}')`, 8000);
  const claim2 = (await P("doc()")).claims?.sim;
  const p0 = await P(`worldOf('${hull}', '${FOL}')`);
  await sleep(3000);
  const p1 = await P(`worldOf('${hull}', '${FOL}')`);
  const after = await P(`read('${hull}', '${FOL}')`);
  const moved = Math.hypot(p1[12] - p0[12], p1[14] - p0[14]);
  check("the simulator closes: the other view claims sim", took && claim2?.session === sess[FOL], { claim2, sess });
  check("and she carries on from where she was: no jump in the drawn hull, the same way on, still moving", Math.max(...stepsH) < 0.5 && Math.abs(after.speed - before.speed) < 1 && moved > Math.min(0.3, 0.4 * 3 * Math.abs(before.speed)), { maxStep: n2(Math.max(...stepsH)), before: n2(before.speed), after: n2(after.speed), movedIn3s: n2(moved) });

  check("no errors in either console", (await errorsNow()).length === 0, await errorsNow());
} catch (err) {
  if (!(err instanceof Done)) {
    check("ran", false, String(err?.stack || err));
    try { await shot("failure"); } catch {}
  }
}
report.logs = b.logs.filter((l) => !/^(debug|log)/.test(l) && !EXPECTED.test(l)).slice(0, 40);
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
