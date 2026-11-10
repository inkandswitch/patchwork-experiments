// The naval study against fixture subjects (and a real-size camber hull), in headless Chrome.
//
//   (in naval/) pnpm build; for the camber hull: (in camber/patchwork) npm run build, and camber's own npm install (for its tsx)
//   node probes/study-run.mjs [--camber ~/dev/camber] [--no-camber] [--shots <dir>] [--show]
//
// Mounts the BUILT study tool (naval/dist) on an in-memory repo
// (probes/study-probe.html), Chrome guarded by chrome-guard.mjs through
// cdp.mjs. Adds, through the study's own Add field: the Catalina 30 and the
// J/24 (published-boat rig designs, synthetic hulls), a scene render (which
// must be refused: link the hull itself), and, with camber, camber's
// kinked-curvature example as a hull doc at real size (12 m, made in node by
// camber-hull-doc.mts with camber's own commands) built by camber's own
// scene:source. Checks the particulars and the compare columns render, with
// envelope badges, Δ against the baseline, the can't-tell panel, an Export;
// no page errors. Screenshots desktop light and dark and 390 px.
// When camber registers a chartroom:source, says whether the hull's statics
// came from it, and then adds the same hull again as a GLB file (no
// provider: the mesh is its only engine) and checks the two agree: the
// agreement check between camber's own hydrostatics and naval's mesh-hydro,
// at probe time because no package imports another. With the table, every
// upright figure it carries (∇, Aw, LCB, LCF, KMt, and Cb/Cp/Cw over the
// mesh's lengths) is camber's; what a table has no field for (LOA, LWL,
// BWL, Tc, the wetted surface, Cm, the half angle of entrance) is read off
// the same mesh at the same waterplane either way, so it must be identical.
import { join, resolve, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const CAMBER = resolve(arg("--camber", join(homedir(), "dev/camber")));
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "study-shots"));
const EXAMPLE = "cuvature-kink-with-unmodified-pchip.json";
const TSX = join(CAMBER, "node_modules/.bin/tsx");
if (!existsSync(join(PKG, "dist/index.js"))) throw new Error("no dist/index.js: pnpm build first");
const withCamber = !process.argv.includes("--no-camber") && [join(CAMBER, "patchwork/dist/index.js"), TSX, join(CAMBER, "examples", EXAMPLE)].every(existsSync);
const hullDoc = withCamber ? JSON.parse(execFileSync(TSX, [join(PKG, "probes/camber-hull-doc.mts"), CAMBER, EXAMPLE, "Kinked hull, 12 m", "12"], { encoding: "utf8", maxBuffer: 64 << 20 })) : null;
const fixture = (id) => {
  const { published, ...doc } = JSON.parse(readFileSync(join(PKG, `src/fixtures/${id}.json`), "utf8"));
  return doc;
};

const W = 1400, H = 1000;
// The agreement tolerances, each about twice what was measured on the kinked example at 12 m (camber's table at
// its own default resolution, 240 sections × 10 girth steps, against naval's mesh-hydro on the GLB camber builds
// with its default params; table − mesh):
//   ∇ −0.37% (−0.087 m³, −89 kg of 23.7 t), Aw −1.05%, KMt +0.33% (+10 mm), D/L −0.37%;
//   Cb −0.0018, Cp −0.0028, Cw −0.0083; LCB +0.36% of LWL, LCF +0.60% of LWL;
//   KN −0.4 mm at 30°, −3.1 mm at 60°, −0.5 mm at 90° (0.03% of LWL at worst).
// (At the 96 × 6 the table used to be asked for, ∇ was −1.23% and KMt +0.93%: chartroom-link.js TABLE_OPTIONS.)
// The two integrate differently discretised surfaces (camber's station sweep, naval's triangles); neither is the other's oracle.
/** [row, tolerance, kind]: "rel" a fraction of the mesh's value, "abs" in the figure's own unit (LCB and LCF: a fraction of LWL). */
const AGREE = [
  ["volume", 0.01, "rel"],
  ["displacement", 0.01, "rel"],
  ["aw", 0.02, "rel"],
  ["kmt", 0.01, "rel"],
  ["dL", 0.01, "rel"],
  ["cb", 0.005, "abs"],
  ["cp", 0.006, "abs"],
  ["cw", 0.016, "abs"],
  ["lcb", 0.008, "abs"],
  ["lcf", 0.012, "abs"],
];
/** What a hydrostatic table has no field for: read off the same mesh at the same waterplane, so identical. */
const SAME = ["loa", "lwl", "bwl", "tc", "wsa", "cm", "halfEntrance"];
/** KN from camber's table and from the mesh table must agree to this fraction of LWL. */
const KN_TOL_FRAC = 0.0006; // measured: 0.03% at worst (3.1 mm at 60°), each at its own engine's ∇
const b = await browser({
  root: PKG, port: 4830, cdp: 9830, page: `/probes/study-probe.html${withCamber ? "?camber" : ""}`, width: W, height: H,
  show: process.argv.includes("--show"), timeout: 300_000,
  mounts: withCamber ? { "/camber/": join(CAMBER, "patchwork/dist") } : {},
});
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const J = JSON.stringify;
const until = (expr, ms = 30_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { withCamber, checks: list.checks, details: list.details, shots: [], measured: {} };
const view = (w, h) => b.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
async function shot(name, w = W, h = H) {
  await view(w, h);
  await sleep(300);
  report.shots.push(await b.shot(join(SHOTS, `${name}.png`)));
}

try {
  check("page set up: naval plugins registered, no errors", (await until("window.__ready === true")) && (await P("errors")).length === 0, await P("errors"));
  report.measured.chartroomSources = await P("chartroomSources()");
  const cat = await P(`rig(${J(fixture("catalina-30"))})`);
  const j24 = await P(`rig(${J(fixture("j24"))})`);
  const render = await P(`add(${J({ "@patchwork": { type: "scene-render" }, title: "Some hull", parent: cat, params: { size: "length", lengthMeters: 12 } })})`);
  await P("mount()");
  const refused = await P(`addSubject(${J(render)})`);
  check("a scene render is refused as a subject: link the hull itself", refused.tone === "error" && /link the hull itself/.test(refused.status), refused);
  for (const u of [cat, j24]) await P(`addSubject(${J(u)})`);
  let hullUrl = null;
  if (withCamber) {
    hullUrl = await P(`add(${J(hullDoc)})`);
    await P(`addSubject(${J(hullUrl)})`);
  }
  const n = withCamber ? 3 : 2;
  const ready = await until(`window.__p.states().length === ${n} && window.__p.states().every((s) => s.state === "ready")`, 120_000);
  report.measured.states = await P("states()");
  check(`all ${n} subjects screened (worker)`, !!ready, report.measured.states);
  const t = await P("table()");
  report.measured.head = t.head;
  report.measured.groups = t.groups;
  const pick = (id) => t.rows[id]?.map((c) => `${c.text} [${c.badge}${c.prov ? `, ${c.prov}` : ""}]${c.delta ? ` ${c.delta}` : ""}`);
  report.measured.sample = Object.fromEntries(["loa", "lwl", "displacement", "cp", "kmt", "kn60", "r35", "gzMax", "avs", "lead", "refSpeed", "beatVmg"].map((id) => [id, pick(id)]));
  check("the compare head names every subject, the first as the baseline", t.head.length === n + 1 && /baseline/.test(t.head[1]) && /Catalina/.test(t.head[1]) && /J\/24/.test(t.head[2]), t.head);
  check("particulars render for every subject, each with an envelope badge", ["loa", "lwl", "bwl", "tc", "volume", "displacement", "cp", "cm"].every((id) => t.rows[id]?.length === n && t.rows[id].every((c) => !c.missing && /\d/.test(c.text) && ["inside", "near", "far"].includes(c.badge))), report.measured.sample);
  check("every number on the page carries a badge and a hover naming its method and source", Object.values(t.rows).flat().filter((c) => !c.missing).every((c) => c.badge && /Source:/.test(c.title) && /Envelope:/.test(c.title)), null);
  check("Δ against the baseline under every other column, none under the baseline", Object.values(t.rows).every((cells) => !cells[0].delta) && t.rows.lwl.slice(1).every((c) => /^Δ [−+]?\d/.test(c.delta ?? "")), t.rows.lwl);
  check("the groups: particulars, stability, resistance, balance, performance", J(t.groups) === J(["particulars", "stability", "resistance", "balance", "performance"]), t.groups);
  check("the designs' stability and performance render (GZ max, AVS, speed at the reference point)", ["gzMax", "avs", "refSpeed", "beatVmg"].every((id) => t.rows[id].slice(0, 2).every((c) => /\d/.test(c.text))), report.measured.sample);
  check("DSYHS extrapolation is visible: a near/far badge on resistance for the Catalina", ["near", "far"].includes(t.rows.r35[0].badge), t.rows.r35[0]);
  if (withCamber) {
    const st = report.measured.states.find((s) => s.id === "s3");
    report.measured.camberHull = { status: st?.status, loa: t.rows.loa[2], lwl: t.rows.lwl[2], unit: hullDoc.unit };
    check("the camber hull is read at real size: built by camber at its default params, LOA ≈ 12 m, measured", /built by .*default params, at its own size/.test(st?.status ?? "") && /^1[01]\.\d+ m$/.test(t.rows.loa[2].text) && t.rows.loa[2].prov === "measured", report.measured.camberHull);
    check("a hull-only subject's design rows say they need a rig design", t.rows.gzMax[2].missing && /needs a rig design/.test(t.rows.gzMax[2].title) && !t.rows.kmt[2].missing && !t.rows.kn60[2].missing, { gz: t.rows.gzMax[2], kmt: t.rows.kmt[2] });
    report.measured.chartroomUsed = /statics from/.test(st?.status ?? "");
  }
  const cant = await P("cant()");
  report.measured.cant = { count: cant.figures.length, first: cant.figures.slice(0, 4), always: cant.always.length };
  check("'What the screen can't tell you' lists the extrapolated figures and what no screen here does", cant.figures.length > 0 && cant.figures.some((x) => /R at Fn/.test(x)) && cant.always.some((x) => /STIX/.test(x)), report.measured.cant);
  const ex = await P("exported()");
  check("Export JSON: the study, the versions read, every figure with method, source, envelope and provenance", ex?.format === "naval-study-report" && ex.subjects.length === n && ex.groups[0].rows[0].cells.every((c) => c.figure && c.figure.method && "cite" in c.figure && c.figure.envelope && c.figure.provenance), ex ? { subjects: ex.subjects.map((s) => s.read) } : null);
  await shot("study-desktop-light");
  await P("setTheme(true)");
  await shot("study-desktop-dark");
  await P("setTheme(false)");
  await view(390, 844);
  await sleep(300);
  const ox = await P("overflowX()");
  report.measured.narrow = ox;
  check("at 390 px nothing runs past the tool's right edge (the table scrolls in its own box)", ox.scrollWidth <= ox.clientWidth + 1 && ox.wide.length === 0, ox);
  await shot("study-narrow-light", 390, 844);
  await view(W, H);
  // ── agreement: camber's own hydrostatics against naval's mesh-hydro, on the same hull.
  // The same triangles reach the study twice: as the camber doc (its chartroom:source's table is the statics
  // engine: one engine per hull source) and as a GLB file (no provider to ask, so the mesh is the engine and
  // naval/statics.js buildTable makes its table).
  if (withCamber && report.measured.chartroomUsed) {
    const fileUrl = await P(`glbFileOf(${J(hullUrl)})`, 120_000);
    await P(`addSubject(${J(fileUrl)})`);
    const both = await until(`window.__p.states().length === ${n + 1} && window.__p.states().every((s) => s.state === "ready")`, 120_000);
    const ex2 = both ? await P("exported()") : null;
    const cell = (id, i) => ex2?.groups.flatMap((g) => g.rows).find((r) => r.id === id)?.cells[i]?.figure ?? null;
    const reads = ex2?.subjects.map((x) => x.read?.hull?.table ?? null) ?? [];
    const row = (id) => {
      const [a, m] = [cell(id, n - 1), cell(id, n)];
      const diff = a?.value != null && m?.value != null ? a.value - m.value : null;
      return { id, chartroom: a?.value ?? null, mesh: m?.value ?? null, diff: diff == null ? null : +diff.toPrecision(3), rel: diff == null || !m.value ? null : +(diff / m.value).toPrecision(3), method: a?.method ?? null, whyChartroom: a?.why ?? null, whyMesh: m?.why ?? null };
    };
    const same = SAME.map(row), upright = AGREE.map(([id]) => row(id)), kn = ["kn30", "kn60", "kn90"].map(row);
    const lwl = cell("lwl", n)?.value ?? NaN;
    report.measured.agreement = { tables: reads.slice(n - 1), fingerprint: ex2?.subjects[n - 1]?.read?.hull?.fingerprint ?? null, lwlM: lwl, same, upright, kn };
    check("agreement set up: the camber doc's statics are its chartroom:source's, the GLB file's are built from the mesh", !!both && reads[n - 1] === "chartroom" && reads[n] === null, { tables: reads.slice(n - 1) });
    check("…the camber hull's ∇, Aw and KMt say they are its own table's; its LWL, BWL, Tc and wetted surface that they are off the mesh", ["volume", "aw", "kmt"].every((id) => /the hull's own Chartroom table/.test(cell(id, n - 1)?.method ?? "")) && ["lwl", "bwl", "tc", "wsa"].every((id) => /off the mesh/.test(cell(id, n - 1)?.method ?? "")) && ["volume", "aw", "kmt", "lwl"].every((id) => !/table|off the mesh/.test(cell(id, n)?.method ?? "")), [...upright, ...same].map((r) => `${r.id}: ${r.method}`));
    check("…what a table has no field for is the same mesh at the same waterplane either way (LOA, LWL, BWL, Tc, WSA, Cm, half entrance): identical", same.every((r) => r.diff != null && Math.abs(r.diff) <= 1e-9 * Math.max(1, Math.abs(r.mesh))), same);
    check(`…camber's own upright figures agree with the mesh's: ${AGREE.map(([id, tol, kind]) => `${id} ±${kind === "rel" ? `${tol * 100}%` : tol}`).join(", ")}`, upright.every((r, i) => r.diff != null && Math.abs(AGREE[i][2] === "rel" ? r.rel : r.diff) <= AGREE[i][1]), upright);
    check("…and they are camber's, not the mesh's again: ∇ differs by more than round-off", Math.abs(upright[0].rel ?? 0) > 1e-6, upright[0]);
    check(`…and camber's table and the mesh table agree on KN at 30°, 60° and 90° to ${KN_TOL_FRAC * 100}% of LWL`, kn.every((r) => r.diff != null && Math.abs(r.diff) <= KN_TOL_FRAC * lwl), kn);
  }
  check("no errors on the page", (await P("errors")).length === 0, await P("errors"));
} catch (err) {
  check("probe ran to the end", false, String(err?.stack ?? err));
}
report.logs = b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 20);
mkdirSync(SHOTS, { recursive: true });
writeFileSync(join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
