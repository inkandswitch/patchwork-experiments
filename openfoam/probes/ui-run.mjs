// The case tool in headless Chrome: the BUILT package (dist/) on an
// in-memory repo (probes/ui-probe.html), with a real camber GLB as the hull
// and, when given, real runs dumped by probes/local-run.mjs --dump.
//
//   pnpm build && node probes/ui-run.mjs [--done run.json] [--done2 run2.json] [--shots dir] [--show]
//
// Checks: the hull is read and measured; the pre-flight figures; Run makes a
// run doc (frozen setup + STL) and files it in the server's inbox; a run
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

const W = 1300, H = 950;
const b = await browser({ root: PKG, port: Number(process.env.PROBE_PORT) || 4795, cdp: Number(process.env.PROBE_CDP) || 9795, page: "/probes/ui-probe.html", width: W, height: H, show: process.argv.includes("--show"), timeout: 300_000, mounts: { "/hulls/": HULLS, "/runs/": runs } });
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
  await P("setup()");
  const measured = await until("window.__p.figures().length > 5", 20_000);
  const fig = await P("figures()");
  report.figures = fig;
  check("the hull is read from its GLB and measured", !!measured && /narrow-transom/.test(await P("hullChip()")), { chip: await P("hullChip()"), warn: await P("hullWarn()") });
  const lwl = Number(fig.find((r) => r[0] === "Length, waterline")?.[1].replace(/[^\d.]/g, ""));
  check("waterline length 9.91 m (as node measured it)", Math.abs(lwl - 9.91) < 0.01, lwl);
  check("the open transom is reported closed", /closed 1 opening/.test(await P("hullWarn()")), await P("hullWarn()"));
  check("the server shows online with its cores", /online/.test(await P("server()")) && /8 cores/.test(await P("server()")), await P("server()"));
  const rb = await P("runButton()");
  check("Run is enabled and names the speed", rb.disabled === false && /6\.00 kn/.test(rb.text), rb);
  await shot("1-preflight");

  // sinkage moves the waterline and the figures follow
  await P(`change("d.setup.attitude.sinkage = 0.3")`);
  await until("Number((window.__p.figures().find(r => r[0] === 'Draft')||[])[1]?.replace(/[^\\d.]/g,'')) > 1.7", 10_000);
  const draft = Number((await P("figures()")).find((r) => r[0] === "Draft")[1].replace(/[^\d.]/g, ""));
  check("sinkage 0.3 m deepens the draft by 0.3 m (1.49 → 1.79)", Math.abs(draft - 1.79) < 0.011, draft);
  await P(`change("d.setup.attitude.sinkage = 0")`);
  await until("Number((window.__p.figures().find(r => r[0] === 'Draft')||[])[1]?.replace(/[^\\d.]/g,'')) < 1.6", 10_000);

  // Run
  await P("clickRun()");
  await until("window.__p.state().runs.length === 1", 10_000);
  const st = await P("state()");
  report.afterRun = st;
  check("Run makes a run doc (queued, STL frozen, setup copied) and files it in the inbox", st.run0?.status === "queued" && st.run0.stl > 84 && st.requests[0] === st.runs[0] && st.selected === st.runs[0] && Math.abs(st.run0.info - 9.91) < 0.01, st);
  await sleep(300);
  check("the queued run says it waits for the daemon", /Queued/.test((await P("runView()")).status ?? ""), await P("runView()"));
  await shot("2-queued", { scroll: ".run-host" });

  if (DONE) {
    await P(`midRun("/runs/done.json", 0.45)`);
    await sleep(500);
    const mid = await P("runView()");
    report.mid = mid;
    check("a run mid-solve shows its stage, its progress and both charts", /Solving/.test(mid.status) && mid.stages.includes("running") && mid.charts >= 2, mid);
    await shot("3-solving", { scroll: ".run-host" });

    const done = await P(`loadRun("/runs/done.json")`);
    await until("window.__p.runView().tiles.length === 4", 20_000);
    const rv = await P("runView()");
    report.done = rv;
    check("a finished run shows four tiles and its figures", rv.tiles.length === 4 && rv.figures.length >= 8 && /Done/.test(rv.status), rv);
    check("it offers its plots", rv.tabs.length >= 3, rv.tabs);
    await shot("4-results", { scroll: ".results-box" });
    for (let i = 0; i < rv.tabs.length; i++) {
      await P(`clickTab(${i})`);
      await sleep(300);
      await shot(`5-plot-${i}-${rv.tabs[i].replace(/\W+/g, "-").toLowerCase()}`, { scroll: ".plots" });
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
      check("two finished runs at different speeds draw the resistance curve", rv2.curve && rv2.runs.length >= 3, rv2.runs);
      await shot("6-curve", { scroll: ".runs-box" });
      await P(`select(${JSON.stringify(done)})`);
    }
    await P(`theme("dark")`);
    await sleep(400);
    await shot("7-dark-results", { scroll: ".results-box" });
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
