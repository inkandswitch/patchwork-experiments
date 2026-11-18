// Extract and bundle on a real example (scene/EDITOR.md, "Extract and bundle", build step
// 15): Lost Cities aboard, the boat's card table and the game linked on it
// made a scene of their own, then bundled back.
//
//   (in scene/, seats/, sailing/, tabletop/, joints/ and traversal/) pnpm build
//   node probes/extract-run.mjs [--shots <dir>] [--show] [--port 4783] [--cdp 9783]
//
// Mounts the BUILT scene tool with the BUILT packages on aboard-probe.html
// (the page aboard-run.mjs uses, unchanged): A builds the sloop at anchor
// with the Card table in her cockpit and Lost Cities linked on it, as
// aboard-run does. Then, in Edit, through the scene.transfer commands any
// surface runs (api.run), it checks:
//  1. Extract on the table: a new scene doc T holds the table and the game's
//     link, ids and transforms as they were (the table at T's root, where
//     the hull's frame was); the boat holds one link to T at the hull, no
//     transform of its own, a hint the table's size; the link is selected;
//     one undo step (that each is one host change and writes nothing else
//     is scene/src/extract.test.js's, over every case);
//  2. the game, linked inside T now, acts there (its stage's path is the
//     boat's link to T, then T's link to the game): its cards are drawn
//     exactly where they were (to 1e-9 m), its rule and keeper run;
//  3. Undo takes the extract back as one step, and Redo does it again;
//  4. Bundle on the boat's link to T: the boat is what it was before 1, on
//     every field (the stage's runtime fields aside), the table and the
//     game's link under their own ids; T is never written; the game acts
//     at its first path again, its cards where they were;
//  5. nothing failed to load, no errors on the page.
// Prints a JSON checklist; exits non-zero if any check fails.
//
// Simulated time: the page's manual clock (window.__time), the world held
// (?held) as aboard-run holds it while it sets up. Loading is the wall's
// (loads); nothing here waits on the world.
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "seats", "sailing", "walk", "water", "tabletop", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist/index.js: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "sailing-extract"));
const PORT = Number(arg("--port") ?? 4783);
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/aboard-probe.html?held&seed=1`, width: 1416, height: 530, show: process.argv.includes("--show"), timeout: 600_000 });
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const X = (e, ms) => js(`window.__ex.${e}`, ms);
const loads = (expr, ms = 20_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], numbers: {} };
const t0 = Date.now();
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `extract-${name}.png`)));
const J = JSON.stringify;

// what the run reads in the page: the boat's doc, the general parts' api (scene.transfer runs in the focus
// stage, the boat's), each doc by url, where the game acts, and where its cards are drawn
const HELPERS = `window.__ex = (() => {
  const dbg = () => window.__p.A;
  const api = () => dbg().view.plugins.record("scene.transfer").api;
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const docAt = (url) => window.repo.handles.get(url)?.doc() ?? null;
  const links = (d) => Object.entries(d.objects ?? {}).filter(([, o]) => o.providerId === "scene.link").map(([id, o]) => ({ id, url: o.sourceUrl }));
  const stageOf = (url) => dbg().view.stages().find((s) => s.url === url && s.acts) ?? null;
  return {
    host: () => plain(api().doc()),
    hostUrl: () => api().url,
    doc: (url) => plain(docAt(url)),
    heads: (url) => window.repo.handles.get(url)?.heads() ?? null,
    links: () => links(api().doc()),
    selected: () => dbg().local.get().selected ?? null,
    edits: () => plain(dbg().local.get().edits),
    run: (command, target, value) => api().run({ ext: "scene.transfer", command, target, value }),
    edit: () => dbg().view.focusStage().reader.run({ ext: "scene.edit", command: "edit", target: null, value: true }),
    body: () => dbg().local.get().body?.id ?? null,
    editing: () => (dbg().local.get().hands ?? []).some((h) => h.kind === "edit"),
    undo: () => api().undo(),
    redo: () => api().redo(),
    // the game's stage: where it acts, what runs there
    gamePath: (url) => stageOf(url)?.path ?? null,
    gameRuns: (url, ext) => !!stageOf(url)?.debug.host.instanceOf(ext),
    // where each of these game objects is drawn, in the world (the viewport's, through every frame on the way)
    drawn(url, ids) {
      const s = stageOf(url);
      if (!s) return null;
      const SEP = "\\u001f";
      return ids.map((id) => { const m = dbg().viewport.worldOf(s.n === 0 ? id : SEP + s.n + SEP + id); return m ? [...m] : null; });
    },
    cards: (url, n) => Object.entries(docAt(url)?.objects ?? {}).filter(([, o]) => o.traits?.["tabletop.card"]).slice(0, n).map(([id]) => id),
    built: (url) => { const s = stageOf(url); if (!s) return false; return Object.keys(docAt(url)?.objects ?? {}).every((id) => docAt(url).objects[id].kind === "group" || dbg().viewport.contentOf(s.n === 0 ? id : "\\u001f" + s.n + "\\u001f" + id)?.loaded); },
  };
})(); true`;

/** The largest difference between two lists of 4×4 matrices (null if either is missing one). */
const maxDiff = (a, b) => (a && b && a.every(Boolean) && b.every(Boolean) ? Math.max(...a.flatMap((m, i) => m.map((v, k) => Math.abs(v - b[i][k])))) : null);

/** The objects attached under `root` in a doc, at any depth, and root itself. */
function subtree(doc, root) {
  const out = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, o] of Object.entries(doc.objects)) if (!out.has(id) && out.has(o.parent)) out.add(id), (grew = true);
  }
  return out;
}

/** A value with every map's keys in order: two docs written in different orders compare equal. */
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
/** A doc as compared: the stage's runtime fields (claims, saved) gone from these objects; keys in order. */
function comparable(doc, ids) {
  const d = JSON.parse(JSON.stringify(doc));
  for (const id of ids) if (d.objects[id]) for (const f of ["claims", "saved"]) delete d.objects[id][f];
  return canon(d);
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  check("the start screen offers Ship at anchor", await loads("window.__p.templates('a').includes('ship-at-anchor')", 20_000), await P("templates('a')"));
  const ids = await P("build()", 120_000);
  check("built through the start screen and the parts bin: the table in her cockpit, Lost Cities linked on it", !ids.error && ids.table && ids.link, ids);
  await js(HELPERS);
  const game = (await X("links()")).find((l) => l.id === ids.link)?.url;
  check("everything loads", await loads("window.__p.loaded('a').loaded === window.__p.loaded('a').total", 120_000), await P("loaded('a')"));
  const cards = await X(`cards(${J(game)}, 6)`);
  const drawn0 = await X(`drawn(${J(game)}, ${J(cards)})`);
  const host0 = await X("host()");
  const S = [...subtree(host0, ids.table)];
  report.numbers.extracted = S.map((id) => host0.objects[id].name);
  await X("edit()");
  check("A holds the editor", await loads("window.__ex.editing()", 5000), await X("body()"));
  await shot("before");

  // ── 1 ──
  check("1: Extract runs on the table (no traits ticked)", (await X(`run("extract", ${J(ids.table)}, [])`)) === true);
  check("1: the boat holds a link to a new scene", await loads(`window.__ex.links().some((l) => l.url !== ${J(game)})`, 20_000), await X("links()"));
  const host1 = await X("host()");
  const lt = (await X("links()")).find((l) => l.url !== game);
  const T = await X(`doc(${J(lt.url)})`);
  check(
    "1: T holds the table and what's on it (the game's link among them) under their own ids, transforms as they were, the table at T's root",
    J(Object.keys(T.objects).sort()) === J([...S].sort()) && T.objects[ids.link]?.sourceUrl === game && T.objects[ids.table].parent === null && S.every((id) => J(T.objects[id].transform) === J(host0.objects[id].transform)),
    { T: Object.keys(T.objects), S, link: T.objects[ids.link], table: T.objects[ids.table] },
  );
  const link = host1.objects[lt.id];
  check(
    "1: the boat: the table and what was on it gone, one link to T at the hull, no transform of its own, a hint the table's size; selected",
    S.every((id) => !host1.objects[id]) && link.parent === ids.hull && J(link.transform) === J({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }) && !!link.hint?.bounds && (await X("selected()")) === lt.id,
    { link, selected: await X("selected()") },
  );
  const tHeads = await X(`heads(${J(lt.url)})`);
  check("1: one undo step, “Extract”", (await X("edits()")).undo === "Extract", await X("edits()"));

  // ── 2 ──
  check("2: the game acts inside T now: its stage's path is the boat's link to T, then T's link to the game", await loads(`JSON.stringify(window.__ex.gamePath(${J(game)})) === ${J(J([lt.id, ids.link]))}`, 20_000), await X(`gamePath(${J(game)})`));
  await loads(`window.__ex.built(${J(game)})`, 60_000);
  const drawn1 = await X(`drawn(${J(game)}, ${J(cards)})`);
  report.numbers.cardsMovedByExtract = maxDiff(drawn0, drawn1);
  check("2: its cards are drawn exactly where they were (1e-9)", report.numbers.cardsMovedByExtract !== null && report.numbers.cardsMovedByExtract < 1e-9, report.numbers.cardsMovedByExtract);
  check("2: its own extensions run there (tabletop, the keeper)", (await X(`gameRuns(${J(game)}, "tabletop")`)) && (await X(`gameRuns(${J(game)}, "card-table")`)), { tabletop: await X(`gameRuns(${J(game)}, "tabletop")`), keeper: await X(`gameRuns(${J(game)}, "card-table")`) });
  await shot("extracted");

  // ── 3 ──
  check("3: Undo takes it back as one step: the boat as it was", (await X("undo()")) === true && J(comparable(await X("host()"), [])) === J(comparable(host0, [])), null);
  check("3: …and the game acts at its first path again", await loads(`JSON.stringify(window.__ex.gamePath(${J(game)})) === ${J(J([ids.link]))}`, 20_000), await X(`gamePath(${J(game)})`));
  check("3: Redo does it again", (await X("redo()")) === true && J(comparable(await X("host()"), [])) === J(comparable(host1, [])), null);
  await loads(`JSON.stringify(window.__ex.gamePath(${J(game)})) === ${J(J([lt.id, ids.link]))}`, 20_000);

  // ── 4 ──
  check("4: Bundle runs on the boat's link to T (no traits ticked)", (await X(`run("bundle", ${J(lt.id)}, [])`)) === true);
  check("4: the link to T is gone", await loads(`!window.__ex.links().some((l) => l.url === ${J(lt.url)})`, 20_000), await X("links()"));
  const host2 = await X("host()");
  check("4: the boat is what it was before the extract, on every field but the stage's runtime fields", J(comparable(host2, S)) === J(comparable(host0, S)), { now: Object.keys(host2.objects).length, was: Object.keys(host0.objects).length, order: host2.order.length === host0.order.length });
  check("4: T was never written by the bundle", J(await X(`heads(${J(lt.url)})`)) === J(tHeads), { before: tHeads, after: await X(`heads(${J(lt.url)})`) });
  check("4: the game acts at its first path again", await loads(`JSON.stringify(window.__ex.gamePath(${J(game)})) === ${J(J([ids.link]))}`, 20_000), await X(`gamePath(${J(game)})`));
  await loads(`window.__ex.built(${J(game)})`, 60_000);
  const drawn2 = await X(`drawn(${J(game)}, ${J(cards)})`);
  report.numbers.cardsMovedByRoundTrip = maxDiff(drawn0, drawn2);
  check("4: its cards are drawn exactly where they were (1e-9)", report.numbers.cardsMovedByRoundTrip !== null && report.numbers.cardsMovedByRoundTrip < 1e-9, report.numbers.cardsMovedByRoundTrip);
  check("4: one undo step, “Bundle”", (await X("edits()")).undo === "Bundle", await X("edits()"));
  await shot("bundled");

  // ── 5 ──
  check("5: nothing failed to load", (await P("loading('a')")).errors === 0, await P("loading('a')"));
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("5: no errors on the page", errors.length === 0, errors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
report.seconds = Math.round((Date.now() - t0) / 1000);
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
