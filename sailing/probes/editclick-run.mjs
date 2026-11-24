// Edit inside a game aboard, her world running: does a click that lands on
// the boat (outside the entered link) change the viewer's body? Found by
// presence-check.nopause (2026-11-16): in the real Patchwork, B entered Lost
// Cities aboard (Edit) and B's next single click, a card
// missed on the pitching boat, landed on her and came aboard: the Aboard
// body, at the helm, the pointer locked (scene/HISTORY.md, COMPOSITION Decisions,
// Edit's click is Edit's).
//
//   (in scene/, seats/, sailing/, water/, tabletop/, joints/, traversal/) pnpm build
//   node probes/editclick-run.mjs [--shots <dir>] [--seed 1] [--misses 12] [--port 4795] [--cdp 9795]
//
// On aboard-probe.html (one view, A; the page's manual clock, stepped here
// as the wall would move it):
//  1. A builds Lost Cities aboard, her world running; A picks Edit and
//     looks down on the table (the presence-check's camera);
//  2. A enters G (the view's Enter on the link, as the menu's and the
//     inspector's Enter run it): the focus is G, the body still Edit;
//  3. inside G, in Edit: a click on the boat's Card table, then one on her
//     hull, each outside the focus: the body stays Edit, the focus and the
//     selection are unchanged;
//  4. inside G, in Edit: `--misses` single clicks each aimed at a card of
//     G's, her sea moving 150 ms between the aim and the press (what a
//     script's or a hand's latency is): what each press hit (a card of G's,
//     another of G's things such as its board, the boat outside the focus,
//     nothing) and the body after; none boards, and each hit inside G
//     selects what it hit;
//  5. triage (f): back on the boat (not entered), in Edit, the clock still:
//     a card of G's put ~16 px below the canvas's top edge, near its left
//     (where the HUD's Come aboard button sat before the bar of tools took
//     the command, scene HISTORY.md, TOOLS Decisions 10); nothing of sailing's HUD is
//     a button or takes a press anywhere along that edge, and a click on the
//     card leaves the body Edit, the pointer free, the canvas where it was;
//  6. the bar's Come aboard in Edit: there, and a real click on it comes
//     aboard (the crew's body), the canvas's top and height where they were
//     (the bar stays: B3, Come aboard is declared; Edit's drawer goes, so
//     its width grows).
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "seats", "sailing", "walk", "water", "tabletop", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist/index.js: build it first`);
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

// every press A's host hears: when (the event's own stamp), where, what the view picks there now
// (what the router picks for it: no frame comes between), and A's body, focus and selection as it lands
const LISTEN = `(() => {
  const host = document.getElementById("a"); const log = (window.__ev = []);
  const what = (e) => { const v = __p.A.view; const r = v.canvas.getBoundingClientRect(); const hit = v.viewport.pick(e.clientX - r.left, e.clientY - r.top);
    return { type: e.type, stamp: +e.timeStamp.toFixed(1), x: Math.round(e.clientX), y: Math.round(e.clientY), on: e.target === v.canvas ? "canvas" : e.target.tagName.toLowerCase() + "." + String(e.target.className || ""), cw: Math.round(r.width),
      hit: hit?.id ? v.pathOfKey(hit.id) : null, body: __p.A.local.get().body?.id ?? null, focus: v.atom.get().focus, selected: v.atom.get().selected }; };
  host.addEventListener("pointerdown", (e) => log.push(what(e)), true);
  return true; })()`;
const events = () => js("window.__ev.splice(0)");
const state = async () => ({ body: (await P("body('a')")).id, stack: (await P("body('a')")).stack, editing: await js("(__p.A.local.get().hands ?? []).some((h) => h.kind === 'edit')"), focus: await P("focusPath('a')"), selected: await P("selectionPath('a')"), locked: await js("!!document.pointerLockElement") });
// "in Edit": Look, holding the editor (a hand, not a body: scene HISTORY.md, Kernel step 1)
const inEdit = (s) => s.body === "look" && s.editing === true;
const editOver = async () => {
  await js(`(__p.A.view.plugins.record("scene.edit")?.api.run({ ext: "scene.edit", command: "edit", target: null, value: true }), true)`);
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
  check("1: her world runs", await js(`__p.A.view.stages().find((s) => s.path.length === 0).reader.use("clock").status().running`), null);
  await js(LISTEN);
  await editOver();
  check("1: A in Edit, over the table, the focus on the boat", inEdit(await state()) && J(await P("focusPath('a')")) === "[]", await state());

  // ── 2: A enters G ──
  await js(`(__p.A.view.enter(${J([ids.link])}), true)`);
  await b.rest(400);
  await events();
  check("2: Enter on the link enters G", J(await P("focusPath('a')")) === J([ids.link]), await state());
  check("2: entering leaves the body Edit", inEdit(await state()), await state());

  // ── 3: a click on the boat, outside the focus ──
  // the boat's object nearest the canvas's middle, of those a click reaches on a 12 px grid: the table (its top
  // round G's board: its origin is under the board, so no spiral from it finds it), or something else of hers
  // round the table (her deck, a bench, the coachroof), not the table or the link
  const find = (which) => js(`(() => { const v = __p.A.view; const r = v.canvas.getBoundingClientRect(); let best = null;
    const want = (id) => ${which === "table" ? `id === ${J(ids.table)}` : `id !== ${J(ids.table)} && id !== ${J(ids.link)}`};
    for (let y = 8; y < r.height - 8; y += 12) for (let x = 8; x < r.width - 8; x += 12) { const h = v.viewport.pick(x, y); const p = h?.id ? v.pathOfKey(h.id) : null;
      if (!p || p.length !== 1 || !want(p[0]) || document.elementFromPoint(r.left + x, r.top + y) !== v.canvas) continue;
      const d = Math.hypot(x - r.width / 2, y - r.height / 2); if (!best || d < best.d) best = { id: p[0], d, x: r.left + x, y: r.top + y }; } return best; })()`);
  for (const which of ["table", "other"]) {
    if (J(await P("focusPath('a')")) !== J([ids.link]) || !inEdit(await state())) {
      await editOver();
      await js(`__p.A.view.focusOn(${J([ids.link])})`);
      await b.rest(300);
    }
    // over the table again where she is now: her ride doesn't rise with her (crew.js, rise: false), so a heave
    // since the last aim can bring the felt up to the lens
    else {
      await P("setCam('a', __p.overTable('a'))");
      await b.rest(300);
    }
    const before = await state();
    const name = which === "table" ? "the Card table" : "another part of her";
    const at = await find(which);
    if (!at) { check(`3: ${name} in plain sight`, false, null); continue; }
    const id = at.id;
    await b.move(at.x, at.y);
    await press(at.x, at.y, 1);
    await b.rest(600);
    const after = await state();
    const ev = await events();
    report.numbers[`click on ${name}`] = { before, at, ev, after };
    check(`3: in Edit inside G, a click on ${name} (the boat's, outside the focus) leaves the body Edit, the pointer free`, inEdit(after) && !after.locked, { id, hit: ev[0]?.hit, before: before.body, after });
    check(`3: …and the focus and selection as they were`, J(after.focus) === J(before.focus) && J(after.selected) === J(before.selected), { before, after });
    await b.shot(join(SHOTS, `editclick-${which}.png`));
  }

  // ── 4: single clicks at cards, her sea moving between the aim and the press ──
  const misses = [];
  for (let i = 0; i < MISSES; i++) {
    if (J(await P("focusPath('a')")) !== J([ids.link]) || !inEdit(await state())) {
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
    misses.push({ aimed: at.id, where, hit: ev?.hit ?? null, body: after.body, editing: after.editing, selected: after.selected });
    await b.advance(700 + 137 * i); // (another moment of her sea for the next)
  }
  report.numbers.singleClicks = misses;
  const tally = misses.reduce((t, m) => ((t[m.where] = (t[m.where] ?? 0) + 1), t), {});
  check(`4: ${MISSES} single clicks at cards on her moving table, in Edit inside G: none changes the body`, misses.every((m) => inEdit(m)), { tally, misses });
  check("4: …each one on something of G's (a card, or its board) selects that thing", misses.filter((m) => m.where?.startsWith("G ")).every((m) => J(m.selected) === J(m.hit.slice(0, 2))), tally);

  // ── 5: triage (f): a click on a card by the canvas's top edge, in Edit on the boat ──
  const canvasRect = () => js(`(() => { const r = __p.A.view.canvas.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  await js(`(__p.A.view.focusOn([]), __p.A.view.select(null), true)`);
  await editOver();
  await events();
  const want = { x: 40, y: 16 }; // canvas px: where the HUD's Come aboard button sat (top left, 12 px in)
  const gCards = await cards();
  const card = gCards[0];
  // slide the camera (no turn) toward the card's middle projecting at `want`, all in one go on the page: no frame passes
  // meanwhile, for she swings at anchor and the eye rides her level, so a frame between two steps moves the card on the
  // screen; it needn't land exactly: what counts is that the view's pick at `want` is a card of G's
  const at = await js(`(() => { const v = __p.A.view.viewport; const m = __p.worldOf(${J(card)}, "a"); if (!m) return null;
    for (let i = 0; i < 32; i++) {
      const c = v.getCamera(); const p = v.project([m[12], m[13], m[14]]); const f = c.target.map((t, i) => t - c.position[i]); const d = Math.hypot(...f); const fw = f.map((x) => x / d);
      const up = c.up, right = [fw[1] * up[2] - fw[2] * up[1], fw[2] * up[0] - fw[0] * up[2], fw[0] * up[1] - fw[1] * up[0]];
      const dist = Math.hypot(m[12] - c.position[0], m[13] - c.position[1], m[14] - c.position[2]);
      const k = (2 * dist * Math.tan((c.fov * Math.PI) / 360)) / v.size.h;
      const dx = ${want.x} - p.x, dy = ${want.y} - p.y;
      if (Math.hypot(dx, dy) < 1.5) return { x: p.x, y: p.y, done: true, steps: i };
      const shift = right.map((r, i) => 0.7 * (-dx * k * r + dy * k * up[i])); // damped: the card isn't at the distance k assumes
      v.setCamera({ position: c.position.map((x, i) => x + shift[i]), target: c.target.map((x, i) => x + shift[i]) });
    }
    const p = v.project([m[12], m[13], m[14]]); return { x: p.x, y: p.y, done: false, steps: 32 }; })()`);
  const cr = await canvasRect();
  const onCard = await js(`(() => { const v = __p.A.view.viewport; const h = v.pick(${want.x}, ${want.y}); return h?.id ? __p.A.view.pathOfKey(h.id) : null; })()`);
  report.numbers.topEdge = { at, onCard, card, canvas: cr };
  check("5: a card of G's lies 16 px below the canvas's top edge, 40 px in from its left (the view's pick there is one)", onCard?.[0] === ids.link && gCards.includes(onCard[1]), report.numbers.topEdge);
  // nothing of sailing's HUD takes a press along the top edge: no button in it, and every point of the top 48 px band that isn't
  // the canvas is something else's (the HUD's own nodes are pointer-events: none)
  const band = await js(`(() => { const v = __p.A.view, r = v.canvas.getBoundingClientRect(), hud = document.querySelector("#a .sail-hud"); const takers = new Set();
    for (let y = 2; y < 48; y += 4) for (let x = 2; x < r.width - 2; x += 8) { const e = document.elementFromPoint(r.left + x, r.top + y); if (e && hud?.contains(e)) takers.add(e.className || e.tagName); }
    return { hud: !!hud, state: hud?.dataset.state ?? null, buttons: hud ? hud.querySelectorAll("button").length : null, hint: hud?.querySelector('[data-k="hint"]')?.textContent ?? null, takers: [...takers] }; })()`);
  report.numbers.hudBand = band;
  check("5: in Edit on her, sailing's HUD holds no button and takes no press along the canvas's top edge", band.hud && band.buttons === 0 && band.takers.length === 0, band);
  // nor does it say "Click her to come aboard" (N11 step 10): in Edit a click selects her, and the HUD can't know the base
  check("5: in Edit on her, sailing's HUD says nothing before you're aboard (the way in is the bar's Come aboard)", band.state === "lobby" && band.hint === "", band);
  const x = cr.left + want.x, y = cr.top + want.y;
  await b.move(x, y);
  await press(x, y, 1);
  await b.rest(400);
  // what the click did (triage (f): it hit the HUD's button, came aboard, left Edit and moved the canvas 36 px)
  const after5 = await state();
  const ev5 = await events();
  report.numbers.topEdgeClick = { after: after5, canvas: await canvasRect(), events: ev5 };
  check("5: a click by the top edge leaves the body Edit, the pointer free, and the canvas's top where it was (triage (f))", inEdit(after5) && !after5.locked && (await canvasRect()).top === cr.top, { before: cr, after: after5, hits: ev5.map((e) => ({ type: e.type, on: e.on, hit: e.hit })) });

  // ── 6: the bar's Come aboard, from Edit ──
  await js(`(__p.A.view.focusOn([]), __p.A.view.select(null), true)`);
  await b.rest(300);
  const aboardButton = `(() => { const e = document.querySelector('#a .toolbar .world [data-command="aboard"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: e.textContent.trim(), title: e.title, enabled: !e.disabled }; })()`;
  // the pointer goes to the button, as a person's does to read its tooltip: off the canvas, so nothing is looked at
  // (looking at G, a link, Enter is its Open's, and the bar shows Come aboard without it: EDITOR.md, H3)
  const at6 = await js(aboardButton);
  if (at6) await b.move(at6.x, at6.y);
  await b.rest(300);
  const way = await js(aboardButton);
  const cr6 = await canvasRect();
  check("6: in Edit on her, the bar of tools offers Come aboard (Enter)", way?.text === "Come aboard" && way.enabled && way.title === "Walk the deck in first person (Enter)", way);
  if (way) {
    await b.click(way.x, way.y);
    await b.rest(600);
    const after6 = await state();
    const cr6b = await canvasRect();
    report.numbers.barAboard = { way, after: after6, canvas: [cr6, cr6b] };
    check("6: a click on it comes aboard: the crew's body, the editor still held (a hand: walking while editing)", after6.body === "walk" && after6.stack.includes("walk") && after6.editing, after6);
    check("6: …and the canvas's top and height stay (the bar stays: Come aboard is declared)", cr6b.top === cr6.top && cr6b.height === cr6.height, { before: cr6, after: cr6b });
  }

} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
report.errors = (await js("window.__p?.errors ?? []").catch(() => [])).filter((e) => !/KHR_parallel_shader_compile|GPU stall|pointer ?lock/i.test(e)).slice(0, 20);
writeFileSync(join(SHOTS, "editclick.json"), J(report, null, 2));
const failed = Object.values(list.checks).filter((v) => !v).length;
console.log(J({ summary: `${Object.keys(list.checks).length - failed}/${Object.keys(list.checks).length}`, checks: list.checks, report: join(SHOTS, "editclick.json") }, null, 2));
b.stop(failed ? 1 : 0);
