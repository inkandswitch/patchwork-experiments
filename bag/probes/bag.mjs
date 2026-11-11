// A token bag at a table, by two people at once, in headless Chrome.
//
//   (in scene/ and bag/) pnpm build
//   node probes/bag.mjs [--rule top|random] [--shots <dir>] [--show]
//
// Mounts the BUILT scene tool with the BUILT bag plugins, twice, on REAL
// Automerge documents: A (Ana) and B (Ben) each have their own replica of the
// scene doc and of the bag doc, and a change reaches the other 25 ms later by
// a real merge (bag-probe.html, real-repo.js). Real mouse and keys over CDP.
//
// 1. A clicks "Token bag" in the parts bin: a bag doc is made and built, and
//    both views show it with "Token bag · 0".
// 2. A carries three different tokens onto the bag with the hand (mouse
//    drags). Each leaves the scene doc; both views show count 3.
// 3. The link is held: nothing gets across. A presses D over the bag, then B
//    does: neither has heard the other. With --rule top (the default here)
//    both take the SAME token; with --rule random, whichever each draws.
// 4. The link is released. Each ends up carrying a different token, the
//    count is 1 in both views, and every token is in exactly one place.
// 5. Each clicks to put theirs down; the docs are the same on both peers.
// 6. A draws the last one and lets go of it over the bag: it is back inside.
// 7. From the right-click menu: A puts a piece in, then looks inside: the
//    bag's panel docks beside the scene, and B is told.
//
// Prints a JSON checklist and a timeline; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["bag/dist/index.js", "scene/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "bag-probe"));
const RULE = arg("--rule") ?? "top";

const b = await browser({ root: ROOT, port: 4863, cdp: 9863, page: "/bag/probes/bag-probe.html", width: 1816, height: 610, show: process.argv.includes("--show"), timeout: 180_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { rule: RULE, checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = async (what) => {
  const row = { t: +((Date.now() - t0) / 1000).toFixed(2), what };
  for (const w of ["a", "b"]) {
    row[w] = { scene: await P(`inScene('${w}')`), bag: (await P(`inBag('${w}')`))?.inside ?? null, label: (await P(`label('${w}')`))[0] ?? null, carrying: await P(`carrying('${w}')`) };
  }
  report.timeline.push(row);
};
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `bag-${RULE}-${name}.png`)));
const Q = JSON.stringify;

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const tokens = await P("tokens");
  check("three tokens on the table, loaded in both views", await until(`tokens.every((id) => __p.loaded('a', id) && __p.loaded('b', id))`, 30_000), tokens);

  // ── 1. a bag from the parts bin ──
  const row = await until("part('a', 'bag.token-bag')", 10_000);
  check("the parts bin offers Token bag", !!row, row);
  await b.click(row.x, row.y);
  check("a bag is in both peers' scene docs", await until("bag('a') && __p.bag('b')", 10_000), { a: await P("bag('a')"), b: await P("bag('b')") });
  check("…built from its document as a sack, and shown in both views", await until("bag('a').loaded && __p.bag('b').loaded", 30_000), { a: await P("bag('a')"), b: await P("bag('b')") });
  const bag = await P("bag('a')");
  check("…with its title and count on it: Token bag · 0", await until(`label('a')[0] === 'Token bag · 0' && __p.label('b')[0] === 'Token bag · 0'`, 5000), { a: await P("label('a')"), b: await P("label('b')") });
  if (RULE !== "random") await P(`setRule(${Q(RULE)})`);
  check("the draw rule is the bag doc's, on both peers", await until(`rule('a') === ${Q(RULE)} && __p.rule('b') === ${Q(RULE)}`, 5000), { a: await P("rule('a')"), b: await P("rule('b')") });
  await P("play('a')");
  await P("play('b')");
  check("both playing", await until("activity('a') === 'play' && __p.activity('b') === 'play'", 5000));
  await mark("set up");
  await shot("set-up");

  // ── 2. three tokens in, carried by A's hand ──
  for (const [i, id] of tokens.entries()) {
    const from = await until(`aimAt(${Q(id)}, 'a')`, 10_000);
    const to = await until(`aimAt(${Q(bag.id)}, 'a')`, 10_000);
    await b.drag([from.x, from.y], [to.x, to.y], { steps: 14 });
    const gone = await until(`inScene('a').indexOf(${Q(id)}) < 0 && __p.inScene('b').indexOf(${Q(id)}) < 0`, 5000);
    check(`${id}: dropped on the bag, it leaves the scene doc on both peers`, gone, { a: await P("inScene('a')"), b: await P("inScene('b')"), t: await P(`transform('a', ${Q(id)})`) });
    const want = `Token bag · ${i + 1}`;
    check(`…and both views show ${want}`, await until(`label('a')[0] === ${Q(want)} && __p.label('b')[0] === ${Q(want)}`, 5000), { a: await P("label('a')"), b: await P("label('b')") });
  }
  const full = { a: await P("inBag('a')"), b: await P("inBag('b')") };
  check("all three are inside, on both peers, and none is in either scene doc", full.a.inside.length === 3 && full.b.inside.length === 3 && (await P("inScene('a')")).length === 0 && (await P("inScene('b')")).length === 0, full);
  check("A was told it put each in; B that Ana did, never what", (await P("notices('a')")).filter((n) => n === "You put something in Token bag").length === 3 && (await until("notices('b').filter((n) => n === 'Ana put something in Token bag').length === 3", 3000)), { a: await P("notices('a')"), b: await P("notices('b')") });
  await mark("three in");
  await shot("three-in");

  // ── 3. both draw at the same moment ──
  const overA = await until(`aimAt(${Q(bag.id)}, 'a')`, 10_000);
  const overB = await until(`aimAt(${Q(bag.id)}, 'b')`, 10_000);
  await b.move(overA.x + 1, overA.y);
  await b.move(overA.x, overA.y);
  check("A hovers the bag, and the use prompt offers Draw from Token bag (3)", (await until(`hovered('a') === ${Q(bag.id)}`, 3000)) && (await until("prompt('a').some((t) => /Draw from Token bag \\(3\\)/.test(t))", 3000)), await P("prompt('a')"));
  await shot("prompt");
  await P("net.hold()");
  check("the link is held: nothing gets across", await P("net.held()"));
  await P("focus('a')");
  await b.key("d");
  const drewA = await until("inScene('a').length === 1", 3000);
  await b.move(overB.x + 1, overB.y);
  await b.move(overB.x, overB.y);
  check("B hovers the bag, still showing 3 (it hasn't heard)", (await until(`hovered('b') === ${Q(bag.id)}`, 3000)) && (await until("prompt('b').some((t) => /Draw from Token bag \\(3\\)/.test(t))", 3000)), await P("prompt('b')"));
  await P("focus('b')");
  await b.key("d");
  const drewB = await until("inScene('b').length === 1", 3000);
  const apart = { a: await P("inScene('a')"), b: await P("inScene('b')"), bagA: await P("inBag('a')"), bagB: await P("inBag('b')") };
  check("each has drawn one, on its own replica, before either heard the other", drewA && drewB && apart.bagA.inside.length === 2 && apart.bagB.inside.length === 2, apart);
  const same = apart.a[0] === apart.b[0];
  if (RULE === "top") check("…and both took the SAME token (last in, first out)", same, apart);
  report.collision = same;
  await mark("both drew, link held");
  await shot("held");

  // ── 4. the docs meet ──
  await P("net.release()");
  const settled = await until("converged().length === 0 && __p.inBag('a').inside.length === 1 && __p.inBag('b').inside.length === 1 && __p.carrying('a').length === 1 && __p.carrying('b').length === 1", 10_000);
  await sleep(400);
  await mark("link released");
  const after = { a: await P("inScene('a')"), b: await P("inScene('b')"), bagA: await P("inBag('a')"), bagB: await P("inBag('b')"), carrying: { a: await P("carrying('a')"), b: await P("carrying('b')") }, order: await P("order('a')") };
  check("the docs converge", settled && (await P("converged()")).length === 0, { differ: await P("converged()"), after });
  check("each carries one token, and they are different tokens", after.carrying.a.length === 1 && after.carrying.b.length === 1 && after.carrying.a[0] !== after.carrying.b[0], after.carrying);
  check("both are armed by the bag (the piece follows the pointer until the next click)", (await P("armed('a')")) === "bag" && (await P("armed('b')")) === "bag", { a: await P("armed('a')"), b: await P("armed('b')") });
  check("the count is 1, on both peers and in both views", after.bagA.inside.length === 1 && after.bagB.inside.length === 1 && (await until("label('a')[0] === 'Token bag · 1' && __p.label('b')[0] === 'Token bag · 1'", 3000)), { a: await P("label('a')"), b: await P("label('b')") });
  const places = {};
  for (const id of tokens) places[id] = [...(after.a.includes(id) ? ["scene"] : []), ...(after.bagA.inside.includes(id) ? ["bag"] : [])];
  check("every token is in exactly one place: nothing duplicated, nothing lost", tokens.every((id) => places[id].length === 1) && after.a.length === 2 && Q(after.a) === Q(after.b), { places, after });
  check("…and the two out are the two being carried", Q([...after.carrying.a, ...after.carrying.b].sort()) === Q(after.a), after);
  check("no scene object is listed twice where it's shown (the outline reads each id once)", new Set(after.a).size === after.a.length, after.order);
  const nA = await P("notices('a')");
  const nB = await P("notices('b')");
  check("each was told they drew, and that the other did: from which bag, never what", nA.includes("You drew from Token bag") && nB.includes("You drew from Token bag") && nA.includes("Ben drew from Token bag") && nB.includes("Ana drew from Token bag"), { a: nA, b: nB });
  check("nobody was told what was drawn", ![...nA, ...nB].some((n) => /Cube|Tile|Post/.test(n)), { a: nA, b: nB });
  if (same) check("the one who lost the piece was told, and drew another", [...nA, ...nB].filter((n) => /same moment/.test(n)).length === 1, { a: nA, b: nB });
  await shot("released");

  // ── 5. each puts theirs down where they choose ──
  const spotA = await P("pageOf('a', [-0.35, 0.02, -0.2])");
  const spotB = await P("pageOf('b', [0.35, 0.02, -0.2])");
  await b.click(spotA.x, spotA.y);
  await b.click(spotB.x, spotB.y);
  const down = await until("carrying('a').length === 0 && __p.carrying('b').length === 0 && __p.armed('a') == null && __p.armed('b') == null", 5000);
  await sleep(300);
  await mark("put down");
  const end = { a: await P("inScene('a')"), b: await P("inScene('b')"), bagA: await P("inBag('a')"), bagB: await P("inBag('b')") };
  const tA = await P(`transform('a', ${Q(after.carrying.a[0])})`);
  const tB = await P(`transform('a', ${Q(after.carrying.b[0])})`);
  check("each put theirs down where they clicked", down && Math.hypot(tA.position[0] + 0.35, tA.position[2] + 0.2) < 0.05 && Math.hypot(tB.position[0] - 0.35, tB.position[2] + 0.2) < 0.05, { tA, tB });
  check("at the end: two on the table, one in the bag, the same on both peers", end.a.length === 2 && Q(end.a) === Q(end.b) && end.bagA.inside.length === 1 && Q(end.bagA) === Q(end.bagB) && (await P("converged()")).length === 0, end);
  check("no strays: what the bag lists as inside is what is inside", Q(end.bagA.inside) === Q(end.bagA.listed), end.bagA);
  await shot("put-down");

  // ── a drawn piece put straight back (a chit drawn and returned) ──
  {
    const over = await until(`aimAt(${Q(bag.id)}, 'a')`, 10_000);
    await b.move(over.x + 1, over.y);
    await b.move(over.x, over.y);
    await until(`hovered('a') === ${Q(bag.id)}`, 3000);
    await P("focus('a')");
    await b.key("d");
    const out = await until("inBag('a').inside.length === 0 && __p.inBag('b').inside.length === 0 && __p.carrying('a').length === 1", 5000);
    check("A draws the last one: the bag is empty on both peers, and A carries it", out && (await until("label('b')[0] === 'Token bag · 0'", 3000)), { a: await P("inBag('a')"), carrying: await P("carrying('a')"), label: await P("label('b')") });
    await b.move(over.x + 3, over.y + 2);
    await b.click(over.x, over.y);
    const back = await until("inBag('a').inside.length === 1 && __p.inBag('b').inside.length === 1 && __p.inScene('a').length === 2 && __p.inScene('b').length === 2", 5000);
    check("…and lets go of it over the bag: it is back inside, on both peers", back && (await until("label('a')[0] === 'Token bag · 1' && __p.label('b')[0] === 'Token bag · 1'", 3000)), { a: await P("inBag('a')"), b: await P("inBag('b')"), scene: await P("inScene('a')") });
    await mark("drawn and put back");
  }

  // ── the verbs without a key, from the right-click menu ──
  {
    const piece = (await P("inScene('a')"))[0];
    const on = await until(`aimAt(${Q(piece)}, 'a')`, 10_000);
    await b.click(on.x, on.y, { button: "right" });
    const items = await until("menu('a').length && __p.menu('a')", 3000);
    const put = (items || []).find((m) => m.text === "Put in Token bag");
    check("right-click a piece: the menu offers Put in Token bag", !!put, items);
    if (put) await b.click(put.x, put.y);
    check("…and it goes in: 2 inside on both peers", await until(`inBag('a').inside.length === 2 && __p.inBag('b').inside.length === 2 && __p.inScene('b').indexOf(${Q(piece)}) < 0 && __p.label('b')[0] === 'Token bag · 2'`, 5000), { a: await P("inBag('a')"), b: await P("inBag('b')") });
    const over = await until(`aimAt(${Q(bag.id)}, 'a')`, 10_000);
    await b.click(over.x, over.y, { button: "right" });
    const verbs = await until("menu('a').length && __p.menu('a')", 3000);
    const texts = (verbs || []).map((m) => m.text);
    check("right-click the bag: Draw from Token bag (2), Draw 2, Look inside; no Empty out in play", texts.includes("Draw from Token bag (2)") && texts.includes("Draw 2") && texts.includes("Look inside") && !texts.includes("Empty out"), texts);
    // ── looking inside: the bag's own panel, docked beside the scene ──
    const look = (verbs || []).find((m) => m.text === "Look inside");
    if (look) await b.click(look.x, look.y);
    const panel = await until("panel('a')", 5000);
    check("Look inside docks the bag's panel in A's view: 2 inside, by kind, and it says it's no secret", panel?.total === "2" && panel.kinds.length === 2 && /Not a secret/.test(panel.note), panel);
    check("B is told Ana looked", await until("notices('b').includes('Ana looked inside Token bag')", 3000), await P("notices('b')"));
    await mark("menu and panel");
    await shot("panel");
  }

  report.net = await P("net.stats()");
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
