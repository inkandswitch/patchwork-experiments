// One run: where it is, how it's converging, and what it found. Updates
// in place as the daemon writes the run doc (every couple of seconds while
// it solves); the layers are loaded once, when it's done.

import { unpackChunks, decodeLayer, requestStop, isTerminal, FIELD_INFO } from "../protocol.js";
import { formatSpeed, formatDuration, MODE_LABELS } from "../setup.js";
import { lineChart, seriesColors, formatNumber } from "./charts.js";
import { runningAttitude } from "../attitude.js";
import { findWhenThere } from "../find.js";
import { waveProfile } from "../waveprofile.js";
import { fieldPlot } from "./fields.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const STATUS_LABEL = { queued: "Queued", meshing: "Meshing", solving: "Solving", post: "Reading results", done: "Done", failed: "Failed", cancelled: "Cancelled" };
const dotState = (s) => (s === "done" ? "done" : s === "failed" ? "failed" : s === "cancelled" || s === "queued" ? "idle" : "running");

export const fmtN = (v) => (!Number.isFinite(v) ? "–" : Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)} kN` : `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)} N`);
export const fmtW = (v) => (!Number.isFinite(v) ? "–" : v >= 1e6 ? `${(v / 1e6).toFixed(2)} MW` : v >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${v.toFixed(0)} W`);
const fmtC = (v) => (Number.isFinite(v) ? `${(v * 1000).toFixed(3)} ×10⁻³` : "–");

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
 * @param {{ repo: object, onUseAttitude?: (attitude: { sinkage: number, trim: number }) => void, showTitle?: boolean }} o
 *   onUseAttitude: offered on a double-body run's predicted running attitude (the case tool sets up a free-surface run with it);
 *   showTitle: name the run (where the view sits among others; a run opened alone has its title above)
 *
 * While a run goes, its stages and convergence are what there is to see. Once
 * it's done they fold into "How it ran" under the results; a run that failed
 * or was stopped keeps them open, with what went wrong above.
 */
export function mountRunView(host, { repo, onUseAttitude = null, showTitle = false }) {
  const root = document.createElement("div");
  root.className = "flow run-view";
  root.innerHTML = `
    <div class="head flow" style="--flow-space:6px"></div>
    <div class="error" hidden></div>
    <div class="results-box flow" hidden></div>
    <details class="how" open>
      <summary class="how-sum"></summary>
      <div class="flow">
        <div class="stages-box"><h3>Stages</h3><ol class="stages"></ol></div>
        <div class="charts-box"><h3>Resistance while it converges</h3><div class="c-forces"></div><h3 style="margin-top:12px">Residuals</h3><div class="c-res"></div></div>
      </div>
    </details>
  `;
  root.hidden = true; // until a run is shown
  host.append(root);
  const $ = (s) => root.querySelector(s);
  const forcesChart = lineChart($(".c-forces"), { height: 170, xLabel: "iteration", skipStart: 0.15, format: (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)) });
  const resChart = lineChart($(".c-res"), { height: 150, yLog: true, xLabel: "iteration" });
  let handle = null;
  let lastProgress = "";
  let resultsFor = null;
  let plots = [];
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
    if (showTitle) $(".run-title").textContent = run.title ?? "";
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

  async function results(run) {
    const box = $(".results-box");
    if (run.status !== "done" || !run.summary) {
      box.hidden = true;
      return;
    }
    const key = handle.url;
    if (resultsFor === key) return;
    resultsFor = key;
    box.hidden = false;
    const s = run.summary;
    const free = s.mode === "free-surface";
    const pct = (a) => (Number.isFinite(a) && s.Rt ? `${((100 * a) / s.Rt).toFixed(0)}%` : "");
    const att = runningAttitude(s, run.hull?.info, run.setup);
    const attRow = att
      ? `<tr><td>Running attitude (estimate)</td><td>${(att.sinkage * 1000).toFixed(0)} mm, ${Math.abs(att.trimDeg).toFixed(2)}° ${att.trimDeg >= 0 ? "bow down" : "bow up"}</td><td></td><td class="method">${esc(att.why)}${onUseAttitude ? ` <button class="use-attitude">Use for a free-surface run</button>` : ""}</td></tr>`
      : "";
    box.innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="v">${fmtN(s.Rt)}</div><div class="k">total resistance${Number.isFinite(s.RtStd) && s.RtStd > 0 ? ` ±${fmtN(s.RtStd)}` : ""}</div></div>
        <div class="tile"><div class="v">${fmtW(s.power)}</div><div class="k">effective power (R·V)</div></div>
        <div class="tile"><div class="v">${free ? fmtC(s.Cr) : Number.isFinite(s.formFactor) ? s.formFactor.toFixed(3) : "–"}</div><div class="k">${free ? "residuary Cr = Ct − Cf₀" : "form factor 1+k = Ct / Cf₀"}</div></div>
        <div class="tile"><div class="v">${s.Fn.toFixed(3)}</div><div class="k">Froude number</div></div>
      </div>
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
      <div class="plots flow" style="--flow-space:8px">
        <div class="tabs" role="tablist"></div>
        <div class="cluster"><label class="hint">Colour by <select class="plot-field" style="width:auto"></select></label><span class="hint plot-view"></span></div>
        <div class="plot-host"></div>
        <div class="profile-host" hidden></div>
        <div class="hint profile-note" hidden></div>
      </div>
      ${run.notes?.length ? `<div class="hint">${esc(run.notes.join("; "))}</div>` : ""}
    `;
    box.querySelector(".use-attitude")?.addEventListener("click", () => onUseAttitude?.(att.attitude));
    const layers = {};
    for (const [name, u] of Object.entries(run.layers ?? {})) {
      try {
        layers[name] = decodeLayer((await findWhenThere(repo, u)).doc());
      } catch {
        /* not here yet */
      }
    }
    if (resultsFor !== key) return;
    const views = [
      free && layers.freeSurface && { id: "waves", label: "Wave pattern", layer: "freeSurface", view: "plan", fields: ["eta", "Cp", "speed"], under: "hull", focus: true },
      free && layers.freeSurface && { id: "profile", label: "Wave profile", chart: true },
      !free && layers.waterplane && { id: "waterplane", label: "Waterplane", layer: "waterplane", view: "plan", fields: ["Cp", "ux", "speed"], under: "hull", focus: true },
      layers.hull && { id: "hull", label: "Hull", layer: "hull", view: "profile", fields: ["Cp", "Cf"] },
      layers.wake && { id: "wake", label: "Wake", layer: "wake", view: "wake", fields: ["ux", "speed", "Cp"] },
      layers.centreplane && { id: "centre", label: "Centre plane", layer: "centreplane", view: "profile", fields: ["ux", "speed", "Cp"], focus: true },
      free && layers.depth && { id: "depth", label: "Mid-draft", layer: "depth", view: "plan", fields: ["ux", "speed", "Cp"], under: "hull", focus: true },
    ].filter(Boolean);
    const tabs = box.querySelector(".tabs");
    const select = box.querySelector(".plot-field");
    const plot = fieldPlot(box.querySelector(".plot-host"));
    plots.push(plot);
    // the wave profile along the hull: where the water surface meets it (src/waveprofile.js)
    let profileChart = null;
    const showProfile = () => {
      const b = run.hull?.info?.bounds;
      const prof = b ? waveProfile(layers.freeSurface, { xMin: b.min[0], xMax: b.max[0] }) : [];
      if (!profileChart) {
        profileChart = lineChart(box.querySelector(".profile-host"), { height: 220, xLabel: "x (m), bow →", yLabel: "water height at the hull (m)", format: (v) => v.toFixed(2) });
        plots.push(profileChart);
      }
      const colors = seriesColors(root);
      const name = { both: "Both sides (half model)", port: "Port", starboard: "Starboard" };
      profileChart.update(prof.map((p, i) => ({ name: name[p.side], color: colors[i === 0 ? 1 : 2], points: p.points })));
      const all = prof.flatMap((p) => p.points.map((q) => ({ ...p, x: q[0], z: q[1] })));
      const note = box.querySelector(".profile-note");
      if (!all.length) note.textContent = "no contact line found between the water and the hull";
      else {
        const crest = all.reduce((a, q) => (q.z > a.z ? q : a));
        const trough = all.reduce((a, q) => (q.z < a.z ? q : a));
        const head = (s.V * s.V) / (2 * 9.80665);
        note.textContent = `Highest ${crest.z.toFixed(2)} m at x = ${crest.x.toFixed(2)} m${crest.side === "both" ? "" : ` (${crest.side})`}, lowest ${trough.z.toFixed(2)} m at x = ${trough.x.toFixed(2)} m. Still water is 0; V²/2g, the height of full stagnation, is ${head.toFixed(2)} m. Where the water meets the hull: the edge of the water surface along it, averaged in stations along the length.`;
      }
    };
    let cur = views[0];
    const show = (v, field) => {
      cur = v;
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === v.id)));
      const chart = !!v.chart;
      box.querySelector(".plot-host").hidden = chart;
      box.querySelector(".profile-host").hidden = !chart;
      box.querySelector(".profile-note").hidden = !chart;
      select.closest(".cluster").hidden = chart;
      if (chart) return showProfile();
      select.innerHTML = v.fields.filter((f) => layers[v.layer]?.fields[f]).map((f) => `<option value="${f}">${esc(FIELD_INFO[f]?.label ?? f)} (${esc(FIELD_INFO[f]?.unit ?? "")})</option>`).join("");
      if (field) select.value = field;
      box.querySelector(".plot-view").textContent = { plan: "from above, bow right", profile: "from starboard, bow right", wake: `a section ${(s.L * 0.05).toFixed(2)} m behind the stern, from astern` }[v.view];
      plot.update({ layer: layers[v.layer], field: select.value, view: v.view, under: v.under ? layers[v.under] : null, focus: v.focus ? layers.hull : null, maxHeight: v.view === "profile" ? 220 : 340 });
    };
    tabs.innerHTML = views.map((v) => `<button role="tab" data-id="${v.id}">${esc(v.label)}</button>`).join("");
    tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => show(views.find((v) => v.id === b.dataset.id))));
    select.addEventListener("change", () => show(cur, select.value));
    if (cur) show(cur);
    else box.querySelector(".plots").hidden = true;
  }

  // the stages and charts fold away once a run is done; set when it's shown or finishes, so a reader's own fold holds
  let foldedFor = "";
  function how(run) {
    const st = run.status;
    const k = `${handle.url}|${st === "done"}`;
    if (k !== foldedFor) {
      foldedFor = k;
      $(".how").open = st !== "done";
    }
    const took = run.startedAt && run.finishedAt ? formatDuration((run.finishedAt - run.startedAt) / 1000) : "";
    $(".how-sum").textContent = !isTerminal(st)
      ? "Stages and convergence"
      : st === "done"
        ? `How it ran${run.summary?.iterations ? ` · ${run.summary.iterations} iterations` : ""}${took ? ` · ${took}` : ""}${run.summary?.stoppedBy === "settled" ? " · settled" : run.summary?.stoppedBy === "asked" ? " · finished early" : ""}`
        : "Where it stopped";
  }

  function render() {
    const run = handle?.doc();
    if (!run) return;
    header(run);
    how(run);
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
      foldedFor = "";
      plots.forEach((p) => p.dispose());
      plots = [];
      $(".results-box").innerHTML = "";
      root.hidden = !h;
      if (!h) return;
      h.on("change", onChange);
      render();
      clearInterval(tick);
      // the elapsed time and stage clocks move without doc changes
      tick = setInterval(() => {
        const run = handle?.doc();
        if (run && !isTerminal(run.status)) {
          header(run);
          stages(run);
        }
      }, 1000);
    },
    dispose() {
      handle?.off("change", onChange);
      clearInterval(tick);
      plots.forEach((p) => p.dispose());
      forcesChart.dispose();
      resChart.dispose();
      root.remove();
    },
  };
}
