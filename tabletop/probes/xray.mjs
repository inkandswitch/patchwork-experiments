// The scene's X-ray (scene/src/native/xray.js), at a Lost Cities table, by
// two people in headless Chrome.
//
//   (in scene/, seats/ and tabletop/) pnpm build
//   node probes/xray.mjs [--shots <dir>] [--show]
//
// Mounts the BUILT scene tool with the BUILT seats and tabletop plugins on a
// Lost Cities table (the plain deck), twice on one doc (A is Ana in Player 1,
// B is Ben in Player 2; xray-probe.html). Once dealt, A presses X:
// - the X-ray is held and its panel docked; the scene's running list shows;
// - A hovers the deck's top card: its holders in input order (tabletop's,
//   scene.carry…), each with its verbs and their states;
// - A picks tabletop's extension from the running list: its cards outlined,
//   its objects × verbs grid;
// - the claims layer shows the seats' claims; the poses layer shows a card
//   B is carrying, held by Ben;
// - A clicks a card: the X-ray pins it and takes nothing, and the input
//   route says who took the click;
// - A picks up the editor and Measure over it: both tools held at once (the
//   X-ray isn't put down), B's chip lists every hand A holds; a click goes
//   to Measure (on top: its first point), not to the X-ray under it, whose
//   pin stays; putting the editor down puts Measure down, the X-ray stays;
// - Escape puts the X-ray down.
// Prints a JSON checklist; exits non-zero if any check fails.
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
  check("X: the X-ray is held, its panel docked with the running list", await until("xray('a').held && __p.running('a').length > 5", 3000), { xray: await P("xray('a')"), running: await P("running('a')") });
  await b.rest(300);
  await shot("held");

  // ── A hovers the deck's top card ──
  const top = (await P("pile()"))[0];
  await until(`aimAt(${J(top)}, 'a')`, 30_000);
  const at = await P(`aimAt(${J(top)}, 'a')`);
  await b.move(at.x, at.y);
  check("A hovers the deck's top card", await until(`xray('a').hovered === ${J(top)} && __p.holders('a').length > 0`, 3000), { xray: await P("xray('a')"), holders: await P("holders('a')") });
  const holders = await P("holders('a')");
  const game = holders.find((h) => /^tabletop/.test(h.ext) && h.verbs.length)?.ext ?? holders.find((h) => /^tabletop/.test(h.ext))?.ext;
  check("its holders in input order: tabletop's and scene.carry, with verbs", !!game && holders.some((h) => h.ext === "scene.carry") && holders.some((h) => h.verbs.length), holders);
  check("…a verb for the deck: Draw", holders.some((h) => h.verbs.some((v) => /Draw/.test(v))), holders.flatMap((h) => h.verbs));
  mark("object lens", { holders: holders.map((h) => h.ext) });
  await b.rest(200);
  await shot("object");

  // ── A picks tabletop's extension ──
  check(`A picks ${game} from the running list`, await P(`pickExt('a', ${J(game)})`), await P("running('a')"));
  check("its lens: the objects × verbs grid", await until("grid('a').length > 3", 3000), (await P("grid('a')")).slice(0, 6));
  check("…its objects outlined in the view", await until("outlines('a').filter((k) => /^trait:/.test(k)).length >= 10", 3000), (await P("outlines('a')")).length);
  report.details.grid = (await P("grid('a')")).slice(0, 8);
  report.details.refreshMs = { picked: await P("refreshMs('a')") };
  await b.rest(200);
  await shot("extension");

  // ── claims: the seats ──
  const claims = await P("rows('a', 'claims')");
  check("the claims layer: each seat's claim, who holds it", claims.some((r) => /seat/.test(r) && /you/.test(r)) && claims.some((r) => /seat/.test(r) && /Ben/.test(r)), claims);

  // ── poses: B carries one of its cards ──
  const card = await P("handCard('p2')");
  const atB = await P(`aimAt(${J(card)}, 'b')`);
  check("a card of B's hand is under the pointer in B's view", !!atB, { card, atB });
  const seen = await b.drag([atB.x, atB.y], [atB.x - 40, atB.y - 120], {
    steps: 14,
    beforeRelease: async () => {
      const ok = await until("rows('a', 'poses').some((r) => /Ben/.test(r))", 5000);
      const rows = await P("rows('a', 'poses')");
      const badges = await P("badges('a')");
      await P("scrollTo('a', 'layers')");
      await shot("pose");
      return { ok, rows, badges };
    },
  });
  check("the poses layer: the card B is carrying, held by Ben (rank 0)", seen.ok && seen.rows.some((r) => /Ben/.test(r) && /rank 0/.test(r)), seen);
  mark("pose seen");

  // ── the input route of a click ──
  const mine = await P("handCard('p1')");
  const atMine = await P(`aimAt(${J(mine)}, 'a')`);
  await b.click(atMine.x, atMine.y);
  check("A's click pins the card", await until(`xray('a').pinned === ${J(mine)}`, 3000), { xray: await P("xray('a')"), mine });
  check("the input route: the click on it, the X-ray passing it on, who took it", await until("rows('a', 'route')[0]?.startsWith('click on')", 3000), await P("rows('a', 'route')"));
  report.details.route = await P("rows('a', 'route')");
  await P("scrollTo('a', 'layers')");
  await b.rest(200);
  await shot("route");

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
  check("Escape puts it down: no outlines, no badges", await until("xray('a').held === false && __p.outlines('a').length === 0 && __p.badges('a').length === 0", 3000), { xray: await P("xray('a')"), outlines: await P("outlines('a')"), badges: await P("badges('a')") });

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
