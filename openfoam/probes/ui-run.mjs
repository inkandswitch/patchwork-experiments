// The case tool in headless Chrome: the BUILT package (dist/) on an
// in-memory repo (probes/ui-probe.html), with a real camber GLB as the hull,
// the task client from the tasks package's built dist (../tasks/dist), and,
// when given, real runs dumped by probes/local-run.mjs --dump.
//
//   pnpm build && node probes/ui-run.mjs [--done run.json] [--done2 run2.json] [--shots dir] [--show]
//
// Checks: before the Tasks package is installed, the tool says it needs it,
// and carries on when it arrives; the hull is read and measured; the pre-flight figures; Run makes a
// run doc (frozen setup + STL) and asks the server's queue for it; a run
// mid-solve shows its stages and charts; a finished run shows its figures
// and each plot; two finished runs at different speeds draw a resistance
// curve; the scene provider builds the results; unmounting leaves nothing.
// Screenshots at desktop and phone widths, light and dark.

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "openfoam-shots"));
const HULLS = resolve(PKG, "../naval/src/test/fixtures/camber");
const DONE = arg("--done");
const DONE2 = arg("--done2");
mkdirSync(SHOTS, { recursive: true });
const runs = join(SHOTS, "runs");
mkdirSync(runs, { recursive: true });
if (DONE) copyFileSync(DONE, join(runs, "done.json"));
if (DONE2) copyFileSync(DONE2, join(runs, "done2.json"));
if (!existsSync(join(PKG, "dist/index.js"))) throw new Error("build first: pnpm build");
if (!existsSync(join(PKG, "../tasks/dist/index.js"))) throw new Error("build the tasks package first: pnpm build in ../tasks");

const W = 1300, H = 950;
const b = await browser({ root: PKG, port: Number(process.env.PROBE_PORT) || 4795, cdp: Number(process.env.PROBE_CDP) || 9795, page: "/probes/ui-probe.html", width: W, height: H, show: process.argv.includes("--show"), timeout: 300_000, mounts: { "/hulls/": HULLS, "/runs/": runs, "/automerge:openfoamProbePackage/": PKG, "/tasks/": resolve(PKG, "../tasks/dist") } });
const js = (expr) => b.js(expr);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 20_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [] };
const view = (w, h) => b.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
async function shot(name, { w = W, h = H, scroll = null } = {}) {
  await view(w, h);
  await sleep(350);
  if (scroll) await P(`scrollTo(${JSON.stringify(scroll)})`);
  await sleep(200);
  report.shots.push(await b.shot(join(SHOTS, `${name}.png`)));
  await view(W, H);
}

try {
  check("page set up", (await until("window.__ready === true", 20_000)) && (await P("errors")).length === 0, await P("errors"));
  await P("setup({ withoutTasks: true })");
  await until(`document.querySelector("#host").innerText.trim().length > 0`, 10_000);
  const without = await js(`document.querySelector("#host").innerText.trim()`);
  check("without the Tasks package, the tool says it needs it and shows nothing else", without === "OpenFOAM needs the Tasks package, which is not installed here." && !(await js(`!!document.querySelector(".openfoam")`)), without);
  await P("installTasks()");
  const measured = await until("window.__p.figures().length > 5", 20_000);
  const fig = await P("figures()");
  report.figures = fig;
  check("the hull is read from its GLB and measured", !!measured && /narrow-transom/.test(await P("hullChip()")), { chip: await P("hullChip()"), warn: await P("hullWarn()") });
  const lwl = Number(fig.find((r) => r[0] === "Length, waterline")?.[1].replace(/[^\d.]/g, ""));
  check("waterline length 9.91 m (as node measured it)", Math.abs(lwl - 9.91) < 0.01, lwl);
  check("the open transom is reported closed", /closed 1 opening/.test(await P("hullWarn()")), await P("hullWarn()"));
  await until(`/served by/.test(window.__p.server())`, 10_000);
  check("the server shows the machine serving it", /served by probe-host/.test(await P("server()")), await P("server()"));
  const rb = await P("runButton()");
  check("Run is enabled and names the speed", rb.disabled === false && /6 kn/.test(rb.text), rb);
  const ph = await P("phases()");
  report.phases = ph;
  const tb = await P("tabs()");
  check("two tabs, and a case with no runs opens on Model setup", tb.labels.length === 2 && /Model setup/.test(tb.labels[0]) && /Runs/.test(tb.labels[1]) && tb.selected === "setup", tb);
  check(
    "Model setup holds the model and the run setup, each summed up in a line; Runs holds running and results",
    ph.map((x) => `${x.tab}:${x.phase}`).join() === "setup:model,setup:setup,runs:running,runs:results" &&
      ph[0].shown && ph[1].shown && !ph[3].shown && /narrow-transom/.test(ph[0].sum) && /9\.91 m/.test(ph[0].sum) && /6 kn/.test(ph[1].sum) && /none yet/.test(ph[3].sum),
    ph,
  );
  check("nothing going or finished: neither run view shows", !(await P(`runView("live")`)).shown && !(await P(`runView("result")`)).shown);
  await shot("1-preflight");

  // sinkage moves the waterline and the figures follow
  await P(`change("d.setup.attitude.sinkage = 0.3")`);
  await until("Number((window.__p.figures().find(r => r[0] === 'Draft')||[])[1]?.replace(/[^\\d.]/g,'')) > 1.7", 10_000);
  const draft = Number((await P("figures()")).find((r) => r[0] === "Draft")[1].replace(/[^\d.]/g, ""));
  check("sinkage 0.3 m deepens the draft by 0.3 m (1.49 → 1.79)", Math.abs(draft - 1.79) < 0.011, draft);
  await P(`change("d.setup.attitude.sinkage = 0")`);
  await until("Number((window.__p.figures().find(r => r[0] === 'Draft')||[])[1]?.replace(/[^\\d.]/g,'')) < 1.6", 10_000);

  // keeping the flow volume: asked for in the solver settings, sized in the estimate
  await P(`click('[data-k="keepVolume"]')`);
  await until("(window.__p.figures().find(r => r[0] === 'Flow volume')||[])[1]", 10_000);
  const vol = (await P("figures()")).find((r) => r[0] === "Flow volume");
  check("Keep volume asks for the flow volume, and the estimate says how big (MB)", /≈ \d+ MB/.test(vol?.[1] ?? ""), vol);

  // Run
  await P("clickRun()");
  await until("window.__p.state().runs.length === 1", 10_000);
  const st = await P("state()");
  report.afterRun = st;
  await until("!!window.__p.state().task", 10_000);
  const st2 = await P("state()");
  check("Run makes a run doc (queued, STL frozen, setup copied) and asks the queue for it, keyed by the run", st2.run0?.status === "queued" && st2.run0.stl > 84 && st2.requests[0] === st2.runs[0] && /^automerge:/.test(st2.task ?? "") && st2.selected === st2.runs[0] && Math.abs(st2.run0.info - 9.91) < 0.01, st2);
  check("the task names this package's run code, not the Tasks package's", st2.importUrl === `/${encodeURIComponent("automerge:openfoamProbePackage")}/daemon/run-task.mjs`, st2.importUrl);
  check("and keeps what it was made from: the hull's geometry digest and heads, the tool's version", /^[0-9a-f]{64}$/.test(st.run0.geometry ?? "") && st.run0.triangles > 100 && Array.isArray(st.run0.heads) && st.run0.made === "0.1.0", st.run0);
  check("a run that keeps its volume says so, and has a stage for it", st.run0.setup.keepVolume === true && st.run0.stageIds.at(-1) === "volume", st.run0.stageIds);
  check("Run switches to the Runs tab", (await P("tabs()")).selected === "runs", await P("tabs()"));
  await sleep(300);
  check("the queued run shows under Running, waiting for a machine", /Queued/.test((await P(`runView("live")`)).status ?? "") && /1 waiting/.test((await P("phases()"))[2].sum), await P(`runView("live")`));
  await shot("2-queued", { scroll: '[data-phase="running"]' });

  if (DONE) {
    await P(`midRun("/runs/done.json", 0.45)`);
    await sleep(500);
    const mid = await P(`runView("live")`);
    report.mid = mid;
    check("a run mid-solve shows under Running: its stage, its progress and both charts, with no tabs", /Solving/.test(mid.status) && mid.stages.includes("running") && mid.charts >= 2 && mid.howShown === true && mid.tabs.length === 0, mid);
    check("with two going, Running lists both and watches the one solving", mid.going.length === 2 && /Solving/.test(mid.status), mid.going);
    await shot("3-solving", { scroll: '[data-phase="running"]' });

    const done = await P(`loadRun("/runs/done.json")`);
    await until("window.__p.runView().tiles.length === 4", 20_000);
    const rv = await P("runView()");
    report.done = rv;
    check("a finished run shows under Results: four tiles and its figures", rv.tiles.length === 4 && rv.figures.length >= 8 && /Done/.test(rv.status), rv);
    check("its stages and convergence move to the How it ran tab", rv.howShown === false && rv.tabs.includes("How it ran") && /iterations/.test(rv.how) && rv.stages.length > 3, rv);
    check("and Running still watches the run going", /Solving/.test((await P(`runView("live")`)).status ?? ""));
    check("it offers its plots", rv.tabs.length >= 3, rv.tabs);
    await shot("4-results", { scroll: ".result-host" });
    check("a finished run's tabs: figures, its plots, inputs, how it ran", rv.tabs[0] === "Figures" && rv.tabs.at(-2) === "Inputs" && rv.tabs.at(-1) === "How it ran", rv.tabs);
    for (let i = 0; i < rv.tabs.length; i++) {
      await P(`clickTab(${i})`);
      await sleep(300);
      await shot(`5-plot-${i}-${rv.tabs[i].replace(/\W+/g, "-").toLowerCase()}`, { scroll: ".result-host .plots" });
    }
    const sb = await P("sceneBuild()");
    report.scene = sb;
    check("the scene provider builds the results: hull, water surface, streamlines, with legends", sb.meshes.includes("Hull") && sb.meshes.some((m) => /Waterplane|Free surface/.test(m)) && sb.meshes.includes("Streamlines") && sb.legends.filter(Boolean).length >= 2, sb);
    const sb2 = await P(`sceneBuild({ hull: "Cf", wake: true, centreplane: true, streamlines: false })`);
    check("its params pick the layers", sb2.meshes.includes("Wake plane") && sb2.meshes.includes("Centre plane") && !sb2.meshes.includes("Streamlines"), sb2);
    if (DONE2) {
      await P(`loadRun("/runs/done2.json")`);
      await until("window.__p.runView().curve === true", 10_000);
      const rv2 = await P("runView()");
      check("two finished runs at different speeds draw the resistance curve, and Results lists only finished runs", rv2.curve && rv2.runs.length === 2, rv2.runs);
      await shot("6-curve", { scroll: '[data-phase="results"]' });
      const cmp = await P(`compare(${JSON.stringify(done)})`);
      report.compare = cmp;
      check(
        "Inputs sets two runs side by side: the speed is what differs, and the results show the change",
        cmp.options >= 1 && cmp.differs.some((r) => r[0] === "Speed") && !cmp.differs.some((r) => r[0] === "Geometry" || r[0] === "Parts") && cmp.results.some((r) => r[0] === "Total resistance" && /%/.test(r[3])),
        cmp,
      );
      await shot("6b-compare", { scroll: ".result-host" });
      await P(`select(${JSON.stringify(done)})`);
    }
    await P(`theme("dark")`);
    await sleep(400);
    await shot("7-dark-results", { scroll: ".result-host" });
    await shot("8-dark-top");
    await P(`theme("light")`);
    await shot("9-phone", { w: 390, h: 844 });
  }
  const left = await P("unmount()");
  check("unmounting leaves the host empty", left.left === 0, left);
  check("no errors on the page", (await P("errors")).length === 0, await P("errors"));
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
report.logs = b.logs?.slice?.(-30);
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
