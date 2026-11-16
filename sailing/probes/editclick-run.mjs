// Edit inside a game aboard, her world running: does a click that lands on
// the boat (outside the entered link) change the viewer's body? Found by
// presence-check.nopause (2026-11-16): in the real Patchwork, B entered Lost
// Cities aboard (Edit, a double-click) and B's next single click, a card
// missed on the pitching boat, landed on her and came aboard: the Aboard
// body, at the helm, the pointer locked (scene/COMPOSITION.md, Decisions,
// Edit's click is Edit's).
//
//   (in scene/, seats/, sailing/, water/, tabletop/, card-table/, keep/, joints/, traversal/) pnpm build
//   node probes/editclick-run.mjs [--shots <dir>] [--seed 1] [--misses 12] [--port 4795] [--cdp 9795]
//
// On aboard-probe.html (one view, A; the page's manual clock, stepped here
// as the wall would move it):
//  1. A builds Lost Cities aboard, her world running; A picks Edit and
//     looks down on the table (the presence-check's camera);
//  2. A double-clicks a card of G's as presence-check does it (press,
//     release, 90 ms of her sea, press, release; real CDP events), up to
//     three tries: what each press hit, the two gaps by the events' own
//     timeStamps, whether every press and the dblclick reached the canvas
//     at the width the first press found (the inspector, shut, opens a
//     beat after the first press's selection: scene/TOOLS.md Decisions 6)
//     and whether it entered G;
//  3. inside G, in Edit: a click on the boat's Card table, then one on her
//     hull, each outside the focus: the body stays Edit, the focus and the
//     selection are unchanged;
//  4. inside G, in Edit: `--misses` single clicks each aimed at a card of
//     G's, her sea moving 150 ms between the aim and the press (what a
//     script's or a hand's latency is): what each press hit (a card of G's,
//     another of G's things such as its board, the boat outside the focus,
//     nothing) and the body after; none boards, and each hit inside G
//     selects what it hit.
//  5. back at the boat, in Edit, nothing selected: a slow double-click at a
//     card of G's, slow but one the router still takes (second press
//     480 ms after the first, dblclick 170 ms after that, on the stage's
//     clock): the canvas keeps its width to the dblclick (the inspector's
//     beat starts again at the second press, so it can't end between the
//     first click's selection and the dblclick).
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "seats", "sailing", "water", "tabletop", "card-table", "keep", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist/index.js: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "sailing-editclick"));
const MISSES = Number(arg("--misses") ?? 12);
const PORT = Number(arg("--port") ?? 4795);
mkdirSync(SHOTS, { recursive: true });
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/aboard-probe.html?seed=${Number(arg("--seed") ?? 1)}`, width: 1416, height: 530, timeout: 900_000 });
const J = JSON.stringify;
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const loads = (expr, ms = 20_000) => b.waitFor(`window.__p.${expr}`, ms, 60);
const until = (expr, ms = 3000) => b.soon(`window.__p.${expr}`, { frames: Math.ceil(ms / (1000 / 60)) });
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, numbers: {} };

// every press and double-click A's host hears: when (the event's own stamp), where, what the view picks there now
// (what the router picks for it: no frame comes between), and A's body, focus and selection as it lands
const LISTEN = `(() => {
  const host = document.getElementById("a"); const log = (window.__ev = []);
  const what = (e) => { const v = __p.A.view; const r = v.canvas.getBoundingClientRect(); const hit = v.viewport.pick(e.clientX - r.left, e.clientY - r.top);
    return { type: e.type, stamp: +e.timeStamp.toFixed(1), x: Math.round(e.clientX), y: Math.round(e.clientY), on: e.target === v.canvas ? "canvas" : e.target.tagName.toLowerCase() + "." + String(e.target.className || ""), cw: Math.round(r.width),
      hit: hit?.id ? v.pathOfKey(hit.id) : null, body: __p.A.local.get().body?.id ?? null, focus: v.atom.get().focus, selected: v.atom.get().selected }; };
  host.addEventListener("pointerdown", (e) => log.push(what(e)), true);
  host.addEventListener("dblclick", (e) => log.push(what(e)), true);
  return true; })()`;
const events = () => js("window.__ev.splice(0)");
const state = async () => ({ body: (await P("body('a')")).id, stack: (await P("body('a')")).stack, focus: await P("focusPath('a')"), selected: await P("selectionPath('a')"), locked: await js("!!document.pointerLockElement") });
const editOver = async () => {
  await js(`(__p.A.view.enterBody("edit"), true)`);
  await b.rest(200);
  await P("setCam('a', __p.overTable('a'))");
  await b.rest(300);
};
const cards = async () => js(`Object.keys(__p.A.view.stages().find((s) => s.path.length === 1)?.doc().objects ?? {}).filter((id) => __p.A.view.stages().find((s) => s.path.length === 1).doc().objects[id].traits?.["tabletop.card"])`);
const press = async (x, y, n) => { await b.mouse("mousePressed", x, y, { clickCount: n }); await b.mouse("mouseReleased", x, y, { clickCount: n }); };

try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  await loads("templates('a').includes('ship-at-anchor')", 20_000);
  const ids = await P("build()", 120_000);
  check("1: built Lost Cities aboard (the boat, the Card table, G linked onto it)", !ids.error && !!ids.link && !!ids.table, ids);
  await loads("loaded('a').loaded === __p.loaded('a').total", 120_000);
  await P("resume()");
  await b.advance(1500);
  check("1: her world runs", await js("__p.A.view.stages().find((s) => s.path.length === 0).reader.clock.status().running"), null);
  await js(LISTEN);
  await editOver();
  check("1: A in Edit, over the table, the focus on the boat", J(await state()).includes('"body":"edit"') && J(await P("focusPath('a')")) === "[]", await state());

  // ── 2: the presence-check's double-click ──
  const tries = [];
  let entered = false;
  for (let i = 0; i < 3 && !entered; i++) {
    const ids2 = await cards();
    const at = await P(`aimBest(${J(ids2)}, 'a')`);
    if (!at) { tries.push({ aim: null }); await b.rest(500); continue; }
    await b.move(at.x, at.y);
    await b.advance(80);
    await press(at.x, at.y, 1);
    await b.advance(90);
    await press(at.x, at.y, 2);
    await b.rest(400);
    const ev = await events();
    const downs = ev.filter((e) => e.type === "pointerdown"), dbl = ev.find((e) => e.type === "dblclick");
    const gaps = downs.length === 2 && dbl ? { second: +(downs[1].stamp - downs[0].stamp).toFixed(1), dbl: +(dbl.stamp - downs[1].stamp).toFixed(1) } : null;
    entered = J(await P("focusPath('a')")) === J([ids.link]);
    tries.push({ aim: { id: at.id, x: Math.round(at.x), y: Math.round(at.y) }, gaps, events: ev, entered, after: await state() });
    if (!entered) await editOver();
  }
  report.numbers.enterTries = tries;
  check("2: a double-click on a card of G's enters G", entered, tries.map((t) => ({ gaps: t.gaps, hits: t.events?.map((e) => e.hit), entered: t.entered })));
  // the stage's promise (COMPOSITION.md, Decisions, double-click and its stamps): a double-click whose first press
  // landed on G's card and whose dblclick reached the canvas enters, however the boat moved between the clicks
  const onG = (t) => t.events?.find((e) => e.type === "pointerdown")?.hit?.[0] === ids.link && t.events.find((e) => e.type === "dblclick")?.on === "canvas";
  check("2: every try whose first press landed on a card of G's and whose dblclick reached the canvas entered", tries.filter(onG).every((t) => t.entered), tries.map((t) => ({ onG: onG(t), entered: t.entered })));
  // a first press's selection opens the shut inspector only a beat later (scene/TOOLS.md Decisions 6, "The inspector
  // waits a beat"), so the canvas keeps its width under the second press: every press and the dblclick reach it
  const onCanvas = (t) => t.events?.length >= 3 && t.events.every((e) => e.on === "canvas" && e.cw === t.events[0].cw);
  check("2: every try's presses and dblclick reached the canvas at the width the first press found (no inspector opened under the second)", tries.filter((t) => t.aim).every(onCanvas), tries.map((t) => t.events?.map((e) => `${e.on} ${e.cw}`)));
  report.numbers.firstTry = tries[0] && { entered: tries[0].entered, gaps: tries[0].gaps, presses: tries[0].events?.map((e) => ({ type: e.type, on: e.on, hit: e.hit, selected: e.selected })) };
  check("2: entering leaves the body Edit", (await state()).body === "edit", await state());

  // ── 3: a click on the boat, outside the focus ──
  // something else of hers in sight round the table (her deck, a bench, the coachroof): the boat's object nearest
  // the canvas's middle that isn't the table or the link
  const findOther = () => js(`(() => { const v = __p.A.view; const r = v.canvas.getBoundingClientRect(); let best = null;
    for (let y = 8; y < r.height - 8; y += 12) for (let x = 8; x < r.width - 8; x += 12) { const h = v.viewport.pick(x, y); const p = h?.id ? v.pathOfKey(h.id) : null;
      if (!p || p.length !== 1 || p[0] === ${J(ids.table)} || p[0] === ${J(ids.link)} || document.elementFromPoint(r.left + x, r.top + y) !== v.canvas) continue;
      const d = Math.hypot(x - r.width / 2, y - r.height / 2); if (!best || d < best.d) best = { id: p[0], d, x: r.left + x, y: r.top + y }; } return best; })()`);
  for (const which of ["table", "other"]) {
    if (J(await P("focusPath('a')")) !== J([ids.link]) || (await state()).body !== "edit") {
      await editOver();
      await js(`__p.A.view.focusOn(${J([ids.link])})`);
      await b.rest(300);
    }
    const before = await state();
    const other = which === "other" ? await findOther() : null;
    if (which === "other" && !other) { check("3: another part of her in sight", false, null); continue; }
    const id = which === "table" ? ids.table : other.id;
    const name = which === "table" ? "the Card table" : "another part of her";
    const at = which === "table" ? await P(`aimAt(${J(id)}, 'a')`) : other;
    if (!at) { check(`3: ${name} in plain sight`, false, null); continue; }
    await b.move(at.x, at.y);
    await press(at.x, at.y, 1);
    await b.rest(600);
    const after = await state();
    const ev = await events();
    report.numbers[`click on ${name}`] = { before, at, ev, after };
    check(`3: in Edit inside G, a click on ${name} (the boat's, outside the focus) leaves the body Edit, the pointer free`, after.body === "edit" && !after.locked, { id, hit: ev[0]?.hit, before: before.body, after });
    check(`3: …and the focus and selection as they were`, J(after.focus) === J(before.focus) && J(after.selected) === J(before.selected), { before, after });
    await b.shot(join(SHOTS, `editclick-${which}.png`));
  }

  // ── 4: single clicks at cards, her sea moving between the aim and the press ──
  const misses = [];
  for (let i = 0; i < MISSES; i++) {
    if (J(await P("focusPath('a')")) !== J([ids.link]) || (await state()).body !== "edit") {
      await editOver();
      await js(`__p.A.view.focusOn(${J([ids.link])})`);
      await b.rest(300);
    }
    await js("__p.A.view.select(null)");
    await P("setCam('a', __p.overTable('a'))");
    await b.rest(200);
    const ofG = await cards();
    const at = await P(`aimBest(${J(ofG)}, 'a')`);
    if (!at) { misses.push({ aim: null }); continue; }
    await b.advance(150);
    await b.move(at.x, at.y);
    await press(at.x, at.y, 1);
    await b.rest(400);
    const ev = (await events()).find((e) => e.type === "pointerdown");
    const after = await state();
    // inside G: a card of G's, or another of G's things (its board); outside: the boat's
    const where = !ev?.hit ? "nothing" : ev.hit[0] === ids.link && ev.hit.length > 1 ? (ofG.includes(ev.hit[1]) ? "G card" : "G other") : "boat";
    misses.push({ aimed: at.id, where, hit: ev?.hit ?? null, body: after.body, selected: after.selected });
    await b.advance(700 + 137 * i); // (another moment of her sea for the next)
  }
  report.numbers.singleClicks = misses;
  const tally = misses.reduce((t, m) => ((t[m.where] = (t[m.where] ?? 0) + 1), t), {});
  check(`4: ${MISSES} single clicks at cards on her moving table, in Edit inside G: none changes the body`, misses.every((m) => m.body === "edit"), { tally, misses });
  check("4: …each one on something of G's (a card, or its board) selects that thing", misses.filter((m) => m.where?.startsWith("G ")).every((m) => J(m.selected) === J(m.hit.slice(0, 2))), tally);

  // ── 5: a slow double-click, at the boat ──
  await js(`(__p.A.view.focusOn([]), __p.A.view.select(null), true)`);
  await editOver();
  // the inspector shut (steps 3 and 4 opened it), as the toolbar's Inspector shuts it
  await js(`(() => { const t = document.getElementById("a").querySelector('.toolbar [data-command="inspector"]'); if (t?.getAttribute("aria-pressed") === "true") t.click(); return true; })()`);
  await b.rest(300);
  check("5: the inspector shut to start the slow double-click", await js(`!document.getElementById("a").querySelector('.stage-drawer [data-panel="inspector"]')`), null);
  // aimed on the canvas at its full width: the view takes the wider canvas in (a ResizeObserver, on the page's
  // own time) on a frame after it
  await sleep(300);
  await b.rest(100);
  await events();
  const slowAt = await P(`aimBest(${J(await cards())}, 'a')`);
  if (!slowAt) check("5: a card of G's in plain sight for the slow double-click", false, null);
  else {
    await b.move(slowAt.x, slowAt.y);
    await b.mouse("mousePressed", slowAt.x, slowAt.y, { clickCount: 1 });
    await b.advance(120);
    await b.mouse("mouseReleased", slowAt.x, slowAt.y, { clickCount: 1 });
    await b.advance(360);
    await b.mouse("mousePressed", slowAt.x, slowAt.y, { clickCount: 2 });
    await b.advance(170);
    await b.mouse("mouseReleased", slowAt.x, slowAt.y, { clickCount: 2 });
    await b.rest(400);
    const ev = await events();
    report.numbers.slowDouble = { at: slowAt, events: ev, after: await state(), entered: J((await state()).focus) === J([ids.link]) };
    check("5: a slow double-click's presses and dblclick all reach the canvas at the width the first press found", ev.length >= 3 && ev.some((e) => e.type === "dblclick") && ev.every((e) => e.on === "canvas" && e.cw === ev[0].cw), ev.map((e) => `${e.type} ${e.on} ${e.cw}`));
  }
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
report.errors = (await js("window.__p?.errors ?? []").catch(() => [])).filter((e) => !/KHR_parallel_shader_compile|GPU stall|pointer ?lock/i.test(e)).slice(0, 20);
writeFileSync(join(SHOTS, "editclick.json"), J(report, null, 2));
const failed = Object.values(list.checks).filter((v) => !v).length;
console.log(J({ summary: `${Object.keys(list.checks).length - failed}/${Object.keys(list.checks).length}`, checks: list.checks, report: join(SHOTS, "editclick.json") }, null, 2));
b.stop(failed ? 1 : 0);
