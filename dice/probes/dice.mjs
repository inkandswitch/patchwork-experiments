// Dice in a scene, by two people in headless Chrome.
//
//   (in scene/ and dice/) pnpm build
//   node probes/dice.mjs [--shots <dir>] [--show]
//
// Mounts the BUILT scene tool with the BUILT dice plugins, twice, on REAL
// Automerge documents (A is Ana, B is Ben, each with its own replica, a
// change reaching the other 25 ms later; dice-probe.html), at a scene holding
// one tilted table. Real keys and a real mouse over CDP. Then:
// - edit: the parts bin offers the Dice parts; a d20 dragged onto the table
//   is a new die doc, built at real size by the scene's own render pipeline
//   in both views, lying on the table; a plus/minus die DOC dropped on the
//   ground becomes a die too; a percentile pair lands as two dice in a group;
//   R over a die is the gizmo's Rotate, not a roll;
// - the die's own panel: selecting the d20, the inspector's "Edit die" docks
//   its 2D tool beside the scene; naming a face there rebuilds the die, and
//   both views' built content says the new name;
// - play: R over the d20 rolls it. Every roll is drawn by lots between the
//   clients here: R puts the die in the air at once (a pose, drawn by both
//   views within a frame or two of the key), it tumbles until the draw is
//   known, then lands in one write; the seed is checked here, with WebCrypto,
//   to be the hash of both clients' openings, and the face to be the one that
//   seed lands; both views draw that face up, flat on the tilted table, and B
//   is told "Ana rolled N" from the doc; the same for the symbol die; T turns
//   the d20 to its next face, told as a turn; G over one of the pair rolls
//   both: ONE draw, on the first die, of both in order, landing in one write
//   and told in one line; then B leaves and A rolls alone: a draw of one
//   member, drawn at once.
// Measures press-to-in-the-air and press-to-landed for each roll (this page's
// clock, from the keydown to the frame / the doc write).
// Prints a JSON checklist (and the d20 roll as a sampled trajectory); exits
// non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["dice/dist/index.js", "scene/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "dice-probe"));

const b = await browser({ root: ROOT, port: 4791, cdp: 9791, page: "/dice/probes/dice-probe.html", width: 1816, height: 630, show: process.argv.includes("--show"), timeout: 240_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [], timings: {} };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `dice-${name}.png`)));
const J = JSON.stringify;
const plan = (a, c) => Math.hypot(a[0] - c[0], a[2] - c[2]);
const ids = async () => Object.keys((await P("doc()")).objects);
const towards = ([ax, ay], [bx, by], n = 6) => Array.from({ length: n }, (_, i) => [Math.round(ax + ((bx - ax) * (i + 1)) / n), Math.round(ay + ((by - ay) * (i + 1)) / n)]);
const click = async (r) => r && b.click(r.x, r.y);
const near = (a, c, eps) => a && c && a.length === c.length && a.every((v, i) => Math.abs(v - c[i]) < eps);

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
/** drag a part out of A's bin to a page point; the new objects' ids */
async function dragPart(part, to) {
  const before = new Set(await ids());
  const from = await P(`rect('.part[data-part="${part}"]')`);
  const c = await P("canvas('a')");
  const entry = [Math.round(c.x + c.w - 40), Math.round(c.y + c.h / 2)];
  await b.htmlDrag([from.x, from.y], [entry, ...towards(entry, [to.x, to.y], 6)]);
  await sleep(500);
  return (await ids()).filter((id) => !before.has(id));
}
/** a world point near `p` that's on screen in A's view and over nothing but the ground */
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
/** hover a die in A, press a key over it; the notices each view had before */
async function pressOver(id, key) {
  await until(`aimAt(${J(id)}, 'a')`, 5000);
  const at = await P(`aimAt(${J(id)}, 'a')`);
  await b.move(at.x + 1, at.y + 1);
  await b.move(at.x, at.y);
  const hovering = await until(`hovered('a') === ${J(id)}`, 3000);
  const prompt = await P("prompt('a')");
  await P("focus('a')");
  const before = { a: (await P("notices('a')")).length, b: (await P("notices('b')")).length, writes: (await P("writes()")).length };
  await b.key(key);
  return { hovering, prompt, before };
}
/** what both views draw for a die, once nothing holds it */
async function drawn(id) {
  const sa = await P(`dieShows(${J(id)}, 'a')`), sb = await P(`dieShows(${J(id)}, 'b')`);
  const ma = await P(`shown(${J(id)}, 'a')`), mb = await P(`shown(${J(id)}, 'b')`);
  return { a: sa, b: sb, same: near(ma, mb, 1e-5), lies: { a: await P(`lies(${J(id)}, 'a')`), b: await P(`lies(${J(id)}, 'b')`) } };
}
/** When a key's throw went into the air (in both views) and when it landed: ms after the keydown. */
async function timing(key, id) {
  const k = await P(`pressedAt(${J(key)})`);
  const landed = await until(`movedAt(${J(id)}, ${k})`, 20_000);
  return { landedMs: landed ? Math.round((await P(`movedAt(${J(id)}, ${k})`)) - k) : null };
}
/** The draw of a throw led by `lead`: in the doc, as each view's lots know it, and as worked out here from its openings. */
async function drawOf(lead) {
  return { round: await P(`round(${J(lead)})`), a: await P(`lots(${J(lead)}, 'a')`), b: await P(`lots(${J(lead)}, 'b')`), mine: await P(`seedFromOpenings(${J(lead)})`) };
}
/** flat on its parent at `height`: nothing below, and at least three corners on it */
const flatAt = (lies, height) => !!lies && lies[0] > height - 2e-5 && lies.filter((y) => Math.abs(y - height) < 2e-5).length >= 3;

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const TOP = await P("TOP");
  const V = await P("viewers");
  check("both views editing, the table loaded", await until("activity('a') === 'edit' && __p.activity('b') === 'edit' && __p.loaded('table', 'a') && __p.loaded('table', 'b')", 30_000));
  check("with no die in the scene the dice extension isn't running, and only Edit is on offer", !(await P("running('a')")).includes("dice") && J(await P("available('a')")) === J(["edit"]), { running: await P("running('a')"), available: await P("available('a')") });
  await settled();

  // ── the parts bin ──
  const bin = await P("binParts('a')");
  check("the bin offers the Dice parts, then a cup and a pool", J(bin) === J(["dice.die", "dice.d4", "dice.d8", "dice.d10", "dice.percentile", "dice.d12", "dice.d20", "dice.coin", "dice.plus-minus", "dice.doubling", "dice.cup", "dice.pool"]), bin);

  // a d20 dragged onto the table
  let d20;
  {
    const world = await P("onTable(0.05, 0.03)");
    const s = await P(`screen(${J(world)}, 'a')`);
    const hit = await P(`pickAt(${s.x}, ${s.y}, 'a')`);
    check("the spot on the table is in A's view", s.visible && hit?.id === "table", { s, hit });
    [d20] = await dragPart("dice.d20", s);
    const d = await P("doc()");
    const o = d.objects[d20];
    report.d20 = d20;
    check("a d20 dragged onto the table is a die on it: built by the dice source, its own doc, the trait, under the table, square to it", !!o && o.providerId === "die" && !!o.renderUrl && o.parent === "table" && J(o.traits) === J({ "dice.die": {} }) && o.transform.rotation[0] === 0 && o.transform.rotation[2] === 0 && Math.abs(o.transform.position[1] - TOP) < 1e-3, o);
    const src = await js(`(async () => (await window.repo.find(${J(o?.sourceUrl)})).doc())()`);
    check("…its source is a new die doc: a d20, 20 mm, twenty faces", src?.["@patchwork"]?.type === "die" && src.shape === "d20" && src.size === 0.02 && src.faces.length === 20, { type: src?.["@patchwork"], shape: src?.shape });
    check("the scene builds it in both views, and each view's built content says what it is", await until(`built(${J(d20)}, 'a')?.labels.length === 20 && __p.built(${J(d20)}, 'b')?.labels.length === 20`, 30_000), { a: await P(`status(${J(d20)}, 'a')`), b: await P(`status(${J(d20)}, 'b')`) });
    const first = await drawn(d20);
    check("as put down it shows 1 in both views, flat on the tilted table", first.a?.label === "1" && first.b?.label === "1" && flatAt(first.lies.a, TOP) && flatAt(first.lies.b, TOP), first);
    check("the dice extension now runs in both views, and Play is on offer", (await P("running('a')")).includes("dice") && (await P("running('b')")).includes("dice") && (await P("available('a')")).includes("play"), await P("available('a')"));
    check("the scene lists nothing it can't load (the probe's plugins come from a dev server: no package URL)", J((await P("doc()")).packages) === "[]", (await P("doc()")).packages);
  }
  mark("d20 on the table");

  // a die doc dropped on the ground
  const table = await P("onTable(0, 0)");
  const offsets = [];
  for (const dz of [0.25, 0.3, 0.2, 0.35, -0.3]) for (const dx of [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3]) offsets.push([dx, dz]);
  let sym;
  {
    const g = await groundNear(table, offsets);
    check("open ground in A's view", !!g, g);
    const before = new Set(await ids());
    await P(`dropUrl('a', ${J(await P("symbolDie"))}, ${g.page.x}, ${g.page.y})`);
    await until(`Object.keys(doc().objects).length > ${before.size}`, 6000);
    [sym] = (await ids()).filter((id) => !before.has(id));
    const o = (await P("doc()")).objects[sym];
    report.symbol = sym;
    check("a die doc dropped on the ground becomes a die there: the dropped doc itself, built by the dice source, the trait, where it was dropped, selected", !!o && o.sourceUrl === (await P("symbolDie")) && o.providerId === "die" && J(o.traits) === J({ "dice.die": {} }) && o.parent == null && plan(o.transform.position, g.hit.point) < 2e-3 && (await P("selected('a')")) === sym, { o, at: g.hit.point });
    check("…and is built in both views as a plus/minus die", await until(`built(${J(sym)}, 'a')?.labels.join() === 'plus,minus,blank,minus,blank,plus' && __p.built(${J(sym)}, 'b')?.labels.join() === 'plus,minus,blank,minus,blank,plus'`, 30_000), await P(`built(${J(sym)}, 'a')`));
  }
  // a percentile pair
  let pair, pairGroup;
  {
    const o = (await P("doc()")).objects[sym];
    const g = await groundNear(o.transform.position, [[0.15, 0], [-0.15, 0], [0.2, 0.05], [-0.2, 0.05], [0.12, -0.08], [-0.12, -0.08], [0.25, 0], [-0.25, 0]]);
    check("more open ground", !!g, g);
    const made = await dragPart("dice.percentile", g.page);
    const d = await P("doc()");
    pairGroup = made.find((id) => d.objects[id].kind === "group");
    pair = made.filter((id) => d.objects[id].kind !== "group");
    report.pair = pair;
    check("percentile dice dragged out are two dice, each its own doc, filed in one new group, and the group is selected", made.length === 3 && !!pairGroup && pair.length === 2 && pair.every((id) => d.objects[id].group === pairGroup && d.objects[id].traits?.["dice.die"]) && d.objects[pair[0]].sourceUrl !== d.objects[pair[1]].sourceUrl && (await P("selected('a')")) === pairGroup, { made, selected: await P("selected('a')") });
    check("…built in both views: a tens d10 and a d10", await until(`built(${J(pair[0])}, 'b')?.labels.includes('00') && __p.built(${J(pair[1])}, 'b')?.labels.includes('0') && __p.built(${J(pair[0])}, 'a') && __p.built(${J(pair[1])}, 'a')`, 30_000), { a: await P(`built(${J(pair[0])}, 'a')`), b: await P(`built(${J(pair[1])}, 'a')`) });
  }
  await shot("1-dice-out");

  // ── R while editing is Rotate ──
  {
    const t = await P(`transform(${J(d20)})`);
    const { hovering } = await pressOver(d20, "r");
    await sleep(900);
    check("R over a die while editing is the gizmo's Rotate: the tool changes, the die doesn't, nothing is told", hovering && (await P("tool('a')")) === "rotate" && J(await P(`transform(${J(d20)})`)) === J(t) && !(await P("notices('a')")).some((n) => /rolled/.test(n)), { tool: await P("tool('a')"), notices: await P("notices('a')") });
    await b.key("Escape");
  }

  // ── the die's own panel, docked beside the scene ──
  {
    const at = await P(`aimAt(${J(d20)}, 'a')`);
    await b.click(at.x, at.y);
    check("clicking the d20 selects it", await until(`selected('a') === ${J(d20)}`, 3000), await P("selected('a')"));
    const button = await until(`rect('button[data-ext="dice"][data-command="open"]')`, 4000);
    check("the inspector offers Edit die", !!button && (await P(`text('button[data-ext="dice"][data-command="open"]')`)) === "Edit die", await P(`text('button[data-ext="dice"][data-command="open"]')`));
    const canvas0 = await P("canvas('a')");
    await click(await P(`rect('button[data-ext="dice"][data-command="open"]')`));
    check("it docks the die's 2D tool beside the scene: twenty faces, in A's view only", await until("count('.dice-dock .die-tool .die-face') === 20", 6000) && (await P("count('.dice-dock', 'b')")) === 0, { a: await P("count('.dice-dock .die-tool .die-face')"), b: await P("count('.dice-dock', 'b')") });
    await sleep(300);
    const canvas1 = await P("canvas('a')");
    check("the canvas gives it room", canvas1.w < canvas0.w - 200, { before: canvas0.w, after: canvas1.w });
    await shot("2-docked");
    // name face 0 in the panel: the die doc changes, the scene rebuilds it, and both views read the new name
    check("a face named in the panel", await P(`commit('.dice-dock .die-face[data-face="0"] input.name', 'crit')`));
    check("the scene rebuilds the die from its doc, and both views' built content says the new name", await until(`built(${J(d20)}, 'a')?.labels[0] === 'crit' && __p.built(${J(d20)}, 'b')?.labels[0] === 'crit'`, 30_000), { a: (await P(`built(${J(d20)}, 'a')`))?.labels.slice(0, 3), b: (await P(`built(${J(d20)}, 'b')`))?.labels.slice(0, 3) });
    // keys typed in the panel are the panel's: R there doesn't change the scene's tool
    const tool0 = await P("tool('a')");
    await click(await P(`rect('.dice-dock .die-face[data-face="1"] input.name')`));
    await b.key("r");
    check("a key typed in the panel is the panel's, not the scene's", (await P("tool('a')")) === tool0, { tool0, tool: await P("tool('a')") });
    await click(await P(`rect('.dice-dock > header button')`));
    check("Close undocks it", await until("count('.dice-dock') === 0", 3000));
    await sleep(300);
  }

  // ── play ──
  await click(await P(`rect('.activity-option[data-activity="play"]')`));
  check("A switches to Play, with the hand as the tool", await until("activity('a') === 'play' && (__p.tool('a') == null || __p.tool('a') === 'hand')", 6000), { activity: await P("activity('a')"), tool: await P("tool('a')") });
  await settled();
  await sleep(400);

  // R over the d20
  {
    const t = await P(`transform(${J(d20)})`);
    await P(`watch(${J(d20)})`);
    const { hovering, prompt, before } = await pressOver(d20, "r");
    mark("pressed R over the d20");
    check("A hovers the d20, and the use prompt offers Roll and Turn", hovering && prompt.some((p) => /Roll/.test(p)) && prompt.some((p) => /Turn \(shows crit\)/.test(p)), prompt);
    report.d20Prompt = prompt;
    // the moment both views draw it clear of the table: what does the doc say then?
    const mid = await b.waitFor(`(() => { const p = window.__p, a = p.lies(${J(d20)}, 'a'), c = p.lies(${J(d20)}, 'b'); return a && c && a[0] > ${TOP + 0.005} && c[0] > ${TOP + 0.005} ? { doc: JSON.stringify(p.transform(${J(d20)})), a: a[0], b: c[0], at: p.now() } : false; })()`, 3000, 10);
    check("mid-roll both views draw it in the air (a pose), and the doc hasn't moved", !!mid && mid.doc === J(t), mid);
    const k = await P("pressedAt('r')");
    report.timings.d20 = { bothInAirMs: mid ? Math.round(mid.at - k) : null };
    const rolled = await until("notices('a').some((n) => /^You rolled /.test(n))", 4000);
    const said = (await P("notices('a')")).slice(before.a).find((n) => /^You rolled /.test(n));
    const value = said?.replace(/^You rolled /, "");
    report.d20Rolled = value;
    check("A is told what it rolled: one of the d20's faces", rolled && (await P(`built(${J(d20)}, 'a')`)).labels.includes(value), await P("notices('a')"));
    check("B is told Ana rolled the same", await until(`notices('b').includes(${J(`Ana rolled ${value}`)})`, 4000), await P("notices('b')"));
    await sleep(700);
    const samples = await P("unwatch()");
    const firstAir = samples.find((s) => s.a > TOP + 0.002);
    report.timings.d20.aInAirMs = firstAir ? Math.round(firstAir.at - k) : null;
    Object.assign(report.timings.d20, await timing("r", d20));
    report.d20Costs = { changes: await js(`window.__changeCost.filter((c) => c.at >= ${k} - 5).map((c) => [Math.round(c.at - ${k}), Math.round(c.ms), c.peer])`), longTasks: await js(`window.__longTasks.filter((c) => c.at >= ${k} - 5).map((c) => [Math.round(c.at - ${k}), Math.round(c.ms)])`), frames: await js(`window.__frames.filter((t) => t >= ${k} - 50 && t <= ${k} + 1500).map((t) => Math.round(t - ${k}))`) };
    // when B's answer to the draw (its commit) first reached A's replica: the second change there after the key (the first is A's own round)
    const changes = report.d20Costs.changes;
    report.timings.d20.bAnswerReachedAMs = changes.filter(([, , peer]) => peer === "a")[1]?.[0] ?? null;
    check("R puts it in the air at once: A draws it off the table within 100 ms of the key, before B's answer to the draw has even reached A; B draws it in the air too, before it lands", report.timings.d20.aInAirMs != null && report.timings.d20.aInAirMs < 100 && report.timings.d20.bAnswerReachedAMs != null && report.timings.d20.aInAirMs < report.timings.d20.bAnswerReachedAMs && report.timings.d20.bothInAirMs < report.timings.d20.landedMs, report.timings.d20);
    const w = (await P("writes()")).slice(before.writes).filter((x) => x.moved.length);
    check("it landed in one write", w.length === 1 && J(w[0].moved) === J([d20]), w);
    const d = await drawOf(d20);
    report.d20Draw = { contributors: d.mine?.contributors, members: d.round?.members, of: d.round?.of, seed: d.mine?.seed, landedMs: report.timings.d20.landedMs };
    check("its draw is the doc's, on the die, of it alone, nothing sealed, drawn by both clients: the seed is the hash of both openings (worked out here with WebCrypto), the same in both views", !!d.round && J(d.round.of) === J([d20]) && J(d.round.sealers) === "[]" && J(d.round.members) === J([V.a, V.b].sort()) && d.mine.contributors.length === 2 && d.a?.seed === d.mine.seed && d.b?.seed === d.mine.seed && d.a.public && d.b.public, d);
    // the asker opens first: in A's replica, A's own opening is in before B's, and B's never comes without it
    const order = (await P(`opensOrder(${J(d20)}, ${k})`)).filter((x) => x.round === d.round?.id);
    report.d20OpensOrder = order;
    const firstOpen = order.find((x) => x.opens.length);
    check("the asker opens first: A's replica holds A's opening alone before B's comes, and then both (B never opened before Ana: she knew the face no sooner than Ben did)", !!firstOpen && J(firstOpen.opens) === J([V.a]) && J(order.at(-1)?.opens) === J([V.a, V.b].sort()), order);
    const faceWanted = await P(`expectedFace(${J(d.mine?.seed ?? "")}, 0, 1, 20)`);
    const after = await drawn(d20);
    check("both views draw the d20 the same, the announced face up: the face its seed lands", after.same && after.a?.label === value && after.b?.label === value && after.a.face === faceWanted, { value, faceWanted, a: after.a, b: after.b });
    check("…flat on the tilted table", flatAt(after.lies.a, TOP) && flatAt(after.lies.b, TOP), { a: after.lies.a.slice(0, 4), b: after.lies.b.slice(0, 4) });
    // the roll as it went: every ~4th frame
    report.d20Trajectory = samples.filter((_, i) => i % 4 === 0).map((s) => `${String(s.t).padStart(5)} ms  doc ${s.docMoved ? "moved" : "still"}  A y ${s.a?.toFixed(4)}  B y ${s.b?.toFixed(4)}  A reads ${s.up}`);
    const air = samples.filter((s) => !s.docMoved && s.a > TOP + 0.01);
    check("the trajectory: it leaves the table and comes back while the doc stays still, and the doc moves only once it's down", air.length >= 5 && samples.findIndex((s) => s.docMoved) > samples.indexOf(air.at(-1)) && Math.max(...samples.map((s) => s.a)) > TOP + 0.04, { air: air.length, top: Math.max(...samples.map((s) => s.a)) });
    await shot("3-d20-rolled");
  }

  // R over the symbol die
  {
    const { hovering, prompt, before } = await pressOver(sym, "r");
    check("A hovers the symbol die, and its prompt offers Roll", hovering && prompt.some((p) => /Roll/.test(p)), prompt);
    const rolled = await until(`notices('a').slice(${before.a}).some((n) => /^You rolled (plus|minus|blank)$/.test(n))`, 4000);
    const value = (await P("notices('a')")).slice(before.a).find((n) => /^You rolled /.test(n))?.replace(/^You rolled /, "");
    report.symbolRolled = value;
    report.timings.symbol = await timing("r", sym);
    check("A is told the symbol it rolled", rolled, await P("notices('a')"));
    check("B is told Ana rolled the same symbol", await until(`notices('b').includes(${J(`Ana rolled ${value}`)})`, 4000), await P("notices('b')"));
    await sleep(700);
    const after = await drawn(sym);
    const ds = await drawOf(sym);
    const symWanted = await P(`expectedFace(${J(ds.mine?.seed ?? "")}, 0, 1, 6)`);
    check("both views draw the symbol die the same, the announced face up, flat on the ground: the face the hash of both openings lands", after.same && after.a?.label === value && after.b?.label === value && flatAt(after.lies.a, 0) && flatAt(after.lies.b, 0) && after.a.face === symWanted && ds.mine.contributors.length === 2 && ds.a.seed === ds.mine.seed && ds.b.seed === ds.mine.seed, { value, symWanted, a: after.a, b: after.b, lies: after.lies.a.slice(0, 5), draw: ds });
    await shot("4-symbol-rolled");
  }

  // T turns the d20 by hand
  {
    const was = await P(`dieShows(${J(d20)}, 'a')`);
    const labels = (await P(`built(${J(d20)}, 'a')`)).labels;
    const next = labels[(was.face + 1) % 20];
    const { before } = await pressOver(d20, "t");
    check("T turns the d20 to its next face, told as a turn", await until(`notices('a').slice(${before.a}).includes(${J(`You turned d20 to ${next}`)})`, 3000), (await P("notices('a')")).slice(before.a));
    check("B is told Ana turned it, not that she rolled", (await until(`notices('b').slice(${before.b}).includes(${J(`Ana turned d20 to ${next}`)})`, 3000)) && !(await P("notices('b')")).slice(before.b).some((n) => /rolled/.test(n)), (await P("notices('b')")).slice(before.b));
    await sleep(400);
    const after = await drawn(d20);
    check("both views draw it turned: the next face up, flat on the table", after.same && after.a?.label === next && after.b?.label === next && flatAt(after.lies.a, TOP), { next, a: after.a, b: after.b });
  }

  // G over one of the pair rolls both
  {
    const roundBefore = { lead: await P(`round(${J(pair[0])})`), other: await P(`round(${J(pair[1])})`) };
    const { hovering, prompt, before } = await pressOver(pair[1], "g");
    check("over one of the pair the prompt offers Roll all 2", hovering && prompt.some((p) => /Roll all 2/.test(p)), prompt);
    const rolled = await until(`notices('a').slice(${before.a}).some((n) => /^You rolled \\d0, \\d$/.test(n))`, 4000);
    const said = (await P("notices('a')")).slice(before.a).find((n) => /^You rolled /.test(n));
    report.pairRolled = said;
    check("A is told both in one line: the tens, then the units", rolled, (await P("notices('a')")).slice(before.a));
    check("B is told the same line of Ana", await until(`notices('b').includes(${J(said?.replace(/^You/, "Ana"))})`, 4000), (await P("notices('b')")).slice(before.b));
    report.timings.pair = await timing("g", pair[0]);
    await sleep(700);
    const w = (await P("writes()")).slice(before.writes).filter((x) => x.moved.length);
    check("the pair landed in one write", w.length === 1 && J([...w[0].moved].sort()) === J([...pair].sort()), w);
    const dp = await drawOf(pair[0]);
    const other = await P(`round(${J(pair[1])})`);
    check("a group throw is ONE draw: on its first die, of both dice in the scene's order, drawn by both clients; the second die has no draw of its own", !!dp.round && dp.round.id !== roundBefore.lead?.id && J(dp.round.of) === J(pair) && J(other) === J(roundBefore.other) && dp.mine.contributors.length === 2 && dp.a.seed === dp.mine.seed && dp.b.seed === dp.mine.seed, { round: dp.round && { of: dp.round.of, members: dp.round.members }, other, before: roundBefore });
    const want = [await P(`expectedFace(${J(dp.mine?.seed ?? "")}, 0, 2, 10)`), await P(`expectedFace(${J(dp.mine?.seed ?? "")}, 1, 2, 10)`)];
    const [tens, units] = said.replace(/^You rolled /, "").split(", ");
    const a0 = await drawn(pair[0]), a1 = await drawn(pair[1]);
    check("both views draw both dice the same, each the face announced and the face its place's seed lands, flat on the ground", a0.same && a1.same && a0.a?.label === tens && a0.b?.label === tens && a1.a?.label === units && a1.b?.label === units && flatAt(a0.lies.b, 0) && flatAt(a1.lies.b, 0) && a0.a.face === want[0] && a1.a.face === want[1], { tens, units, want, a0: a0.a, a1: a1.a });
    await shot("5-pair-rolled");
  }

  // a close look, for the eye: B's camera a hand's breadth from the pair, then from the d20
  for (const [name, id] of [["6-close-pair", pair[0]], ["7-close-d20", d20]]) {
    const m = await P(`shown(${J(id)}, 'b')`);
    await P(`setCamera('b', { position: [${m[12] + 0.03}, ${m[13] + 0.07}, ${m[14] + 0.06}], target: [${m[12] + 0.01}, ${m[13] + 0.005}, ${m[14]}] })`);
    await sleep(500);
    await shot(name);
  }

  // ── alone: B leaves, and A rolls the d20 by herself ──
  {
    await P("leave('b')");
    check("B has left: A's view sees nobody else here", await until("present('a').length === 0", 8000), await P("present('a')"));
    const { before } = await pressOver(d20, "r");
    const rolled = await until(`notices('a').slice(${before.a}).some((n) => /^You rolled /.test(n))`, 8000);
    report.timings.alone = await timing("r", d20);
    const d = await drawOf(d20);
    const said = (await P("notices('a')")).slice(before.a).find((n) => /^You rolled /.test(n));
    check("alone, a roll is a draw of one member, drawn at once (no deadline waited out), and lands as its seed says, unremarked", rolled && !!d.round && J(d.round.members) === J([V.a]) && J(d.mine.contributors) === J([V.a]) && !d.round.closed && d.a?.seed === d.mine.seed && report.timings.alone.landedMs != null && report.timings.alone.landedMs < 2000 && said === `You rolled ${(await P(`built(${J(d20)}, 'a')`)).labels[await P(`expectedFace(${J(d.mine?.seed ?? "")}, 0, 1, 20)`)]}`, { said, round: d.round && { members: d.round.members, closed: d.round.closed }, timing: report.timings.alone });
  }

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
