// The scene's X-ray (scene/src/native/xray.js), at a Lost Cities table, by
// two people in headless Chrome.
//
//   (in scene/, seats/ and tabletop/) pnpm build
//   node probes/xray.mjs [--shots <dir>] [--show]
//
// Mounts the BUILT scene tool with the BUILT seats and tabletop plugins on a
// Lost Cities table (the plain deck), twice on one doc (A is Ana in Player 1,
// B is Ben in Player 2; xray-probe.html). Once dealt, A presses X:
// - the X-ray is held: every object ghosted and outlined by who responds to
//   it, the legend by package with what each holds;
// - A isolates tabletop's row: its objects lit, the rest faded; again clears;
// - A hovers the deck's top card: a card beside it with its chain in input
//   order and verbs as keycaps;
// - the seats' claims have their lock glyphs; a card B carries has a hand;
// - A clicks a card: the X-ray pins it and takes nothing, and the route strip
//   says who took the click;
// - A picks up the editor and Measure over it: both tools held at once (the
//   X-ray isn't put down), B's chip lists every hand A holds; a click goes
//   to Measure (on top: its first point), not to the X-ray under it, whose
//   pin stays; putting the editor down puts Measure down, the X-ray stays;
// - Escape puts the X-ray down and nothing it displayed stays.
// Screenshots (--shots <dir>) are the scene-wide view, the isolation, the
// card, the glyphs and the strip. Prints a JSON checklist; exits non-zero if
// any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "seats/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "tabletop-xray"));

const b = await browser({ root: ROOT, port: 4773, cdp: 9773, page: "/tabletop/probes/xray-probe.html", width: 1600, height: 650, show: process.argv.includes("--show"), timeout: 180_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `xray-${name}.png`)));
const J = JSON.stringify;

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const viewers = await P("viewers");
  check("both pickers up", await until("picker('a') === 3 && __p.picker('b') === 3"), { a: await P("body('a')"), b: await P("body('b')") });
  await P("pick('a', 'p1')");
  await P("pick('b', 'p2')");
  check("A in Player 1, B in Player 2", await until(`seats().p1.player === ${J(viewers.a)} && __p.seats().p2.player === ${J(viewers.b)}`), await P("seats()"));
  // (the plain deck: dealt by the table's setup, no shuffle phase)
  const dealt = await until("where().p1.length === 8 && __p.where().p2.length === 8", 30_000);
  check("dealt: eight cards in each hand", dealt, await P("where()"));
  mark("dealt");

  // ── A picks up the X-ray ──
  check("A's view has the keyboard", await P("focus('a')"));
  await b.key("x");
  check("X: the X-ray is held, its legend docked with the extensions' rows", await until("xray('a').held && __p.legend('a').length > 2", 3000), { xray: await P("xray('a')"), legend: await P("legend('a')") });
  await b.rest(500);
  const legend = await P("legend('a')");
  const game = legend.find((r) => /^tabletop/.test(r.ext))?.ext;
  check("the legend: tabletop holds objects, with a count, grouped by package", !!game && legend.every((r) => r.count > 0) && (await P("packages('a')")).length >= 1, { legend, packages: await P("packages('a')") });
  report.details.legend = legend;
  report.details.swatches = await P("swatches('a')");
  report.details.runningIds = await P("running('a')");
  const tally = await P("tally('a')");
  check("scene-wide: objects ghosted, those nothing responds to faded", tally.ghost > 20 && tally.faded >= 1, tally);
  const top = (await P("pile()"))[0];
  const lookTop = await P(`look('a', ${J(top)})`);
  check("the deck's top card: ghosted, outlined in its responders' colours", lookTop?.opacity < 0.6 && lookTop?.outline?.length >= 1 && !!lookTop?.tint, lookTop);
  mark("scene-wide", tally);
  await shot("1-scene-wide");

  // ── A isolates tabletop's row ──
  check(`A isolates ${game}`, await P(`isolate('a', ${J(game)})`));
  check("its objects lit, the rest faded; its row marked", await until(`xray('a').isolated === ${J(game)} && __p.tally('a').lit >= 10 && __p.legend('a').filter((r) => r.on).length === 1`, 3000), { tally: await P("tally('a')"), xray: await P("xray('a')") });
  report.details.isolated = await P("tally('a')");
  await b.rest(400);
  await shot("2-isolated");
  await P(`isolate('a', ${J(game)})`);
  check("clicking the row again clears it", await until("xray('a').isolated === null && __p.tally('a').lit === 0", 3000), await P("tally('a')"));

  // ── A hovers the deck's top card ──
  await until(`aimAt(${J(top)}, 'a')`, 30_000);
  const at = await P(`aimAt(${J(top)}, 'a')`);
  await b.move(at.x, at.y);
  check("A hovers the deck's top card: it has a card, lit", await until(`xray('a').hovered === ${J(top)} && __p.card('a')?.chain.length > 0`, 3000), { xray: await P("xray('a')"), card: await P("card('a')") });
  const card = await P("card('a')");
  check("its card: the responding chain in input order (tabletop's, scene.carry), a verb Draw", card.chain.some((e) => /^tabletop/.test(e)) && card.chain.includes("scene.carry") && card.verbs.some((v) => /Draw/.test(v)), card);
  check("…the card is lit in the world", (await P(`look('a', ${J(top)})`))?.opacity === 1, await P(`look('a', ${J(top)})`));
  mark("card", card);
  await b.rest(300);
  await shot("3-card");
  // the same in the dark theme (the page's editor tokens swapped)
  await js(`(() => { const r = document.documentElement; r.style.cssText += "--editor-fill:#16181c;--editor-fill-offset-10:#23262b;--editor-fill-offset-20:#3b3f46;--editor-line:#e6e8eb;color-scheme:dark"; r.setAttribute("data-theme", "dark"); })()`);
  await b.rest(800);
  await b.move(at.x + 1, at.y);
  await b.rest(500);
  await shot("3-card-dark");
  await js(`(() => { const r = document.documentElement; r.removeAttribute("data-theme"); r.style.cssText = ""; })()`);
  await b.rest(800);

  // ── claims: the seats ──
  const glyphs = await P("badges('a')");
  report.details.claims = await P("claims('a')");
  const onScene = await P("sceneClaims('a')");
  check("the seats' claims are the scene's own: locks in the panel, who holds each (you, Ben)", onScene.length === 2 && onScene.some((t) => /you/.test(t)) && onScene.some((t) => /Ben/.test(t)), { onScene, glyphs });
  await b.move(40, 40);
  await b.rest(500);
  await shot("4-claims");

  // ── poses: B carries one of its cards ──
  const carried = await P("handCard('p2')");
  const atB = await P(`aimAt(${J(carried)}, 'b')`);
  check("a card of B's hand is under the pointer in B's view", !!atB, { carried, atB });
  const seen = await b.drag([atB.x, atB.y], [atB.x - 40, atB.y - 120], {
    steps: 14,
    beforeRelease: async () => {
      const ok = await until("badges('a').some((t) => t.includes('✋'))", 5000);
      await b.rest(300);
      await shot("5-carried");
      return { ok, badges: await P("badges('a')") };
    },
  });
  check("the card B is carrying has a hand glyph (held, rank 0)", seen.ok, seen);
  mark("pose seen");

  // ── the input route of a press: A lifts one of its own cards, the carry takes it ──
  const lift = await P("handCard('p1')");
  const atLift = await P(`aimAt(${J(lift)}, 'a')`);
  const pressed = await b.drag([atLift.x, atLift.y], [atLift.x + 8, atLift.y - 12], {
    steps: 6,
    beforeRelease: async () => {
      const ok = await until("strip('a')?.on.startsWith('press on') && __p.strip('a').took", 3000);
      await b.rest(300);
      await shot("6-press-taken");
      return { ok, strip: await P("strip('a')") };
    },
  });
  check("the route strip of a press: the carry took it (its box filled)", pressed.ok && /Carry|Holders/.test(pressed.strip.took ?? ""), pressed);
  report.details.pressRoute = pressed.strip;
  await b.rest(800);
  report.details.afterLift = { xray: await P("xray('a')"), held: await P("held('a')"), hands: await P("hands('a')"), pointer: await P("wanted('a')"), where: (await P("where()")).p1.length, lift };

  // ── the input route of a click ──
  const mine = await P("handCard('p1')");
  await until(`aimAt(${J(mine)}, 'a')`, 5000);
  const atMine = await P(`aimAt(${J(mine)}, 'a')`);
  await b.move(atMine.x, atMine.y);
  await b.rest(400);
  await b.click(atMine.x, atMine.y);
  check("A's click pins the card", await until(`xray('a').pinned === ${J(mine)}`, 3000), { xray: await P("xray('a')"), mine });
  check("the route strip: the click on it, the X-ray passing it on, who took it", await until("strip('a')?.on.startsWith('click on')", 3000), await P("strip('a')"));
  report.details.route = await P("strip('a')");
  await b.rest(300);
  await shot("7-click-route");

  // ── Measure held over the X-ray: two tools at once ──
  check("the X-ray alone asks nothing of the pointer", (await P("wanted('a')")) === false, { held: await P("held('a')"), wanted: await P("wanted('a')") });
  check("A picks up the editor", await P("edit('a', true)"), await P("hands('a')"));
  await P("focus('a')");
  await b.key("m");
  check("M: Measure held over the X-ray, both at once", await until(`held('a').join() === ${J("X-ray,Measure")} && __p.xray('a').held && __p.measure('a').held`, 3000), { held: await P("held('a')"), hands: await P("hands('a')"), xray: await P("xray('a')"), measure: await P("measure('a')") });
  check("B's chip lists every hand A holds, top last", await until("people('b').some((r) => /X-ray, Edit, Measure/.test(r))", 5000), await P("people('b')"));
  await shot("measure");
  const other = (await P("where()")).p1.find((id) => id !== mine) ?? mine;
  const atOther = await P(`aimAt(${J(other)}, 'a')`);
  await b.click(atOther.x, atOther.y);
  check("a click goes to Measure on top (its first point, on the card); the X-ray under it never hears it (its pin stays)", await until("measure('a').a !== null", 3000) && (await P("xray('a')")).pinned === mine, { measure: await P("measure('a')"), xray: await P("xray('a')"), other, mine });
  check("putting the editor down puts Measure down with it; the X-ray stays", (await P("edit('a', false)")) && (await until(`held('a').join() === "X-ray" && __p.xray('a').held && !__p.measure('a').held`, 3000)), { held: await P("held('a')"), xray: await P("xray('a')"), measure: await P("measure('a')") });

  // ── Escape puts it down ──
  await P("focus('a')");
  await b.key("Escape");
  check("Escape puts it down: nothing displayed, no glyphs, no card, no strip", await until("xray('a').held === false && __p.tally('a').lit + __p.tally('a').ghost + __p.tally('a').faded === 0 && __p.badges('a').length === 0 && __p.card('a') === null && __p.strip('a') === null", 3000), { xray: await P("xray('a')"), tally: await P("tally('a')"), badges: await P("badges('a')") });

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
