// A Lost Cities table aboard the sloop, played by two people in headless
// Chrome, at anchor and under way.
//
//   (in scene/, seats/, sailing/, tabletop/, card-table/ and keep/) pnpm build
//   node probes/aboard-run.mjs [--shots <dir>] [--show] [--gpu] [--quick] [--seed 1] [--port 4781] [--cdp 9781]
//
// Mounts the BUILT scene tool with the BUILT seats, sailing, tabletop and
// card-table plugins twice on one empty scene (aboard-probe.html): A is Ana,
// B is Ben. A builds the scene through the stage's public calls (the start
// screen's Ship at anchor, then api.part: the Card table in her cockpit and
// Lost Cities on it), B opens it, and they play. It checks:
//  1. the doc: pieces under the table, the table under the hull, a secure
//     deck, play, sail down and anchor down;
//  2. A simulates; A sits in Player 1, B in Player 2; both seats' claims
//     and the doc's clock claim are live, and the secure deck reaches "playing";
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
//     R held at the mast (the main up at anchor), F held at the windlass, F
//     at the wheel; head to wind (the HUD's: within 40°, slow; else the step fails as not
//     exercised), the wheel to port and B unrolls the jib backed on the side
//     opposite the bow its hint names, and she falls off that way past 45°
//     within 15 s of sailing time (one bounded step: DESIGN.md, "Leaving
//     the anchor"); A and D onto a reach, over 1 m/s within 90 s; then 3–6 again for A
//     (still seated), and the name tags stay on their trays;
//  9. Enter boards (the crew's "aboard" body, over the seat): over the deck
//     the prompt shows Flip with F, Shuffle and Draw without their keys (S
//     and D walk), and S and D walk; with the table in her cockpit the
//     mainsheet is in reach from its stand spot and offers F; the body chip's
//     Leave puts A back in the seat view (Escape never leaves a body);
// 10. walking up to her own tray (from Look, Enter): F sits A down (the seat
//     body over "aboard", the walker waiting); F at it again (the seats'
//     "Stand up") pops the seat: walking on her deck beside the table and
//     facing it, the seat still A's; F once more, back in the seat view;
// 11. screens of both views at anchor and under way.
// 12. under way, seated: the menu on a card has the card's verbs (the
//     game's) and Select, which selects the link the card is in (the focus
//     is the boat's: scene/COMPOSITION.md §5), not the card;
// 13. editing in context (COMPOSITION.md build step 14), under way: A picks
//     Edit on the body chip and clicks a card on the table (it selects the
//     link: the focus is the boat's), then double-clicks it, which enters
//     the game (the focus moves into G: the trail says where, the
//     general parts run in G's stage); a click selects the card itself (the
//     boat sees the link, G the card), and its halo's X arrow, in the card's
//     parent's frame as drawn, moves it along the table's X only while she
//     heels and sails on, written to G local to the same parent and nothing
//     to the boat; B is untouched; Escape deselects, Escape again
//     leaves, the general parts back in the boat's stage.
// Prints a JSON checklist; exits non-zero if any check fails.
//
// Simulated time: both views run on the page's manual clock (window.__time),
// so the sea, the crew and every prompt move only as this steps frames, as
// fast as the CPU allows. A wait on something in the world is a number of
// frames (until), never a sleep. The wall is waited on only for loading
// (loads) and for the secure deck's crypto (holds: the world held still, no
// time passing, however long it takes). The page seeds Math.random (?seed)
// and holds the world paused while it's set up and dealt (?held): it resumes
// at 2, so every run sails the same sea from the same moment, and does the
// same thing.
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene/dist/index.js", "seats/dist/index.js", "sailing/dist/index.js", "water/dist/index.js", "tabletop/dist/index.js", "card-table/dist/index.js", "keep/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "sailing-aboard"));
const QUICK = process.argv.includes("--quick");
/** How far (px) the table's top may wander on a seated view's screen over the sample. */
const STEADY_PX = 40;

// (--port / --cdp: another probe, another lane's, may have the defaults)
const PORT = Number(arg("--port") ?? 4781);
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/aboard-probe.html?held&seed=${Number(arg("--seed") ?? 1)}`, width: 1416, height: 530, show: process.argv.includes("--show"), gpu: process.argv.includes("--gpu"), timeout: 900_000 });
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const FRAME = 1000 / 60;
/** Frame by frame until `expr` (on window.__p) holds, for at most ms of the page's clock → its value, or false. */
const until = (expr, ms = 10_000) => b.soon(`window.__p.${expr}`, { frames: Math.ceil(ms / FRAME) });
/** Loading and sync: the wall's, up to ms (the page's frames going at its pace). */
const loads = (expr, ms = 20_000) => b.waitFor(`window.__p.${expr}`, ms, 60);
/** Crypto (the secure deck's): the wall's, up to ms, the world held still meanwhile (still frames). */
const holds = (expr, ms = 20_000) => b.hold(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [], numbers: {} };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(1), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `aboard-${name}.png`)));
const J = JSON.stringify;
const SAIL_VERBS = /sail|Haul|Ease|helm|anchor|Weigh|Let go/i;

/** Leave the top body of view w through its body chip (its menu's "Leave (<label>)"). */
async function leaveBody(w, label) {
  const chip = await P(`chip('${w}')`);
  if (chip) await b.click(Math.round(chip.x), Math.round(chip.y));
  await until(`chipItem('${w}', 'Leave (${label})')`, 3000);
  const item = await P(`chipItem('${w}', 'Leave (${label})')`);
  if (item) await b.click(Math.round(item.x), Math.round(item.y));
  await b.rest(500);
  return !!item;
}

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

/**
 * Stand view `w` at `pos` (the hull's frame) looking down `pitch`, and point at `id` (at `local` in its own frame, else
 * its origin) until the prompt offers `verb`: aimed afresh a few times, each waited on as hover() waits (a view at a
 * few frames a second takes more than one to hear the pointer). → whether it did; what each try saw is in report.numbers.
 */
async function face(w, id, pos, pitch, verb, local = null) {
  await P(`place('${w}', ${J((await P("ids")).hull)}, ${J(pos)}, 0, ${pitch})`);
  await b.rest(600);
  const tries = [];
  for (let i = 0; i < 6; i++) {
    const at = await P(`aimAt(${J(id)}, '${w}', ${J(local)})`);
    if (!at) { tries.push(null); await b.rest(300); continue; }
    await b.move(at.x + 1, at.y);
    await b.move(at.x, at.y);
    if (await until(`prompt('${w}').some((t) => ${verb}.test(t))`, 1500)) return true;
    tries.push({ at, prompt: await P(`prompt('${w}')`), hovered: await P(`hovered('${w}')`) });
  }
  (report.numbers.unfaced ??= []).push({ id, pos, verb: String(verb), tries });
  return false;
}

/**
 * At the helm in view `w`, steer for `want` (a compass heading, radians) with
 * A and D held as a helmsman holds them, for up to `ms` of sailing time (the
 * page's clock: frames), looking every 0.2 s, until she's made `speed` m/s.
 * → { t: seconds to that speed or null, max, trace }.
 */
async function steer(w, want, ms, speed = 1) {
  const t0 = Date.now();
  let held = null;
  const trace = [];
  let reached = null;
  const hold = async (k) => { if (held === k) return; if (held) await b.keyUp(held); held = k; if (k) await b.keyDown(k); };
  let sailed = 0; // s
  try {
    for (; sailed * 1000 < ms; sailed += 0.2) {
      const m = await P(`worldOf(__p.ids.hull, '${w}')`);
      const rd = await P(`read('a')`);
      const angle = await P(`live(__p.ids.wheel, 'angle')`) || 0;
      const err = wrap(want - compassOf(m));
      const goal = Math.max(-1, Math.min(1, err * 1.5));
      await hold(Math.abs(goal - angle) < 0.08 ? null : goal > angle ? "d" : "a");
      const t = +sailed.toFixed(1);
      trace.push([t, +(rd?.speed ?? 0).toFixed(2), +err.toFixed(2)]);
      if ((rd?.speed ?? 0) > speed) { reached = t; break; }
      await b.advance(200);
    }
  } finally {
    await hold(null);
  }
  const wall = (Date.now() - t0) / 1000;
  return { t: reached, sailedS: +sailed.toFixed(1), wallS: +wall.toFixed(1), max: Math.max(...trace.map((x) => x[1])), trace: trace.filter((_, i) => i % 25 === 0) };
}

/**
 * Leaving head to wind (DESIGN.md, "Leaving the anchor"), at the helm in view `w`: the wheel over
 * (`key` held 0.6 s: "a" port, "d" starboard; it picks the side dead ahead), B backs the jib
 * (unrolling it if it's furled) on the side opposite the bow its hint names, and her heading must
 * swing past 45° that way within `seaS` s of sailing time; then B lets it fly. One bounded step:
 * whatever happens is reported, nothing is retried.
 */
async function backJib(w, key, seaS = 15) {
  const h0 = compassOf(await P(`worldOf(__p.ids.hull, '${w}')`));
  const awa0 = (await P("read('a')"))?.apparentWind?.angle ?? NaN;
  await b.keyDown(key);
  await b.advance(600);
  await b.keyUp(key);
  const hint = (await P(`me('${w}')`))?.hint ?? "";
  await b.key("b");
  await b.rest(300);
  const held = await P("jibHeld()");
  let past = null, turned = 0;
  // looked at every 0.2 s of sailing time, from the jib made fast
  for (let sailed = 0; sailed < seaS; sailed += 0.2) {
    turned = wrap(compassOf(await P(`worldOf(__p.ids.hull, '${w}')`)) - h0);
    if (Math.abs(turned) > Math.PI / 4) { past = +sailed.toFixed(1); break; }
    await b.advance(200);
  }
  const furl = (await P("jib()"))?.furl ?? NaN;
  await b.key("b"); // and let it fly
  await b.rest(300);
  const bow = /bow to port/.test(hint) ? "port" : /bow to starboard/.test(hint) ? "starboard" : null;
  return { awa0: +awa0.toFixed(3), hint, bow, held, past, turnedDeg: Math.round((turned * 180) / Math.PI), furl, let: await P("jibHeld()") };
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
  // (the card glides to the tray: frames; what A sees of it is the secure deck's crypto, held below)
  const landed = await until(`where().p1.length === ${before.p1.length + 1}`, 6000);
  const after = await P("where()");
  const drawn = after.p1.find((id) => !before.p1.includes(id));
  check(`${label}: D lands a card in A's tray`, landed && !!drawn, { before: before.p1.length, after: after.p1.length });
  if (!drawn) return null;
  const pose = await P(`onTable(${J(drawn)})`);
  check(`${label}: …on the table (G's, linked onto it), square to it`, pose.game && pose.parent === null && pose.up > 0.999, pose);
  check(`${label}: A sees its face, B doesn't`, (await holds(`faces('a').includes(${J(drawn)})`, 20_000)) && !(await P("faces('b')")).includes(drawn) && (await P("faces('b')")).length === facesB, { a: (await P("faces('a')")).includes(drawn), b: (await P("faces('b')")).includes(drawn) });
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
  check(`${label}: a card carried onto an expedition column snaps to its slot, square to the table, on the table (not the boom)`, d < 0.002 && pose.up > 0.999 && Math.abs(pose.local[1] - want[1]) < 0.006 && pose.game && pose.parent === null, { pose, want, d: +d.toFixed(4) });
  // Flip it where it lies
  await P("focus('a')");
  await hover(card, "/Flip/");
  await b.key("f");
  // (it turns over in the air for 0.3 s of frames, then lands)
  await until(`onTable(${J(card)}).up < -0.999`, 8000);
  await b.rest(300);
  const flipped = await P(`onTable(${J(card)})`);
  check(`${label}: Flip turns it over on the table`, flipped.up < -0.999 && Math.abs(flipped.local[1] - want[1]) < 0.006 && Math.hypot(flipped.local[0] - pose.local[0], flipped.local[2] - pose.local[2]) < 0.002, { flipped, was: pose.local });
  return pose;
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  check("the start screen offers Ship at anchor", await loads("templates('a').includes('ship-at-anchor')", 20_000), await P("templates('a')"));
  const ids = await P("build()", 120_000);
  mark("built", ids);
  check("built through the start screen and the parts bin", !ids.error && ids.table && ids.board, ids);
  const shape = await P("shape()");
  // ── 1 ──
  // Lost Cities aboard is two docs (scene/COMPOSITION.md, worked example 1): the boat, with a locked link to the game on its card table
  check("1: the boat holds one link to the game, locked, on the table, and none of its pieces or seats; the table under the hull, locked", shape.link?.parent === ids.table && shape.link.locked && shape.link.providerId === "scene.link" && shape.boatPieces === 0 && !shape.boatSeats && shape.tableParent === ids.hull && shape.tableLocked, { link: shape.link, boatPieces: shape.boatPieces, boatSeats: shape.boatSeats });
  check("1: the game is a doc of its own: every piece at its root, its own title and start", shape.pieces === 63 && shape.piecesAtGameRoot === 63 && shape.gameTitle === "Lost Cities table" && shape.gameStart === "seat", { pieces: shape.pieces, atRoot: shape.piecesAtGameRoot, title: shape.gameTitle, start: shape.gameStart });
  // titled by the game and its deck, never by the scene it was set down in (tabletop/GAME-FORMAT.md)
  check("1: a secure deck, named for the game, not the ship", shape.deckType === "secure-deck" && shape.deckTitle === "Lost Cities: Deck", { deckType: shape.deckType, deckTitle: shape.deckTitle });
  check("1: it starts people through the game's link (as the game starts them), sail down, anchor down, a home view over the cockpit", shape.start === null && shape.startsThroughLink && shape.sail?.raised === 0 && shape.anchor?.down === true && shape.anchor?.rode === 25 && !!shape.home, { start: shape.start, through: shape.startsThroughLink, sail: shape.sail, anchor: shape.anchor, home: shape.home });
  check("1: the seats are the game's, their views in its root frame (it rides the table by the link)", Object.values(shape.seats ?? {}).length === 2 && Object.values(shape.seats).every((s) => s.camera && !s.camera.in), shape.seats);
  // (view.start is read once, on arrival: A, who made it, is still where the template put them)
  check("A, who made it, is where it left them: Look", (await P("bodyLabel('a')")) === "Look", await P("bodyLabel('a')"));
  await P("openB()");
  check("B arrives watching from a seat (view.start), both pickers up", await loads("bodyLabel('b') === 'Watching' && __p.picker('a') === 3 && __p.picker('b') === 3", 30_000), { b: await P("bodyLabel('b')") });
  check("everything loads in both views", await loads("loaded('a').loaded === __p.loaded('a').total && __p.loaded('b').loaded === __p.loaded('b').total", 120_000), { a: await P("loaded('a')"), b: await P("loaded('b')") });
  mark("loaded");

  // ── 2 ── (the world still paused: seated and dealt first, then it runs)
  await P("pick('a', 'p1')");
  await P("pick('b', 'p2')");
  const viewers = await P("viewers");
  check("2: A in Player 1, B in Player 2", await until(`seats().p1.player === ${J(viewers.a)} && __p.seats().p2.player === ${J(viewers.b)}`), await P("seats()"));
  // (dealing is the secure deck's crypto: the wall's, the world held still)
  const dealt = await holds("phase() === 'playing' && __p.faces('a').length >= 8 && __p.faces('b').length >= 8", 180_000);
  mark("dealt");
  check("2: the secure deck reaches playing, each hand's faces delivered", dealt, { phase: await P("phase()"), a: (await P("faces('a')")).length, b: (await P("faces('b')")).length });
  report.numbers.resumedAt = await P("resume()");
  check("2: A simulates the ship", await until("simulating('a') && !__p.simulating('b')", 20_000), { a: await P("simulating('a')"), b: await P("simulating('b')") });
  check("2: the doc's clock claim (A computes the world) and both seats' claims are live", await until("claims('a').includes('clock') && __p.claims('a').includes('seat:p1') && __p.claims('b').includes('seat:p2')", 5000), { a: await P("claims('a')"), b: await P("claims('b')") });
  const seatA = await P("seatView('p1', 'a')");
  const camA = await P("cam('a')");
  check("2: A's view is its seat's, through the table as drawn", Math.hypot(...camA.position.map((v, i) => v - seatA.position[i])) < 0.3, { cam: camA.position, seat: seatA.position });
  await b.rest(500);
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
    await b.rest(300);
    check("7: a plain click on a card doesn't board, and doesn't move it", !(await P("me('a')")).playing && !(await P("walking('a')")) && J(await P(`transform(${J(target)})`)) === J(before), { me: await P("me('a')"), before, after: await P(`transform(${J(target)})`) });
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
    await b.rest(400);
    let hullSpot = null;
    for (const p of [[-0.6, 1.08, 2.3], [0.6, 1.08, 2.3], [-0.82, 1.25, 3.4], [0.82, 1.25, 3.4], [0, 0.72, 3.6]]) if ((hullSpot = await P(`aimAt(${J(ids.hull)}, 'a', ${J(p)})`))) break;
    if (hullSpot) {
      await b.click(hullSpot.x, hullSpot.y);
      await b.rest(400);
      check("7: seated, a plain click on the hull round the table doesn't board", !(await P("me('a')")).playing && !(await P("walking('a')")), { me: await P("me('a')") });
    } else check("7: the hull round the table is on A's screen", false);
    // seated: the HUD offers Enter, not the walking keys, and keeps clear of the hand at the bottom
    const hud = await P("hud('a')");
    check("7: seated, the HUD says Enter to come aboard, without the walking keys, its dial top left", hud?.seated && /Enter/.test(hud.button ?? "") && !/WASD/.test(hud.keys) && hud.panel && hud.panel.bottom < hud.panel.hostHeight * 0.4, hud);
    // back in the seat for what follows
    await P("pick('a', '')");
    await P("pick('a', 'p1')");
    await b.rest(400);
  }

  // ── 8: under way ──
  if (!QUICK) {
    // B leaves the table and gets her under way with the keys, in the template's own breeze:
    // Enter; R held at the mast, then F at the windlass; F at the wheel; A and D to bear away onto a reach
    report.numbers.breeze = await P("wind()");
    await P("focus('b')");
    await b.key("Enter");
    check("8: B comes aboard with Enter, keeping the seat", (await until("me('b').playing", 5000)) && (await P("seats()")).p2?.player === viewers.b, await P("me('b')"));
    const wl = await P(`hullLocal(${J(ids.windlass)})`);
    const mastAt = await P(`hullLocal(${J(ids.mast)})`);
    const rigAt = await P(`hullLocal(${J(ids.rig)})`);
    const wh = await P(`hullLocal(${J(ids.wheel)})`);
    await P("focus('b')");
    // the main hoisted while she's anchored (DESIGN.md, "Leaving the anchor"), so she lies head to wind as it breaks out
    // (0.6 m up the mast, the middle of that look: its foot is 2.47 m from the eye, at the edge of the 2.5 m reach as she heaves)
    const atMast = await face("b", ids.mast, [0.4, mastAt[1] + 0.3, rigAt[2] + 1.3], -0.8, /Raise sail/, [0, 0.6, 0]);
    let raised = false;
    if (atMast) { await b.keyDown("r"); raised = await until("live(__p.ids.rig, 'raised') >= 0.98", 60_000); await b.keyUp("r"); }
    check("8: B raises the sail at anchor, holding R at the mast", atMast && raised, await P("shape().sail"));
    const atWindlass = await face("b", ids.windlass, [wl[0], wl[1], wl[2] + 0.9], -0.75, /Raise anchor/);
    let up = false;
    if (atWindlass) { await b.keyDown("f"); up = await until("shape().anchor.down === false", 90_000); await b.keyUp("f"); }
    check("8: B weighs anchor, holding F at the windlass", atWindlass && up, await P("shape().anchor"));
    const atWheel = await face("b", ids.wheel, [wh[0], wh[1] - 0.6, wh[2] + 0.75], -0.45, /Take the helm/);
    if (atWheel) await b.key("f");
    check("8: B takes the helm with F", atWheel && (await until(`me('b').station === ${J(ids.wheel)}`, 3000)), await P("me('b')"));
    mark("sail up, anchor up, at the helm");
    // she lies near head to wind, her jib rolled away at anchor (layout.js AT_ANCHOR). B leaves as a
    // crew does (DESIGN.md, "Leaving the anchor"): the tack chosen with the wheel (to port), B unrolls
    // the jib backed (the furling line's led aft), and she falls off: one bounded step, then B lets it fly
    const wind = await P("wind()");
    let jib = null;
    if (ids.jib) {
      const advice = (await P("hud('b')"))?.advice ?? "";
      const rd = await P("read('a')");
      // head to wind in the HUD's own sense (hud.js luffing: within 40°, under 0.5 m/s), or the step isn't exercised
      const inIrons = Math.abs(rd?.apparentWind?.angle ?? Infinity) < (40 * Math.PI) / 180 && Math.abs(rd?.speed ?? Infinity) < 0.5;
      check("8: weighed with the main up, she lies head to wind (the apparent wind within 40°, under 0.5 m/s): the leave step is exercised", inIrons, { awa: rd?.apparentWind?.angle, speed: rd?.speed });
      check("8: head to wind, the HUD names the move (back the jib, B at the helm)", /back the jib \(B at the helm/.test(advice), { advice, awa: rd?.apparentWind?.angle, speed: rd?.speed });
      jib = await backJib("b", "a");
      // the hint names her bow's way, the jib held on the other side (stations.js helmBackSide), unrolled
      check("8: B, the wheel to port, unrolls the jib (furl 0) and makes it fast on the side opposite the bow its hint names, and lets it fly once she's off", inIrons && jib.bow != null && jib.held != null && jib.held !== jib.bow && jib.furl <= 0.02 && jib.let == null, jib);
      // compass + is her bow to starboard: a turn the other way, or with the jib still furled, is drifting, not backing
      check("8: backed, she falls off the way the hint said: past 45° that way within 15 s of sailing time, the jib out", inIrons && jib.past != null && jib.furl <= 0.02 && jib.held != null && Math.sign(jib.turnedDeg) === (jib.bow === "starboard" ? 1 : -1), jib);
    }
    const awa = (await P("read('a')"))?.apparentWind?.angle ?? 0.5;
    const want = ((wind.from + (awa < 0 ? 1 : -1) * 90) * Math.PI) / 180;
    const sailed = await steer("b", want, 90_000, 1);
    report.numbers["under way"] = { ...sailed, wind: wind.speed, jib };
    check("8: steered with A and D, she makes over 1 m/s within 90 s (of sailing time) in the anchorage's breeze", sailed.t != null, report.numbers["under way"]);
    // and on, a little: the helm left as it is
    await b.advance(5000);
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
    const near1 = tray1 ? tags.filter((t) => /Player 1/.test(t.text)).map((t) => Math.hypot(t.x - tray1.x, t.y - tray1.y)) : [];
    // (the seat's view rolls with the table, its camera's up the table's: her heel no longer tips A's own tray off screen)
    check("8: the name tags stay on their trays", near1.length === 1 && near1[0] < 30, { tags, tray1, heelDeg: +(((await P("read('a')"))?.heel ?? NaN) * 180 / Math.PI).toFixed(1) });
    const off = await P("upOffTable('a')");
    check("8: under way, A's seat view rolls with the table (the camera's up is the table's) and A's own tray stays on screen", off != null && off < 1e-6 && !!tray1, { off, tray1, heelDeg: +(((await P("read('a')"))?.heel ?? NaN) * 180 / Math.PI).toFixed(1) });
    await shot("under-way-played");
  }

  // ── 12: selecting a game's card from outside selects the link (scene/COMPOSITION.md §5), under way ──
  // (the game is a doc of its own: editing a piece inside it is Enter's, build step 14, not a halo from the boat)
  {
    const lying = (await P("where()")).table[0] ?? null;
    const target = card ?? lying;
    const at = target ? await until(`aimAt(${J(target)}, 'a')`, 5000) : null;
    if (at) {
      await b.click(at.x, at.y, { button: "right" });
      await b.rest(200);
      const items = await P("menu('a')");
      const sel = items.find((i) => i.label === "Select");
      check("12: the menu on a card, seated and playing, has the card's verbs (the game's) and Select (the boat's, on the link)", items.some((i) => /Flip/.test(i.label)) && !!sel && !sel.disabled, items.map((i) => i.label));
      if (sel) await b.click(sel.x, sel.y);
      await b.rest(300);
      const path = await P("selectionPath('a')");
      check("12: Select selects the link the card is in, not the card: the boat sees the link, the game nothing", J(path) === J([ids.link]) && (await P("selected('a')")) === ids.link, { path, selected: await P("selected('a')") });
      await P("focus('a')");
      await b.key("Escape");
    } else check("12: a card lies on the table on A's screen", false, { card, lying });
  }

  // ── 9: first person ──
  {
    await P("focus('a')");
    await b.key("Enter");
    check("9: Enter boards", await until("me('a').playing && __p.walking('a')", 5000), await P("me('a')"));
    // standing in the cockpit aft of the table, looking down at the deck on it
    await P(`place('a', ${J(ids.hull)}, [0, 0.72, 3.65], 0, -0.62)`);
    await b.rest(1500); // (the walker settles her feet on the sole, and the eye with them)
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
    await b.rest(300);
    const prompt = await P("promptKeys('a')");
    // a shown key works (TOOLS.md H3): walking, S and D are the body's, so Shuffle and Draw show without them
    const flip = prompt.find((v) => /Flip/.test(v.name));
    const keyed = prompt.filter((v) => /Shuffle|Draw/.test(v.name));
    check("9: over the deck walking, the prompt shows Flip with F, and Shuffle or Draw only without their keys (S and D walk)", over && flip?.key === "F" && keyed.every((v) => v.key === ""), { prompt, over, hovered: await P("hovered('a')") });
    const p0 = (await P("me('a')")).position;
    const told0 = (await P("notices('a')")).length;
    const hand0 = (await P("where()")).p1.length;
    await P("focus('a')");
    await b.keyDown("s");
    await b.rest(1500);
    await b.keyUp("s");
    await b.keyDown("d");
    await b.rest(1500);
    await b.keyUp("d");
    const p1 = (await P("me('a')")).position;
    const moved = Math.hypot(...p1.map((v, i) => v - p0[i]));
    const notes = (await P("notices('a')")).slice(told0);
    const hand1 = (await P("where()")).p1.length;
    check("9: S and D walk, and neither shuffles nor draws", moved > 0.05 && !notes.some((n) => /Shuffl|drew/.test(n)) && hand1 === hand0, { moved: +moved.toFixed(3), notes, hand: [hand0, hand1] });
    // the mainsheet, aft of the table: its stand spot's clear, and from it the look down to the block isn't the table's
    if (ids.mainsheet) {
      const ms = await P(`hullLocal(${J(ids.mainsheet)})`);
      const atSheet = await face("a", ids.mainsheet, [ms[0], ms[1], ms[2] + 0.35], -1.2, /Take the mainsheet/);
      check("9: with the table in her cockpit, the mainsheet is in reach from its stand spot and offers F (Take the mainsheet)", atSheet, { ms, prompt: await P("prompt('a')"), hovered: await P("hovered('a')"), me: await P("me('a')") });
    } else check("9: she has a mainsheet", false, ids);
    await b.key("Escape");
    await b.rest(200);
    const stillWalking = await P("walking('a')");
    await leaveBody("a", "Aboard");
    check("9: Escape never leaves the body; the body chip's Leave stops walking", stillWalking && (await until("me('a').playing === false && !__p.walking('a')", 4000)), { me: await P("me('a')"), body: await P("body('a')") });
    await b.rest(600);
    const seat = await P("seatView('p1', 'a')");
    const cam = await P("cam('a')");
    check("9: …and A is back in the seat view", Math.hypot(...cam.position.map((v, i) => v - seat.position[i])) < 0.3, { cam: cam.position, seat: seat.position });
    await shot("back-in-seat");
  }

  // ── 10: sitting down from her deck, and standing up (the seat body over "aboard") ──
  {
    await P("focus('a')");
    // off the seat (the chip's Leave: the seat stays A's), then aboard from Look
    await leaveBody("a", "Seated");
    check("10: the chip's Leave stands A up from the seat into Look, the seat still A's", (await P("body('a')")).id === "look" && (await P("seats()")).p1?.player === viewers.a, { body: await P("body('a')"), seats: await P("seats()") });
    await b.key("Enter");
    await until("me('a').playing && __p.walking('a')", 5000);
    // standing in the cockpit aft of the table, looking at her own tray
    await P(`place('a', ${J(ids.hull)}, [0, 0.72, 3.65], 0, -0.62)`);
    await b.rest(1500);
    const back = await hover(ids.hand1, /Back to your seat/);
    check("10: walking, a look at A's own tray offers Back to your seat (F)", back, { prompt: await P("prompt('a')"), hovered: await P("hovered('a')") });
    if (back) await b.key("f");
    await b.rest(600);
    const sat = await P("body('a')");
    check("10: F sits A down: the seat body over the crew's, the walker waiting", JSON.stringify(sat.stack) === '["look","aboard","seat"]' && !(await P("me('a')")).playing, sat);
    const offered = await hover(ids.hand1, /Stand up/);
    check("10: seated, a look at A's own tray offers Stand up (F)", offered, { prompt: await P("prompt('a')"), hovered: await P("hovered('a')") });
    const told0 = (await P("notices('a')")).length;
    if (offered) await b.key("f");
    const up = await until("me('a').playing && __p.walking('a')", 5000);
    await b.rest(600);
    const me = await P("me('a')");
    const wk = await P("walker('a')");
    const tbl = await P(`hullLocal(${J(ids.table)})`);
    const plan = me?.position ? Math.hypot(me.position[0] - tbl[0], me.position[2] - tbl[2]) : null;
    check("10: Stand up pops the seat: walking on her deck from the seat's eye (the walker asserted every step), beside the table", up && wk?.mode === "walking" && wk.ship === ids.hull && plan != null && plan < 1.5 && JSON.stringify((await P("body('a')")).stack) === '["look","aboard"]', { me, wk, tbl, plan, body: await P("body('a')") });
    // facing the table: the camera looks toward it, across the deck
    const cam = await P("cam('a')");
    const tw = (await P(`worldOf(${J(ids.table)}, 'a')`)).slice(12, 15);
    const look = [cam.target[0] - cam.position[0], cam.target[2] - cam.position[2]];
    const to = [tw[0] - cam.position[0], tw[2] - cam.position[2]];
    const cos = (look[0] * to[0] + look[1] * to[1]) / (Math.hypot(...look) * Math.hypot(...to) || 1);
    check("10: …facing the table", cos > 0.7, { cos: +cos.toFixed(3) });
    const notes = (await P("notices('a')")).slice(told0);
    check("10: …told the seat's still A's, and it is", notes.some((n) => /still yours/.test(n)) && (await P("seats()")).p1?.player === viewers.a, { notes, seats: await P("seats()") });
    await shot("stood-up");
    // (back where she walked up from, looking at her tray again)
    await P(`place('a', ${J(ids.hull)}, [0, 0.72, 3.65], 0, -0.62)`);
    await b.rest(1500);
    const again = await hover(ids.hand1, /Back to your seat/);
    if (again) await b.key("f");
    await b.rest(600);
    const seat = await P("seatView('p1', 'a')");
    const cam2 = await P("cam('a')");
    check("10: F at it again: back in the seat view", again && Math.hypot(...cam2.position.map((v, i) => v - seat.position[i])) < 0.3, { cam: cam2.position, seat: seat.position, body: await P("body('a')") });
  }

  // ── 13: editing in context, under way (COMPOSITION.md build step 14) ──
  {
    await P("focus('a')");
    const chip = await P("chip('a')");
    if (chip) await b.click(Math.round(chip.x), Math.round(chip.y));
    await until("chipItem('a', 'Edit')", 3000);
    const item = await P("chipItem('a', 'Edit')");
    if (item) await b.click(Math.round(item.x), Math.round(item.y));
    await b.rest(500);
    check("13: Edit on the body chip: the seat body leaves (nothing stands on Edit), the seat still A's", (await P("body('a')")).id === "edit" && (await P("seats()")).p1?.player === viewers.a, { body: await P("body('a')"), seats: await P("seats()") });
    // she orbits to look down on the table from above (the orbit camera rides her hull: it stays there)
    await P("setCam('a', __p.overTable('a'))");
    await b.rest(600);
    // a card of G's lying on the table in plain sight on A's screen: one played, not one in the deck's pile (the
    // deck's keeper keeps those where it puts them) nor one under another
    const w0 = await P("where()");
    const pile0 = await P("pile()");
    const played = w0.table.filter((x) => !pile0.includes(x));
    let at = await until(`aimBest(${J(played)}, 'a')`, 3000);
    let target = at?.id ?? null;
    if (!at) check("13: a card of G's is in plain sight on A's screen", false, { where: w0, cam: await P("cam('a')") });
    else {
      const bBody = await P("bodyLabel('b')");
      // in Edit a click selects first (the link: the focus is the boat's), and the inspector's tab opens, narrowing
      // the canvas: let it settle and aim again, so the double-click lands on the card
      await b.click(at.x, at.y);
      await until(`selectionPath('a')?.length === 1`, 3000);
      await b.rest(800);
      // (the canvas is narrower now: a card in plain sight on it again, maybe another)
      let atD = await until(`aimBest(${J(played)}, 'a')`, 3000);
      if (atD) target = atD.id;
      else check("13: with the inspector open, a card of G's is still in plain sight on A's screen", false, { played });
      atD ??= at;
      await b.dblclick(atD.x, atD.y);
      await b.rest(400);
      const entered = await until(`focusPath('a').length === 1`, 3000);
      check("13: a double-click on a card of the game enters it: the focus is the link, the trail says where", entered && J(await P("focusPath('a')")) === J([ids.link]) && J(await P("trail('a')")) === J([await P("boatTitle()"), await P("linkName()")]), { focus: await P("focusPath('a')"), trail: await P("trail('a')"), aimed: atD, dbls: await P("dbls('a')") });
      check("13: the general parts moved into G's stage (the halo runs there, and not in the boat's)", J(await P("runsIn('a', 'scene.halo')")) === J([[ids.link]]) && J(await P("runsIn('a', 'scene.menu')")) === J([[ids.link]]), { halo: await P("runsIn('a', 'scene.halo')"), menu: await P("runsIn('a', 'scene.menu')") });
      // a click on the card selects it, now that the focus is in its doc (Edit's click, ahead of carrying)
      const at2 = await until(`aimAt(${J(target)}, 'a')`, 5000);
      if (at2) await b.click(at2.x, at2.y);
      await until(`halo('a')?.id === ${J(target)}`, 5000);
      await b.rest(800); // (the inspector's tab opens with it, so the canvas narrows: let it settle before aiming)
      const seen = await P("seen('a')");
      check("13: a click selects the card itself: the boat sees the link, G the card", J(await P("selectionPath('a')")) === J([ids.link, target]) && seen.some(([p, x]) => p.length === 0 && x === ids.link) && seen.some(([p, x]) => J(p) === J([ids.link]) && x === target), { path: await P("selectionPath('a')"), seen });
      const halo = await P("halo('a')");
      check("13: its halo is on it, in its parent's frame (G's root: the table, by the link)", halo?.id === target && halo.parent === null, { halo, why: await P("haloWhy('a')") });
      const h0 = await P("haloAt('a', 0)"), h1 = await P("haloAt('a', 0, 0.02)");
      if (h0 && h1) {
        const len = Math.hypot(h1.x - h0.x, h1.y - h0.y);
        const u = [(h1.x - h0.x) / len, (h1.y - h0.y) / len];
        const before = await P(`transform(${J(target)})`);
        const parent = await P(`parentOf(${J(target)})`);
        const boatLink0 = J(await P("linkRecord()"));
        const hull0 = await P(`worldOf(${J(ids.hull)}, 'a')`);
        const mid = await b.drag([h0.x, h0.y], [h0.x + u[0] * 40, h0.y + u[1] * 40], {
          steps: 12,
          beforeRelease: async () => {
            await b.rest(600); // she sails on under the held arrow
            return { hull: await P(`worldOf(${J(ids.hull)}, 'a')`) };
          },
        });
        await b.rest(300);
        const after = await P(`transform(${J(target)})`);
        const hullMoved = Math.hypot(mid.hull[12] - hull0[12], mid.hull[13] - hull0[13], mid.hull[14] - hull0[14]);
        const d = after.position.map((v, i) => v - before.position[i]);
        // not turned: the same rotation, whichever way round a half turn is written (π or −π)
        const sameTurn = before.rotation.every((v, i) => Math.abs(Math.atan2(Math.sin(v - after.rotation[i]), Math.cos(v - after.rotation[i]))) < 1e-6);
        report.numbers.haloInContext = { before: before.position, after: after.position, hullMovedM: +hullMoved.toFixed(3), parent };
        check("13: she moved under the drag (the parent is moving)", hullMoved > 0.05, report.numbers.haloInContext);
        await shot("entered");
        check("13: the card moved along its parent's X only, written to G local to the same parent, not turned; the boat's link untouched", d[0] > 0.003 && Math.abs(d[1]) < 1e-6 && Math.abs(d[2]) < 1e-6 && sameTurn && (await P(`parentOf(${J(target)})`)) === parent && (await P(`inGame(${J(target)})`)) && J(await P("linkRecord()")) === boatLink0, { d, before, after });
      } else check("13: the card's X arrow is on A's screen", false, { h0, h1, halo: await P("halo('a')"), why: await P("haloWhy('a')") });
      check("13: B is untouched: its focus the boat's, nothing selected, in the body it was in", J(await P("focusPath('b')")) === "[]" && (await P("selectionPath('b')")) === null && (await P("bodyLabel('b')")) === bBody, { focus: await P("focusPath('b')"), selected: await P("selectionPath('b')"), body: await P("bodyLabel('b')"), was: bBody });
      await P("focus('a')");
      await b.key("Escape");
      await b.rest(300);
      const deselected = (await P("selectionPath('a')")) === null && J(await P("focusPath('a')")) === J([ids.link]);
      await b.key("Escape");
      await b.rest(400);
      check("13: Escape deselects, then leaves: the focus back on the boat, the trail gone, the general parts back in the boat's stage", deselected && J(await P("focusPath('a')")) === "[]" && (await P("trail('a')")) === null && (await until("runsIn('a', 'scene.halo').length === 1 && __p.runsIn('a', 'scene.halo')[0].length === 0", 3000)), { focus: await P("focusPath('a')"), trail: await P("trail('a')"), halo: await P("runsIn('a', 'scene.halo')") });
      await shot("edited-in-context");
    }
  }

  check("nothing failed to load", (await P("loading('a')")).errors === 0 && (await P("loading('b')")).errors === 0, { a: await P("loading('a')"), b: await P("loading('b')") });
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
report.seconds = Math.round((Date.now() - t0) / 1000);
report.frames = await js("window.__time?.frames() ?? null").catch(() => null); // of the page's clock: its simulated seconds × 60
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
