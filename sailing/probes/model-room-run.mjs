// The Model room in Chrome (water/WATER.md, "Clipped open water"; W17, W27,
// W29, W30, W32 in the real stage). Two boats at anchor, each a doc of her
// own whose open water carries her template's clip, linked live at 1:25
// into a dry room (no water, no weather) as publish-model-room.mjs lays
// them out. In the room: no open surface; two blocks, each drawn by its
// boat's stage with its skirt and floor, its floor on the room's floor;
// each hull afloat on her own block at her waterline (the water under her
// origin at her block's level, calm: the room has no wind), at the draft
// she has alone; no HUD and no camera ride (her doc isn't the world); at
// 1:25, and sailing doesn't refuse the scale (her water is her doc's). Her
// water shrunk from under her: held where she was; given back: she goes on
// from there. Then the room linked into a wet harbour: the blocks go, one
// open surface (the harbour's); at 1:25 the boats are at another scale than
// its sea, so sailing refuses it (gravity doesn't scale) and they rest.
//
//   node probes/model-room-run.mjs [--shots <dir>] [--show] [--port 4797]
//
// Build scene, sailing, water, joints and traversal first. Hold the shared
// Chrome lock while it runs (one Chrome at a time).
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "sailing", "water", "weather", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "model-room-probe"));
const PORT = Number(arg("--port") ?? 4797);
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/model-room-probe.html?seed=1`, width: 1660, height: 540, show: process.argv.includes("--show"), timeout: 900_000 });
const js = (expr, ms = 120_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], numbers: {} };
const J = JSON.stringify;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `model-room-${name}.png`)));
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
const dist = (u, v) => Math.hypot(u.x - v.x, u.z - v.z);

/** Sample a hull every `every` s for `seconds` of page time. */
async function sample(w, path, hull, seconds, every = 0.25) {
  const out = [];
  for (let t = 0; t < seconds; t += every) {
    await b.advance(every * 1000);
    out.push(await P(`under('${w}', ${J(path)}, ${J(hull)})`));
  }
  return out;
}

try {
  check("page set up", await b.waitFor("window.__ready === true", 30_000, 60) && !(await P("errors")).some((e) => e.startsWith("setup")), await P("errors"));
  const ids = await P("build()", 300_000);
  check("two boats at anchor by the template, each her Sea's clip from her layout", !!ids.hullA && !!ids.hullB && Array.isArray(ids.clipA) && ids.clipA.length === 3 && Array.isArray(ids.clipB), ids);

  // ─── A alone: her own open sea (the clip silent: her doc is the world) ───
  await P("alone('A')", 120_000);
  await b.advance(3000);
  const sA = await sample("a", null, ids.hullA, 5);
  const draftA = mean(sA.map((u) => u.y - u.h));
  report.numbers.aloneA = { draft: draftA, sd: sd(sA.map((u) => u.y - u.h)), body: sA.at(-1).body };
  check("alone she floats on her own open water (body null), no block drawn: alone, a clip is never live", sA.every((u) => u.body === null) && (await P("patches('a')")) === 0 && (await P("oceans('a')")) === 1, { ...report.numbers.aloneA, patches: await P("patches('a')") });
  await P("closeAlone()");

  // ─── the Model room ──────────────────────────────────────────────────────
  const r = await P("room()", 300_000);
  check("the room opens both boats' stages, each running sailing and water; the room runs neither", !r.error && r.stages.length === 3 && !r.stages.find((s) => !s.path.length).running.some((x) => x === "water" || x === "sailing"), r);
  check("the blocks lie side by side without overlapping, at 1:25", r.blocks && Math.abs(r.blocks[0].x - r.blocks[1].x) >= (r.blocks[0].w + r.blocks[1].w) / 2 && r.links.every((l) => l.scale === 0.04), r);
  // a boat put on a calm block from her doc's pose bobs a while before she settles
  await b.advance(12000);
  const oceans = await P("oceans('h')");
  const patches = await P("patches('h')");
  const drawers = await P("drawers('h')");
  check("no open surface in the room; two blocks, each drawn by its own boat's stage, her clip live there", oceans === 0 && patches === 2 && J(drawers.filter((d) => d.patches.length).map((d) => [d.path, d.patches, d.clip]).sort((a, b) => (a[0][0] < b[0][0] ? -1 : 1))) === J([[["LA"], [ids.seaA], ids.seaA], [["LB"], [ids.seaB], ids.seaB]]) && drawers.every((d) => !d.open), { oceans, patches, drawers });
  const faces = await P("faces('h')");
  check("each block is drawn as a volume: its skirt and floor, seen from either side", faces.length === 2 && faces.every((f) => f.sides > 4 && f.sides < f.vertices && f.doubleSided), faces);
  const rA = await sample("h", ["LA"], ids.hullA, 6);
  const rB = await sample("h", ["LB"], ids.hullB, 6);
  const offA = rA.map((u) => u.y - u.h), offB = rB.map((u) => u.y - u.h);
  report.numbers.room = { A: { draft: mean(offA), sd: sd(offA), h: rA.at(-1).h, body: rA.at(-1).body, scale: rA.at(-1).frameScale }, B: { draft: mean(offB), sd: sd(offB), h: rB.at(-1).h, body: rB.at(-1).body } };
  check("each hull is afloat on her own block (its body her Sea), the water under her origin at its level (calm: the room has no wind)", rA.every((u) => u.body === ids.seaA && Math.abs(u.h) < 1e-6) && rB.every((u) => u.body === ids.seaB && Math.abs(u.h) < 1e-6), report.numbers.room);
  check("at the draft she has alone (within 0.2 m), steadily, and stepped", Math.abs(mean(offA) - draftA) < 0.2 && Math.abs(mean(offB) - draftA) < 0.2 && sd(offA) < 0.05 && sd(offB) < 0.05 && rA.at(-1).simulating && rB.at(-1).simulating, report.numbers.room);
  check("at 1:25 (her stage's frame scaled), and sailing doesn't refuse it: her water is her doc's", Math.abs(rA.at(-1).frameScale - 0.04) < 1e-9 && !(await P("notices('h')")).some((n) => /another scale/.test(n)), { scale: rA.at(-1).frameScale, notices: await P("notices('h')") });
  check("no HUD and no camera ride: her doc isn't the world", (await P("huds('h')")).every((v) => !v) && rA.every((u) => !u.world) && rB.every((u) => !u.world), { huds: await P("huds('h')"), world: [rA.at(-1).world, rB.at(-1).world] });
  await shot("room");

  // ─── her water from under her, and back ──────────────────────────────────
  const before = (await sample("h", ["LA"], ids.hullA, 0.5)).at(-1);
  await P(`setClip('A', [4, 11, 4])`);
  const gone = await sample("h", ["LA"], ids.hullA, 3);
  report.numbers.shrunk = { body: gone.map((u) => u.body), moved: Math.max(...gone.map((u) => dist(u, gone[0]))), from: dist(gone[0], before) };
  check("her clip shrunk from under her: no water, and no block under her (the shrunk block elsewhere)", gone.every((u) => u.body === "none") && (await P("patches('h')")) === 2, report.numbers.shrunk);
  check("she is held where she was, not put back at a checkpoint", report.numbers.shrunk.moved < 1e-6 && report.numbers.shrunk.from < 0.05, report.numbers.shrunk);
  await P(`setClip('A', ${J(ids.clipA)})`);
  const back = await sample("h", ["LA"], ids.hullA, 3);
  const offBack = back.slice(4).map((u) => u.y - u.h);
  report.numbers.back = { body: back.at(-1).body, from: dist(back[0], gone.at(-1)), draft: mean(offBack) };
  check("given back: she goes on from where she was held, afloat on her block again, stepped", back.every((u) => u.body === ids.seaA) && report.numbers.back.from < 0.05 && Math.abs(mean(offBack) - draftA) < 0.2 && back.at(-1).simulating, report.numbers.back);

  // ─── the same room in a wet harbour ──────────────────────────────────────
  const h = await P("wet()", 300_000);
  check("the room linked into a wet harbour opens all four stages", !h.error && h.stages.length === 4, h);
  await b.advance(3000);
  const wOceans = await P("oceans('h')"), wPatches = await P("patches('h')"), wDrawers = await P("drawers('h')");
  check("in a wet world the blocks go: one open surface, the harbour's, and no block (W29)", wOceans === 1 && wPatches === 0 && wDrawers.filter((d) => d.open).map((d) => d.path.length).join() === "0" && wDrawers.every((d) => d.clip === null), { wOceans, wPatches, wDrawers });
  const hA = await sample("h", ["LR", "LA"], ids.hullA, 2), hB = await sample("h", ["LR", "LB"], ids.hullB, 2);
  // the harbour's sea reaches them, but at 1:25: a boat doesn't sail at another scale than the water she's on (gravity doesn't scale), so they rest.
  // Resting is not being stepped with no water under her, not her doc's clock standing still: that may run (it
  // used to wait out the room view's claim, left behind as it closed, which is what an earlier `!simulating` here read).
  const still = (s) => Math.max(...s.map((u) => Math.hypot(u.x - s[0].x, u.y - s[0].y, u.z - s[0].z)));
  report.numbers.wet = { A: { body: hA.map((u) => u.body), moved: still(hA) }, B: { body: hB.map((u) => u.body), moved: still(hB) } };
  check("the harbour's open water is the water there, at another scale: sailing refuses it, so both rest (still), and says so", hA.every((u) => u.body === "none") && hB.every((u) => u.body === "none") && still(hA) < 1e-6 && still(hB) < 1e-6 && (await P("notices('h')")).some((n) => /another scale/.test(n)), { ...report.numbers.wet, notices: await P("notices('h')") });
  await shot("wet");
  const errs = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors or warnings", errs.length === 0, errs.slice(0, 10));
} catch (err) {
  check(`ran to the end (${err.message})`, false, String(err?.stack || err));
}
report.notices = await P("notices('h')").catch(() => null);
console.log(J(report, null, 2));
b.stop(list.failed ? 1 : 0);
