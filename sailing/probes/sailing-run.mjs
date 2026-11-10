// Sailing, crewed by two people in headless Chrome.
//
//   (in scene/ and sailing/) pnpm build
//   node probes/sailing-run.mjs [--shots <dir>] [--show] [--swiftshader] [--seed N]
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
// - at anchor, from the cockpit, the boom over B's head is in reach though
//   its gooseneck isn't, and offers to raise the sail;
// - looking at the mast B is offered the halyard (F, locking in there) and
//   hold R, and hoists a little from there;
// - from the wheel, the mast is out of reach and says which station to take
//   (you're in the cockpit already); B takes the helm and raises the sail
//   from it (hold R), still at anchor; B weighs the anchor at the windlass
//   (hold F, through the use prompt) and takes the helm again; she lies
//   head to wind (the HUD's: within 40°, slow; else the step fails as not exercised), the HUD
//   names the move and B leaves as a crew does (DESIGN.md, "Leaving the
//   anchor"): the wheel to port, B backs the jib on the side opposite the
//   bow its hint names, and she falls off that way past 45° within 15 s of
//   sea time, one bounded step; B lets it fly; A finds the helm taken, B
//   bears away onto a beam reach and she picks up speed; B lets go and A
//   can take it;
// - at the mainsheet in the cockpit B hauls in (hold Q), takes it (F) and
//   eases (E) from there;
// - B lowers the sail (hold R) and she slows;
// - B stands on the moving deck, and A draws B there;
// - her navmesh, as B's view baked it from her GLBs, passes C1–C9; B walks
//   the cockpit's edges with real keys (both sides of the well, its aft end,
//   out onto the side deck and back, a jump at the aft end): every frame the
//   walker's invariant holds and the feet are on her surfaces;
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
import { staticChecks, walkReport, watchWalk } from "./navprobe.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["sailing/dist/index.js", "scene/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "sailing-shots"));
const UNTIL = arg("--until"); // stop after this section (for working on the probe)

// the page seeds Math.random (the template's sea and wind): runs repeat, but for real time
const SEED = Number(arg("--seed") ?? 1);
const b = await browser({ root: ROOT, port: 4760, cdp: 9760, page: `/sailing/probes/sailing-probe.html?seed=${SEED}`, width: 1616, height: 530, show: process.argv.includes("--show"), gpu: !process.argv.includes("--swiftshader"), timeout: 900_000 });
// every page call has a deadline, so a hang says where it was
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], measured: { seed: SEED } };
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
const KEY = { " ": [" ", "Space", 32], r: ["r", "KeyR", 82], q: ["q", "KeyQ", 81], e: ["e", "KeyE", 69], f: ["f", "KeyF", 70], d: ["d", "KeyD", 68], a: ["a", "KeyA", 65], b: ["b", "KeyB", 66], w: ["w", "KeyW", 87], s: ["s", "KeyS", 83], Escape: ["Escape", "Escape", 27], Enter: ["Enter", "Enter", 13] };
const keyDown = (k) => b.send("Input.dispatchKeyEvent", { type: "keyDown", key: KEY[k][0], code: KEY[k][1], windowsVirtualKeyCode: KEY[k][2], ...(k.length === 1 ? { text: k } : {}) });
const keyUp = (k) => b.send("Input.dispatchKeyEvent", { type: "keyUp", key: KEY[k][0], code: KEY[k][1], windowsVirtualKeyCode: KEY[k][2] });
async function press(k, ms = 60) { await keyDown(k); await sleep(ms); await keyUp(k); await sleep(60); }

/**
 * A simple helmsman at B's wheel (B's view focused): steer `hull` onto the
 * compass course `want` (radians), holding A or D, until on course and
 * making `speed` for `settle` s of sea time, or `ms` pass. The wheel goes
 * toward a little of the error, less her turn rate.
 * @returns {{ onCourse: number | null, reached: { sea, speed } | null, trace }}  sea times since the start
 */
async function steer(ids, sim, want, { ms = 90_000, speed = 2, settle = 6 } = {}) {
  const t0 = Date.now(), sea0 = await P(`clock('${sim}')`);
  const trace = [];
  let held = null, onCourse = null, reached = null;
  const hold = async (k) => { if (held === k) return; if (held) await keyUp(held); held = k; if (k) await keyDown(k); };
  // a PD helmsman: the wheel is rate-limited, so steering on the error alone overshoots; the
  // turn rate (smoothed over the waves' yaw) meets her early. It's done once she's been on her
  // course for `settle` seconds of sea and has stopped turning, so the wheel is left near amidships.
  let prev = null, rate = 0, steadySince = null;
  try {
    while (Date.now() - t0 < ms) {
      const m = await P(`worldOf('${ids.hull}', 'b')`);
      const rd = await P(`read('${ids.hull}', 'b')`);
      const angle = (await P(`value('${ids.wheel}', 'b')`)).angle;
      const compass = compassOf(m);
      const err = wrap(want - compass); // + : turn to starboard
      const sea = (await P(`clock('${sim}')`)) - sea0;
      if (prev && sea - prev.sea > 1e-3) rate += 0.4 * (wrap(compass - prev.compass) / (sea - prev.sea) - rate);
      prev = { sea, compass };
      const goal = Math.max(-1, Math.min(1, err * 1.5 - rate * 2.5));
      await hold(Math.abs(goal - angle) < 0.08 ? null : goal > angle ? "d" : "a");
      trace.push([n2(sea), n2(rd?.speed ?? 0), n2(err), n2(angle)]);
      if (onCourse == null && Math.abs(err) < 0.35) onCourse = sea;
      if (!reached && onCourse != null && (rd?.speed ?? 0) > speed && Math.abs(err) < 0.35) reached = { sea, speed: rd.speed };
      const steady = Math.abs(err) < 0.2 && Math.abs(rate) < 0.06;
      steadySince = steady ? (steadySince ?? sea) : null;
      if (reached && sea - reached.sea > settle && steadySince != null && sea - steadySince > 1.5) break;
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
/** Point at `id` near a world point (the boom's after end, say). */
async function pointNear(id, w, at) {
  const p = await P(`aimNear('${id}', '${w}', ${JSON.stringify(at)})`);
  if (!p || p.miss) {
    report.measured.missed = [...(report.measured.missed ?? []), { id, at, why: p }];
    return null;
  }
  await b.move(p.x, p.y);
  await sleep(120);
  return p;
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
  const ids = await js(`(() => { const by = window.__p.byName; return { hull: by("Sloop"), wheel: by("Wheel"), rig: by("Boom and sail"), windlass: by("Windlass"), ladder: by("Ladder"), anchor: by("Anchor"), mast: by("Mast"), mainsheet: by("Mainsheet") }; })()`);
  report.ids = ids;
  const { hull, wheel, rig, windlass, ladder } = ids;
  // where a part is on her (the hull's frame): up its chain of parents (the sail hangs from the mast), none of them turned
  const local = async (id) => {
    const d = await P("doc()");
    let p = [0, 0, 0];
    for (let at = id; at && at !== hull; at = d.objects[at].parent) p = p.map((v, i) => v + d.objects[at].transform.position[i]);
    return p;
  };

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
  // the template's sea is seeded at random (--seed): kept with the report
  report.measured.sea = (await P("doc()")).traits["sailing.sea"];
  check("the template starts her under way: sail up, anchor up, making way on both views", start[rig].traits["sailing.sail"].raised === 1 && start[windlass].traits["sailing.anchor"].down === false && way.s?.speed > 1 && way.f?.speed > 1, { speed: { sim: n2(way.s?.speed), follower: n2(way.f?.speed) } });
  await shot("under-way", FOL);

  // Then lay her to her anchor, head to wind with the sail down, as someone
  // editing the scene would (a moved hull restarts at rest where it was put),
  // so the anchor and the stations can be worked from there. The boom sheeted
  // in, as it's left at anchor: her rig contract's boom, eased, wanders about
  // the centreline with each gust and sheer, a target that moves while the
  // look at it from the cockpit (below) is made; sheeted in it lies over the
  // well. It's eased again (0.5) once that look is done.
  const windFrom = (await P("doc()")).traits["sailing.sea"].wind.from;
  await js(`window.__p.change((d) => {
    const o = d.objects;
    o['${hull}'].transform.rotation[1] = ${(-windFrom * Math.PI) / 180};
    o['${rig}'].traits['sailing.sail'].raised = 0;
    o['${rig}'].traits['sailing.sail'].sheet = 0;
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
  const guide = (await P("text('[data-k=\"guide\"]', 'b')"))[0] ?? "";
  check("walking her deck, B's HUD names her stations: the wheel, the mainsheet, the mast, the windlass", /Wheel/.test(guide) && /Mainsheet/.test(guide) && /Mast/.test(guide) && /Windlass/.test(guide), guide);
  // at anchor, sail down: from the cockpit's forward end, the boom over B's head is in reach though its
  // gooseneck isn't (reach is to the point looked at): it offers to raise the sail
  {
    // the cockpit's forward end: 3.85 m aft of the gooseneck, on the sole (the mainsheet's height)
    const ms0 = await local(ids.mainsheet);
    const fwdEnd = (await local(rig))[2] + 3.85;
    // look at a point of the boom (the rig's +Z from the gooseneck) a metre forward of the one
    // nearest the eye, and point at it; afresh each try, as the boom swings at anchor with the sail
    // down. (Not the nearest: with the boom over the centreline, as the rig contract's sheeted boom
    // mostly lies at anchor, that is straight overhead, a look past the camera's pitch.)
    let aimC = null;
    let verbsC = [];
    let mR, eye, boomAt, yaw, pitch;
    await P(`place('b', '${hull}', [0, ${ms0[1]}, ${fwdEnd}], 0, 0)`);
    await sleep(500);
    for (let i = 0; i < 5 && !verbsC.some((v) => v.command === "sail"); i++) {
      const mH = await P(`worldOf('${hull}', 'b')`);
      mR = await P(`worldOf('${rig}', 'b')`);
      eye = (await P("me('b')")).eye;
      const ax = [mR[8], mR[9], mR[10]];
      const t = Math.max(0.5, Math.min(4.9, (eye[0] - mR[12]) * ax[0] + (eye[1] - mR[13]) * ax[1] + (eye[2] - mR[14]) * ax[2] - 1));
      boomAt = [mR[12] + t * ax[0], mR[13] + t * ax[1], mR[14] + t * ax[2]];
      const d = boomAt.map((v, k) => v - eye[k]);
      yaw = Math.atan2(-d[0], -d[2]) - headingOf(mH);
      pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      await P(`place('b', '${hull}', [0, ${ms0[1]}, ${fwdEnd}], ${yaw}, ${pitch})`);
      await sleep(300);
      aimC = await P(`aimNearest('${rig}', 'b')`);
      if (aimC) { await b.move(aimC.x + 1, aimC.y); await b.move(aimC.x, aimC.y); await sleep(250); }
      verbsC = await P("verbs('b')");
    }
    report.measured.boomLook = { hovered: await P("hovered('b')"), verbs: verbsC };
    const gooseC = Math.hypot(eye[0] - mR[12], eye[1] - mR[13], eye[2] - mR[14]);
    check("at anchor, from the cockpit, the boom over B's head is in reach (its gooseneck isn't): hold R Raise sail", !!aimC && aimC.distance < 2.5 && gooseC > 2.5 && verbsC.some((v) => v.command === "sail" && /Raise/.test(v.name) && !v.disabled), { aimC, verbsC, gooseneck: n2(gooseC), boomAt: r3(boomAt), eye: r3(eye), yaw: n2(yaw), pitch: n2(pitch), me: await P("me('b')"), missed: report.measured.missed });
    // and eased again, as the template has it, for getting under way
    await js(`window.__p.change((d) => { d.objects['${rig}'].traits['sailing.sail'].sheet = 0.5; })`);
  }
  // B raises the sail: looking at the mast offers the sail's verbs
  const mastAt = await local(ids.mast);
  const rigAt = await local(rig);
  await P(`place('b', '${hull}', [0.4, ${mastAt[1] + 0.3}, ${rigAt[2] + 1.3}], 0, -0.8)`); // looking down at its foot
  await sleep(500);
  const aimM = await pointAt(ids.mast, "b");
  const verbsM = await P("verbs('b')");
  check("looking at the mast, B's prompt offers to work the halyard (F) and to raise the sail (hold R); no sheet at the mast", !!aimM && verbsM.some((v) => v.command === "halyard" && !v.disabled) && verbsM.some((v) => v.command === "sail" && /Raise/.test(v.name)) && !verbsM.some((v) => v.command === "haul"), { aimM, verbsM });
  // F locks in at the mast: hold R raises it a little, F leaves (re-aimed if the roll took the
  // pointer off the mast before the key landed)
  await focus("b", aimM);
  await press("f");
  await sleep(300);
  for (let i = 0; i < 3 && (await P("me('b')")).station !== rig; i++) {
    const again = await pointAt(ids.mast, "b");
    if (again) await focus("b", again);
    await press("f");
    await sleep(400);
  }
  const atHalyard = await P("me('b')");
  check("F at the mast locks B in there (the sail's stand spot), the hint saying hold R", atHalyard.station === rig && /hold R raise sail/.test(atHalyard.hint ?? ""), atHalyard);
  // (a little: a sail part way up, aft of her keel's centre, rounds her back up into the wind she's falling off)
  await keyDown("r");
  await sleep(350);
  await keyUp("r");
  await sleep(300);
  const hoisted = (await P("doc()")).objects[rig].traits["sailing.sail"].raised;
  check("holding R there hoists it: the doc has it part way up", hoisted > 0.05 && hoisted < 0.5, { hoisted });
  await press("f");
  await sleep(300);
  check("F leaves the mast: walking again, the halyard's claim gone", (await P("me('b')")).station == null && !(await P("doc()")).objects[rig].claims?.halyard, await P("me('b')"));

  // ─── the helm ────────────────────────────────────────────────────────────
  if (section("anchor")) throw new Done();
  const wh = await local(wheel);
  // from the wheel, the mast is out of reach: it says where to go
  await P(`place('b', '${hull}', [${wh[0]}, ${wh[1] - 0.6}, ${wh[2] + 0.75}], 0, 0.15)`);
  await sleep(500);
  const aimFar = await pointAt(ids.mast, "b");
  const verbsFar = await P("verbs('b')");
  check("from the wheel, looking at the mast: 'Sail · work it at the wheel or the mainsheet (F)', greyed (you're in the cockpit already)", !!aimFar && verbsFar.some((v) => v.command === "far" && v.disabled && v.name === "Sail · work it at the wheel or the mainsheet (F)"), { aimFar, verbsFar });
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
  // the halyard's led aft: at the wheel, R held raises the sail the rest of the way
  check("at the helm, the hint offers the halyard (hold R)", /hold R raise sail/.test((await P("me('b')")).hint ?? ""), await P("me('b')"));
  await keyDown("r");
  await until(`window.__p.value('${rig}', 'a').raised > 0.95`, 10000);
  await keyUp("r");
  await sleep(300);
  check("holding R at the helm raises the sail: the doc says raised 1", (await P("doc()")).objects[rig].traits["sailing.sail"].raised > 0.95, (await P("doc()")).objects[rig].traits["sailing.sail"]);
  await shot("helm", "b");

  // ─── B weighs the anchor, the main up (DESIGN.md, "Leaving the anchor": hoisted while anchored, so she
  // lies head to wind as it breaks out), and comes back to the helm ────────
  await press("f"); // leaves the helm
  await sleep(300);
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
  await P(`place('b', '${hull}', [${wh[0]}, ${wh[1] - 0.6}, ${wh[2] + 0.75}], 0, -0.45)`);
  await sleep(400);
  const aimH2 = await pointAt(wheel, "b");
  await press("f");
  await sleep(300);
  check("back at the wheel, F takes the helm again", !!aimH2 && (await P("me('b')")).station === wheel, { aimH2, me: await P("me('b')") });

  // ─── leaving head to wind, as a crew does (DESIGN.md, "Leaving the anchor") ─
  // She lies near head to wind, where her rudder hardly bites. The tack chosen with the wheel (to
  // port), B backs the jib, and her heading must swing past 45° within 15 s of sea time: one bounded
  // step, reported whatever happens, nothing retried; then B lets it fly.
  const jibId = await P(`byName("Jib")`);
  // the main hoisted at anchor, she lies head to wind as it breaks out: in the HUD's own sense (hud.js luffing: the
  // apparent wind within 40°, under 0.5 m/s, where no sail drives her), or the step isn't exercised
  const advice = (await P("text('[data-k=\"advice\"]', 'b')"))[0] ?? "";
  const rdLeave = await P(`read('${hull}', 'b')`);
  const leave = { awa0: n2(rdLeave.apparentWind.angle), speed0: n2(rdLeave.speed) };
  const inIrons = Math.abs(rdLeave.apparentWind.angle) < (40 * Math.PI) / 180 && Math.abs(rdLeave.speed) < 0.5;
  check("weighed with the main up, she lies head to wind (the apparent wind within 40°, under 0.5 m/s): the leave step is exercised", inIrons, leave);
  check("head to wind, the HUD names the move (back the jib, B at the helm)", /back the jib \(B at the helm/.test(advice), { advice, awa: n2(rdLeave.apparentWind.angle), speed: n2(rdLeave.speed) });
  const hLeave = compassOf(await P(`worldOf('${hull}', 'b')`));
  await keyDown("a");
  await sleep(600); // the wheel a third to port
  await keyUp("a");
  leave.hint = (await P("me('b')")).hint;
  await press("b");
  leave.held = (await P("doc()")).objects[jibId]?.traits["sailing.jib"].held ?? null;
  const leaveSea = await P(`clock('${SIM}')`);
  const leaveWall = Date.now();
  leave.past = null;
  while ((await P(`clock('${SIM}')`)) - leaveSea < 15 && Date.now() - leaveWall < 60_000) {
    leave.turned = wrap(compassOf(await P(`worldOf('${hull}', 'b')`)) - hLeave);
    if (Math.abs(leave.turned) > Math.PI / 4) { leave.past = n2((await P(`clock('${SIM}')`)) - leaveSea); break; }
    await sleep(150);
  }
  leave.turned = n2(leave.turned ?? 0);
  await press("b"); // and let it fly
  await sleep(300);
  leave.let = (await P("doc()")).objects[jibId]?.traits["sailing.jib"].held ?? null;
  report.measured.leave = leave;
  // the hint names her bow's way; the jib is held on the other side (stations.js helmBackSide: the side it backs)
  leave.bow = /bow to port/.test(leave.hint ?? "") ? "port" : /bow to starboard/.test(leave.hint ?? "") ? "starboard" : null;
  check("B, the wheel to port, backs the jib on the side opposite the bow the hint names, then lets it fly", inIrons && leave.bow != null && leave.held != null && leave.held !== leave.bow && /B (unroll jib backed|back jib), bow to /.test(leave.hint ?? "") && leave.let == null, leave);
  // compass + is her bow to starboard
  check("backed, she falls off the way the hint said: her heading swings past 45° that way within 15 s of sea time", inIrons && leave.past != null && Math.sign(leave.turned) === (leave.bow === "starboard" ? 1 : -1), leave);
  // the tack she's on: +1 the wind on her port side (her heading the wind's + 90°), −1 starboard
  const side = (await P(`read('${hull}', 'b')`)).apparentWind.angle < 0 ? 1 : -1;
  report.measured.tack = side > 0 ? "port" : "starboard";

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
  // a beam reach on the tack she fell off on: the wind from 45°, the wind on her port beam she heads 135°
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

  // B hauls in the sheet at the mainsheet, in the cockpit (hold Q): she heels more
  const mast = await local(ids.mast);
  const rg = await local(rig);
  const atMast = `[0.4, ${mast[1] + 0.3}, ${rg[2] + 1.3}]`;
  const ms = await local(ids.mainsheet);
  await P(`place('b', '${hull}', [0, ${ms[1]}, ${ms[2] + 0.35}], 0, -1.2)`); // its stand spot, between it and the wheel
  await sleep(500);
  let aimQ = await pointAt(ids.mainsheet, "b");
  const verbsQ = await P("verbs('b')");
  check("at the mainsheet, B's prompt offers to take it (F) and the sheet (hold Q, E)", !!aimQ && ["mainsheet", "haul", "ease"].every((c) => verbsQ.some((v) => v.command === c && !v.disabled)), { aimQ, verbsQ });
  const sheet0 = (await P(`value('${rig}', 'b')`)).sheet;
  // (re-aimed before each try: she rolls the block out from under a pointer that stays put)
  let sheet1 = sheet0;
  for (let i = 0; i < 3 && !(sheet1 < sheet0 - 0.1); i++) {
    if (i) aimQ = (await pointAt(ids.mainsheet, "b")) ?? aimQ;
    await focus("b", aimQ);
    await keyDown("q");
    await sleep(800);
    await keyUp("q");
    await sleep(300);
    sheet1 = (await P("doc()")).objects[rig].traits["sailing.sail"].sheet;
  }
  check("holding Q there hauls the sheet in: the doc has it tighter", sheet1 < sheet0 - 0.1, { sheet0, sheet1 });
  // F locks in at the mainsheet: Q / E trim, hold R hoists; F leaves
  await press("f");
  await sleep(300);
  for (let i = 0; i < 3 && (await P("me('b')")).station !== ids.mainsheet; i++) {
    const again = await pointAt(ids.mainsheet, "b");
    if (again) await focus("b", again);
    await press("f");
    await sleep(400);
  }
  const atSheet = await P("me('b')");
  check("F takes the mainsheet: B stands at it, the hint saying Q / E and hold R", atSheet.station === ids.mainsheet && /Q \/ E sheet/.test(atSheet.hint ?? "") && /hold R/.test(atSheet.hint ?? "") && Math.abs(atSheet.position[1] - ms[1]) < 0.05, atSheet);
  await keyDown("e");
  await sleep(500);
  await keyUp("e");
  await sleep(300);
  const sheet2 = (await P("doc()")).objects[rig].traits["sailing.sail"].sheet;
  check("there, E eases it: the doc has it further out", sheet2 > sheet1 + 0.05, { sheet1, sheet2 });
  await press("f");
  await sleep(300);
  check("F leaves the mainsheet: its claim goes", (await P("me('b')")).station == null && !(await P("doc()")).objects[ids.mainsheet].claims?.station, await P("me('b')"));
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


  // ─── her navmesh, and the cockpit's edges walked with real keys ───────────
  if (section("deck")) throw new Done();
  const nav = await staticChecks(js, "b", hull, "sloop");
  report.measured.navmesh = { cells: nav.cells, triangles: nav.triangles, links: nav.links, bakeMs: nav.bakeMs };
  for (const [name, c] of Object.entries(nav.checks ?? {})) check(`her navmesh, baked in B's view from her GLBs: ${name}`, c.ok, c.detail);
  check("and it bakes the same twice", nav.cells > 1000 && nav.again === nav.cells, { cells: nav.cells, again: nav.again });
  // from the helm, under way (heeled, pitching): a fixed sequence of keys, about 6 s
  await P(`place('b', '${hull}', [0, 0.72, 4.85], 0, -0.1)`);
  await sleep(300);
  await focus("b");
  await watchWalk(js, "b", hull);
  const legs = [];
  const hold = async (keys, ms) => {
    for (const k of keys) await keyDown(k);
    await sleep(ms);
    for (const k of [...keys].reverse()) await keyUp(k);
    await sleep(120);
    legs.push([keys.join("+"), r3((await P("me('b')")).position)]);
  };
  // (the aft deck right behind the helm is cut by the backstay's foot, so the aft end is taken off the centreline)
  await hold(["d"], 200); // a step to starboard on the sole
  await hold(["s"], 500); // up the well's aft end onto the aft deck
  await hold(["a"], 300); // along it, to where the backstay stops you
  await hold(["w"], 400); // back down into the well
  await hold(["a"], 1100); // across the sole, up its port side onto the side deck, to the lifeline
  await hold(["s"], 350); // aft along it, clear of the wheel (beside it, the well's edge is too narrow to step down)
  await hold(["d"], 500); // back down into the well
  await hold(["d"], 900); // across, up its starboard side onto the side deck
  await hold(["a"], 450); // back down into the well
  await hold(["s", " "], 600); // a jump at its aft end
  await hold(["w"], 300); // and back
  await sleep(300);
  const walked = await walkReport(js, "b");
  report.measured.walk = { ...walked, legs, me: await P("me('b')"), errors: (await errorsNow()).slice(0, 5) };
  await shot("navmesh-walk", "b");
  check("walking the cockpit's edges with real keys: the walker's invariant held every frame", walked.frames > 60 && walked.asserts.length === 0, { frames: walked.frames, asserts: walked.asserts.slice(0, 3), modes: walked.modes });
  check("and the feet were on her surfaces every frame (the sole, the deck: within 2 cm), or over them mid-jump", walked.off.length === 0, { off: walked.off, worst: walked.worst });
  check("the walk went where it meant to: the sole, both side decks, the aft deck, and into the air", ["sole", "port", "starboard", "aft deck", "air"].every((k) => walked.visited[k] > 0), walked.visited);

  // ─── lowering the sail ───────────────────────────────────────────────────
  if (section("navmesh")) throw new Done();
  // She has sailed herself since the helm was left (the wheel where it was): on her rig
  // contract's physics, the main eased (its CE swung out to leeward) rounds her up toward the
  // wind, and in a minute or so she may have lost her way. So B takes the helm and puts her back
  // on the reach first, so that she has way to carry when the sail comes down.
  report.measured.beforeLower = { read: await P(`read('${hull}', 'b')`) };
  await P(`place('b', '${hull}', [${wh[0]}, ${wh[1] - 0.6}, ${wh[2] + 0.75}], 0, -0.45)`);
  await sleep(500);
  const aimH3 = await pointAt(wheel, "b");
  await focus("b", aimH3);
  await press("f");
  await sleep(300);
  const resteer = await steer(ids, SIM, want, { ms: 90_000, settle: 6 });
  report.measured.backOnReach = { reached: resteer.reached, trace: resteer.trace.filter((_, i) => i % 8 === 0) };
  await press("f"); // and leaves it
  await sleep(300);
  const sp0 = (await P(`read('${hull}', 'b')`)).speed;
  // B at the gooseneck, looking at the boom
  await P(`place('b', '${hull}', ${atMast}, 0, -0.25)`);
  await sleep(500);
  const aimS = await pointAt(rig, "b");
  const verbsS = await P("verbs('b')");
  check("the sail's verb says what it'll do: Lower sail (hold R)", !!aimS && verbsS.some((v) => v.command === "sail" && /Lower/.test(v.name)), { aimS, verbsS });
  await focus("b", aimS);
  await keyDown("r");
  await until(`window.__p.value('${rig}', 'a').raised < 0.05`, 8000);
  await sleep(300);
  await keyUp("r");
  await sleep(400);
  const sailDoc = (await P("doc()")).objects[rig].traits["sailing.sail"];
  check("holding R lowers it: the doc says raised 0", sailDoc.raised < 0.05, sailDoc);
  // her jib still draws with the main down (the stock sloop sails her rig contract): B furls it
  // from the working winch (the lazy one says where the jib is), with real keys: F, hold R, F
  {
    const jibId = await P(`byName("Jib")`);
    const furled = { jibId, tried: [] };
    for (const name of ["Port jib winch", "Starboard jib winch"]) {
      const w = await P(`byName(${JSON.stringify(name)})`);
      const s = name.startsWith("Port") ? -1 : 1;
      let aim = null;
      // from its stand spot, looking at the winch (its origin, as she lies now), then either way abeam
      await P(`place('b', '${hull}', [${s * 0.22}, 0.75, 2.3], 0, 0)`);
      await sleep(300);
      const mH = await P(`worldOf('${hull}', 'b')`), mW = await P(`worldOf('${w}', 'b')`), eye = (await P("me('b')")).eye;
      const dW = [mW[12] - eye[0], mW[13] - eye[1], mW[14] - eye[2]];
      const looks = [[Math.atan2(-dW[0], -dW[2]) - headingOf(mH), Math.atan2(dW[1], Math.hypot(dW[0], dW[2]))], [(-s * Math.PI) / 2, -0.35], [(s * Math.PI) / 2, -0.35]];
      for (const [yaw, pitch] of looks) {
        await P(`place('b', '${hull}', [${s * 0.22}, 0.75, 2.3], ${yaw}, ${pitch})`);
        await sleep(400);
        aim = await pointAt(w, "b");
        if (aim) break;
      }
      const vs = aim ? await P("verbs('b')") : [];
      furled.tried.push({ name, aim: !!aim, verbs: vs.map((v) => `${v.command}${v.disabled ? " (disabled)" : ""}: ${v.name}`) });
      if (!aim || vs.some((v) => v.disabled && /Lazy sheet/.test(v.name))) continue;
      await focus("b", aim);
      await press("f");
      await sleep(400);
      furled.station = (await P("me('b')")).station === w;
      furled.hint = (await P("me('b')")).hint;
      await keyDown("r");
      await until(`(window.__p.doc().objects['${jibId}'].traits['sailing.jib'].furl ?? 0) > 0.95`, 8000).catch(() => {});
      await keyUp("r");
      await sleep(300);
      furled.furl = (await P("doc()")).objects[jibId].traits["sailing.jib"].furl;
      await press("f");
      await sleep(300);
      furled.left = (await P("me('b')")).station == null;
      break;
    }
    report.measured.furl = furled;
    check("at the working winch, F takes the jib sheet, hold R furls the jib (the doc says furl 1), F leaves", furled.station && furled.furl > 0.95 && furled.left && /hold R/.test(furled.hint ?? ""), furled);
  }
  const slowing = [];
  for (let i = 0; i < 6; i++) { await sleep(4000); slowing.push(n2((await P(`read('${hull}', 'b')`)).speed)); }
  // (an 8 t sloop carries her way: in calm water she'd be at about half speed after 24 s; each wave surges her a little)
  // slowing: the least-squares trend over the samples, not two pairs of them, so one wave's surge can't decide it
  const trend = (() => { const n = slowing.length, mx = (n - 1) / 2, my = mean(slowing); let a = 0, q = 0; slowing.forEach((v, i) => { a += (i - mx) * (v - my); q += (i - mx) ** 2; }); return a / q / 4; })(); // m/s per second
  check("with the sails down (main lowered, jib furled) she carries her way, and slows", slowing.at(-1) < sp0 * 0.7 && slowing.at(-1) > 0.3 && trend < -0.01, { before: n2(sp0), every4s: slowing, trend: +trend.toFixed(3) });

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
  // she still carries her way (a couple of m/s): beside the ladder again where she is now, so it's in reach when F lands
  const mL3 = await P(`worldOf('${hull}', 'b')`);
  const besideL3 = apply(mL3, [ld[0] + 0.9, 0, ld[2]]);
  await P(`place('b', null, [${besideL3[0]}, 0, ${besideL3[2]}], ${headingOf(mL3) + Math.PI / 2}, 0.1)`);
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
  await keyDown("r");
  await until(`window.__p.value('${rig}', 'a').raised > 0.95`, 8000);
  await keyUp("r");
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
  // each frame's step past what her speed carries her in that frame's time: a long frame (the page
  // busy as the other view closes) is a stall, not a jump
  const stepsH = across.slice(1).map((f, i) => Math.max(0, Math.hypot(f[1] - across[i][1], f[3] - across[i][3]) - (Math.abs(before.speed) * Math.max(0, f[0] - across[i][0])) / 1000));
  const longest = Math.max(...across.slice(1).map((f, i) => f[0] - across[i][0]));
  const took = await until(`window.__p.simulating('${FOL}')`, 8000);
  const claim2 = (await P("doc()")).claims?.sim;
  const p0 = await P(`worldOf('${hull}', '${FOL}')`);
  await sleep(3000);
  const p1 = await P(`worldOf('${hull}', '${FOL}')`);
  const after = await P(`read('${hull}', '${FOL}')`);
  const moved = Math.hypot(p1[12] - p0[12], p1[14] - p0[14]);
  check("the simulator closes: the other view claims sim", took && claim2?.session === sess[FOL], { claim2, sess });
  check("and she carries on from where she was: no jump in the drawn hull, the same way on, still moving", Math.max(...stepsH) < 0.5 && Math.abs(after.speed - before.speed) < 1 && moved > Math.min(0.3, 0.4 * 3 * Math.abs(before.speed)), { maxStep: n2(Math.max(...stepsH)), longestFrameMs: Math.round(longest), before: n2(before.speed), after: n2(after.speed), movedIn3s: n2(moved) });

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
