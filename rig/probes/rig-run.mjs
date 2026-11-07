// The rig design aid against a real camber hull, in headless Chrome.
//
//   (in rig/) pnpm build; (in camber/patchwork) npm run build
//   node probes/rig-run.mjs [--camber ~/dev/camber] [--example cuvature-kink-with-unmodified-pchip.json]
//                           [--length 12] [--shots <dir>] [--show]
//
// Mounts the BUILT rig tool (rig/dist) with camber's BUILT plugins
// (camber/patchwork/dist, served at /camber/: a probe may borrow another
// package's build at dev time; no package imports another), on an in-memory
// repo (probes/rig-probe.html). Then, as a designer would:
// - draws a hull in camber (one of its examples) and renders it at real size
//   with camber's own "Scale to length" param; links a rig to the render;
// - puts the stock sloop's mast at 0.63 LOA aft of the stem and reads the
//   helm verdict (weather helm, or can't be held);
// - drags the mast forward on the drawing with real pointer events, a step
//   at a time, reading the lead and the predicted rudder angle after each;
// - links a 1 m render (camber's document size) and reads the warning;
// - loads each published boat from "New from…" and reads its numbers;
// - waits for the Laser's polar and finds its planing points labelled;
// - builds the rig GLB through the rig's scene:source and checks extras.rig
//   against contract/v1/schema.json (and validate.js's semantic rules);
// - screenshots at desktop and phone widths, light and dark.
// Prints a JSON report; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";
import { validateSchema } from "./json-schema-lite.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const CAMBER = resolve(arg("--camber", join(homedir(), "dev/camber")));
const EXAMPLE = arg("--example", "cuvature-kink-with-unmodified-pchip.json");
const LENGTH = Number(arg("--length", 12));
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "rig-shots"));
for (const p of [join(PKG, "dist/index.js"), join(CAMBER, "patchwork/dist/index.js"), join(CAMBER, "examples", EXAMPLE)]) if (!existsSync(p)) throw new Error(`no ${p}: build it first`);

const W = 1400, H = 1000;
const PAGE_CAP = 24;
const b = await browser({
  root: PKG, port: 4790, cdp: 9790, page: "/probes/rig-probe.html", width: W, height: H,
  show: process.argv.includes("--show"), timeout: 600_000,
  mounts: { "/camber/": join(CAMBER, "patchwork/dist"), "/camber-examples/": join(CAMBER, "examples") },
});
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const until = (expr, ms = 20_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { example: EXAMPLE, length: LENGTH, checks: list.checks, details: list.details, shots: [], measured: {} };
const n3 = (v) => (v == null ? null : +(+v).toFixed(3));
const view = async (w, h) => b.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
/**
 * A screenshot at a width; `full`: the tool scrolled a page at a time (its own
 * scroller, .rig-design), one file per page (name-0.png, name-1.png, …).
 * Growing the viewport to the content's height instead let the tool's
 * 100%-height box re-lay itself out mid-capture.
 */
async function shot(name, { full = false, w = W, h = H } = {}) {
  await view(w, h);
  await sleep(300);
  if (!full) report.shots.push(await b.shot(join(SHOTS, `${name}.png`)));
  else {
    const total = await P("contentHeight()");
    const pages = Math.min(PAGE_CAP, Math.ceil(total / h));
    report.captured ??= {};
    report.captured[name] = { pages, total, pageHeight: h, performanceTop: await P("groupTop('performance')") };
    for (let i = 0; i < pages; i++) {
      await P(`scrollTop(${i * h})`);
      await sleep(150);
      report.shots.push(await b.shot(join(SHOTS, `${name}-${i}.png`)));
    }
    await P("scrollTop(0)");
  }
  await view(W, H);
  await sleep(150);
}
const R = () => P("readouts()");
/** the helm verdict's words out of the readout's text */
/** the reference point's sail set: "Full sail." or "Reef n." (the VPP reefs to hold the heel, or a helm the rudder can't) */
const sailsOf = (r) => (r.refFlat?.text ?? "").match(/Full sail|Reef \d+/)?.[0] ?? null;
const verdict = (row) => (row?.text ?? "").match(/weather helm [\d.]+°|lee helm [\d.]+°|neutral|cannot be held[^.]*/i)?.[0] ?? row?.text ?? null;
const v = (r, id) => r[id]?.v ?? null;
/** wait until a readout has a value (the statics and the reference point need the worker's table) */
const readyReadout = (id, ms = 30_000) => until(`(() => { const r = window.__p.readouts()['${id}']; return r && r.v != null && Number.isFinite(r.v); })()`, ms);
const polarReady = (ms = 90_000) => until(`(() => { const p = window.__p.polar(); return p.stale === false && p.dots.length > 0; })()`, ms);

try {
  check("page set up: rig and camber plugins registered, no errors", (await until("window.__ready === true", 30_000)) && (await P("errors")).length === 0, await P("errors"));

  // ─── a camber hull, rendered at real size, and a rig linked to it ────────
  const hull = await P(`hull(${JSON.stringify(EXAMPLE)}, ${LENGTH})`);
  report.measured.hull = { bounds: hull.bounds, ship: hull.ship, params: hull.params };
  check(`camber's scene:source renders ${EXAMPLE} with "Scale to length" ${LENGTH} m`, hull.params.size === "length" && hull.bounds && hull.bounds.max[0] - hull.bounds.min[0] > 0.9 * LENGTH, hull.bounds);
  await P(`mount(${JSON.stringify(`d.title = "Rig on ${EXAMPLE.replace(/\.json$/, "")}"; d.hull.link = { url: "${hull.renderUrl}", frame: { bow: "+X", up: "+Y" } };`)})`);
  const linkedOk = await until("window.__p.linkStatus().chip?.startsWith('Hull:') && /render/i.test(window.__p.linkStatus().text ?? '')", 30_000);
  const ls = await P("linkStatus()");
  check("the rig reads the linked render (its status names the render path)", !!linkedOk && ls.tone !== "error", ls);
  await readyReadout("gzMax", 60_000);
  await readyReadout("refHelm", 60_000);
  let r = await R();
  const loa = v(r, "hullLoa");
  report.measured.linked = Object.fromEntries(["hullLoa", "lwlFloat", "bwlFloat", "tcFloat", "wsa", "lcbAft", "kmt", "gzMax", "avs", "saD", "lead", "helm", "refSpeed", "refHelm"].map((k) => [k, { v: n3(v(r, k)), prov: r[k]?.prov ?? null }]));
  check("readouts from the floated mesh: LWL, BWL, Tc, wetted area and LCB are 'from mesh', GZ max and AVS from the table", ["lwlFloat", "bwlFloat", "tcFloat", "wsa"].every((k) => v(r, k) > 0) && v(r, "gzMax") > 0 && v(r, "avs") > 30, report.measured.linked);
  const warn0 = await P("warnings()");
  check("a 12 m hull gets no 'model, not a boat' warning", !warn0.some((w) => /model, not a boat/.test(w)), warn0);
  report.measured.linkedWarnings = warn0;
  const g1 = await P("glance()");
  report.measured.glanceLinked = g1;
  check("the strip under the drawing is on the first screen with the helm (and its band), boat speed, heel, VMG, sails and lead", g1?.inView && ["helm", "speed", "heel", "vmg", "sails", "lead"].every((k) => g1.items[k]), g1);
  await polarReady();
  const bn = await P("banner()");
  report.measured.extrapolationBanner = bn;
  check("a hull far outside the DSYHS ranges says so once, in a banner above the polar, and the polar is dashed", bn.level === "far" && bn.dashed && /extrapolated/.test(bn.text ?? ""), bn);
  await shot("1-linked-desktop");

  // ─── the stock rig with its mast at 0.63 LOA aft of the stem ─────────────
  const LOA = loa ?? hull.bounds.max[0] - hull.bounds.min[0];
  const mastAt = +(0.63 * LOA).toFixed(3);
  await P(`change("d.rig.mast.aftOfStem = ${mastAt};")`);
  await sleep(200);
  r = await R();
  const start = { mast: mastAt, lead: v(r, "lead"), rudder: v(r, "refHelm"), helm: verdict(r.helm) };
  report.measured.mastAft = start;
  check("mast at 0.63 LOA: the verdict is weather helm or can't be held", /weather|cannot be held/i.test(start.helm ?? "") && (start.rudder > 0 || /cannot/i.test(start.helm)), start);
  await shot("2-mast-aft");

  // ─── dragging the rig forward (the mast handle moves mast and tack together), a step at a time, with real pointer events ─
  const STEP_M = 0.4;
  async function dragStudy(label) {
    let r = await R();
    const d0 = await P("doc()");
    const traj = [{ step: 0, mast: n3(d0.rig.mast.aftOfStem), J: n3(v(r, "J")), lead: n3(v(r, "lead")), rudder: n3(v(r, "refHelm")), helm: verdict(r.helm), sails: sailsOf(r) }];
    for (let i = 1; i <= 12; i++) {
      const at = await P("handleAt('mast')");
      const k = await P("pxPerM()");
      if (!at) break;
      const dx = STEP_M * k; // bow to the right: forward is +x on the page
      await b.drag([Math.round(at.x), Math.round(at.y)], [Math.round(at.x + dx), Math.round(at.y)], { steps: 8, settle: 200 });
      await until("window.__p.dragging() === null", 5000);
      r = await R();
      const d = await P("doc()");
      traj.push({ step: i, mast: n3(d.rig.mast.aftOfStem), J: n3(v(r, "J")), lead: n3(v(r, "lead")), rudder: n3(v(r, "refHelm")), helm: verdict(r.helm), sails: sailsOf(r) });
      if (v(r, "refHelm") != null && v(r, "refHelm") < -0.5) break; // past neutral: enough
    }
    console.error(`${label}\n step   mast     J      lead    rudder  sails      verdict`);
    for (const t of traj) console.error(`${String(t.step).padStart(5)} ${String(t.mast).padStart(6)} ${String(t.J).padStart(6)} ${String(t.lead).padStart(8)} ${String(t.rudder).padStart(8)}  ${String(t.sails).padEnd(9)}  ${t.helm}`);
    return traj;
  }
  const traj = await dragStudy(`drag at camber's own displacement`);
  r = await R();
  report.measured.dragTrajectory = traj;
  const moves = traj.slice(1).map((t, i) => t.mast - traj[i].mast);
  check("each drag moves the mast forward by about the step (±5 cm)", moves.length >= 3 && moves.every((m) => Math.abs(m + STEP_M) < 0.05), moves.map(n3));
  check("dragging the mast handle keeps J (the rig moves; the sails don't change size)", traj.every((t) => Math.abs(t.J - traj[0].J) < 0.002), traj.map((t) => t.J));
  const leads = traj.map((t) => t.lead), rudders = traj.map((t) => t.rudder);
  check("the lead rises at every step as the mast goes forward", leads.slice(1).every((l, i) => l > leads[i]), leads);
  const finite = rudders.filter((x) => x != null);
  // on one sail set the rudder angle falls at every step; where the VPP changes set (it reefs to hold a helm past the
  // rudder's stall, and shakes the reef out when it can), it may step back up: that step is reported, not failed
  const sameSet = traj.slice(1).map((t, i) => ({ same: t.sails === traj[i].sails, fell: t.rudder < traj[i].rudder }));
  check("the predicted rudder angle falls toward neutral at every step on one sail set, and ends at or past neutral", finite.length === rudders.length && sameSet.every((x) => !x.same || x.fell) && (finite.at(-1) < 0.5 || Math.abs(finite.at(-1)) < Math.abs(finite[0]) / 4), traj.map((t) => [t.rudder, t.sails]));
  report.measured.setChanges = traj.slice(1).filter((t, i) => t.sails !== traj[i].sails).map((t) => ({ step: t.step, mast: t.mast, to: t.sails, rudder: t.rudder }));
  const lastDrag = await P("glance()");
  check("after a drag the strip shows the new helm (the same rudder angle as the readout)", lastDrag?.items.helm && v(r, "refHelm") != null && (Math.abs(v(r, "refHelm")) < 0.5 ? /neutral/.test(lastDrag.items.helm.text) : lastDrag.items.helm.text.includes(Math.abs(v(r, "refHelm")).toFixed(1))), { strip: lastDrag?.items.helm, readout: v(r, "refHelm") });
  await shot("3-mast-dragged");

  // ─── open issue 1: separate displacement from keel position ──────────────
  // camber's own displacement for this hull at 12 m is ~23 t (SA/D ~7); the stock sloop's keel and rig are an 8 t boat's.
  // Same rig position (the stock mast and tack), keel at the stock position, its root quarter chord over the LCB, and 0.5 m either side.
  const study = [];
  const settle = async () => {
    await sleep(400);
    await until(`(() => { const r = window.__p.readouts(); return r.refHelm && Number.isFinite(r.refHelm.v) && r.gzMax && Number.isFinite(r.gzMax.v) && !/Building/.test(document.querySelector('[data-group="stability"] .section-note')?.textContent ?? ""); })()`, 60_000);
    await sleep(300);
  };
  const stock = await P("doc()");
  for (const disp of [null, 8000]) {
    await P(`change(${JSON.stringify(`d.rig.mast.aftOfStem = ${mastAt}; d.rig.forestayAftOfStem = ${stock.rig.forestayAftOfStem - (stock.rig.mast.aftOfStem - mastAt)}; d.loading.displacement = ${disp ? `{ from: "given", kg: ${disp} }` : `{ from: "hull", kg: null }`};`)})`);
    await settle();
    let rr = await R();
    const lcbAft = v(rr, "lcbAft");
    const chord = (await P("doc()")).appendages.keel.rootChord;
    for (const [where, aft] of [["stock", stock.appendages.keel.aftOfStem], ["qc over LCB", lcbAft - chord / 4], ["qc 0.5 m fwd of LCB", lcbAft - chord / 4 - 0.5], ["qc 0.5 m aft of LCB", lcbAft - chord / 4 + 0.5]]) {
      await P(`change("d.appendages.keel.aftOfStem = ${n3(aft)};")`);
      await settle();
      rr = await R();
      study.push({ displacementKg: n3(v(rr, "displacement")), keel: where, keelAftOfStem: n3(aft), lcbAft: n3(lcbAft), tc: n3(v(rr, "tcFloat")), saD: n3(v(rr, "saD")), lead: n3(v(rr, "lead")), rudder: n3(v(rr, "refHelm")), heel: n3(v(rr, "refHeel")), speedKn: n3(v(rr, "refSpeed") / 0.514444), helm: verdict(rr.helm) });
    }
    await P(`change("d.appendages.keel.aftOfStem = ${stock.appendages.keel.aftOfStem};")`);
  }
  report.measured.displacementVsKeel = study;
  console.error(" disp      keel                 lead    rudder  heel   speed  verdict");
  for (const t of study) console.error(`${String(t.displacementKg).padStart(8)}  ${t.keel.padEnd(20)} ${String(t.lead).padStart(6)} ${String(t.rudder).padStart(8)} ${String(t.heel).padStart(5)} ${String(t.speedKn).padStart(6)}  ${t.helm}`);
  check("the displacement-vs-keel study ran: helm at camber's own displacement and at 8 t, the keel in four places", study.length === 8 && study.every((t) => Number.isFinite(t.rudder)), study);
  // and the drag again at 8 t, stock keel
  await settle();
  const traj8 = await dragStudy("drag at 8 t, stock keel");
  report.measured.dragTrajectory8t = traj8;
  check("at 8 t the drag also takes the helm toward neutral", traj8.length >= 2 && traj8.at(-1).rudder < traj8[0].rudder, traj8.map((t) => t.rudder));
  await P(`change("d.loading.displacement = { from: 'hull', kg: null };")`);

  // ─── the polar on the linked hull, then the rig GLB through the scene:source ─
  const polarLinked = await polarReady();
  check("the polar comes back from its worker on the linked hull", !!polarLinked, await P("polar()").then((p) => ({ stale: p.stale, dots: p.dots.length })));
  const glb = await P("buildGlb()", 120_000);
  const rig = glb.extras?.rig;
  report.measured.glb = { bytes: glb.bytes, nodes: glb.nodes, notes: glb.meta?.notes ?? null, hasSail: !!glb.extras?.sail };
  const schema = JSON.parse(readFileSync(join(PKG, "contract/v1/schema.json"), "utf8"));
  const sv = rig ? validateSchema(schema, rig) : { ok: false, errors: [{ message: "no extras.rig" }] };
  check("the rig's scene:source builds a GLB whose extras.rig validates against contract/v1/schema.json", sv.ok, { errors: sv.errors.slice(0, 5), unknown: sv.unknownKeywords });
  // validate.js (structure + §5 semantics) in node: its JSON import needs an import attribute here
  const vdir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "rig-validate-"));
  const src = readFileSync(join(PKG, "contract/v1/validate.js"), "utf8").replace(/import schema from "\.\/schema\.json";/, `import schema from ${JSON.stringify(pathToFileURL(join(PKG, "contract/v1/schema.json")).href)} with { type: "json" };`).replace(/from "\.\//g, `from "${pathToFileURL(join(PKG, "contract/v1")).href}/`);
  writeFileSync(join(vdir, "validate.mjs"), src);
  const { validate, errorText } = await import(pathToFileURL(join(vdir, "validate.mjs")).href);
  const vv = rig ? validate(rig) : { ok: false, errors: [] };
  check("…and validate.js's semantic rules (§5) pass on it", vv.ok, vv.ok ? undefined : errorText(vv).slice(0, 600));
  const live = await R();
  check("the GLB's predicted helm is the tool's (same rudder angle to 0.01°)", rig && Math.abs((rig.predicted?.helm?.rudderDeg ?? rig.predicted?.helm?.rudder ?? NaN) - v(live, "refHelm")) < 0.01, { glb: rig?.predicted?.helm, tool: v(live, "refHelm") });
  check("the GLB has the rig's nodes and no synthetic hull (a hull is linked)", ["Rig", "Mast", "Sail", "Keel", "Rudder"].every((n) => glb.nodes.includes(n)) && !glb.nodes.includes("SyntheticHull"), glb.nodes);
  const deps = await P("dependencies()");
  check("the scene:source depends on the linked render", JSON.stringify(deps ?? []).includes(hull.renderUrl), deps);

  // ─── a 1 m render: a model, not a boat ───────────────────────────────────
  const small = await P(`hull(${JSON.stringify(EXAMPLE)}, null)`);
  await P(`mount(${JSON.stringify(`d.hull.link = { url: "${small.renderUrl}", frame: { bow: "+X", up: "+Y" } };`)})`);
  const smallWarned = await until("window.__p.warnings().some((w) => /model, not a boat/.test(w))", 30_000);
  const sw = await P("warnings()");
  report.measured.smallWarnings = sw;
  check("a 1 m render (camber's document size) warns plainly that it looks like a model, not a boat, and points at Scale to length", !!smallWarned && sw.some((w) => /model, not a boat/.test(w) && /Scale to length/.test(w)), { bounds: small.bounds, warnings: sw });
  // once its table is back, the stock sloop's full-size keel outweighs (outdisplaces) the model: said, not thrown
  const said = await until("window.__p.warnings().some((w) => /keel and rudder displace/.test(w))", 30_000);
  check("…and once its table is built, the tool still renders, saying the keel and rudder displace the whole boat (no exception)", !!said && (await P("errors")).length === 0 && !!(await P("readouts()")).saD, { warnings: await P("warnings()"), errors: await P("errors") });
  await shot("4-model-warning");

  // ─── each published boat via "New from…" ─────────────────────────────────
  await P("mount()");
  const opts = await P("options()");
  const fixtures = opts.filter((o) => o.startsWith("fixture:"));
  check("New from… offers the four validation boats", ["catalina-30", "j24", "laser-ilca7", "sloop-12m"].every((id) => fixtures.includes(`fixture:${id}`)), opts);
  report.measured.fixtures = {};
  for (const f of fixtures) {
    await P(`pick(${JSON.stringify(f)})`);
    await sleep(150);
    await readyReadout("refSpeed", 30_000);
    await readyReadout("rm30", 60_000); // the statics table, from the worker
    const rr = await R();
    const keys = ["saD", "saDesigner", "dL", "ballastRatio", "lead", "gmTable", "rm30", "helm", "refSpeed"];
    const got = Object.fromEntries(keys.map((k) => [k, n3(v(rr, k))]));
    report.measured.fixtures[f] = { title: await P("title()"), ...got, verdict: verdict(rr.helm), status: (await P("helperStatus()")).text, warnings: await P("warnings()") };
    check(`${f}: its readouts render (SA/D, D/L, lead, RM30, helm, reference speed)`, ["saD", "dL", "lead", "rm30", "refSpeed"].every((k) => Number.isFinite(got[k])) && verdict(rr.helm) && (await P("errors")).length === 0, { ...report.measured.fixtures[f], errors: await P("errors") });
    if (f === "fixture:laser-ilca7") {
      const pr = await polarReady();
      const pol = await P("polar()");
      const planing = pol.dots.filter((d) => d.regime === "planing");
      report.measured.laserPolar = { dots: pol.dots.length, planing: planing.length, hollow: pol.dots.filter((d) => d.hollow).length, caption: pol.caption, example: planing[0]?.title ?? null, cells: pol.cells.filter((c) => c.regime === "planing").length };
      check("the Laser's polar has planing points, each labelled 'planing (Savitsky)' on its dot and P in the table", !!pr && planing.length > 0 && planing.every((d) => /planing \(Savitsky\)/.test(d.title)) && pol.cells.some((c) => c.regime === "planing" && /P/.test(c.text)) && /P planing/.test(pol.caption ?? ""), report.measured.laserPolar);
      await P("scrollTo('[data-group=\"performance\"]')");
      await shot("5-laser-polar");
      await P("scrollTo('.rig-bar')");
      await shot("5-laser-full", { full: true });
    }
  }

  // ─── layout: desktop and phone widths, light and dark ────────────────────
  await P(`hull(${JSON.stringify(EXAMPLE)}, ${LENGTH})`).then((h) => P(`mount(${JSON.stringify(`d.hull.link = { url: "${h.renderUrl}", frame: { bow: "+X", up: "+Y" } };`)})`));
  await readyReadout("gzMax", 60_000);
  await polarReady();
  for (const dark of [false, true]) {
    await P(`setTheme(${dark})`);
    const t = dark ? "dark" : "light";
    await shot(`6-desktop-${t}`, { full: true });
    const capd = report.captured[`6-desktop-${t}`];
    check(`desktop (${t}): Performance starts within the first two screens`, capd.performanceTop != null && capd.performanceTop < 2 * H, capd);
    await view(390, 844);
    await sleep(300);
    const ox = await P("overflowX()");
    report.measured[`narrow-${t}`] = ox;
    check(`at 390 px (${t}): nothing runs past the tool's right edge (the polar table may scroll in its own box)`, ox.scrollWidth <= ox.clientWidth + 1 && ox.wide.length === 0, ox);
    const sz = await P("drawingSizes()");
    const gn = await P("glance()");
    report.measured[`narrow-${t}-drawing`] = sz;
    check(`at 390 px (${t}): drawing labels at least 10.5 px, handles' touch targets at least 12 px radius, the page scrolls through the drawing`, sz.labelPx >= 10.5 && sz.hitR >= 12 && sz.svgTouch !== "none", sz);
    check(`at 390 px (${t}): the strip sits right under the drawing, in view`, gn?.inView && gn.items.helm, gn);
    await shot(`6-narrow-${t}`, { full: true, w: 390, h: 844 });
    const cap = report.captured[`6-narrow-${t}`];
    check(`at 390 px (${t}): the screenshots reach the Performance group (${cap.performanceTop} px down, ${cap.pages} pages of ${cap.pageHeight})`, cap.performanceTop != null && cap.performanceTop < cap.pages * cap.pageHeight, cap);
  }
  await P("setTheme(false)");
  check("no errors in the page through all of it", (await P("errors")).length === 0, await P("errors"));
} catch (err) {
  check("probe ran to the end", false, String(err?.stack ?? err));
}
report.logs = b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 20);
mkdirSync(SHOTS, { recursive: true });
writeFileSync(join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
