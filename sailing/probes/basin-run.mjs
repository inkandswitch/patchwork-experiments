// The Model basin in Chrome (water/WATER.md, "Water bodies": the lead's yes
// to an inner world keeping its own water). Two docs, each her own: Ship at
// sea (open water: weather) and the Model basin (a 30 × 3 × 30 m box of water
// with a sloop in it: a thing; no open water, no weather). Alone, the basin
// draws its patch and no open surface, and its sloop floats on it at the
// draft Ship at sea has on hers. Linked side by side into a dry room (no
// water, no weather), each keeps her own water (the path rule: each ambient
// the outermost offer on a stage's own path, WATER.md Decisions 90 to 96):
// one open surface, Ship at sea's own, drawn by her stage; the basin's patch
// drawn once, by the basin's stage; the basin's sloop still floats on the
// basin, flat and still (nothing on her path offers wind); Ship at sea floats
// on her own sea at the draft she has alone, stepped, in her own weather, so
// her HUD shows as it does alone.
//
//   node probes/basin-run.mjs [--shots <dir>] [--show] [--port 4796]
//
// Build scene, sailing, water, joints and traversal first. Hold the shared
// Chrome lock while it runs (one Chrome at a time).
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "sailing", "water", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "basin-probe"));
const PORT = Number(arg("--port") ?? 4796);
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/basin-probe.html?seed=1`, width: 1660, height: 540, show: process.argv.includes("--show"), timeout: 900_000 });
const js = (expr, ms = 120_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], numbers: {} };
const J = JSON.stringify;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `basin-${name}.png`)));
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));

/** Sample a hull every `every` s for `seconds` of page time. */
async function sample(w, link, hull, seconds, every = 0.25) {
  const out = [];
  for (let t = 0; t < seconds; t += every) {
    await b.advance(every * 1000);
    out.push(await P(`under('${w}', ${J(link)}, ${J(hull)})`));
  }
  return out;
}

try {
  check("page set up", await b.waitFor("window.__ready === true", 30_000, 60) && !(await P("errors")).some((e) => e.startsWith("setup")), await P("errors"));
  const built = await P("build()", 300_000);
  check("Ship at sea by her template; the Model basin a basin and a sloop, with no open water and no weather", !!built.hullA && !!built.hullM && built.mObjects.includes("Basin") && !built.mObjects.includes("Sea") && !built.mTraits.includes("sailing.weather"), built);

  // ─── each alone ──────────────────────────────────────────────────────────
  await P("alone('A')", 120_000);
  await b.advance(3000);
  const sA = await sample("a", null, built.hullA, 5);
  const draftA = mean(sA.map((u) => u.y - u.h));
  report.numbers.aloneA = { draft: draftA, sd: sd(sA.map((u) => u.y - u.h)), body: sA.at(-1).body };
  check("Ship at sea alone floats on her own open water (body null)", sA.every((u) => u.body === null && Number.isFinite(u.h)), report.numbers.aloneA);
  await P("closeAlone()");

  await P("alone('M')", 120_000);
  await b.advance(3000);
  check("the basin alone draws its patch and no open surface", (await P("oceans('a')")) === 0 && (await P("patches('a')")) === 1, { oceans: await P("oceans('a')"), patches: await P("patches('a')"), drawers: await P("drawers('a')") });
  const sM = await sample("a", null, built.hullM, 5);
  const offM = sM.map((u) => u.y - u.h);
  report.numbers.aloneM = { draft: mean(offM), sd: sd(offM), body: sM.at(-1).body, h: sM.at(-1).h };
  check("the basin's sloop floats on the basin (its own bounded body), its surface flat at 0, at Ship at sea's draft (within 0.2 m), steadily", sM.every((u) => u.body === "basin" && u.h === 0) && Math.abs(mean(offM) - draftA) < 0.2 && sd(offM) < 0.05, report.numbers.aloneM);
  check("she is stepped (the basin's clock runs her)", sM.at(-1).simulating === true, sM.at(-1));
  await shot("alone-M");
  await P("closeAlone()");

  // ─── the dry room ────────────────────────────────────────────────────────
  const r = await P("room()", 300_000);
  check("the room opens both docs' stages, each running sailing and water; the room runs neither", !r.error && r.stages.length === 3 && !r.stages.find((s) => !s.path.length).running.some((x) => x === "water" || x === "sailing" || x === "sailing.sea"), r);
  await b.advance(3000);
  const oceans = await P("oceans('h')");
  const patches = await P("patches('h')");
  const drawers = await P("drawers('h')");
  check("one open surface in the room, Ship at sea's own, drawn by her stage; the basin's patch is drawn once, by the basin's stage", oceans === 1 && patches === 1 && J(drawers.filter((d) => d.patches.length).map((d) => [d.path, d.patches])) === J([[["LM"], ["basin"]]]) && J(drawers.filter((d) => d.open).map((d) => d.path)) === J([["LA"]]), { oceans, patches, drawers });
  const rM = await sample("h", "LM", built.hullM, 8);
  const offR = rM.map((u) => u.y - u.h);
  report.numbers.roomM = { draft: mean(offR), sd: sd(offR), body: rM.at(-1).body };
  check("in the room the basin's sloop still floats on her own basin, flat, at the draft she had alone (within 0.05 m)", rM.every((u) => u.body === "basin" && u.h === 0) && Math.abs(mean(offR) - report.numbers.aloneM.draft) < 0.05 && sd(offR) < 0.05, report.numbers.roomM);
  const still = rM.map((u) => Math.hypot(u.x - rM[0].x, u.z - rM[0].z));
  check("and still: nothing on her path offers wind (she drifts under 0.5 m in 8 s)", Math.max(...still) < 0.5, { drift: Math.max(...still) });
  const rA = await sample("h", "LA", built.hullA, 4);
  const offA = rA.map((u) => u.y - u.h);
  report.numbers.roomA = { draft: mean(offA), sd: sd(offA), last: rA.at(-1) };
  check("Ship at sea floats on her own sea in the room (her open water, body null), at the draft she has alone (within 0.2 m)", rA.every((u) => u.body === null && Number.isFinite(u.h)) && Math.abs(mean(offA) - draftA) < 0.2, report.numbers.roomA);
  check("she is stepped (her own clock runs her sea)", rA.at(-1).simulating === true, rA.at(-1));
  const huds = await P("huds('h')");
  check("nobody aboard: only Ship at sea's HUD shows, as alone (she sails in her own weather); the basin's sloop's doesn't", huds.filter(Boolean).length === 1, huds);
  await shot("room");
  const errs = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors or warnings", errs.length === 0, errs.slice(0, 10));
} catch (err) {
  check(`ran to the end (${err.message})`, false, String(err?.stack || err));
}
report.notices = await P("notices('h')").catch(() => null);
console.log(J(report, null, 2));
b.stop(list.failed ? 1 : 0);
