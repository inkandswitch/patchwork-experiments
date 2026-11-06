// A Lost Cities table aboard the sloop, played by two people in headless
// Chrome, at anchor and under way.
//
//   (in scene/, sailing/, tabletop/ and card-table/) pnpm build
//   node probes/aboard-run.mjs [--shots <dir>] [--show] [--gpu] [--quick]
//
// Mounts the BUILT scene tool with the BUILT sailing, tabletop and
// card-table plugins twice on one empty scene (aboard-probe.html): A is Ana,
// B is Ben. A builds the scene through the stage's public calls (the start
// screen's Ship at anchor, then api.part: the Card table in her cockpit and
// Lost Cities on it), B opens it, and they play. It checks:
//  1. the doc: pieces under the table, the table under the hull, a secure
//     deck, play, sail down and anchor down;
//  2. A simulates; A sits in Player 1, B in Player 2; both seats' claims
//     and the sim's are live, and the secure deck reaches "playing";
//  3. over 10 s on the waves, the table's top stays put on both screens
//     (the seat views ride the table), though it moves in the world;
//  4. hovering the deck shows Flip, Shuffle and Draw and no sail verb; D
//     lands a card in A's tray, A sees its face and B doesn't;
//  5. a card carried from A's hand onto an expedition column snaps to it,
//     square to the table, on the table (not the boom);
//  6. Flip turns it over on the table;
//  7. a plain click on a card doesn't board; a drag on the wheel orbits
//     (the hand doesn't carry her fittings); seated, a plain click on the
//     hull doesn't board, and the HUD offers Enter, not the walking keys,
//     its dial top left clear of the hand;
//  8. B gets her under way with the keys in the template's own breeze: Enter,
//     F held at the windlass and at the mast, F at the wheel, A and D to
//     bear away onto a reach; over 1 m/s within 90 s; then 3–6 again for A
//     (still seated), and the name tags stay on their trays;
//  9. Enter boards: over the deck the prompt shows only Flip, and S and D
//     walk; Esc puts A back in the seat view;
// 10. screens of both views at anchor and under way.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene/dist/index.js", "sailing/dist/index.js", "tabletop/dist/index.js", "card-table/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "sailing-aboard"));
const QUICK = process.argv.includes("--quick");
/** How far (px) the table's top may wander on a seated view's screen over the sample. */
const STEADY_PX = 40;

const b = await browser({ root: ROOT, port: 4781, cdp: 9781, page: "/sailing/probes/aboard-probe.html", width: 1416, height: 530, show: process.argv.includes("--show"), gpu: process.argv.includes("--gpu"), timeout: 900_000 });
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [], numbers: {} };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(1), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `aboard-${name}.png`)));
const J = JSON.stringify;
const SAIL_VERBS = /sail|Haul|Ease|helm|anchor|Weigh|Let go/i;

/** The spread (px) of a list of page points: the largest distance from their middle. */
const spread = (pts) => {
  if (!pts.length) return Infinity;
  const c = [0, 1].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  return Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
};

/** 3: the table's top on each seated view's page over `ms`. */
async function steady(label, ms, { only = null } = {}) {
  const s = await P(`sampleTable(${ms})`, ms + 30_000);
  const world = s.world.length ? Math.max(...s.world.map((w) => Math.hypot(w[0] - s.world[0][0], w[1] - s.world[0][1], w[2] - s.world[0][2]))) : 0;
  const turned = s.world.length ? Math.max(...s.world.map((w) => Math.abs(Math.atan2(Math.sin(w[3] - s.world[0][3]), Math.cos(w[3] - s.world[0][3]))))) : 0;
  const n = { a: +spread(s.a).toFixed(1), b: +spread(s.b).toFixed(1), frames: { a: s.a.length, b: s.b.length }, worldMoved: +world.toFixed(3), worldTurned: +((turned * 180) / Math.PI).toFixed(2) };
  report.numbers[`steady ${label}`] = n;
  if (only) check(`${label}: over ${ms / 1000} s the table's top stays within ${STEADY_PX} px on ${only.toUpperCase()}'s seated screen`, n[only] < STEADY_PX && n.frames[only] > 5, n);
  else check(`${label}: over ${ms / 1000} s the table's top stays within ${STEADY_PX} px on both seated screens`, n.a < STEADY_PX && n.b < STEADY_PX && n.frames.a > 5 && n.frames.b > 5, n);
  return n;
}

/**
 * Put A's pointer over `id` and wait until A hovers it (or, with `pile`, any
 * card of the deck's pile) and the prompt shows `verb`; aimed afresh a few
 * times, as a hand follows a card on a moving table. → whether it did.
 */
async function hover(id, verb, { pile = false, tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    const at = await until(`aimAt(${J(id)}, 'a')`, 5000);
    if (!at) continue;
    await b.move(at.x + 2, at.y);
    await b.move(at.x, at.y);
    const on = pile ? `__p.pile().includes(__p.hovered('a'))` : `__p.hovered('a') === ${J(id)}`;
    if (await until(`hovered('a') && ${on} && __p.prompt('a').some((t) => ${verb}.test(t))`, 1500)) return true;
  }
  return false;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const compassOf = (m) => Math.atan2(-m[8], m[10]);

/** Stand view `w` at `pos` (the hull's frame) looking down `pitch`, and point at `id` until the prompt offers `verb`. → whether it did. */
async function face(w, id, pos, pitch, verb) {
  await P(`place('${w}', ${J((await P("ids")).hull)}, ${J(pos)}, 0, ${pitch})`);
  await sleep(600);
  for (let i = 0; i < 6; i++) {
    const at = await P(`aimAt(${J(id)}, '${w}')`);
    if (!at) { await sleep(300); continue; }
    await b.move(at.x + 1, at.y);
    await b.move(at.x, at.y);
    await sleep(250);
    if ((await P(`prompt('${w}')`)).some((t) => verb.test(t))) return true;
  }
  return false;
}

/**
 * At the helm in view `w`, steer for `want` (a compass heading, radians) with
 * A and D held as a helmsman holds them, for up to `ms`, until she's made
 * `speed` m/s. → { t: seconds to that speed or null, max, trace }.
 */
async function steer(w, want, ms, speed = 1, wallMs = ms * 4) {
  const t0 = Date.now();
  // sailing time: each frame steps her at most 0.25 s (physics.js MAX_SUBSTEPS × SUBSTEP), so on a
  // slow software renderer (two views on SwiftShader: a few frames a second) she sails slower than
  // the clock on the wall; the budget is hers, and the wall-clock time and frame rate are reported
  await js(`(() => { const g = (window.__sail = { t: 0, frames: 0, last: performance.now(), on: true });
    const f = (now) => { if (!g.on) return; g.t += Math.min(0.25, (now - g.last) / 1000); g.last = now; g.frames++; requestAnimationFrame(f); };
    requestAnimationFrame(f); return true; })()`);
  const sailed = () => js("window.__sail.t");
  let held = null;
  const trace = [];
  let reached = null;
  const hold = async (k) => { if (held === k) return; if (held) await b.keyUp(held); held = k; if (k) await b.keyDown(k); };
  try {
    while ((await sailed()) * 1000 < ms && Date.now() - t0 < wallMs) {
      const m = await P(`worldOf(__p.ids.hull, '${w}')`);
      const rd = await P(`read('a')`);
      const angle = await P(`live(__p.ids.wheel, 'angle')`) || 0;
      const err = wrap(want - compassOf(m));
      // going astern the rudder works backwards
      const goal = (rd?.speed ?? 0) < -0.2 ? -Math.sign(err) : Math.max(-1, Math.min(1, err * 1.5));
      await hold(Math.abs(goal - angle) < 0.08 ? null : goal > angle ? "d" : "a");
      const t = +(await sailed()).toFixed(1);
      trace.push([t, +(rd?.speed ?? 0).toFixed(2), +err.toFixed(2)]);
      if ((rd?.speed ?? 0) > speed) { reached = t; break; }
      await sleep(200);
    }
  } finally {
    await hold(null);
  }
  const g = await js("(() => { const g = window.__sail; g.on = false; return { t: g.t, frames: g.frames }; })()");
  const wall = (Date.now() - t0) / 1000;
  return { t: reached, sailedS: +g.t.toFixed(1), wallS: +wall.toFixed(1), fps: +(g.frames / wall).toFixed(1), max: Math.max(...trace.map((x) => x[1])), trace: trace.filter((_, i) => i % 25 === 0) };
}

/** 4: hover the deck in A, the prompt, D into A's tray. */
async function drawOne(label) {
  const pile = await P("pile()");
  const top = pile[0];
  if (!top) return check(`${label}: a pile out on the table`, false);
  const ok = await hover(top, "/Draw to my hand/", { pile: true });
  const hov = ok;
  const prompt = await P("prompt('a')");
  check(`${label}: over the deck the prompt offers Flip, Shuffle and Draw, and no sail verb`, hov && ok && prompt.some((t) => /Flip/.test(t)) && prompt.some((t) => /Shuffle/.test(t)) && !prompt.some((t) => SAIL_VERBS.test(t)), { prompt, hovered: await P("hovered('a')"), top });
  const before = await P("where()");
  const facesB = (await P("faces('b')")).length;
  await P("focus('a')");
  await hover(top, "/Draw to my hand/", { pile: true, tries: 3 });
  await b.key("d");
  const landed = await until(`where().p1.length === ${before.p1.length + 1}`, 6000);
  const after = await P("where()");
  const drawn = after.p1.find((id) => !before.p1.includes(id));
  check(`${label}: D lands a card in A's tray`, landed && !!drawn, { before: before.p1.length, after: after.p1.length });
  if (!drawn) return null;
  const pose = await P(`onTable(${J(drawn)})`);
  check(`${label}: …under the table, square to it`, pose.parent === (await P("ids")).table && pose.up > 0.999, pose);
  check(`${label}: A sees its face, B doesn't`, (await until(`faces('a').includes(${J(drawn)})`, 20_000)) && !(await P("faces('b')")).includes(drawn) && (await P("faces('b')")).length === facesB, { a: (await P("faces('a')")).includes(drawn), b: (await P("faces('b')")).includes(drawn) });
  return drawn;
}

/** 5 and 6: carry a card from A's hand onto A's first free expedition slot of a colour; then Flip it there. */
async function playOne(label, card, column) {
  const ids = await P("ids");
  const from = await until(`aimAt(${J(card)}, 'a')`, 10_000);
  // p1's side of the board: z +0.11 in the board's frame, column x (yellow −0.17 … red +0.17)
  const slot = [column, 0.0044, 0.11];
  const to = await P(`pageOf(${J(ids.board)}, ${J(slot)}, 'a')`);
  if (!from || !to) return check(`${label}: the card and the slot are on A's screen`, false, { from, to });
  await b.drag([from.x, from.y], [to.x + 3, to.y + 2], { steps: 16, settle: 400 });
  const pose = await P(`onTable(${J(card)})`);
  // a slot of that column (they're 2.2 cm apart, and the card keeps where it was grabbed), on the table's top
  const k = Math.max(0, Math.min(11, Math.round((pose.local[2] - 0.11) / 0.022)));
  const want = [column, 0.7006, +(0.11 + k * 0.022).toFixed(4)];
  const d = Math.hypot(pose.local[0] - want[0], pose.local[2] - want[2]);
  check(`${label}: a card carried onto an expedition column snaps to its slot, square to the table, on the table (not the boom)`, d < 0.002 && pose.up > 0.999 && Math.abs(pose.local[1] - want[1]) < 0.006 && pose.parent === ids.table, { pose, want, d: +d.toFixed(4) });
  // Flip it where it lies
  await P("focus('a')");
  await hover(card, "/Flip/");
  await b.key("f");
  // (it turns over in the air for 0.3 s of frames, then lands)
  await until(`onTable(${J(card)}).up < -0.999`, 8000);
  await sleep(300);
  const flipped = await P(`onTable(${J(card)})`);
  check(`${label}: Flip turns it over on the table`, flipped.up < -0.999 && Math.abs(flipped.local[1] - want[1]) < 0.006 && Math.hypot(flipped.local[0] - pose.local[0], flipped.local[2] - pose.local[2]) < 0.002, { flipped, was: pose.local });
  return pose;
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  check("the start screen offers Ship at anchor", await until("templates('a').includes('ship-at-anchor')", 20_000), await P("templates('a')"));
  const ids = await P("build()", 120_000);
  mark("built", ids);
  check("built through the start screen and the parts bin", !ids.error && ids.table && ids.board, ids);
  const shape = await P("shape()");
  // ── 1 ──
  check("1: every piece under the table, the table under the hull, locked", shape.pieces === 63 && shape.piecesUnderTable === 63 && shape.tableParent === ids.hull && shape.tableLocked, shape);
  check("1: a secure deck, named for the scene", shape.deckType === "secure-deck" && /Lost Cities aboard/.test(shape.deckTitle ?? ""), { deckType: shape.deckType, deckTitle: shape.deckTitle });
  check("1: in play, sail down, anchor down, a home view over the cockpit", shape.activity === "play" && shape.sail?.raised === 0 && shape.anchor?.down === true && shape.anchor?.rode === 25 && !!shape.home, { activity: shape.activity, sail: shape.sail, anchor: shape.anchor, home: shape.home });
  check("1: the seats' views are in the table's frame", Object.values(shape.seats ?? {}).length === 2 && Object.values(shape.seats).every((s) => s.camera?.in === ids.table), shape.seats);
  check("A is playing", await until("activity('a') === 'play'", 10_000), await P("activity('a')"));
  await P("openB()");
  check("B opens it in play", await until("activity('b') === 'play' && __p.picker('a') === 3 && __p.picker('b') === 3", 30_000), { b: await P("activity('b')") });
  check("everything loads in both views", await until("loaded('a').loaded === __p.loaded('a').total && __p.loaded('b').loaded === __p.loaded('b').total", 120_000), { a: await P("loaded('a')"), b: await P("loaded('b')") });
  mark("loaded");

  // ── 2 ──
  check("2: A simulates the ship", await until("simulating('a') && !__p.simulating('b')", 20_000), { a: await P("simulating('a')"), b: await P("simulating('b')") });
  await P("pick('a', 'p1')");
  await P("pick('b', 'p2')");
  const viewers = await P("viewers");
  check("2: A in Player 1, B in Player 2", await until(`seats().p1.player === ${J(viewers.a)} && __p.seats().p2.player === ${J(viewers.b)}`), await P("seats()"));
  check("2: the sim's claim and both seats' claims are live", await until("claims('a').includes('sim') && __p.claims('a').includes('tabletop.seat:p1') && __p.claims('b').includes('tabletop.seat:p2')", 5000), { a: await P("claims('a')"), b: await P("claims('b')") });
  const dealt = await until("phase() === 'playing' && __p.faces('a').length >= 8 && __p.faces('b').length >= 8", 180_000);
  mark("dealt");
  check("2: the secure deck reaches playing, each hand's faces delivered", dealt, { phase: await P("phase()"), a: (await P("faces('a')")).length, b: (await P("faces('b')")).length });
  const seatA = await P("seatView('p1', 'a')");
  const camA = await P("cam('a')");
  check("2: A's view is its seat's, through the table as drawn", Math.hypot(...camA.position.map((v, i) => v - seatA.position[i])) < 0.3, { cam: camA.position, seat: seatA.position });
  await sleep(500);
  await shot("anchor");

  // ── 3 ──
  await steady("at anchor", QUICK ? 4000 : 10_000);

  // ── 4, 5, 6 ──
  const drawn = await drawOne("4 at anchor");
  const hand = (await P("where()")).p1;
  const card = drawn ?? hand[0];
  if (card) await playOne("5–6 at anchor", card, -0.17);
  await shot("played");

  // ── 7 ──
  {
    const target = (await P("where()")).p1.find((id) => id !== card) ?? card;
    const at = await until(`aimAt(${J(target)}, 'a')`, 5000);
    const before = await P(`transform(${J(target)})`);
    await b.click(at.x, at.y);
    await sleep(300);
    check("7: a plain click on a card doesn't board, and doesn't move it", !(await P("me('a')")).playing && !(await P("immersive('a')")) && J(await P(`transform(${J(target)})`)) === J(before), { me: await P("me('a')"), before, after: await P(`transform(${J(target)})`) });
    // whichever of her fittings is on A's screen from the seat (the wheel is aft, behind the seat's view)
    let fitting = null;
    let spot = null;
    // (the hull: her benches and coamings across the cockpit, in her frame)
    const tries = [["wheel", ids.wheel, null], ["mast", ids.mast, null], ...[[-0.6, 1.08, 2.3], [0.6, 1.08, 2.3], [-0.82, 1.25, 3.4], [0.82, 1.25, 3.4], [0, 0.72, 3.6]].map((p) => ["hull", ids.hull, p])];
    for (const [name, id, local] of tries) {
      spot = await P(`aimAt(${J(id)}, 'a', ${J(local)})`);
      if (spot) {
        fitting = { name, id };
        break;
      }
    }
    if (fitting) {
      const cam0 = await P("cam('a')");
      const w0 = await P(`transform(${J(fitting.id)})`);
      await b.drag([spot.x, spot.y], [spot.x + 60, spot.y + 10], { steps: 10, settle: 300 });
      const cam1 = await P("cam('a')");
      const turned = Math.hypot(...cam1.position.map((v, i) => v - cam0.position[i]));
      // (an orbit means nothing took the press: the hand didn't pick her up. The hull's own doc
      // pose moves anyway, as the sim saves where she swings at anchor; a fitting's doesn't.)
      const still = fitting.name === "hull" || J(await P(`transform(${J(fitting.id)})`)) === J(w0);
      check(`7: a drag on her ${fitting.name} orbits (the hand doesn't carry her)`, turned > 0.02 && still && !(await P("me('a')")).playing, { turned: +turned.toFixed(3), still });
    } else check("7: a fitting of hers is on A's screen", false);
    // a plain click on the hull round the table, seated: no boarding
    await P("pick('a', '')");
    await P("pick('a', 'p1')");
    await sleep(400);
    let hullSpot = null;
    for (const p of [[-0.6, 1.08, 2.3], [0.6, 1.08, 2.3], [-0.82, 1.25, 3.4], [0.82, 1.25, 3.4], [0, 0.72, 3.6]]) if ((hullSpot = await P(`aimAt(${J(ids.hull)}, 'a', ${J(p)})`))) break;
    if (hullSpot) {
      await b.click(hullSpot.x, hullSpot.y);
      await sleep(400);
      check("7: seated, a plain click on the hull round the table doesn't board", !(await P("me('a')")).playing && !(await P("immersive('a')")), { me: await P("me('a')") });
    } else check("7: the hull round the table is on A's screen", false);
    // seated: the HUD offers Enter, not the walking keys, and keeps clear of the hand at the bottom
    const hud = await P("hud('a')");
    check("7: seated, the HUD says Enter to come aboard, without the walking keys, its dial top left", hud?.seated && /Enter/.test(hud.button ?? "") && !/WASD/.test(hud.keys) && hud.panel && hud.panel.bottom < hud.panel.hostHeight * 0.4, hud);
    // back in the seat for what follows
    await P("pick('a', '')");
    await P("pick('a', 'p1')");
    await sleep(400);
  }

  // ── 8: under way ──
  if (!QUICK) {
    // B leaves the table and gets her under way with the keys, in the template's own breeze:
    // Enter; F held at the windlass, then at the mast; F at the wheel; A and D to bear away onto a reach
    report.numbers.breeze = await P("wind()");
    await P("focus('b')");
    await b.key("Enter");
    check("8: B comes aboard with Enter, keeping the seat", (await until("me('b').playing", 5000)) && (await P("seats()")).p2?.player === viewers.b, await P("me('b')"));
    const wl = await P(`hullLocal(${J(ids.windlass)})`);
    const mastAt = await P(`hullLocal(${J(ids.mast)})`);
    const rigAt = await P(`hullLocal(${J(ids.rig)})`);
    const wh = await P(`hullLocal(${J(ids.wheel)})`);
    await P("focus('b')");
    const atWindlass = await face("b", ids.windlass, [wl[0], wl[1], wl[2] + 0.9], -0.75, /Raise anchor/);
    let up = false;
    if (atWindlass) { await b.keyDown("f"); up = await until("shape().anchor.down === false", 90_000); await b.keyUp("f"); }
    check("8: B weighs anchor, holding F at the windlass", atWindlass && up, await P("shape().anchor"));
    await sleep(2000);
    const atMast = await face("b", ids.mast, [0.4, mastAt[1] + 0.3, rigAt[2] + 1.3], -0.8, /Raise sail/);
    let raised = false;
    if (atMast) { await b.keyDown("f"); raised = await until("live(__p.ids.rig, 'raised') >= 0.98", 60_000); await b.keyUp("f"); }
    check("8: B raises the sail, holding F at the mast", atMast && raised, await P("shape().sail"));
    const atWheel = await face("b", ids.wheel, [wh[0], wh[1] - 0.6, wh[2] + 0.75], -0.45, /Take the helm/);
    if (atWheel) await b.key("f");
    check("8: B takes the helm with F", atWheel && (await until(`me('b').station === ${J(ids.wheel)}`, 3000)), await P("me('b')"));
    mark("sail up, anchor up, at the helm");
    // bear away onto a beam reach, on whichever side the wind is
    const wind = await P("wind()");
    const awa = (await P("read('a')"))?.apparentWind?.angle ?? 0.5;
    const want = ((wind.from + (awa < 0 ? 1 : -1) * 90) * Math.PI) / 180;
    const sailed = await steer("b", want, 90_000, 1);
    report.numbers["under way"] = { ...sailed, wind: wind.speed };
    check("8: steered with A and D, she makes over 1 m/s within 90 s (of sailing time) in the anchorage's breeze", sailed.t != null, report.numbers["under way"]);
    // and on, a little: the helm left as it is
    await sleep(5000);
    mark("under way", report.numbers["under way"]);
    await shot("under-way");
    await steady("under way", 10_000, { only: "a" });
    const drawn2 = await drawOne("8: 4 under way");
    const card2 = drawn2 ?? (await P("where()")).p1[0];
    if (card2) await playOne("8: 5–6 under way", card2, 0.085);
    // the name tags over their trays
    const tags = await P("tags('a')");
    // (on the tray, at its edge nearest the seat)
    const tray1 = await P(`pageOf(${J(ids.hand1)}, [0, 0, 0.065], 'a')`);
    const near1 = tags.filter((t) => /Player 1/.test(t.text)).map((t) => Math.hypot(t.x - tray1.x, t.y - tray1.y));
    check("8: the name tags stay on their trays", near1.length === 1 && near1[0] < 30, { tags, tray1 });
    await shot("under-way-played");
  }

  // ── 9: first person ──
  {
    await P("focus('a')");
    await b.key("Enter");
    check("9: Enter boards", await until("me('a').playing && __p.immersive('a')", 5000), await P("me('a')"));
    // standing in the cockpit aft of the table, looking down at the deck on it
    await P(`place('a', ${J(ids.hull)}, [0, 0.72, 3.65], 0, -0.62)`);
    await sleep(1500); // (the walker settles her feet on the sole, and the eye with them)
    const pile = await P("pile()");
    let at = null;
    let over = false;
    for (let i = 0; i < 4 && !over; i++) {
      at = await until(`aimAt(${J(pile[0])}, 'a')`, 5000);
      if (!at) continue;
      await b.move(at.x + 1, at.y);
      await b.move(at.x, at.y);
      over = await until(`pile().includes(__p.hovered('a'))`, 2000);
    }
    await sleep(300);
    const prompt = await P("prompt('a')");
    check("9: over the deck in first person the prompt shows Flip, and not Shuffle or Draw", over && prompt.some((t) => /Flip/.test(t)) && !prompt.some((t) => /Shuffle|Draw/.test(t)), { prompt, over, hovered: await P("hovered('a')") });
    const p0 = (await P("me('a')")).position;
    const told0 = (await P("notices('a')")).length;
    const hand0 = (await P("where()")).p1.length;
    await P("focus('a')");
    await b.keyDown("s");
    await sleep(1500);
    await b.keyUp("s");
    await b.keyDown("d");
    await sleep(1500);
    await b.keyUp("d");
    const p1 = (await P("me('a')")).position;
    const moved = Math.hypot(...p1.map((v, i) => v - p0[i]));
    const notes = (await P("notices('a')")).slice(told0);
    const hand1 = (await P("where()")).p1.length;
    check("9: S and D walk, and neither shuffles nor draws", moved > 0.05 && !notes.some((n) => /Shuffl|drew/.test(n)) && hand1 === hand0, { moved: +moved.toFixed(3), notes, hand: [hand0, hand1] });
    await b.key("Escape");
    await sleep(200);
    if (await P("immersive('a')")) await b.key("Escape");
    check("9: Esc stops walking", await until("me('a').playing === false && !__p.immersive('a')", 4000), { me: await P("me('a')"), immersive: await P("immersive('a')") });
    await sleep(600);
    const seat = await P("seatView('p1', 'a')");
    const cam = await P("cam('a')");
    check("9: …and A is back in the seat view", Math.hypot(...cam.position.map((v, i) => v - seat.position[i])) < 0.3, { cam: cam.position, seat: seat.position });
    await shot("back-in-seat");
  }

  check("nothing failed to load", (await P("loading('a')")).errors === 0 && (await P("loading('b')")).errors === 0, { a: await P("loading('a')"), b: await P("loading('b')") });
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
report.seconds = Math.round((Date.now() - t0) / 1000);
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
