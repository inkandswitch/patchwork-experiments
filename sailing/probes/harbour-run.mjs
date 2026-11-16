// The harbour in Chrome (water/WATER.md, W12): two boats, each a doc of her
// own, first open alone (each draws her own sea and floats on it), then
// linked live into one harbour with water and a sea of its own. In the
// harbour there is one surface, the harbour's; both hulls float on it (each
// boat's own reading of the water under her is the harbour's water there,
// exactly); both heave as the waves pass; Ship at sea sails her reach in the
// harbour's wind; both boats read the same true wind at one point; neither
// rides the camera nor shows her HUD while nobody is aboard; the sky is the
// harbour's.
//
//   node probes/harbour-run.mjs [--shots <dir>] [--show] [--port 4795]
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
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "harbour-probe"));
const PORT = Number(arg("--port") ?? 4795);
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/harbour-probe.html?seed=1`, width: 1660, height: 540, show: process.argv.includes("--show"), timeout: 900_000 });
const js = (expr, ms = 120_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const loads = (expr, ms = 30_000) => b.waitFor(`window.__p.${expr}`, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], numbers: {} };
const J = JSON.stringify;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `harbour-${name}.png`)));
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const KN = 0.514444;

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
const corr = (a, c) => {
  const ma = mean(a), mc = mean(c);
  let n = 0, da = 0, dc = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (c[i] - mc);
    da += (a[i] - ma) ** 2;
    dc += (c[i] - mc) ** 2;
  }
  return n / Math.sqrt(da * dc || 1);
};

/** Sample boat `hull` (at `link`, or her own world) every `every` s for `seconds` of page time. */
async function sample(w, link, hull, seconds, every = 0.25) {
  const out = [];
  for (let t = 0; t < seconds; t += every) {
    await b.advance(every * 1000);
    out.push(await P(`under('${w}', ${J(link)}, ${J(hull)})`));
  }
  return out;
}

const n3 = (v) => Math.round(v * 1000) / 1000;

try {
  check("page set up", await b.waitFor("window.__ready === true", 30_000, 60) && !(await P("errors")).some((e) => e.startsWith("setup")), await P("errors"));
  const built = await P("build()", 300_000);
  check("two boats made by their templates (Ship at sea, Ship at anchor), each a doc of her own", !!built.hullA && !!built.hullB && built.a !== built.b, built);

  // ─── each boat alone: her own world, her own sea ─────────────────────────
  const alone = {};
  for (const [which, hull] of [["A", built.hullA], ["B", built.hullB]]) {
    await P(`alone('${which}')`, 120_000);
    await b.advance(3000);
    const oceans = await P("oceans('a')");
    const drawers = await P("drawers('a')");
    const readers = await P("readers('a')");
    check(`${which} alone draws her own sea: one surface, drawn by her own (outermost) stage`, oceans === 1 && J(drawers) === "[[]]", { oceans, drawers });
    check(`${which} alone sails on her own water: her reader is the world's, and it's hers`, readers.length === 1 && readers[0].reader && readers[0].sails && readers[0].mine && readers[0].same, readers);
    const s = await sample("a", null, hull, 6);
    const off = s.map((u) => u.y - u.hWorld);
    alone[which] = { mean: mean(off), sd: sd(off), exact: s.every((u) => u.hOwn === u.hWorld) };
    check(`${which} alone floats on it: her own reading of the water under her is the world's exactly, and her hull sits a steady draft off it`, alone[which].exact && alone[which].sd < 0.35, alone[which]);
    check(`${which} alone shows her HUD (her doc is the world)`, (await P("huds('a')")).every(Boolean) && (await P("huds('a')")).length === 1, await P("huds('a')"));
    await shot(`alone-${which}`);
  }
  report.numbers.alone = alone;
  await P("closeAlone()");

  // ─── the harbour ─────────────────────────────────────────────────────────
  const h = await P("harbour()", 300_000);
  check("the harbour opens both boats' stages, each running sailing and water; the harbour runs the sea and water, no ships", !h.error && h.stages.length === 3 && h.stages.find((s) => !s.path.length).running.includes("sailing.sea") && !h.stages.find((s) => !s.path.length).running.includes("sailing"), h);
  await b.advance(2000);
  const cam0 = await P("camera('h')");
  const oceans = await P("oceans('h')");
  const drawers = await P("drawers('h')");
  check("one surface in the harbour, the harbour's: neither boat draws her own sea", oceans === 1 && J(drawers) === "[[]]", { oceans, drawers });
  // W29: each boat's Sea carries her template's clip, silent here, where the harbour offers water; the harbour's own Sea has none
  const clips = await P("clips('h')");
  check("no blocks in the harbour: each boat's clip is silent where the world offers water, and the harbour's Sea has none (W29)", (await P("blocks('h')")) === 0 && clips.every((c) => c.clip === null) && clips.filter((c) => c.path.length).every((c) => Array.isArray(c.sea)) && clips.find((c) => !c.path.length).sea === null, { blocks: await P("blocks('h')"), clips });
  const readers = await P("readers('h')");
  check("every stage's reader is the harbour's water (its components), and both boats sail on it", readers.length === 3 && readers.every((r) => r.reader && r.same) && readers.filter((r) => !r.mine).every((r) => r.sails), readers);
  check("the sky is the harbour's (its sea's maritime day)", (await P("sky('h')")) === "#2f6db5", await P("sky('h')"));
  check("nobody aboard: neither boat shows her HUD in the harbour", (await P("huds('h')")).length === 2 && (await P("huds('h')")).every((v) => !v), await P("huds('h')"));

  const sa = await sample("h", "LA", built.hullA, 20);
  const sb = await sample("h", "LB", built.hullB, 20);
  const exactA = Math.max(...sa.map((u) => Math.abs(u.hOwn - u.hWorld)));
  const exactB = Math.max(...sb.map((u) => Math.abs(u.hOwn - u.hWorld)));
  check("each boat's own reading of the water under her is the harbour's water there (W10 in the real stage)", exactA < 1e-6 && exactB < 1e-6, { exactA, exactB });
  const offA = sa.map((u) => u.y - u.hWorld), offB = sb.map((u) => u.y - u.hWorld);
  report.numbers.harbour = { A: { mean: mean(offA), sd: sd(offA) }, B: { mean: mean(offB), sd: sd(offB) } };
  check("both hulls float on the harbour's water: each sits the draft she had alone off it (within 0.2 m), steadily", Math.abs(mean(offA) - alone.A.mean) < 0.2 && Math.abs(mean(offB) - alone.B.mean) < 0.2 && sd(offA) < 0.35 && sd(offB) < 0.35, report.numbers);
  const cA = corr(sa.map((u) => u.y), sa.map((u) => u.hWorld));
  const cB = corr(sb.map((u) => u.y), sb.map((u) => u.hWorld));
  const heaveA = sd(sa.map((u) => u.y)), heaveB = sd(sb.map((u) => u.y));
  report.numbers.heave = { cA, cB, heaveA, heaveB, waterA: sd(sa.map((u) => u.hWorld)), waterB: sd(sb.map((u) => u.hWorld)) };
  check("both heave as the harbour's waves pass under them: each hull's height follows the water under her", cA > 0.3 && cB > 0.3 && heaveA > 0.005 && heaveB > 0.005, report.numbers.heave);
  const vA = sa.at(-1).speed;
  report.numbers.speedA = { ms: vA, kn: vA / KN };
  check("Ship at sea sails her reach in the harbour's wind: above 2 kn", vA / KN > 2, report.numbers.speedA);
  const wA = await P("windAt('h', 'LA', 0, 0)");
  const wB = await P("windAt('h', 'LB', 0, 0)");
  check("both boats read the same true wind at one point of the harbour", Math.hypot(wA[0] - wB[0], wA[1] - wB[1]) < 1e-9 && Math.hypot(...wA) > 1, { wA, wB });
  const cam1 = await P("camera('h')");
  check("in Look the camera follows neither boat: it stays where the harbour put it", J(cam0?.position?.map(n3)) === J(cam1?.position?.map(n3)) && J(cam0?.target?.map(n3)) === J(cam1?.target?.map(n3)), { cam0, cam1 });
  report.numbers.clocks = await P("clocks('h')");
  await shot("harbour");
  const errs = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors or warnings", errs.length === 0, errs.slice(0, 10));
} catch (err) {
  check(`ran to the end (${err.message})`, false, String(err?.stack || err));
}
report.notices = await P("notices('h')").catch(() => null);
console.log(J(report, null, 2));
b.stop(list.failed ? 1 : 0);
