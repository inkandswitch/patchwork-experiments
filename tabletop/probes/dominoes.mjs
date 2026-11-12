// Draw Dominoes for two, by two people in headless Chrome, on real Automerge
// documents (each peer its own replica, merged 25 ms late).
//
//   (in scene/, tabletop/, card-table/ and keep/) pnpm build
//   node probes/dominoes.mjs [--shots <dir>] [--show] [--players 3|4]
//
// With --players 3 or 4 it starts that template and checks only the layout
// (28 tiles face down, a rack and a seat each, every tile a back to both
// views), and takes a picture: the rest needs every seat taken.
//
// Mounts the BUILT scene tool with the BUILT tabletop, card-table and keep
// plugins twice (dominoes-probe.html): A is Ana, B is Ben. With a real mouse
// and keyboard over CDP:
// - A clicks "Draw Dominoes, 2 players" on an empty scene's start screen; B
//   opens the scene; each takes a seat; their clients shuffle the 28 tiles
//   between them (the joint keeper);
// - A washes the boneyard (W over a face-down tile): the players reshuffle it
//   and it is laid out again, jumbled, still face down;
// - each draws 7 (D over a boneyard tile, in their own view): each tile
//   stands on edge in its drawer's rack, facing them; each sees their own
//   faces and the other's backs, never a veil;
// - A lays a tile flat (U) and carries it onto the felt, then another,
//   turned a quarter (Q twice while carried: a double, crosswise), and nudges
//   that one by hand until it lies flush against the first (gap within
//   1 mm), on the felt, not climbed onto it: both face up, and B sees their
//   faces;
// - B draws one more from the boneyard;
// - played without a rack: A carries a standing tile out of the rack onto
//   the felt, still standing, facing A; B stands a boneyard tile up on the
//   table with U, facing B; each sees their own standing tile's face and the
//   other's back, never a veil;
// - nothing is duplicated or lost: both replicas have the same 28 tiles on
//   28 different slots, every tile is somewhere, no face is seen twice, and
//   the two views agree on every face both see;
// - A lays their hand face up (right-click → Lay my hand face up), the tile
//   standing in front of the rack with it, and B sees every one of those
//   faces.
// Prints a JSON checklist and a timeline; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "card-table/dist/index.js", "keep/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const PLAYERS = Number(arg("--players") ?? 2);
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "tabletop-dominoes"));

const b = await browser({ root: ROOT, port: 4877, cdp: 9877, page: "/tabletop/probes/dominoes-probe.html", width: 1536, height: 610, show: process.argv.includes("--show"), timeout: 420_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
// (an expression that starts with a list or a bracket is whole already: it names __p itself)
const until = (expr, ms = 10_000) => b.waitFor(/^[[(]/.test(expr) ? expr : `window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `dominoes-${name}.png`)));
const J = JSON.stringify;
const same = (a, b) => J([...a].sort()) === J([...b].sort());

/** Hover object `id` in view `w` with the real mouse (once it's drawn where a pick hits it). */
async function hover(id, w) {
  await until(`aimAt(${J(id)}, ${J(w)})`, 8000);
  const at = await P(`aimAt(${J(id)}, ${J(w)})`);
  if (!at) return null;
  await b.move(at.x + 2, at.y + 1);
  await b.move(at.x, at.y);
  return (await until(`hovered(${J(w)}) === ${J(id)}`, 3000)) ? at : null;
}

/** View `w` draws one tile from the boneyard with D; the one drawn, or null. */
async function draw(w, seat) {
  const before = (await P("where()"))[seat].length;
  const down = (await P("where()")).down;
  for (const id of down) {
    if (!(await hover(id, w))) continue;
    await P(`focus(${J(w)})`);
    await b.key("d");
    if (await until(`where().${seat}.length === ${before + 1}`, 5000)) return id;
  }
  return null;
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const viewers = await P("viewers");

  // ── A starts the table from the start screen ──
  check("A's start screen offers Draw Dominoes for 2, 3 and 4", await until("['tabletop.dominoes-2', 'tabletop.dominoes-3', 'tabletop.dominoes-4'].every((t) => __p.templates('a').includes(t))", 20_000), await P("templates('a')"));
  // (the start screen lays itself out as the view's panels arrive: click once the button has stopped moving)
  let btn = null;
  let made = false;
  for (let attempt = 0; attempt < 3 && !made; attempt++) {
    await until(`templateAt('a', 'tabletop.dominoes-${PLAYERS}')`, 10_000);
    for (let k = 0; k < 40; k++) {
      const one = await P(`templateAt('a', 'tabletop.dominoes-${PLAYERS}')`);
      await sleep(250);
      btn = await P(`templateAt('a', 'tabletop.dominoes-${PLAYERS}')`);
      if (one && btn && one.x === btn.x && one.y === btn.y) break;
    }
    await b.click(btn.x, btn.y);
    mark("clicked the template", { attempt, btn });
    made = await until("census().a.n === 28 && __p.activity('a') === 'play'", attempt < 2 ? 20_000 : 60_000);
  }
  if (!made) await shot("no-table");
  check("a table of 28 tiles, in play", made, { census: await P("census()"), activity: await P("activity('a')"), notices: await P("notices('a')"), templates: await P("templates('a')"), btn, errors: await P("errors") });
  if (!made) throw new Error("no table");
  await P("openB()");
  check("B opens the same scene from its own replica, in play", await until("census().b.n === 28 && __p.activity('b') === 'play' && __p.census().same", 30_000), await P("census()"));
  const start = await P("where()");
  check("all 28 start face down on the table, none in a rack", start.down.length === 28 && !start.p1.length && !start.p2.length, start);
  check("every tile looks the same to both: its back", await until("backs('a').length === 28 && __p.backs('b').length === 28", 30_000), { a: (await P("backs('a')")).length, b: (await P("backs('b')")).length });
  await sleep(500);
  await shot(PLAYERS === 2 ? "start" : `start-${PLAYERS}`);
  if (PLAYERS !== 2) {
    check(`${PLAYERS} seats on the picker, ${PLAYERS} racks`, await until(`picker('a') === ${PLAYERS + 1}`, 20_000) && (await P("racks()")) === PLAYERS, { picker: await P("picker('a')"), racks: await P("racks()") });
    await P("camera('a', [0, 1.1, 0.0001], [0, 0, 0])");
    await sleep(800);
    await shot(`above-${PLAYERS}`);
    throw Object.assign(new Error("layout only"), { done: true });
  }

  // ── seats, and the players' first shuffle ──
  check("both views have the seat picker", await until("picker('a') === 3 && __p.picker('b') === 3", 20_000), { a: await P("picker('a')"), b: await P("picker('b')") });
  await P("pick('a', 'p1')");
  await P("pick('b', 'p2')");
  check("A in Player 1, B in Player 2", await until(`seats().p1.player === ${J(viewers.a)} && __p.seats().p2.player === ${J(viewers.b)}`, 10_000), await P("seats()"));
  mark("seated");
  const dealt = await until("shuffledAtLeast(1)", 180_000);
  mark("shuffled", await P("deck()"));
  const dk = await P("deck()");
  check("the players' clients shuffled all 28 between them, encrypted (two participants, every tile a 2048-bit ciphertext)", dealt && dk.participants === 2 && dk.cipherHex.every((n) => n >= 500), dk);

  // ── A washes the boneyard ──
  const bone = (await P("where()")).down[5];
  const at0 = Object.fromEntries(await Promise.all(start.down.map(async (id) => [id, J(await P(`transform(${J(id)})`))])));
  await shot("seated");
  check("A hovers a boneyard tile", !!(await hover(bone, "a")), { hovered: await P("hovered('a')"), debug: await P(`aimDebug(${J(bone)}, 'a')`) });
  check("the use prompt offers Wash (28) and Draw", await until("prompt('a').some((t) => /Wash \\(28\\)/.test(t)) && __p.prompt('a').some((t) => /Draw to my hand/.test(t))", 3000), await P("prompt('a')"));
  await shot("wash-prompt");
  await P("focus('a')");
  await b.key("w");
  mark("pressed W");
  const washed = await until("shuffledAtLeast(2)", 180_000);
  mark("washed", await P("deck()"));
  check("the players reshuffled all 28 between them (every tile's epoch went up)", washed, await P("deck()"));
  const afterWash = await P("where()");
  let moved = 0;
  for (const id of afterWash.down) if (J(await P(`transform(${J(id)})`)) !== at0[id]) moved++;
  check("…and they were swept about: laid out again, all still face down", afterWash.down.length === 28 && moved >= 20, { down: afterWash.down.length, moved });
  check("B is told Ana washed them", await until("notices('b').some((n) => /^Ana washed/.test(n))", 5000), await P("notices('b')"));

  // ── each draws seven ──
  const drawn = { a: [], b: [] };
  for (let i = 0; i < 7; i++) {
    drawn.a.push(await draw("a", "p1"));
    drawn.b.push(await draw("b", "p2"));
  }
  mark("drew 7 each");
  const racks = await P("where()");
  check("each drew 7 with D, into their own rack", racks.p1.length === 7 && racks.p2.length === 7 && racks.down.length === 14 && !drawn.a.includes(null) && !drawn.b.includes(null), { p1: racks.p1.length, p2: racks.p2.length, down: racks.down.length, drawn });
  const dirs = { p1: await Promise.all(racks.p1.map((id) => P(`faceDir(${J(id)})`))), p2: await Promise.all(racks.p2.map((id) => P(`faceDir(${J(id)})`))) };
  check("every drawn tile stands on edge facing its drawer", dirs.p1.every((d) => J(d) === J([0, 0, 1])) && dirs.p2.every((d) => J(d) === J([0, 0, -1])), dirs);
  const sees = `racks => racks.p1.every((id) => __p.faces('a').includes(id)) && racks.p2.every((id) => __p.faces('b').includes(id))`;
  check("each sees their own seven faces", await until(`(${sees})(${J(racks)})`, 60_000), { a: (await P("faces('a')")).length, b: (await P("faces('b')")).length });
  check("…and the other's seven as backs, with no veil anywhere", await until(`${J(racks.p2)}.every((id) => __p.backs('a').includes(id)) && ${J(racks.p1)}.every((id) => __p.backs('b').includes(id)) && __p.veils('a').length === 0 && __p.veils('b').length === 0`, 20_000), { veilsA: await P("veils('a')"), veilsB: await P("veils('b')") });
  check("nobody sees any boneyard tile's face", (await P("faces('a')")).every((id) => racks.p1.includes(id)) && (await P("faces('b')")).every((id) => racks.p2.includes(id)), { a: await P("faces('a')"), b: await P("faces('b')") });
  await sleep(400);
  await shot("hands");

  // ── A plays two tiles face up ──
  const played = [];
  for (const k of [0, 1]) {
    const id = racks.p1[k];
    // the first in the middle of the felt; the double crosswise, its side against the first's end (its middle half a tile's width, 12.5 mm, past that end)
    let spot = [0, 0.003, 0.1];
    if (k === 1) {
      const f1 = await P(`footprint(${J(played[0])})`);
      spot = [+(f1.max[0] + 0.0125).toFixed(5), 0.003, +((f1.min[2] + f1.max[2]) / 2).toFixed(5)];
    }
    check(`A hovers tile ${k + 1} in their rack, and the prompt offers Lay flat`, !!(await hover(id, "a")) && (await until("prompt('a').some((t) => /Lay flat/.test(t))", 3000)), await P("prompt('a')"));
    await P("focus('a')");
    await b.key("u");
    check(`U lays it flat, face up, still in the rack (still A's alone)`, await until(`faceDir(${J(id)})[1] === 1 && __p.where().p1.includes(${J(id)})`, 5000), await P(`faceDir(${J(id)})`));
    const from = await P(`aimAt(${J(id)}, 'a')`);
    const to = await P(`pointAt(${J(spot)}, 'a')`);
    const yaw0 = (await P(`transform(${J(id)})`)).rotation;
    // the second goes down turned a quarter (Q twice while carried): a double, crosswise
    await b.drag([from.x, from.y], [to.x, to.y], { steps: 16, beforeRelease: k === 1 ? async () => { await b.key("q"); await b.key("q"); await sleep(100); } : undefined, settle: 600 });
    const up = await until(`where().up.includes(${J(id)})`, 5000);
    const t = await P(`transform(${J(id)})`);
    check(`tile ${k + 1} lies face up on the felt`, up, { t, where: await P("where()") });
    // nothing snapped it anywhere: it went down where the pointer let go (the felt has no places; a rack's take only tiles, 2 cm round)
    const off = Math.hypot(t.position[0] - spot[0], t.position[2] - spot[2]);
    check(`…where it was let go (${(off * 1000).toFixed(1)} mm from the pointer's spot): nothing snapped it`, off < 0.015, { at: t.position, spot });
    if (k === 1) {
      const m0 = Math.atan2(Math.sin(yaw0[1]), Math.cos(yaw0[1]));
      // a quarter turn from how it lay, the short way, whichever way the Euler angles say it
      const fz = (r) => [Math.sin(r[1]), Math.cos(r[0]) * Math.cos(r[1])];
      const [a0, a1] = [fz(yaw0), fz(t.rotation)];
      const turn = Math.abs(a0[0] * a1[0] + a0[1] * a1[1]);
      check("…turned a quarter from how it came out of the rack, as Q twice asked", turn < 0.02, { before: yaw0, after: t.rotation, dot: turn, m0 });
      // butted up flush: nudged by hand (as a player does), each nudge by what the last one missed by
      const f1 = await P(`footprint(${J(played[0])})`);
      const tries = [];
      let aim = spot.slice();
      let f2 = await P(`footprint(${J(id)})`);
      for (let n = 0; n < 5; n++) {
        const gap = f2.min[0] - f1.max[0];
        tries.push({ gap: +(gap * 1000).toFixed(2), f2 });
        if (Math.abs(gap) <= 0.001) break;
        const mid = [(f2.min[0] + f2.max[0]) / 2, (f2.min[2] + f2.max[2]) / 2];
        aim = [aim[0] + (spot[0] - mid[0]), 0.003, aim[2] + (spot[2] - mid[1])];
        if (!(await hover(id, "a"))) break;
        const p0 = await P(`aimAt(${J(id)}, 'a')`);
        const p1 = await P(`pointAt(${J(aim)}, 'a')`);
        await b.drag([p0.x, p0.y], [p1.x, p1.y], { steps: 10, settle: 600 });
        f2 = await P(`footprint(${J(id)})`);
      }
      const gap = f2.min[0] - f1.max[0];
      const along = Math.min(f1.max[2], f2.max[2]) - Math.max(f1.min[2], f2.min[2]);
      check(`…and nudged flush against tile 1's end (${tries.length - 1} nudge(s)): ${(gap * 1000).toFixed(2)} mm apart, side by side, on the felt as tile 1 is, not climbed onto it`, Math.abs(gap) <= 0.001 && along >= 0.024 && Math.abs(f2.min[1] - f1.min[1]) < 0.0005 && (await P(`faceDir(${J(id)})`))[1] === 1, { f1, f2, tries });
    }
    played.push(id);
  }
  mark("played two");
  check("B sees both played tiles' faces", await until(`${J(played)}.every((id) => __p.faces('b').includes(id))`, 30_000), { faces: await P("faces('b')"), played });
  check("…and A does", await until(`${J(played)}.every((id) => __p.faces('a').includes(id))`, 10_000), await P("faces('a')"));
  await sleep(400);
  await shot("played");

  // ── B draws from the boneyard ──
  const bDraw = await draw("b", "p2");
  check("B draws one more from the boneyard (D)", !!bDraw && (await P("where()")).p2.length === 8 && (await P("where()")).down.length === 13, await P("where()"));
  check("…B sees its face, A its back", await until(`faces('b').includes(${J(bDraw)}) && __p.backs('a').includes(${J(bDraw)})`, 30_000), { a: await P(`backs('a').includes(${J(bDraw)})`), b: await P(`faces('b').includes(${J(bDraw)})`) });

  // ── played without a rack: tiles standing on the table, facing their players ──
  const standA = racks.p1[2];
  check("A hovers a standing tile in their rack", !!(await hover(standA, "a")), await P("hovered('a')"));
  {
    const p0 = await P(`aimAt(${J(standA)}, 'a')`);
    const p1 = await P("pointAt([0.05, 0.003, 0.27], 'a')");
    await b.drag([p0.x, p0.y], [p1.x, p1.y], { steps: 16, settle: 600 });
  }
  const dA = await P(`faceDir(${J(standA)})`);
  check("A carries it out onto the felt in front of the rack: it goes down still standing, its face level and toward A", (await until(`where().stand.includes(${J(standA)})`, 5000)) && dA[1] === 0 && dA[2] > 0.9, { dir: dA, where: await P("where()"), at: await P(`transform(${J(standA)})`) });
  check("…A still sees its face, B its back, no veil", await until(`faces('a').includes(${J(standA)}) && __p.backs('b').includes(${J(standA)}) && __p.veils('a').length === 0 && __p.veils('b').length === 0`, 20_000), { a: await P(`faces('a').includes(${J(standA)})`), b: await P(`backs('b').includes(${J(standA)})`), veilsA: await P("veils('a')"), veilsB: await P("veils('b')") });
  const standB = (await P("where()")).down[0];
  check("B hovers a boneyard tile, and the prompt offers Stand on edge", !!(await hover(standB, "b")) && (await until("prompt('b').some((t) => /Stand on edge/.test(t))", 3000)), await P("prompt('b')"));
  await P("focus('b')");
  await b.key("u");
  check("U stands it up on the table where it lay, its face level and toward B", await until(`where().stand.includes(${J(standB)}) && __p.faceDir(${J(standB)})[1] === 0 && __p.faceDir(${J(standB)})[2] < -0.7`, 5000), { dir: await P(`faceDir(${J(standB)})`), where: await P("where()") });
  check("…B sees its face (the keys handed over), A its back, no veil", await until(`faces('b').includes(${J(standB)}) && __p.backs('a').includes(${J(standB)}) && __p.veils('a').length === 0 && __p.veils('b').length === 0`, 30_000), { a: await P(`backs('a').includes(${J(standB)})`), b: await P(`faces('b').includes(${J(standB)})`) });
  mark("stood two on the table");
  await sleep(400);
  await shot("standing");

  // ── nothing duplicated or lost ──
  const census = await P("census()");
  const where = await P("where()");
  // (the deck's public list of what there is never changes, so it proves nothing here: the 28 tiles' 28 different slots, and no face seen twice below, do)
  check("both replicas have the same 28 tiles, bound to 28 different slots", census.same && census.a.n === 28 && census.b.n === 28 && census.a.slots === 28 && census.b.slots === 28, census);
  check("every tile is somewhere: 4 in A's rack, 8 in B's, 2 face up, 2 standing on the table, 12 face down", where.p1.length === 4 && where.p2.length === 8 && where.up.length === 2 && where.stand.length === 2 && where.down.length === 12 && !where.other.length, where);
  const seenA = await P("seen('a')");
  const seenB = await P("seen('b')");
  const both = Object.keys(seenA).filter((id) => id in seenB);
  check("no face is seen twice: every face each view sees is a different tile", new Set(Object.values(seenA)).size === Object.keys(seenA).length && new Set(Object.values(seenB)).size === Object.keys(seenB).length, { seenA, seenB });
  check("the two views agree on every face both see (the played ones)", both.length === 2 && both.every((id) => seenA[id] === seenB[id]), { both: both.map((id) => [seenA[id], seenB[id]]) });

  // ── A lays their hand face up ──
  const handA = [...where.p1, standA];
  let tileA = null;
  for (const id of where.p1) if (await hover(id, "a")) { tileA = id; break; }
  check("A hovers a tile of theirs", !!tileA, { handA, debug: await P(`aimDebug(${J(handA[0])}, 'a')`), hovered: await P("hovered('a')") });
  const at = await P(`aimAt(${J(tileA)}, 'a')`);
  await b.click(at.x, at.y, { button: "right" });
  check("the right-click menu offers Lay my hand face up (5)", await until("menu('a').some((m) => m.text.includes('Lay my hand face up (5)'))", 3000), await P("menu('a')"));
  const item = (await P("menu('a')")).find((m) => m.text.includes("Lay my hand face up"));
  await b.click(item.x, item.y);
  mark("laid hand face up");
  check("A's rack is empty: its four tiles and the one standing in front of it lie face up in front of it", await until(`where().p1.length === 0 && ${J(handA)}.every((id) => __p.where().up.includes(id))`, 5000), await P("where()"));
  check("B sees every one of A's five faces", await until(`${J(handA)}.every((id) => __p.faces('b').includes(id))`, 30_000), { faces: await P("faces('b')"), handA });
  const seenB2 = await P("seen('b')");
  const seenA2 = await P("seen('a')");
  check("…as A sees them, and all different", handA.every((id) => seenB2[id] && seenB2[id] === seenA2[id]) && new Set(handA.map((id) => seenB2[id])).size === 5, handA.map((id) => [seenA2[id], seenB2[id]]));
  check("B is told", await until("notices('b').some((n) => /^Ana laid 5 dominoes face up/.test(n))", 5000), await P("notices('b')"));
  const handB = [...(await P("where()")).p2, standB];
  check("B's own hand, and the tile standing facing B, are still B's alone: A sees their backs", await until(`${J(handB)}.every((id) => __p.backs('a').includes(id))`, 5000), await P("backs('a')"));
  await sleep(500);
  await shot("end");
  // close-ups: B's view over A's laid-out hand; A's view over B's rack (backs)
  await P("camera('b', [0, 0.3, 0.05], [0, 0, 0.34])");
  await P("camera('a', [0, 0.22, -0.2], [0, 0.02, -0.42])");
  await sleep(800);
  await shot("closeups");

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  if (!err?.done) check("ran to the end", false, String(err?.stack ?? err));
}
report.elapsed = +((Date.now() - t0) / 1000).toFixed(1);
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
