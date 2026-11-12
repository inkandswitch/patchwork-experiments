// Draw (D), at a secure Lost Cities table, by two people in headless Chrome.
//
//   (in scene/, tabletop/ and card-table/) pnpm build
//   node probes/draw.mjs [--shots <dir>] [--show]
//
// Mounts the BUILT scene tool with the BUILT tabletop and card-table plugins
// on a Lost Cities table set up as the game page does, twice on one doc (A is
// Ana in Player 1, B is Ben in Player 2; draw-probe.html). Once the players'
// clients have shuffled and dealt, A hovers the deck and presses D:
// - the use prompt over the deck offers "Draw to my hand";
// - the deck's top card travels (A holds its pose) and lands in Player 1's hand;
// - A sees its face, B doesn't: B sees it, and all of A's hand, as backs
//   (another seat's hand is never turned toward you), never a veil;
// - B is told "Ana drew a card", and A "You drew a card".
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "card-table/dist/index.js", "keep/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "tabletop-draw"));

const b = await browser({ root: ROOT, port: 4772, cdp: 9772, page: "/tabletop/probes/draw-probe.html", width: 1416, height: 530, show: process.argv.includes("--show"), timeout: 180_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `draw-${name}.png`)));

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const viewers = await P("viewers");
  check("both views playing", await until("activity('a') === 'play' && __p.activity('b') === 'play' && __p.picker('a') === 3 && __p.picker('b') === 3"));
  await P("pick('a', 'p1')");
  await P("pick('b', 'p2')");
  check("A in Player 1, B in Player 2", await until(`seats().p1.player === ${JSON.stringify(viewers.a)} && __p.seats().p2.player === ${JSON.stringify(viewers.b)}`), await P("seats()"));
  mark("seated");
  // the players' clients shuffle and deal between them, then hand over the keys to each hand
  const dealt = await until("phase() === 'playing' && __p.faces('a').length >= 8 && __p.faces('b').length >= 8", 90_000);
  mark("dealt", { phase: await P("phase()"), a: (await P("faces('a')")).length, b: (await P("faces('b')")).length });
  check("the secure deck is shuffled and each hand's faces delivered", dealt, { phase: await P("phase()"), faces: { a: (await P("faces('a')")).length, b: (await P("faces('b')")).length }, hud: await P("hud('a')") });
  const before = await P("where()");
  const facesA0 = await P("faces('a')");
  const facesB0 = await P("faces('b')");
  const pile = await P("pile()");
  check("a pile out on the table", pile.length > 0 && before.p1.length === 8, { pile: pile.length, before: { p1: before.p1.length, p2: before.p2.length } });
  await shot("before");

  // ── A hovers the deck and presses D ──
  const top = pile[0];
  // (once the table's pieces have loaded: what a pick hits)
  await until(`aimAt(${JSON.stringify(top)}, 'a')`, 30_000);
  const at = await P(`aimAt(${JSON.stringify(top)}, 'a')`);
  check("the deck's top card is under the pointer somewhere in A's view", !!at, at);
  await b.move(at.x, at.y);
  check("A hovers it", await until(`hovered('a') === ${JSON.stringify(top)}`, 3000), await P("hovered('a')"));
  const prompt = await until("prompt('a').some((t) => /Draw to my hand/.test(t))", 3000);
  check("the use prompt offers Draw to my hand", prompt, await P("prompt('a')"));
  await shot("prompt");
  const t = await P(`transform(${JSON.stringify(top)})`);
  check("A's view has the keyboard", await P("focus('a')"));
  await b.key("d");
  mark("pressed D");
  await sleep(150);
  const mid = await P(`transform(${JSON.stringify(top)})`);
  check("mid-way, the doc still has it on the deck (it travels as a pose)", JSON.stringify(mid) === JSON.stringify(t), { t, mid });
  const landed = await until(`where().p1.includes(${JSON.stringify(top)})`, 3000);
  mark("landed");
  const after = await P("where()");
  check("the top card lands in Player 1's hand", landed && after.p1.length === before.p1.length + 1, { top, p1: after.p1.length, transform: await P(`transform(${JSON.stringify(top)})`) });
  check("…face up, and the next card is the top of the pile now", (await P(`transform(${JSON.stringify(top)})`)).rotation[2] === 0 && (await P("pile()"))[0] !== top, await P(`transform(${JSON.stringify(top)})`));
  check("A sees its face", await until(`faces('a').includes(${JSON.stringify(top)})`, 15_000), { faces: (await P("faces('a')")).length, before: facesA0.length });
  check("B doesn't", !(await P("faces('b')")).includes(top) && (await P("faces('b')")).length === facesB0.length, { faces: (await P("faces('b')")).length, before: facesB0.length });
  // in A's hand, whichever way up: not turned toward B, so B sees its back (which back it is, is real information)
  check("…B sees its back there, as for all of A's hand, and no veil", await until(`backs('b').includes(${JSON.stringify(top)}) && ${JSON.stringify(before.p1)}.every((id) => __p.backs('b').includes(id)) && __p.veils('b').length === 0`, 15_000), { veils: await P("veils('b')"), hand: before.p1, top });
  check("…and A sees all of its own hand's faces, no veil left", await until(`veils('a').length === 0 && ${JSON.stringify([...before.p1, top])}.every((id) => __p.faces('a').includes(id))`, 15_000), await P("veils('a')"));
  check("A is told it drew", (await P("notices('a')")).includes("You drew a card"), await P("notices('a')"));
  check("B is told Ana drew", await until("notices('b').includes('Ana drew a card')", 3000), await P("notices('b')"));
  await sleep(300);
  await shot("after");
  // up close in B's view, over A's hand: backs
  await js(`(() => { const v = document.querySelectorAll(".scene-stage")[1].__sceneDebug.viewport; v.setCamera({ position: [0.05, 0.28, 0.2], target: [0.05, 0, 0.5] }); v.invalidate?.(); return true; })()`);
  await sleep(600);
  await shot("others-hand-closeup");
  // a second draw: the next top card, into the last free slot
  {
    const next = (await P("pile()"))[0];
    const at2 = await P(`aimAt(${JSON.stringify(next)}, 'a')`);
    await b.move(at2.x + 1, at2.y);
    await b.move(at2.x, at2.y);
    const hov = await until(`hovered('a') === ${JSON.stringify(next)}`, 3000);
    const again = await until("prompt('a').some((t) => /Draw to my hand/.test(t))", 3000);
    check("hovering the pile again, the prompt offers Draw again", hov && again, { hovered: await P("hovered('a')"), next, prompt: await P("prompt('a')") });
    await shot("prompt-again");
  }

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
