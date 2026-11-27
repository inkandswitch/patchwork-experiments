// The study tool in headless Chrome: the BUILT package (dist/) on an
// in-memory repo (probes/ui-probe.html), with parts made from
// src/test/shapes.js and, when given, real runs dumped by
// probes/local-run.mjs --dump.
//
//   pnpm build && node probes/ui-run.mjs [--done plate.json] [--modal beam-modal.json] [--shots dir] [--show]
//
// What a person does, done with the pointer and the form: link a part, see
// it measured and split into faces, click a face on the part and fix it,
// add a force and pick its face, see why Run can't go and then that it can,
// press Run (a run doc with the part frozen in it, asked of the server's
// task queue), cancel it while it waits, read a finished run's figures and see it on the part, a modal
// run's modes, re-read a changed part and keep the faces that are still
// alike. Screenshots at desktop and phone widths, light and dark.

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";
import { TASKS } from "./lib.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "fea-shots"));
const DONE = arg("--done");
const MODAL = arg("--modal");
mkdirSync(SHOTS, { recursive: true });
const runs = join(SHOTS, "runs");
mkdirSync(runs, { recursive: true });
if (DONE) copyFileSync(DONE, join(runs, "done.json"));
if (MODAL) copyFileSync(MODAL, join(runs, "modal.json"));
if (!existsSync(join(PKG, "dist/index.js"))) throw new Error("build first: pnpm build");
if (!existsSync(join(TASKS, "dist/index.js"))) throw new Error(`no built Tasks package at ${TASKS}: set TASKS_HOST, or build ../tasks`);

const W = 1300, H = 900;
// the package is also served under a made-up automerge url, as Patchwork serves it (probes/ui-probe.html)
const b = await browser({ root: PKG, port: Number(process.env.PROBE_PORT) || 4797, cdp: Number(process.env.PROBE_CDP) || 9797, page: "/probes/ui-probe.html", width: W, height: H, show: process.argv.includes("--show"), timeout: 300_000, mounts: { "/runs/": runs, "/automerge:feaProbePackageAbc/": PKG, "/tasks/": TASKS } });
const P = (e) => b.js(`window.__p.${e}`);
const until = (expr, ms = 20_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [] };
const view = (w, h) => b.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
async function shot(name, { w = W, h = H } = {}) {
  await P(`look([-0.55, -0.45, -0.7])`).catch(() => {});
  await view(w, h);
  await sleep(450);
  report.shots.push(await b.shot(join(SHOTS, `${name}.png`)));
  await view(W, H);
  await sleep(150);
}
/** Click the middle of a face of the part, as a person would. */
async function clickFace(id) {
  const at = await P(`aim(${id})`);
  await b.click(at.x, at.y);
  await sleep(150);
  return at;
}

try {
  check("page set up", (await until("window.__ready === true", 20_000)) && (await P("errors")).length === 0, await P("errors"));
  const made = await P("setup()");
  // the Tasks package arrives after the study is open
  const before = await P(`text(".fea .panel")`);
  check("without the Tasks package, the study says so and nothing else", before === "This needs the Tasks package, which is not installed here.", before);
  await P(`install("/tasks/dist/index.js")`);
  await until(`!!document.querySelector(".fea .part-url")`);
  check("once it arrives, the study carries on", true);
  let rb = await P("runButton()");
  check("an empty study says what to do first, and Run is off", rb.disabled === true && rb.why.some((w) => /Link a part/.test(w)), rb);
  await shot("1-empty");

  // ---- link a part: pasted, as a person would
  const plate = await P(`file("plate")`);
  await P(`type(".fea .part-url", ${JSON.stringify(plate)})`);
  const read = await until("window.__p.panel().part?.faces > 0", 20_000);
  const figures = await P(`rows('section[data-s="part"] table.figures tr')`);
  report.part = figures;
  check("the part is read, measured and split into faces", !!read && /100 × 40 × 5 mm/.test(figures.find((r) => r[0] === "Size")?.[1] ?? "") && /^7,/.test(figures.find((r) => r[0] === "Faces")?.[1] ?? ""), figures);
  check("its mass is its volume × the material's density (aluminium: 53 g)", /53\.\d g/.test(figures.find((r) => r[0] === "Mass")?.[1] ?? ""), figures);
  check("the study takes the part's name", /plate/.test((await P("doc()")).title), (await P("doc()")).title);
  const faces = await P("faces()");
  const wall = faces.find((f) => f.radius);
  check("the hole's wall is one round face of the hole's radius", faces.length === 7 && Math.abs(wall.radius - 0.004) < 1e-4, faces.map((f) => [f.id, f.flat, f.radius]));
  const endA = faces.find((f) => f.normal[0] === -1).id, endB = faces.find((f) => f.normal[0] === 1).id;

  // ---- what the pointer is over is said in the view; a click picks it
  const over = await P(`aim(${endA})`);
  await b.move(over.x, over.y);
  await sleep(150);
  check("the view says what face the pointer is over", /^Face \d+: flat, 40 mm × 5 mm, facing −x/.test((await P(`text(".fea .view-hint")`)) ?? ""), await P(`text(".fea .view-hint")`));
  await clickFace(endA);
  const picked = await P("panel()");
  check("a click on the part picks the face under it", picked.picked === endA, picked);
  check("the picked face is described in words", /flat, 40 mm × 5 mm, facing −x/.test((await P(`text(".fea .picked")`)) ?? ""), await P(`text(".fea .picked")`));
  await P(`click('[data-act="fix-picked"]')`);
  let doc = await P("doc()");
  let supports = Object.values(doc.setup.supports);
  check("Fix it adds a fixed support on that face", supports.length === 1 && supports[0].kind === "fixed" && supports[0].faces.join() === String(endA), supports);

  // ---- add a force, and pick its face on the part
  await P(`click('[data-act="add-load"][data-kind="force"]')`);
  const picking = await P("panel()");
  check("a new force is picking faces", picking.active?.what === "load", picking);
  rb = await P("runButton()");
  check("Run says the force has no faces yet", rb.disabled && rb.why.some((w) => /Pick the faces the load/.test(w)), rb);
  await clickFace(endB);
  doc = await P("doc()");
  let load = Object.values(doc.setup.loads)[0];
  check("a click on the part puts the face on the force", load.faces.join() === String(endB), load);
  await clickFace(endB);
  check("a second click takes it off", Object.values((await P("doc()")).setup.loads)[0].faces.length === 0);
  await clickFace(endB);
  const loadId = Object.keys((await P("doc()")).setup.loads)[0];
  await P(`type('[data-key="l-mag-${loadId}"]', "1")`);
  await P(`type('[data-key="l-mag-${loadId}-unit"]', "kN")`);
  load = Object.values((await P("doc()")).setup.loads)[0];
  check("typing 1 and choosing kN converts what was typed: 1 N is 0.001 kN (the force stays what it was)", load.magnitude.unit === "kN" && Math.abs(load.magnitude.value - 0.001) < 1e-12, load.magnitude);
  await P(`type('[data-key="l-mag-${loadId}"]', "1")`);
  await P(`type('[data-key="l-dir-${loadId}"]', "out")`);
  load = Object.values((await P("doc()")).setup.loads)[0];
  check("the force is 1 kN, away from its face (+x)", load.magnitude.value === 1 && load.magnitude.unit === "kN" && Math.abs(load.direction[0] - 1) < 1e-9, load);
  await P(`type('[data-key="l-dir-${loadId}"]', "custom")`);
  const spelled = await P(`rows('.item[data-what="load"] label.field')`);
  check("Other… shows the direction as its three numbers and writes nothing", (await b.js(`!!document.querySelector('[data-key="l-dir0-${loadId}"]')`)) && Math.abs(Object.values((await P("doc()")).setup.loads)[0].direction[0] - 1) < 1e-12, spelled);
  await P(`type('[data-key="l-dir-${loadId}"]', "+x")`);
  const hinted = await P(`text(".fea .view-hint")`);
  check("while picking, the view says whose faces a click sets", /“Force”/.test(hinted ?? ""), hinted);
  await P(`click('[data-act="pick"][data-what="load"]')`);
  check("Done stops picking", (await P("panel()")).active === null);

  // ---- the server, and Run
  rb = await P("runButton()");
  check("with a support and a load, only the server is missing", rb.disabled && rb.why.length === 1 && /server/.test(rb.why[0]), rb);
  await P(`type('[data-key="server-url"]', ${JSON.stringify(made.server)})`);
  await until(`/served by FEA on probe-host/.test(document.querySelector('section[data-s="server"]')?.innerText ?? "")`, 8000);
  const serverText = await P(`text('section[data-s="server"]')`);
  check("the server shows who is heard serving it", /FEA on the probe/.test(serverText) && /served by FEA on probe-host/.test(serverText), serverText);
  rb = await P("runButton()");
  check("Run is on", rb.disabled === false && rb.why.length === 0, rb);
  const estimate = await P(`text('section[data-s="mesh"]')`);
  check("the mesh section says about how big the mesh will be", /About [\d,]+ nodes at [\d.]+ mm/.test(estimate), estimate);
  await shot("2-setup");
  await P(`click(".fea .run")`);
  await until("window.__p.doc().runs.length === 1", 8000);
  const runDocs = await P("runDocs()");
  const queue = await P("serverState()");
  const run = runDocs[0];
  report.run = { title: run?.title, status: run?.status, part: run?.part && { stl: run.part.stl, faceOf: run.part.faceOf, faces: run.part.faces.length }, made: run?.made };
  check("Run makes a run doc with the setup and the part frozen in it, queued", run?.status === "queued" && /bytes/.test(run.part.stl) && run.part.faces.length === 7 && Object.keys(run.setup.supports).length === 1 && run.made?.tool === "@tiny-patchwork/fea", report.run);
  check("and asks the server's queue for it, keyed by the run", Object.keys(queue.jobs).join() === (await P("doc()")).runs[0] && run.task === Object.values(queue.jobs)[0].taskUrl, queue.jobs);
  check("the study turns to its results", (await P("panel()")).tab === "results");
  const waiting = await P(`texts(".fea ul.runs li")`);
  check("the run is listed under the part's name, waiting for the server", waiting.length === 1 && /^plate · static/.test(waiting[0]) && /waiting for the server/.test(waiting[0]), waiting);
  // Cancel on a run that waits: a stop recorded in its task, read back from it
  await P(`click('.fea ul.runs [data-act="stop-run"]')`);
  await until(`/cancelled before it started/.test(document.querySelector(".fea ul.runs")?.innerText ?? "")`, 8000);
  const cancelled = await P(`texts(".fea ul.runs li")`);
  const afterCancel = { queue: await P("serverState()"), run: (await P("runDocs()"))[0] };
  check("Cancel on a waiting run: it reads cancelled, the queue no longer lists it, and its run doc isn't written", /cancelled · cancelled before it started/.test(cancelled[0]) && Object.keys(afterCancel.queue.jobs).length === 0 && afterCancel.run.status === "queued" && !(await b.js(`!!document.querySelector('.fea ul.runs [data-act="stop-run"]')`)), { cancelled, jobs: afterCancel.queue.jobs, status: afterCancel.run.status });

  // ---- a run mid-solve, then finished runs
  if (DONE) {
    await P(`midRun("/runs/done.json")`);
    await until(`/Solve \\(CalculiX\\)/.test(document.querySelector('section[data-s="show"]')?.innerText ?? "")`, 8000);
    const mid = await P(`text('section[data-s="show"]')`);
    check("a run mid-solve shows its stages and the solver's last lines", /Mesh it \(gmsh\)/.test(mid) && /Factoring the system/.test(mid), mid);
    await shot("3-solving");

    await P(`loadRun("/runs/done.json")`);
    const shown = await until(`window.__p.panel().showing === "result" && window.__p.legend().shown`, 20_000);
    const legend = await P("legend()");
    check("a finished run is drawn on the part, coloured by stress, with its scale", !!shown && /Von Mises stress/.test(legend.text) && /MPa/.test(legend.text) && /drawn moved [\d.,]+× what it really moves/.test(legend.text), legend);
    const fig = await P(`rows('section[data-s="figures"] table.figures tr')`);
    report.figures = fig;
    const get = (label) => fig.find((r) => r[0] === label)?.[1] ?? "";
    check("its figures: the stress at the hole, the safety factor, the movement", /1[5-7](\.\d)? MPa at \(5\d[\d.]*, [\d.]+, [\d.]+\) mm/.test(get("Highest stress")) && /^1[5-9]/.test(get("Safety factor")) && /µm/.test(get("Largest movement")), [get("Highest stress"), get("Safety factor"), get("Largest movement")]);
    check("its checks: the forces balance, and energy agrees with work", /exactly|within/.test(get("Forces balance")) && get("Energy against work") === "agree", [get("Forces balance"), get("Energy against work")]);
    check("the support's reaction answers the 1 kN pull, with rounding written 0", /^1 kN \(−1 kN, 0, 0\)$/.test(get("Held carries")), get("Held carries"));
    const listed = await P(`texts(".fea ul.runs li")`);
    check("the runs list has the headline of each", listed.length === 3 && /done in \d+ s · 1[5-7](\.\d)? MPa · moves [\d.]+ µm · safety 1\d/.test(listed[0]), listed);
    await shot("4-results");
    await P(`type('[data-key="show-field"]', "u")`);
    await until(`/Displacement/.test(window.__p.legend().text)`, 8000);
    check("Colour by displacement redraws it, in µm", /Displacement/.test((await P("legend()")).text) && /µm/.test((await P("legend()")).text), await P("legend()"));
    await P(`type('[data-key="show-deform"]', "true")`);
    await until(`/as it really moves/.test(window.__p.legend().text)`, 8000);
    check("Drawn as it really moves says so", /drawn as it really moves/.test((await P("legend()")).text), await P("legend()"));
    await shot("5-displacement");

    const sb = await P("sceneBuild()");
    report.scene = sb;
    check("the scene source builds the selected run: the result coloured, with a legend, and the marks on their layers", sb.meshes.join() === "Result,Supports,Loads" && sb.colored[0] && /Von Mises/.test(sb.legends[0]?.title ?? "") && sb.legends[0].unit === "MPa" && sb.layers.join() === "part,supports,loads", sb);
    const plain = await P(`sceneBuild({ show: "plain", marks: false, deform: "none" })`);
    check("its params: plain, unmoved, no marks", plain.meshes.join() === "Result" && !plain.colored[0] && plain.legends[0] === null && !/drawn moved/.test(plain.notes), plain);
    const runPage = await P(`openTool("fea-run", window.__p.doc().selected)`);
    check("a run opened on its own shows how it went, what it found and what was asked", /How it went/i.test(runPage) && /Highest stress/.test(runPage) && /Fixed support/.test(runPage) && /\*STATIC/.test(runPage), runPage.slice(0, 300));
    await shot("6-run-page");
    await P("reopen()");
    await until("window.__p.panel().part?.faces > 0", 10_000);
    check("reopened, the study is on its setup with the part there (read from what it kept)", (await P("panel()")).tab === "setup" && (await P("panel()")).showing === "part", await P("panel()"));
  }
  if (MODAL) {
    await P(`click('[data-act="tab"][data-tab="results"]')`);
    await P(`loadRun("/runs/modal.json")`);
    await until(`window.__p.panel().showing === "result" && /Mode 1/.test(window.__p.legend().text)`, 20_000);
    const modes = await P(`rows('section[data-s="figures"] tr[data-act="show-mode"]')`);
    check("a modal run lists its modes with their frequencies", modes.length === 6 && /Hz/.test(modes[0][1]), modes);
    await P(`click('tr[data-act="show-mode"][data-mode="3"]')`);
    await until(`/Mode 3/.test(window.__p.legend().text)`, 8000);
    check("clicking a mode draws its shape", (await P("panel()")).field === "m3", await P("panel()"));
    await shot("7-modal");
    const sb = await P(`sceneBuild({ mode: 3 })`);
    check("the scene source draws the mode asked for", /Mode 3/.test(sb.legends[0]?.title ?? ""), sb.legends);
  }

  // ---- the model changes: read again, and the faces that are still alike keep their supports
  await P(`click('[data-act="tab"][data-tab="setup"]')`);
  const beam = await P(`file("beam")`);
  await P(`click(".other-part summary")`);
  await P(`type(".fea .part-url", ${JSON.stringify(beam)})`);
  await until(`/beam/.test(window.__p.doc().part?.title ?? "") && window.__p.panel().part?.faces === 6`, 20_000);
  doc = await P("doc()");
  const said = await P(`text('section[data-s="part"]')`);
  report.reread = { supports: Object.values(doc.setup.supports), loads: Object.values(doc.setup.loads), said };
  check("another model: faces unlike any of the old ones are dropped, and it says which to pick again", Object.values(doc.setup.supports)[0].faces.length === 0 && /lost 1 face/.test(said), report.reread);
  const open = await P(`file("open")`);
  await P(`click(".other-part summary")`);
  await P(`type(".fea .part-url", ${JSON.stringify(open)})`);
  await until(`/open/.test(window.__p.doc().part?.title ?? "") && !!window.__p.panel().part`, 20_000);
  const openText = await P(`text('section[data-s="part"]')`);
  rb = await P("runButton()");
  check("a part that isn't a closed solid says why, in words, and can't run", /can't be meshed: its surface isn't closed: 4 edges have a face on one side only/.test(openText) && rb.disabled, { openText, rb });
  await shot("8-open-part");

  await P(`theme("dark")`);
  await sleep(200);
  await shot("9-dark");
  await P(`theme("light")`);
  await shot("10-phone", { w: 390, h: 844 });
  const left = await P("unmount()");
  check("unmounting leaves the host empty and stops listening", left.left === 0 && left.listeners === 0, left);
  check("no errors on the page", (await P("errors")).length === 0, await P("errors"));
  const logged = b.logs.filter((l) => /^(error|exception):/.test(l));
  check("nothing logged an error", logged.length === 0, logged);
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
report.logs = b.logs?.slice?.(-30);
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
