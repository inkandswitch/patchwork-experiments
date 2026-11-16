// One run: where it is, how it's converging, and what it found. Updates
// in place as the daemon writes the run doc (every couple of seconds while
// it solves); the layers are loaded once, when it's done.
//
// While a run goes, its stages and convergence are all there is to see. A
// finished run shows its headline numbers, then one row of tabs: its
// figures, each plot, its inputs (what it was made from, set against
// another run if you pick one), and how it ran. A run that failed or was
// stopped opens on how it ran, with what went wrong above.

import { unpackChunks, decodeLayer, requestStop, isTerminal, FIELD_INFO } from "../protocol.js";
import { formatSpeed, formatDuration, MODE_LABELS } from "../setup.js";
import { lineChart, seriesColors } from "./charts.js";
import { runningAttitude } from "../attitude.js";
import { findWhenThere } from "../find.js";
import { internalize } from "../segments.js";
import { waveProfile } from "../waveprofile.js";
import { inputRows, diffInputs, resultRows } from "../inputs.js";
import { fieldPlot } from "./fields.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const STATUS_LABEL = { queued: "Queued", meshing: "Meshing", solving: "Solving", post: "Reading results", done: "Done", failed: "Failed", cancelled: "Cancelled" };
const dotState = (s) => (s === "done" ? "done" : s === "failed" ? "failed" : s === "cancelled" || s === "queued" ? "idle" : "running");

export const fmtN = (v) => (!Number.isFinite(v) ? "–" : Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)} kN` : `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)} N`);
export const fmtW = (v) => (!Number.isFinite(v) ? "–" : v >= 1e6 ? `${(v / 1e6).toFixed(2)} MW` : v >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${v.toFixed(0)} W`);
const fmtC = (v) => (Number.isFinite(v) ? `${(v * 1000).toFixed(3)} ×10⁻³` : "–");
const fmtResult = (r) =>
  !Number.isFinite(r.value)
    ? "–"
    : r.unit === "N"
      ? fmtN(r.value)
      : r.unit === "W"
        ? fmtW(r.value)
        : r.unit === "s"
          ? formatDuration(r.value)
          : r.unit
            ? `${r.value.toFixed(3)} ${r.unit}`
            : r.value.toLocaleString("en");

/** Residuals folded to at most four series: U (worst component), pressure, turbulence (worst of k, ω), and α. */
export function residualSeries(table) {
  const { cols, rows } = table;
  const at = (name) => cols.indexOf(name);
  const pick = (names) => names.map(at).filter((i) => i >= 0);
  const groups = [
    { name: "U", idx: pick(["Ux", "Uy", "Uz"]) },
    { name: cols.includes("p_rgh") ? "p_rgh" : "p", idx: pick(["p", "p_rgh"]) },
    { name: "k, ω", idx: pick(["k", "omega"]) },
    { name: "α", idx: pick(["alpha.water"]) },
  ].filter((g) => g.idx.length);
  return groups.map((g) => ({ name: g.name, points: rows.map((r) => [r[0], Math.max(...g.idx.map((i) => r[i]).filter(Number.isFinite))]) }));
}

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {object} o.repo
 * @param {boolean} [o.showTitle]  name the run (where the view sits among others; a run opened alone has its title above)
 * @param {(attitude: { sinkage: number, trim: number }) => void} [o.onUseAttitude]  offered on a double-body run's predicted running attitude
 * @param {(run: object) => void} [o.onReuse]    "Set up the case from this run"
 * @param {(run: object) => void} [o.onRerun]    "Run again exactly": the same setup and the same frozen hull
 * @param {(url: string) => { url: string, title: string, letter?: string }[]} [o.others]  finished runs this one can be set against
 * @param {(url: string) => object|null} [o.runDoc]  a run's doc, by url (for the comparison)
 * @param {(run: object) => string|null} [o.variant]  the letter of a run's hull variation
 */
export function mountRunView(host, { repo, onUseAttitude = null, showTitle = false, onReuse = null, onRerun = null, others = null, runDoc = null, variant = null }) {
  const root = document.createElement("div");
  root.className = "flow run-view";
  root.innerHTML = `
    <div class="head flow" style="--flow-space:6px"></div>
    <div class="error" hidden></div>
    <div class="tiles-host"></div>
    <div class="tabs view-tabs" role="tablist" hidden></div>
    <div class="panel p-figures" hidden></div>
    <div class="panel plots flow" style="--flow-space:8px" hidden>
      <div class="cluster plot-controls"><label class="hint">Colour by <select class="plot-field" style="width:auto"></select></label><span class="hint plot-view"></span></div>
      <div class="plot-host"></div>
      <div class="profile-host" hidden></div>
      <div class="hint profile-note" hidden></div>
    </div>
    <div class="panel p-inputs flow" style="--flow-space:10px" hidden></div>
    <div class="panel how flow">
      <div class="hint how-sum"></div>
      <div class="stages-box"><h3>Stages</h3><ol class="stages"></ol></div>
      <div class="charts-box"><h3>Resistance while it converges</h3><div class="c-forces"></div><h3 style="margin-top:12px">Residuals</h3><div class="c-res"></div></div>
    </div>
  `;
  root.hidden = true; // until a run is shown
  host.append(root);
  const $ = (s) => root.querySelector(s);
  const forcesChart = lineChart($(".c-forces"), { height: 170, xLabel: "iteration", skipStart: 0.15, format: (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)) });
  const resChart = lineChart($(".c-res"), { height: 150, yLog: true, xLabel: "iteration" });
  const plot = fieldPlot($(".plot-host"));
  let profileChart = null;
  let handle = null;
  let lastProgress = "";
  let resultsFor = null;
  let layers = {};
  let views = [];
  // the tab you're on, kept from run to run (stepping through runs keeps showing the same thing)
  let tabId = "figures";
  const plotField = {};
  let compareUrl = null;
  let tick = null;

  const onChange = () => render();

  // the buttons are made once (a re-render between pointerdown and click would eat the click)
  $(".head").innerHTML = `
    <div class="cluster" style="justify-content:space-between">
      <span class="cluster">${showTitle ? `<h3 class="run-title"></h3>` : ""}<span class="chip status-chip"></span></span>
      <span class="cluster">
        <button class="finish" title="Write the solution as it is and read the results" hidden>Finish now</button>
        <button class="cancel" data-danger hidden>Cancel</button>
      </span>
    </div>
    <div class="head-info flow" style="--flow-space:4px"></div>`;
  $(".finish").addEventListener("click", () => handle?.change((d) => requestStop(d, { keep: true })));
  $(".cancel").addEventListener("click", () => handle?.change((d) => requestStop(d, { keep: false })));

  function header(run) {
    const p = run.progress ?? {};
    const st = run.status;
    const started = run.startedAt ?? run.requestedAt;
    const ended = run.finishedAt ?? Date.now();
    const asked = run.control?.cancel ? "cancel asked…" : run.control?.finish ? "finishing…" : "";
    const pct = p.of ? Math.min(100, (100 * (p.iteration ?? 0)) / p.of) : 0;
    const letter = variant?.(run);
    if (showTitle) $(".run-title").textContent = `${letter ? `${letter} · ` : ""}${run.title ?? ""}`;
    $(".status-chip").innerHTML = `<span class="dot" data-state="${dotState(st)}"></span>${STATUS_LABEL[st] ?? esc(st)}${asked ? ` · ${asked}` : ""}`;
    $(".finish").hidden = st !== "solving" || !!run.control?.finish;
    $(".cancel").hidden = isTerminal(st) || !!run.control?.cancel;
    $(".head-info").innerHTML = `
      <div class="hint">${esc(MODE_LABELS[run.setup?.mode] ?? "")} · ${formatSpeed(run.setup?.speed ?? 0, run.setup?.speedUnit)} · ${esc(run.setup?.mesh)} mesh${run.daemon ? ` · ${esc(run.daemon.host)}, ${run.daemon.cores} core${run.daemon.cores === 1 ? "" : "s"}, OpenFOAM ${esc(run.daemon.openfoam ?? "")}` : ""}${started && st !== "queued" ? ` · ${formatDuration((ended - started) / 1000)}` : ""}</div>
      ${st === "solving" ? `<progress max="100" value="${pct.toFixed(1)}"></progress><div class="hint">iteration ${p.iteration ?? 0} of ${p.of}${run.setup?.mode === "double-body" ? " (it stops early once the residuals settle)" : ""}</div>` : ""}
      ${st === "queued" ? `<div class="hint">Waiting for the daemon; it takes runs oldest first.</div>` : ""}
    `;
  }

  function stages(run) {
    $(".stages").innerHTML = (run.stages ?? [])
      .map((s) => {
        const icon = { done: "✓", failed: "✕", running: "●", skipped: "–", pending: "○" }[s.status] ?? "○";
        const t = s.startedAt ? formatDuration(((s.endedAt ?? Date.now()) - s.startedAt) / 1000) : "";
        return `<li data-status="${s.status}"><span>${icon}</span><span>${esc(s.label)}</span><span class="time">${s.status === "pending" ? "" : t}</span>
          ${s.note ? `<span class="note">${esc(s.note)}</span>` : ""}
          ${s.status === "running" && s.tail ? `<pre class="tail note">${esc(s.tail)}</pre>` : ""}
          ${s.status === "failed" && s.tail ? `<pre class="tail note">${esc(s.tail)}</pre>` : ""}</li>`;
      })
      .join("");
    const pre = root.querySelector("pre.tail");
    if (pre) pre.scrollTop = pre.scrollHeight;
    const took = run.startedAt && run.finishedAt ? formatDuration((run.finishedAt - run.startedAt) / 1000) : "";
    const s = run.summary;
    const sum = !isTerminal(run.status)
      ? ""
      : run.status === "done"
        ? `${s?.iterations ? `${s.iterations} iterations` : ""}${took ? `, ${took}` : ""}${s?.stoppedBy === "settled" ? "; stopped once settled" : s?.stoppedBy === "asked" ? "; finished early when asked" : ""}`
        : "Where it stopped.";
    $(".how-sum").textContent = sum;
    $(".how-sum").hidden = !sum;
  }

  function charts(run) {
    const key = `${run.progress?.forces?.length ?? 0}/${run.progress?.residuals?.length ?? 0}`;
    if (key === lastProgress) return;
    lastProgress = key;
    const [c1, c2, c3, c4] = seriesColors(root);
    const f = unpackChunks(run.progress?.forces);
    const col = (name) => f.cols.indexOf(name);
    forcesChart.update(
      f.rows.length
        ? [
            { name: "Total", color: c1, points: f.rows.map((r) => [r[0], r[col("Rt")]]) },
            { name: "Pressure", color: c2, points: f.rows.map((r) => [r[0], r[col("Rp")]]) },
            { name: "Viscous", color: c3, points: f.rows.map((r) => [r[0], r[col("Rv")]]) },
          ]
        : [],
    );
    resChart.update(residualSeries(unpackChunks(run.progress?.residuals)).map((s, i) => ({ ...s, color: [c1, c2, c3, c4][i] })));
    $(".charts-box").hidden = !f.rows.length && run.status !== "solving";
  }

  // ------------------------------------------------------------ a finished run
  function tiles(run) {
    const s = run.summary;
    if (run.status !== "done" || !s) return void ($(".tiles-host").innerHTML = "");
    const free = s.mode === "free-surface";
    $(".tiles-host").innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="v">${fmtN(s.Rt)}</div><div class="k">total resistance${Number.isFinite(s.RtStd) && s.RtStd > 0 ? ` ±${fmtN(s.RtStd)}` : ""}</div></div>
        <div class="tile"><div class="v">${fmtW(s.power)}</div><div class="k">effective power (R·V)</div></div>
        <div class="tile"><div class="v">${free ? fmtC(s.Cr) : Number.isFinite(s.formFactor) ? s.formFactor.toFixed(3) : "–"}</div><div class="k">${free ? "residuary Cr = Ct − Cf₀" : "form factor 1+k = Ct / Cf₀"}</div></div>
        <div class="tile"><div class="v">${s.Fn.toFixed(3)}</div><div class="k">Froude number</div></div>
      </div>`;
  }

  function figures(run) {
    const s = run.summary;
    const free = s.mode === "free-surface";
    const pct = (a) => (Number.isFinite(a) && s.Rt ? `${((100 * a) / s.Rt).toFixed(0)}%` : "");
    const att = runningAttitude(s, run.hull?.info, run.setup);
    const attRow = att
      ? `<tr><td>Running attitude (estimate)</td><td>${(att.sinkage * 1000).toFixed(0)} mm, ${Math.abs(att.trimDeg).toFixed(2)}° ${att.trimDeg >= 0 ? "bow down" : "bow up"}</td><td></td><td class="method">${esc(att.why)}${onUseAttitude ? ` <button class="use-attitude">Use for a free-surface run</button>` : ""}</td></tr>`
      : "";
    const box = $(".p-figures");
    box.innerHTML = `
      <table class="figures">
        <tr><th>Figure</th><th>Value</th><th>Share</th><th>How</th></tr>
        <tr><td>Total resistance R<sub>T</sub></td><td>${fmtN(s.Rt)}</td><td></td><td class="method">forces on the hull, mean of the last ${s.window} iterations${s.half ? ", half model ×2" : ""}</td></tr>
        <tr><td>Pressure part</td><td>${fmtN(s.Rp)}</td><td>${pct(s.Rp)}</td><td class="method">${free ? "form and waves" : "form (no waves in a double body)"}</td></tr>
        <tr><td>Viscous part</td><td>${fmtN(s.Rv)}</td><td>${pct(s.Rv)}</td><td class="method">wall shear, kOmegaSST + Spalding wall function</td></tr>
        <tr><td>C<sub>T</sub></td><td>${fmtC(s.Ct)}</td><td></td><td class="method">R<sub>T</sub> / ½ρV²S, S = ${s.S.toFixed(2)} m² wetted at rest</td></tr>
        <tr><td>C<sub>V</sub> (viscous)</td><td>${fmtC(s.Cv)}</td><td></td><td class="method"></td></tr>
        <tr><td>C<sub>F0</sub> (ITTC-57)</td><td>${fmtC(s.Cf0)}</td><td></td><td class="method">0.075 / (log₁₀Re − 2)², Re = ${s.Re.toExponential(2)} on L = ${s.L.toFixed(2)} m</td></tr>
        <tr><td>Vertical force F<sub>z</sub></td><td>${fmtN(s.Fz)}</td><td></td><td class="method">${free ? "pressure and buoyancy on the hull held fixed; minus the weight, what would sink or lift it" : "suction of the double body: the hull would squat (sink) by this"}</td></tr>
        ${attRow}
        ${!s.half && Number.isFinite(s.Fy) ? `<tr><td>Side force F<sub>y</sub></td><td>${fmtN(s.Fy)}</td><td></td><td class="method">to port positive${Math.abs(s.heel ?? 0) > 1e-9 ? `; heeled ${Math.abs(s.heel)}° to ${s.heel > 0 ? "starboard" : "port"}, no leeway` : ""}</td></tr>` : ""}
        ${!s.half && Number.isFinite(s.Mx) ? `<tr><td>Heeling moment M<sub>x</sub></td><td>${(s.Mx / 1000).toFixed(2)} kN·m</td><td></td><td class="method">about the waterline at mid-length; starboard down positive, as heel</td></tr>` : ""}
        ${!s.half && Number.isFinite(s.Mz) ? `<tr><td>Yaw moment M<sub>z</sub></td><td>${(s.Mz / 1000).toFixed(2)} kN·m</td><td></td><td class="method">bow to port positive</td></tr>` : ""}
        <tr><td>y⁺ on the hull</td><td>${s.yPlus ? `${s.yPlus.average.toFixed(0)}` : "–"}</td><td></td><td class="method">${s.yPlus ? `average; ${s.yPlus.min.toFixed(0)}–${s.yPlus.max.toFixed(0)}. Spalding's wall function holds at any y⁺` : ""}</td></tr>
        <tr><td>Mesh</td><td>${s.cells ? s.cells.toLocaleString("en") : "–"}</td><td></td><td class="method">cells${run.mesh?.layers ? `, ${run.mesh.layers.achieved.toFixed(1)}/${run.mesh.layers.target} wall layers` : ""}${run.mesh && !run.mesh.ok ? `, ${run.mesh.failedChecks} mesh checks failed` : ""}</td></tr>
        <tr><td>Converged</td><td>${s.stoppedBy === "residuals" || s.converged ? "yes" : s.stoppedBy === "settled" ? "settled" : "no"}</td><td></td><td class="method">${
          s.stoppedBy === "residuals" || s.converged
            ? "residuals under their targets"
            : s.stoppedBy === "settled"
              ? esc(s.settledNote ?? "")
              : `${s.stoppedBy === "asked" ? "stopped when asked" : "ran all its iterations"} at ${s.iterations}; R<sub>T</sub> moved ${fmtN(Math.abs(s.RtDrift))} over the averaging window`
        }</td></tr>
      </table>
      ${run.notes?.length ? `<div class="hint" style="margin-top:8px">${esc(run.notes.join("; "))}</div>` : ""}`;
    box.querySelector(".use-attitude")?.addEventListener("click", () => onUseAttitude?.(att.attitude));
  }

  /** What the run was made from; beside another run's when one is picked, with what differs marked. */
  function inputs(run) {
    const box = $(".p-inputs");
    const list = (others?.(handle.url) ?? []).filter((o) => o.url !== handle.url);
    if (compareUrl && !list.some((o) => o.url === compareUrl)) compareUrl = null;
    const other = compareUrl ? runDoc?.(compareUrl) : null;
    const theirs = other ? new Map(inputRows(other).map((r) => [r.key, r])) : null;
    const differs = other ? diffInputs(run, other) : new Set();
    const otherName = other ? `${variant?.(other) ? `${variant(other)} · ` : ""}${other.title ?? ""}` : "";
    let group = null;
    const rows = inputRows(run)
      .map((r) => {
        const head = r.group !== group ? `<tr class="group"><td colspan="${other ? 3 : 2}">${esc(r.group)}</td></tr>` : "";
        group = r.group;
        return `${head}<tr ${differs.has(r.key) ? "data-differs" : ""}><td>${esc(r.label)}</td><td>${esc(r.value)}</td>${other ? `<td>${esc(theirs.get(r.key)?.value ?? "–")}</td>` : ""}</tr>`;
      })
      .join("");
    const sameCase = other && run.recipe?.digest && run.recipe.digest === other.recipe?.digest;
    let res = "";
    if (other) {
      const theirsR = new Map(resultRows(other).map((r) => [r.key, r]));
      res = `<h3>Results side by side</h3><table class="figures compare"><tr><th></th><th>This run</th><th>${esc(otherName)}</th><th>Change</th></tr>${resultRows(run)
        .filter((r) => Number.isFinite(r.value) || Number.isFinite(theirsR.get(r.key)?.value))
        .map((r) => {
          const o = theirsR.get(r.key);
          const d = Number.isFinite(r.value) && Number.isFinite(o?.value) && o.value !== 0 ? (100 * (r.value - o.value)) / Math.abs(o.value) : null;
          return `<tr><td>${esc(r.label)}</td><td>${fmtResult(r)}</td><td>${o ? fmtResult(o) : "–"}</td><td>${d == null ? "" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`}</td></tr>`;
        })
        .join("")}</table>`;
    }
    box.innerHTML = `
      <div class="cluster">
        ${list.length ? `<label class="hint">Compare with <select class="compare" style="width:auto"><option value="">nothing</option>${list.map((o) => `<option value="${esc(o.url)}" ${o.url === compareUrl ? "selected" : ""}>${esc(o.letter ? `${o.letter} · ` : "")}${esc(o.title)}</option>`).join("")}</select></label>` : ""}
        <span style="flex:1"></span>
        ${onReuse ? `<button class="reuse" title="Put this run's setup, and the hull it was read from, back into the case: then change one thing">Set up the case from this run</button>` : ""}
        ${onRerun ? `<button class="rerun" title="A new run with this one's setup and its frozen hull, exactly">Run again exactly</button>` : ""}
      </div>
      ${other ? `<div class="hint">${differs.size ? `${differs.size} input${differs.size === 1 ? " differs" : "s differ"}, marked.` : "No input differs."}${sameCase ? " Both wrote the same OpenFOAM case (one recipe digest)." : ""}</div>` : ""}
      <table class="figures inputs"><tr><th>Input</th><th>This run</th>${other ? `<th>${esc(otherName)}</th>` : ""}</tr>${rows}</table>
      ${res}
      <div class="hint">A run keeps all of this, with its hull as a closed STL and, once the daemon has started it, every file of its OpenFOAM case (the recipe): it can be made again without this case or that daemon.</div>`;
    box.querySelector(".compare")?.addEventListener("change", (e) => {
      compareUrl = e.target.value || null;
      inputs(run);
    });
    box.querySelector(".reuse")?.addEventListener("click", () => onReuse?.(handle.doc()));
    box.querySelector(".rerun")?.addEventListener("click", () => onRerun?.(handle.doc()));
  }

  async function results(run) {
    if (!isTerminal(run.status)) {
      resultsFor = null;
      $(".view-tabs").hidden = true;
      root.querySelectorAll(".panel").forEach((p) => (p.hidden = !p.classList.contains("how")));
      $(".tiles-host").innerHTML = "";
      return;
    }
    const key = `${handle.url}|${run.status}|${run.summary ? 1 : 0}`;
    if (resultsFor === key) return;
    resultsFor = key;
    const s = run.summary;
    const done = run.status === "done" && !!s;
    tiles(run);
    if (done) figures(run);
    layers = {};
    let plotsFor = [];
    const showTabs = () => {
      views = [done && { id: "figures", label: "Figures" }, ...plotsFor, { id: "inputs", label: "Inputs" }, { id: "how", label: done ? "How it ran" : "Where it stopped" }].filter(Boolean);
      const tabs = $(".view-tabs");
      tabs.hidden = false;
      tabs.innerHTML = views.map((v) => `<button role="tab" data-id="${v.id}">${esc(v.label)}</button>`).join("");
      tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => select(b.dataset.id)));
      // the tab you were on, if this run has it; else its figures, or where it stopped
      select(views.some((v) => v.id === tabId) ? tabId : done ? "figures" : "how", { remember: false });
    };
    showTabs();
    if (!done) return;
    for (const [name, u] of Object.entries(run.layers ?? {})) {
      try {
        layers[name] = decodeLayer(await internalize(repo, (await findWhenThere(repo, u)).doc()));
      } catch {
        /* not here yet */
      }
    }
    if (resultsFor !== key) return;
    const free = s.mode === "free-surface";
    plotsFor = [
      free && layers.freeSurface && { id: "waves", label: "Wave pattern", layer: "freeSurface", view: "plan", fields: ["eta", "Cp", "speed"], under: "hull", focus: true },
      free && layers.freeSurface && { id: "profile", label: "Wave profile", chart: true },
      !free && layers.waterplane && { id: "waterplane", label: "Waterplane", layer: "waterplane", view: "plan", fields: ["Cp", "ux", "speed"], under: "hull", focus: true },
      layers.hull && { id: "hull", label: "Hull", layer: "hull", view: "profile", fields: ["Cp", "Cf"] },
      layers.wake && { id: "wake", label: "Wake", layer: "wake", view: "wake", fields: ["ux", "speed", "Cp"] },
      layers.centreplane && { id: "centre", label: "Centre plane", layer: "centreplane", view: "profile", fields: ["ux", "speed", "Cp"], focus: true },
      free && layers.depth && { id: "depth", label: "Mid-draft", layer: "depth", view: "plan", fields: ["ux", "speed", "Cp"], under: "hull", focus: true },
    ].filter(Boolean);
    showTabs();
  }

  /** Show one tab. remember: false when a run is shown (a missing tab falls back without forgetting yours). */
  function select(id, { remember = true } = {}) {
    const v = views.find((x) => x.id === id) ?? views[0];
    if (!v) return;
    if (remember) tabId = v.id;
    $(".view-tabs")
      .querySelectorAll("button")
      .forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === v.id)));
    const panel = v.id === "figures" ? "p-figures" : v.id === "inputs" ? "p-inputs" : v.id === "how" ? "how" : "plots";
    root.querySelectorAll(".panel").forEach((p) => (p.hidden = !p.classList.contains(panel)));
    const run = handle?.doc();
    if (v.id === "inputs" && run) inputs(run);
    if (panel === "plots") showPlot(v);
  }

  function showPlot(v) {
    const s = handle.doc().summary;
    const chart = !!v.chart;
    $(".plot-host").hidden = chart;
    $(".profile-host").hidden = !chart;
    $(".profile-note").hidden = !chart;
    $(".plot-controls").hidden = chart;
    if (chart) return showProfile(handle.doc());
    const sel = $(".plot-field");
    sel.innerHTML = v.fields.filter((f) => layers[v.layer]?.fields[f]).map((f) => `<option value="${f}">${esc(FIELD_INFO[f]?.label ?? f)} (${esc(FIELD_INFO[f]?.unit ?? "")})</option>`).join("");
    if (plotField[v.id] && [...sel.options].some((o) => o.value === plotField[v.id])) sel.value = plotField[v.id];
    sel.onchange = () => {
      plotField[v.id] = sel.value;
      showPlot(v);
    };
    $(".plot-view").textContent = { plan: "from above, bow right", profile: "from starboard, bow right", wake: `a section ${(s.L * 0.05).toFixed(2)} m behind the stern, from astern` }[v.view];
    plot.update({ layer: layers[v.layer], field: sel.value, view: v.view, under: v.under ? layers[v.under] : null, focus: v.focus ? layers.hull : null, maxHeight: v.view === "profile" ? 220 : 340 });
  }

  // the wave profile along the hull: where the water surface meets it (src/waveprofile.js)
  function showProfile(run) {
    const s = run.summary;
    const b = run.hull?.info?.bounds;
    const prof = b && layers.freeSurface ? waveProfile(layers.freeSurface, { xMin: b.min[0], xMax: b.max[0] }) : [];
    if (!profileChart) profileChart = lineChart($(".profile-host"), { height: 220, xLabel: "x (m), bow →", yLabel: "water height at the hull (m)", format: (v) => v.toFixed(2) });
    const colors = seriesColors(root);
    const name = { both: "Both sides (half model)", port: "Port", starboard: "Starboard" };
    profileChart.update(prof.map((p, i) => ({ name: name[p.side], color: colors[i === 0 ? 1 : 2], points: p.points })));
    const all = prof.flatMap((p) => p.points.map((q) => ({ ...p, x: q[0], z: q[1] })));
    const note = $(".profile-note");
    if (!all.length) note.textContent = "no contact line found between the water and the hull";
    else {
      const crest = all.reduce((a, q) => (q.z > a.z ? q : a));
      const trough = all.reduce((a, q) => (q.z < a.z ? q : a));
      const head = (s.V * s.V) / (2 * 9.80665);
      note.textContent = `Highest ${crest.z.toFixed(2)} m at x = ${crest.x.toFixed(2)} m${crest.side === "both" ? "" : ` (${crest.side})`}, lowest ${trough.z.toFixed(2)} m at x = ${trough.x.toFixed(2)} m. Still water is 0; V²/2g, the height of full stagnation, is ${head.toFixed(2)} m. Where the water meets the hull: the edge of the water surface along it, averaged in stations along the length.`;
    }
  }

  function render() {
    const run = handle?.doc();
    if (!run) return;
    header(run);
    stages(run);
    charts(run);
    results(run);
    const err = $(".error");
    err.hidden = !run.error;
    err.textContent = run.error ?? "";
  }

  return {
    show(h) {
      if (handle === h) return;
      handle?.off("change", onChange);
      handle = h;
      lastProgress = "";
      resultsFor = null;
      root.hidden = !h;
      clearInterval(tick);
      if (!h) return;
      h.on("change", onChange);
      render();
      // the elapsed time and stage clocks move without doc changes
      tick = setInterval(() => {
        const run = handle?.doc();
        if (run && !isTerminal(run.status)) {
          header(run);
          stages(run);
        }
      }, 1000);
    },
    /** Redraw what depends on other runs (the comparison, the variation letter), after they change. */
    refresh() {
      const run = handle?.doc();
      if (!run) return;
      header(run);
      if (tabId === "inputs" && isTerminal(run.status) && !$(".p-inputs").hidden) inputs(run);
    },
    dispose() {
      handle?.off("change", onChange);
      clearInterval(tick);
      plot.dispose();
      profileChart?.dispose();
      forcesChart.dispose();
      resChart.dispose();
      root.remove();
    },
  };
}
