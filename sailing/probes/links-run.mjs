// One Lost Cities game doc G, linked live into a still room and aboard the
// sloop at anchor, played by two people; G open alone in a third view
// (scene/COMPOSITION.md, worked example 3). All in one headless Chrome, one
// page, one repo (links-probe.html).
//
//   (in scene/, seats/, sailing/, tabletop/, card-table/, keep/, joints/, traversal/) pnpm build
//   node probes/links-run.mjs [--shots <dir>] [--show] [--seed 1] [--port 4791] [--cdp 9791]
//
// It checks:
//  1. the docs: the boat and the room each hold one link to the same G, and
//     none of its pieces or seats; G is a whole table of its own;
//  2. each view runs G in a stage of its own (the room's and the boat's at
//     their link), its extensions there and not in the host;
//  3. Ana sits at p1 in the room, Ben at p2 aboard: each view's G stage
//     hears the other two on G's channel (the page bus: one handle, no
//     network), and each seat's claim is held for all three;
//  4. the secure deck is dealt; each sees their own hand's faces, Cara
//     (watching G alone) neither;
//  5. Ana draws a card (D over the deck, the room's key map reaching into
//     G) and carries one onto an expedition column; Ben and Cara see both
//     moves; Ben draws and plays one of his, and Ana and Cara see it;
//  6. with the boat's world running, a card leans with her in Ben's view
//     and stays upright in Ana's and Cara's; Ben's seat view rolls with the
//     table (the camera's up is the table's), Ana's keeps the world's;
//  7. no page errors.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "seats", "sailing", "tabletop", "card-table", "keep", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "links-probe"));
const PORT = Number(arg("--port") ?? 4791);
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/links-probe.html?seed=${Number(arg("--seed") ?? 1)}`, width: 1700, height: 490, show: process.argv.includes("--show"), timeout: 900_000 });
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const FRAME = 1000 / 60;
const until = (expr, ms = 10_000) => b.soon(`window.__p.${expr}`, { frames: Math.ceil(ms / FRAME) });
const loads = (expr, ms = 30_000) => b.waitFor(`window.__p.${expr}`, ms, 60);
const holds = (expr, ms = 30_000) => b.hold(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], numbers: {} };
const J = JSON.stringify;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `links-${name}.png`)));
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;

/** Put view w's pointer over G's `id` until it hovers it and the prompt offers `verb`. */
async function hover(w, id, verb, { pile = false, tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    const at = await until(`aimAt(${J(id)}, '${w}')`, 4000);
    if (!at) continue;
    await b.move(at.x + 2, at.y);
    await b.move(at.x, at.y);
    const on = pile ? `__p.pile().includes(__p.hovered('${w}'))` : `__p.hovered('${w}') === ${J(id)}`;
    if (await until(`hovered('${w}') && ${on} && __p.prompt('${w}').some((t) => ${verb}.test(t))`, 1500)) return true;
  }
  return false;
}

/** View w draws the top of the deck into its seat's tray (D, through its outermost doc's key map). */
async function draw(w, seat) {
  const top = (await P("pile()"))[0];
  const ok = await hover(w, top, "/Draw to my hand/", { pile: true });
  const before = await P("where()");
  await P(`focus('${w}')`);
  await hover(w, top, "/Draw to my hand/", { pile: true, tries: 3 });
  await b.key("d");
  const landed = await until(`where().${seat}.length === ${before[seat].length + 1}`, 6000);
  const after = await P("where()");
  const drawn = after[seat].find((id) => !before[seat].includes(id)) ?? null;
  check(`${w.toUpperCase()} draws: over the deck the prompt offers Draw, and D lands a card in ${seat}'s tray`, ok && landed && !!drawn, { ok, landed, before: before[seat].length, after: after[seat].length, top, pile: (await P("pile()")).length, hovered: await P(`hovered('${w}')`), prompt: await P(`prompt('${w}')`), aim: await P(`aimAt(${J(top)}, '${w}')`), table: (await P("where()")).table.length });
  return drawn;
}

/** View w carries `card` from its hand onto the first slot of an expedition column on its side (z > 0 for p1, < 0 for p2). */
async function play(w, card, column, side) {
  const ids = await P("ids");
  const from = await until(`aimAt(${J(card)}, '${w}')`, 8000);
  const slot = [column, 0.0044, 0.11 * side];
  const to = await P(`pageOf(${J(ids.board)}, ${J(slot)}, '${w}')`);
  if (!from || !to) return check(`${w.toUpperCase()} plays: the card and the slot are on screen`, false, { from, to });
  await b.drag([from.x, from.y], [to.x + 2, to.y + 2], { steps: 16, settle: 400 });
  const pose = await P(`inGame(${J(card)})`);
  const onColumn = Math.abs(pose.local[0] - column) < 0.004 && Math.sign(pose.local[2]) === side && pose.up > 0.999;
  check(`${w.toUpperCase()} plays: a card carried from the hand onto an expedition column lies on it, square to G's table`, onColumn, { pose, column });
  return pose;
}

try {
  if (!(await loads("errors !== undefined", 60_000))) throw new Error("the page never got ready");
  const ready = await js("window.__ready");
  if (ready !== true) throw new Error(`page failed: ${J(await P("errors"))}`);

  // 1. the docs
  const ids = await P("build()", 300_000);
  check("1. the boat (B), then the room (A), then G alone (C) are made", ids && !ids.error, ids);
  const shape = await P("shape()");
  report.numbers.shape = shape;
  check("1. the boat and the room each hold one link to the same G, locked, and none of its pieces or seats", shape.sameGame && !shape.boatHasGamePieces && !shape.roomHasGamePieces && shape.boatLink?.locked === true && shape.roomLink?.locked === true && !shape.boatSeats && !shape.roomSeats, { sameGame: shape.sameGame, boatSeats: shape.boatSeats, roomSeats: shape.roomSeats });
  check("1. G is a whole table of its own: its title, p1 and p2", shape.gameTitle === "Lost Cities table" && J(shape.seats) === J(["p1", "p2"]), { title: shape.gameTitle, seats: shape.seats });

  // 2. a stage for G in each view
  await until("link('a')?.open && __p.link('b')?.open", 4000);
  const st = { a: await P("stages('a')"), b: await P("stages('b')"), c: await P("stages('c')") };
  report.numbers.stages = st;
  check("2. the room and the boat each open G's stage at their link; Cara's view is G's own", st.a.some((s) => s.url === ids.game && J(s.path) === J([ids.roomLink])) && st.b.some((s) => s.url === ids.game && J(s.path) === J([ids.boatLink])) && st.c[0].url === ids.game && (await P("link('a')")).open === true && (await P("link('a')")).role === "acting", st);
  const run = shape.running;
  check("2. G's extensions run in its stage (tabletop, seats, the keeper, carry), never in the room's or the boat's", ["a", "b", "c"].every((w) => run[w].game?.includes("tabletop") && run[w].game?.includes("seats")) && !run.a.outer.includes("tabletop") && !run.b.outer.includes("tabletop") && !run.b.outer.includes("seats") && run.b.outer.includes("sailing"), run);

  // 3. seated: Ana in the room, Ben aboard
  await P("pick('a', 'p1')");
  await P("pick('b', 'p2')");
  const seated = await until("seats().p1?.player === __p.people.a && __p.seats().p2?.player === __p.people.b && __p.body('a').id === 'seat' && __p.body('b').id === 'seat'", 4000);
  check("3. Ana sits as Player 1 in the room and Ben as Player 2 aboard, each in the seat body", seated, { seats: await P("seats()"), a: await P("body('a')"), b: await P("body('b')") });
  const heard = await until("hearsAll()", 3000);
  check("3. on G's channel each view hears the other two (one handle in one page: the page bus)", heard, { a: await P("presence('a')"), b: await P("presence('b')"), c: await P("presence('c')") });
  const claims = { c1: await P("claimedBy('c', 'p1')"), c2: await P("claimedBy('c', 'p2')"), a2: await P("claimedBy('a', 'p2')"), b1: await P("claimedBy('b', 'p1')") };
  const pres = { a: await P("presence('a')"), b: await P("presence('b')") };
  check("3. each seat's claim is held for everyone: Cara sees Ana at p1 and Ben at p2; Ana sees Ben's, Ben Ana's", claims.c1?.session === pres.a.mine && claims.c2?.session === pres.b.mine && claims.a2?.session === pres.b.mine && claims.b1?.session === pres.a.mine, claims);

  // 4. dealt
  const dealt = await holds("phase() === 'playing'", 60_000);
  check("4. the secure deck is shuffled between the two and dealt", dealt, { phase: await P("phase()") });
  const where0 = await P("where()");
  await holds(`faces('a').length >= ${where0.p1.length} && __p.faces('b').length >= ${where0.p2.length}`, 30_000);
  const faces = { a: await P("faces('a')"), b: await P("faces('b')"), c: await P("faces('c')") };
  report.numbers.dealt = { p1: where0.p1.length, p2: where0.p2.length, faces: { a: faces.a.length, b: faces.b.length, c: faces.c.length } };
  check("4. each sees their own hand's faces and not the other's; Cara, watching G alone, neither", where0.p1.length > 0 && where0.p2.length > 0 && where0.p1.every((id) => faces.a.includes(id)) && !where0.p2.some((id) => faces.a.includes(id)) && where0.p2.every((id) => faces.b.includes(id)) && !where0.p1.some((id) => faces.b.includes(id)) && !faces.c.some((id) => where0.p1.includes(id) || where0.p2.includes(id)), report.numbers.dealt);
  await shot("dealt");

  // 5. a turn each, as Lost Cities has it: play a card onto an expedition, then draw (a hand is full when dealt)
  const hand1 = (await P("where()")).p1;
  const aPlayed = hand1[0] ? await play("a", hand1[0], -0.17, 1) : null;
  if (aPlayed) {
    const inB = await P(`drawn(${J(hand1[0])}, 'b')`);
    const inC = await P(`drawn(${J(hand1[0])}, 'c')`);
    check("5. Ben and Cara see Ana's card on the column: Cara where G has it, Ben where the boat carries it", !!inB && !!inC && Math.hypot(inC.p[0] - aPlayed.local[0], inC.p[2] - aPlayed.local[2]) < 1e-3, { inB, inC, pose: aPlayed });
  }
  const aCard = await draw("a", "p1");
  if (aCard) {
    const seen = await until(`where().p1.includes(${J(aCard)}) && __p.drawn(${J(aCard)}, 'b') && __p.drawn(${J(aCard)}, 'c') && __p.faces('a').includes(${J(aCard)}) && !__p.faces('b').includes(${J(aCard)})`, 1000);
    check("5. Ben and Cara see Ana's draw land in her tray; its face is hers alone", seen || (await holds(`faces('a').includes(${J(aCard)})`, 20_000) && !(await P("faces('b')")).includes(aCard)), { b: await P(`drawn(${J(aCard)}, 'b')`), c: await P(`drawn(${J(aCard)}, 'c')`) });
  }
  const hand2 = (await P("where()")).p2;
  const bPlayed = hand2[0] ? await play("b", hand2[0], 0.17, -1) : null;
  if (bPlayed) {
    const inA = await P(`drawn(${J(hand2[0])}, 'a')`);
    const inC = await P(`drawn(${J(hand2[0])}, 'c')`);
    check("5. Ana and Cara see Ben's card on the column", !!inA && !!inC && Math.hypot(inC.p[0] - bPlayed.local[0], inC.p[2] - bPlayed.local[2]) < 1e-3, { inA, inC, pose: bPlayed });
  }
  await draw("b", "p2");
  await shot("played");

  // 6. heel: the boat's world runs
  await P("resume()");
  const lean = await P(`sampleLean(${J(ids.board)}, 8000)`, 120_000);
  report.numbers.lean = lean;
  check("6. aboard, G's table leans with the boat in Ben's view; in Ana's room and in Cara's view it stays level", lean.b > 0.05 && lean.a < 1e-6 && lean.c < 1e-6, lean);
  check("6. Ben's seat view rolls with the table (the camera's up is the table's); Ana's keeps the world's", lean.camOffTableB < 1e-6 && lean.camOffWorldA < 1e-9, lean);
  await shot("heeled");

  // 7.
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("7. no page errors", errors.length === 0, errors.slice(0, 10));
} catch (err) {
  check(`ran to the end: ${err?.message ?? err}`, false, String(err?.stack ?? err));
}
report.frames = await js("window.__time?.frames() ?? null").catch(() => null);
console.log(JSON.stringify(report, null, 1));
b.stop(list.failed ? 1 : 0);
