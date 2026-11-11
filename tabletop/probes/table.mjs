// The table's verbs, card slots, a dropped deck and the parts bin's pawn, by
// two people in headless Chrome. (Dice are the dice package's: dice/probes/dice.mjs.)
//
//   (in scene/, tabletop/ and card-table/) pnpm build
//   node probes/table.mjs [--shots <dir>] [--show]
//
// Mounts the BUILT scene tool with the BUILT tabletop and card-table plugins
// on a Lost Cities table with a plain deck, twice on one doc (A is Ana in
// Player 1, B is Ben in Player 2; table-probe.html). Then:
// - verbs: hovering the deck, A's use prompt offers Flip and Shuffle; S
//   shuffles, and B is told "Ana shuffled the deck (N)";
// - card slots: a card carried near a free slot of A's tray squares onto it;
// - edit: the parts bin offers the Tabletop parts; a pawn dragged out lands
//   where it was dropped, its art one file; a secure deck dropped on open
//   table stacks at the point, and one dropped near an empty discard slot
//   squares onto it;
// - play again: the pawn (no tags) carried near a free tray slot does not
//   snap to it.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "card-table/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "tabletop-table"));

const b = await browser({ root: ROOT, port: 4773, cdp: 9773, page: "/tabletop/probes/table-probe.html", width: 1416, height: 530, show: process.argv.includes("--show"), timeout: 240_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `table-${name}.png`)));
const J = JSON.stringify;
const plan = (a, c) => Math.hypot(a[0] - c[0], a[2] - c[2]);
const ids = async () => Object.keys((await P("doc()")).objects);
const towards = ([ax, ay], [bx, by], n = 6) => Array.from({ length: n }, (_, i) => [Math.round(ax + ((bx - ax) * (i + 1)) / n), Math.round(ay + ((by - ay) * (i + 1)) / n)]);
const click = async (r) => r && b.click(r.x, r.y);
const looks = {};
const snapLooks = async (when) => (looks[when] = { a: await P("handLooks('a')"), b: await P("handLooks('b')") });
report.looks = looks;

/** a world point near `p` (plan offsets to try) that's on screen in A's view and over nothing but the ground */
async function groundNear(p, tries) {
  for (const [dx, dz] of tries) {
    const q = [p[0] + dx, 0, p[2] + dz];
    const s = await P(`screen(${J(q)}, 'a')`);
    if (!s?.visible) continue;
    const hit = await P(`pickAt(${s.x}, ${s.y}, 'a')`);
    if (hit && hit.id == null) return { world: q, page: { x: Math.round(s.x), y: Math.round(s.y) }, hit };
  }
  return null;
}
/** wait until A's camera has stopped moving */
async function settled(ms = 8000) {
  const t = Date.now();
  let last = null;
  while (Date.now() - t < ms) {
    const c = J(await P("camera('a')"));
    if (c === last) return true;
    last = c;
    await sleep(250);
  }
  return false;
}
/** drag a part out of A's bin to a page point; the new object's id */
async function dragPart(part, to) {
  const before = new Set(await ids());
  const from = await P(`rect('.part[data-part="${part}"]')`);
  const c = await P("canvas('a')");
  const entry = [Math.round(c.x + c.w - 40), Math.round(c.y + c.h / 2)];
  await b.htmlDrag([from.x, from.y], [entry, ...towards(entry, [to.x, to.y], 6)]);
  await sleep(400);
  return (await ids()).filter((id) => !before.has(id));
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const viewers = await P("viewers");
  check("both views playing", await until("activity('a') === 'play' && __p.activity('b') === 'play' && __p.picker('a') === 3 && __p.picker('b') === 3"));
  await P("pick('a', 'p1')");
  await P("pick('b', 'p2')");
  check("A in Player 1, B in Player 2", await until(`seats().p1.player === ${J(viewers.a)} && __p.seats().p2.player === ${J(viewers.b)}`), await P("seats()"));
  mark("seated");
  const tray = await P("zoneObj('p1')");
  const board = await P("board()");
  check("the table's pieces load", await until(`loaded(${J(tray)}) && __p.loaded(${J(board)})`, 30_000));

  check("each player sees the faces of their own hand", await until("faces('a').length >= 8 && __p.faces('b').length >= 8", 15_000), { a: await P("faces('a')"), b: await P("faces('b')") });
  await snapLooks("seated");
  // ── verbs on the use prompt; S tells the others ──
  {
    const pile = await P("pile()");
    const deck0 = await P("deckDoc()");
    await until(`aimAt(${J(pile[0])}, 'a')`, 30_000);
    const at = await P(`aimAt(${J(pile[0])}, 'a')`);
    await b.move(at.x, at.y);
    check("A hovers the deck's top card", await until(`hovered('a') === ${J(pile[0])}`, 3000), await P("hovered('a')"));
    const ok = await until("prompt('a').some((t) => /Flip/.test(t)) && __p.prompt('a').some((t) => /Shuffle/.test(t))", 3000);
    check("the use prompt offers Flip and Shuffle", ok, await P("prompt('a')"));
    await shot("1-prompt");
    check("A's view has the keyboard", await P("focus('a')"));
    await b.key("s");
    mark("pressed S");
    await sleep(500);
    await snapLooks("shuffled");
    check("A is told it's shuffling", await until("notices('a').some((n) => /^Shuffling \\d+ cards/.test(n))", 3000), await P("notices('a')"));
    check("B is told Ana shuffled the deck", await until(`notices('b').includes('Ana shuffled the deck (${pile.length})')`, 3000), await P("notices('b')"));
    const deck1 = await P("deckDoc()");
    const names = (d) => Object.values(d.objects ?? {}).map((o) => `${o.sourceUrl}|${o.name}`).sort();
    check("the plain deck's cards are the same cards, in another order", J(names(deck0)) === J(names(deck1)) && J(deck0.objects) !== J(deck1.objects), { before: Object.keys(deck0.objects ?? {}).length, after: Object.keys(deck1.objects ?? {}).length });
  }

  // ── a card carried near a free slot of A's tray squares onto it ──
  let free = [];
  {
    const slots = await P(`slots(${J(tray)})`);
    const where = await P("where()");
    const taken = await Promise.all(where.p1.map((id) => P(`worldPos(${J(id)})`)));
    free = slots.filter((s) => s.tags.includes("card") && !taken.some((p) => plan(p, s.world) < 0.01));
    report.free = free.map((s) => s.i);
    check("A's tray has card slots, some free", slots.length === 10 && free.length >= 2, { slots: slots.length, free: report.free });
    const target = free.at(-1);
    const near = [target.world[0] + 0.012, target.world[1], target.world[2] + 0.006];
    const card = (await P("pile()"))[0];
    const from = await P(`aimAt(${J(card)}, 'a')`);
    const to = await P(`screen(${J(near)}, 'a')`);
    await b.drag([from.x, from.y], [to.x, to.y], { steps: 14, settle: 500 });
    const pos = await P(`worldPos(${J(card)})`);
    const yaw = await P(`worldYaw(${J(card)})`);
    const dy = target.yaw == null ? 0 : Math.abs(Math.atan2(Math.sin(yaw - target.yaw), Math.cos(yaw - target.yaw)));
    check("a card carried 1.3 cm off a free tray slot lands squarely on it", plan(pos, target.world) < 1e-3 && dy < 1e-3, { slot: target, pos, yaw });
    check("…in Player 1's hand", (await P("where()")).p1.includes(card));
    await shot("2-card-snapped");
  }

  await snapLooks("card snapped");
  // ── editing: the parts bin, R, and a dropped deck ──
  await click(await P(`rect('.activity-option[data-activity="edit"]')`));
  check("A switches to Edit", await until("activity('a') === 'edit' && __p.running('a').includes('scene.parts')", 6000), await P("running('a')"));
  // the camera eases to the editor's view: let it stop before aiming at the ground
  await settled();
  const bin = await P("binParts('a')");
  check("the bin offers the Tabletop parts", J(bin) === J(["tabletop.pawn", "tabletop.token", "tabletop.card-spot", "tabletop.table", "tabletop.lost-cities"]), bin);
  const boardBox = await P(`slots(${J(board)})`);
  const xs = boardBox.map((s) => s.world[0]), zs = boardBox.map((s) => s.world[2]);
  const mid = [(Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2];
  const span = Math.max(...xs) - Math.min(...xs);
  const offsets = [];
  for (const dz of [0, 0.05, -0.05, 0.1, -0.1]) for (const dx of [0.6, -0.6, 0.7, -0.7, 0.5, -0.5, 0.8, -0.8]) offsets.push([dx * span, dz]);
  const g1 = await groundNear(mid, offsets);
  const g2 = g1 && (await groundNear([g1.world[0], 0, g1.world[2]], [[0, 0.06], [0, -0.06], [0.06, 0], [-0.06, 0], [0, 0.1], [0, -0.1]]));
  // the deck goes on the board's other side, so it hides neither piece from A's seat
  const g3 = g2 && (await groundNear([2 * mid[0] - g1.world[0], 0, g1.world[2]], [[0, 0], [0, 0.05], [0, -0.05], [0.05, 0], [-0.05, 0], [0.1, 0], [-0.1, 0]]));
  check("open table in A's view to put things on", !!(g1 && g2 && g3), { g1, g2, g3 });
  g2.hit = await P(`pickAt(${g2.page.x}, ${g2.page.y}, 'a')`);
  const [pawnId] = await dragPart("tabletop.pawn", g2.page);
  {
    const d = await P("doc()");
    const pawn = d.objects[pawnId];
    report.pawn = pawnId;
    check("a pawn dragged out lands where it was dropped, on nothing, with no tags and no traits", pawn && pawn.parent == null && !pawn.tags?.length && !Object.keys(pawn.traits ?? {}).length && plan(pawn.transform.position, g2.hit.point) < 2e-3, { pawn, at: g2.hit.point });
    check("its art is one file under its versioned key", d.assets?.["tabletop/pawn@1"]?.url === pawn?.sourceUrl, Object.keys(d.assets ?? {}));
    check("no part made or changed a seat", J(Object.keys(d.traits["tabletop.seats"])) === J(["p1", "p2"]));
  }
  await until(`loaded(${J(pawnId)})`, 15_000);
  await shot("3-parts");
  {
    // a secure deck dropped on open table, then near an empty discard slot
    const loose = await P("looseDeck");
    await settled();
    g3.hit = await P(`pickAt(${g3.page.x}, ${g3.page.y}, 'a')`);
    const before = new Set(await ids());
    await P(`dropUrl('a', ${J(loose)}, ${g3.page.x}, ${g3.page.y})`);
    await until(`Object.keys(doc().objects).length > ${before.size}`, 6000);
    await sleep(200);
    const d = await P("doc()");
    const added = Object.keys(d.objects).filter((id) => !before.has(id));
    const cards = added.filter((id) => d.objects[id].traits?.["tabletop.hidden"]);
    const xz = cards.map((id) => d.objects[id].transform.position);
    check("a secure deck dropped on open table stacks at the drop point, face down, tagged card", cards.length === 60 && xz.every((p) => plan(p, g3.hit.point) < 2e-3) && cards.every((id) => J(d.objects[id].tags) === '["card"]' && Math.abs(d.objects[id].transform.rotation[2] - Math.PI) < 1e-6), { n: cards.length, at: g3.hit.point, first: xz[0] });
    report.dropped1 = { n: cards.length, at: g3.hit.point, first: xz[0] };
    // undo that one (the deck is bound now), and drop a fresh copy near a discard slot
    await settled();
    const slots = await P(`slots(${J(board)})`);
    const discard = slots.filter((s) => s.tags.includes("card") && Math.abs(s.world[2]) < 1e-3 && Math.abs(s.world[0] - 0.3) > 0.01);
    const target = discard[1] ?? discard[0];
    const near = [target.world[0] + 0.008, target.world[1], target.world[2] + 0.01];
    const s = await P(`screen(${J(near)}, 'a')`);
    const hit = await P(`pickAt(${s.x}, ${s.y}, 'a')`);
    const second = await js(`(async () => { const h = await window.repo.find(window.__p.looseDeck); const d = JSON.parse(JSON.stringify(h.doc())); d.slots = {}; return (await window.repo.create2(d)).url; })()`);
    const before2 = new Set(await ids());
    await P(`dropUrl('a', ${J(second)}, ${s.x}, ${s.y})`);
    await until(`Object.keys(doc().objects).length > ${before2.size}`, 6000);
    await sleep(200);
    const d2 = await P("doc()");
    const cards2 = Object.keys(d2.objects).filter((id) => !before2.has(id) && d2.objects[id].traits?.["tabletop.hidden"]);
    const p2 = cards2.map((id) => d2.objects[id].transform);
    const yawOk = target.yaw == null ? true : p2.every((t) => Math.abs(Math.atan2(Math.sin(t.rotation[1] - target.yaw), Math.cos(t.rotation[1] - target.yaw))) < 1e-3);
    check("a deck dropped 1.3 cm off an empty discard slot squares onto it", hit?.id === board && cards2.length === 60 && p2.every((t) => plan(t.position, target.world) < 1e-3) && yawOk, { hit, slot: target, first: p2[0] });
    await shot("4-dropped-decks");
    await sleep(500);
    await snapLooks("decks dropped");
  }

  // ── play again: the pawn won't take a card slot ──
  await click(await P(`rect('.activity-option[data-activity="play"]')`));
  check("A back in play", await until("activity('a') === 'play' && !__p.running('a').includes('scene.parts')", 6000), await P("running('a')"));
  await settled();
  await snapLooks("back in play");
  const same = (x, y) => Object.keys(x).every((id) => !(id in y) || x[id] === y[id]);
  check("the hands keep their faces throughout (a shuffle of the pile, dropped decks, edit and back)", ["shuffled", "card snapped", "decks dropped", "back in play"].every((k) => same(looks.seated.a, looks[k].a) && same(looks.seated.b, looks[k].b)), Object.fromEntries(Object.entries(looks).map(([k, v]) => [k, v])));
  check("…with the hand as the tool", (await P("tool('a')")) == null || (await P("tool('a')")) === "hand", { tool: await P("tool('a')") });
  await sleep(400);
  {
    const target = free[0];
    const near = [target.world[0] + 0.012, target.world[1], target.world[2] + 0.006];
    await until(`aimAt(${J(pawnId)}, 'a')`, 5000);
    const from = await P(`aimAt(${J(pawnId)}, 'a')`);
    const to = await P(`screen(${J(near)}, 'a')`);
    if (!from || !to) { await shot("5-pawn-missing"); throw new Error(`pawn ${J(from)} → ${J(to)}; pawn at ${J(await P(`worldPos(${J(pawnId)})`))}, shown ${J(await P(`shown(${J(pawnId)}, 'a')`))}`); }
    await b.drag([from.x, from.y], [to.x, to.y], { steps: 14, settle: 500 });
    const pos = await P(`worldPos(${J(pawnId)})`);
    check("the pawn carried as near a free tray slot stays where it was put (no tag, no card slot)", pos && plan(pos, target.world) > 5e-3 && plan(pos, near) < 0.015, { pos, slot: target.world, near });
    await shot("5-pawn-not-snapped");
  }

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
