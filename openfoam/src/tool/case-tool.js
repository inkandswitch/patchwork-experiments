// The case tool: link a hull, describe the analysis, see what it will cost,
// ask a machine for it (a task queue, the Server field), watch it run, and
// read what it found.

import css from "./styles.css?inline";
import { normalizeSetup, patchSetup, writeSetup, setupProblems, speedIn, MODE_LABELS, MESH_PRESETS, KNOT, formatDuration, formatSpeed } from "../setup.js";
import { pathLabel } from "../hull/acquire.js";
import { stashCovers } from "../hull/stash.js";
import { readHull, hullModel, prepareModel, partShells, floatAt, keepDisplacement, writeAttitude, keepHull as keepHullDoc, runBlocker, queueRuns, queueRerun, sinkageMeaning, preflight } from "../case-model.js";
import { renderKey } from "../render-read.js";
import { hasPatchworkDrop, parsePatchworkDrop, parseAutomergeUrl } from "../dnd.js";
import { drawHull } from "./fields.js";
import { mountRunView, withTasks, fmtN, fmtW } from "./run-view.js";
import { lineChart, seriesColors } from "./charts.js";
import { variantKey, variantLetters, setupFromRun } from "../inputs.js";
import { version as TOOL_VERSION } from "../../package.json";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const repoOf = (handle) => handle?.repo ?? window.repo;

async function whoAmI(repo) {
  try {
    const contact = window.accountDocHandle?.doc()?.contactUrl;
    if (!contact) return null;
    return (await repo.find(contact)).doc()?.name ?? null;
  } catch {
    return null;
  }
}

export default (handle, element) => withTasks(element, (tasks) => CaseTool(handle, element, tasks));

function CaseTool(handle, element, tasks) {
  const { isQueue, queueCounts, servedBy, shownRun, served, watch, BEAT_MS, isRunEnded: isTerminal } = tasks;
  const repo = repoOf(handle);
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "openfoam";
  // Two tabs. "Model setup": the model (what the hull is) and the setup of
  // the next run (how it floats, the flow, the solver, where it runs, and
  // what that will cost). "Runs": the runs going now, and the finished runs
  // to read and compare. Each part is summed up in a line under its heading.
  root.innerHTML = `
    <div class="case flow" style="--flow-space:12px">
      <input class="title" aria-label="Title">
      <div class="tabs case-tabs" role="tablist">
        <button role="tab" data-tab="setup">Model setup</button>
        <button role="tab" data-tab="runs">Runs <span class="tab-sum runs-tab-sum"></span></button>
      </div>
      <div class="tab-panel flow" data-tab="setup">
      <section class="phase" data-phase="model">
        <div class="phase-head"><span class="name">Model</span><span class="sum model-sum"></span></div>
        <div class="phase-body cols">
          <div class="flow col-form" style="--flow-space:8px">
            <div class="drop hull-drop">
              <div class="hull-chip"></div>
              <div class="cluster" style="margin-top:6px"><input type="text" class="hull-url" placeholder="Drop a 3D file or hull here, or paste its link"><button class="hull-unlink" hidden>Unlink</button></div>
            </div>
            <label class="field"><span>Bow points</span><select class="hull-bow" title="Which way the model's bow points; the analysis turns it to +x"><option value="+x">+x</option><option value="-x">−x</option></select></label>
            <div class="hull-parts"></div>
            <div class="hull-warn hint"></div>
          </div>
          <div class="flow col-main" style="--flow-space:8px">
            <canvas class="hull-canvas"></canvas>
            <div class="model-figures"></div>
          </div>
        </div>
      </section>
      <section class="phase" data-phase="setup">
        <div class="phase-head"><span class="name">Run setup</span><span class="sum setup-sum"></span></div>
        <div class="phase-body cols">
          <div class="flow col-form">
            <fieldset>
              <legend>Floating</legend>
              <label class="field"><span>Sinkage</span><input type="number" step="0.01" data-k="sinkage" title="Metres the hull is lowered from as drawn (negative raises it)"></label>
              <label class="field"><span>Trim</span><input type="number" step="0.1" data-k="trim" title="Degrees, bow down positive"></label>
              <label class="field"><span>Heel</span><span class="pair"><input type="number" step="1" data-k="heel" title="Degrees, starboard down positive. A heeled hull runs the full domain (no symmetry plane), at about twice the cells"><button class="keep-displacement" title="Heeling about the centreline changes what's under water: sink the hull until it displaces what it does upright">Keep displacement</button></span></label>
              <label class="field"><span>Float at</span><span class="pair"><input type="number" step="1" class="float-mass" placeholder="mass"><select class="float-unit"><option value="kg">kg</option><option value="t">t</option></select><button class="float-go">Set</button></span></label>
              <div class="float-why hint"></div>
            </fieldset>
            <fieldset>
              <legend>Flow</legend>
              <label class="field"><span>Analysis</span><select data-k="mode">${Object.entries(MODE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
              <label class="field"><span>Speed</span><span class="pair"><input type="number" step="0.1" min="0" data-k="speed"><select data-k="speed-unit"><option value="kn">kn</option><option value="m/s">m/s</option></select></span></label>
              <label class="field"><span>Water</span><span class="pair"><select data-k="water"><option value="salt">Seawater</option><option value="fresh">Fresh</option></select><input type="number" step="1" min="0" max="30" data-k="temperature" title="°C"></span></label>
            </fieldset>
            <fieldset>
              <legend>Solver</legend>
              <label class="field"><span>Mesh</span><select data-k="mesh">${MESH_PRESETS.map((m) => `<option value="${m}">${m}</option>`).join("")}</select></label>
              <label class="field"><span>Iterations</span><input type="number" step="100" min="50" data-k="iterations"></label>
              <label class="field"><span>Start from</span><select data-k="warmStart" class="warm-select" title="A finished run's solution, mapped onto the new mesh, on the machine that ran it. Helps a free-surface run most: its waves are already there"><option value="">rest</option></select></label>
              <label class="field"><span>Stop</span><select data-k="stop" title="Settled: when the resistance holds within 1% over two windows of iterations; the iterations are then a ceiling"><option value="settled">when settled (±1%)</option><option value="iterations">after the iterations</option></select></label>
              <label class="field"><span>Domain</span><select data-k="domain"><option value="auto">Half if symmetric</option><option value="half">Half (y ≤ 0)</option><option value="full">Full</option></select></label>
              <label class="field"><span>Cores</span><input type="number" step="1" min="0" data-k="cores" title="0: the machine running it decides"></label>
              <label class="field"><span>Keep volume</span><input type="checkbox" data-k="keepVolume" title="Every cell's flow (the mesh and the last fields), kept in docs after the run so it can be explored: about 200 bytes a cell, so hundreds of MB for a medium mesh"></label>
            </fieldset>
            <div class="setup-problems warn" hidden></div>
            <fieldset>
              <legend>Server</legend>
              <div class="server-box"></div>
              <div class="cluster" style="margin-top:6px"><input type="text" class="server-url" placeholder="Paste the queue link the OpenFOAM host printed"><button class="server-forget" hidden>Change</button></div>
            </fieldset>
          </div>
          <div class="flow col-main" style="--flow-space:10px">
            <h3>What to expect</h3>
            <div class="estimate-figures"></div>
            <div class="launch flow" style="--flow-space:8px">
              <button class="run" data-primary>Run</button>
              <label class="field"><span>Sweep</span><span class="pair"><input type="text" class="sweep" placeholder="speeds, e.g. 4, 5, 6, 7"><button class="run-sweep">Run</button></span></label>
              <div class="run-why hint"></div>
            </div>
          </div>
        </div>
      </section>
      </div>
      <div class="tab-panel flow" data-tab="runs" hidden>
      <section class="phase" data-phase="running">
        <div class="phase-head"><span class="name">Running</span><span class="sum running-sum"></span></div>
        <div class="phase-body flow">
          <div class="running-list"></div>
          <div class="live-host"></div>
        </div>
      </section>
      <section class="phase" data-phase="results">
        <div class="phase-head"><span class="name">Results</span><span class="sum results-sum"></span></div>
        <div class="phase-body flow">
          <div class="runs-table"></div>
          <div class="curve" hidden><h3>Resistance against speed</h3><div class="curve-chart"></div></div>
          <div class="result-host"></div>
        </div>
      </section>
      </div>
    </div>`;
  element.append(style, root);
  const $ = (s) => root.querySelector(s);
  // which tab: a viewer's own (not in the doc). A case with runs opens on them.
  let tab = null;
  const showTab = (t) => {
    tab = t;
    root.querySelectorAll(".case-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    root.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.dataset.tab !== t));
    if (t === "setup") renderPreflight();
  };
  root.querySelectorAll(".case-tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  // a double-body run's predicted running attitude, as the setup of a free-surface run
  const useAttitude = (attitude) =>
      handle.change((d) => writeSetup(d, patchSetup(d.setup, { mode: "free-surface", attitude: { sinkage: +attitude.sinkage.toFixed(4), trim: +attitude.trim.toFixed(3) } }).setup));
  // the run going now (stages, convergence, stop), and the finished run being read
  const variantOf = (run) => (run ? (variants.get(variantKey(run)) ?? null) : null);
  const liveView = mountRunView($(".live-host"), { repo, tasks, showTitle: true, variant: variantOf });
  const resultView = mountRunView($(".result-host"), {
    repo,
    tasks,
    showTitle: true,
    variant: variantOf,
    onUseAttitude: (a) => {
      useAttitude(a);
      showTab("setup");
    },
    onReuse: (run) => {
      reuseRun(run);
      showTab("setup");
    },
    onRerun: (run) => rerun(run),
    others: () =>
      runLists()
        .finished.filter(({ r }) => r.status === "done")
        .map(({ u, r }) => ({ url: u, title: r.title, letter: variantOf(r) })),
    runDoc: (u) => runHandles.get(u)?.doc() ?? null,
  });
  const curveChart = lineChart($(".curve-chart"), { height: 180, xLabel: "speed (kn)", markers: true, format: (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)) });

  // ------------------------------------------------------------ state
  let hull = { url: null, result: null, key: null, loading: false, sub: null };
  let prepared = null; // { mesh, stl, info, warnings, attitudeKey }
  let server = { url: null, handle: null, sub: null, pools: [], since: 0 };
  const runHandles = new Map(); // url → handle (subscribed)
  const runTasks = new Map(); // url → its task as followed ({ state, error }), while the run hasn't ended
  let variants = new Map(); // variantKey → "A", "B", … over the case's runs, oldest first
  const runSubs = [];
  let disposed = false;

  const doc = () => handle.doc();
  const setup = () => normalizeSetup(doc()?.setup);

  // ------------------------------------------------------------ form binding
  const title = $(".title");
  title.addEventListener("change", () => handle.change((d) => (d.title = title.value)));
  const fieldValue = (k, s) => {
    if (k === "sinkage" || k === "trim" || k === "heel") return s.attitude[k];
    if (k === "speed") return +s.speed.value.toFixed(3);
    if (k === "speed-unit") return s.speed.unit;
    if (k === "warmStart") return s.warmStart ?? "";
    return s[k];
  };
  root.querySelectorAll("[data-k]").forEach((input) => {
    input.addEventListener("change", () => {
      const k = input.dataset.k;
      const raw = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
      if (input.type === "number" && !Number.isFinite(raw)) return;
      handle.change((d) => {
        const s = normalizeSetup(d.setup);
        // the speed is typed in its unit; a new unit converts it, so the boat's speed stays what it was
        const patch =
          k === "sinkage" || k === "trim" || k === "heel"
            ? { attitude: { [k]: raw } }
            : k === "speed"
              ? { speed: { value: raw, unit: s.speed.unit } }
              : k === "speed-unit"
                ? { speed: speedIn(s.speed, raw) }
                : k === "warmStart"
                  ? { warmStart: raw || null }
                  : { [k]: raw };
        writeSetup(d, patchSetup(s, patch).setup);
      });
    });
  });
  function syncForm() {
    const d = doc();
    const s = setup();
    // what the doc's setup holds that doesn't read as written (a hand edit, a bare-number speed)
    const problems = setupProblems(d?.setup);
    const pbox = $(".setup-problems");
    pbox.hidden = !problems.length;
    pbox.textContent = problems.length ? `The setup as stored: ${problems.join("; ")}. Changing a field here writes it as shown.` : "";
    if (document.activeElement !== title) title.value = d.title ?? "";
    root.querySelectorAll("[data-k]").forEach((input) => {
      if (document.activeElement === input) return;
      const v = fieldValue(input.dataset.k, s);
      if (input.type === "checkbox") input.checked = !!v;
      else if (String(input.value) !== String(v)) input.value = v;
    });
  }

  // ------------------------------------------------------------ hull
  const hullUrl = $(".hull-url");
  const linkHull = (url) => {
    const u = parseAutomergeUrl(url);
    if (!u) return;
    if (u === handle.url) return;
    acq.keep = true; // a hull someone chose: keep it with the case once it's read
    handle.change((d) => (d.hull = { url: u }));
  };
  hullUrl.addEventListener("change", () => {
    linkHull(hullUrl.value);
    hullUrl.value = "";
  });
  $(".hull-unlink").addEventListener("click", () => handle.change((d) => (d.hull = null)));
  const drop = $(".hull-drop");
  drop.addEventListener("dragover", (e) => {
    if (!hasPatchworkDrop(e.dataTransfer)) return;
    e.preventDefault();
    drop.setAttribute("data-over", "");
  });
  drop.addEventListener("dragleave", () => drop.removeAttribute("data-over"));
  drop.addEventListener("drop", (e) => {
    drop.removeAttribute("data-over");
    const items = parsePatchworkDrop(e.dataTransfer);
    if (!items.length) return;
    e.preventDefault();
    linkHull(items[0].url);
  });

  let reacquire = null;
  // One acquisition at a time. Reading a model can cost seconds (a 92 MB
  // Rhino file is converted whole), and a big hull doc takes a while to
  // arrive, while the case doc keeps changing: each of those used to start
  // another full read (five for one link, measured). A request that comes
  // in while one runs makes exactly one more afterwards.
  // keep: write a stash after the next read of the original; fromSource: skip the stash once
  const acq = { running: false, again: false, keep: false, fromSource: false };
  async function acquire() {
    if (acq.running) {
      acq.again = true;
      return;
    }
    acq.running = true;
    try {
      do {
        acq.again = false;
        const url = doc()?.hull?.url ?? null;
        if (!url) {
          hull = { ...hull, url: null, result: null };
          prepared = null;
          renderHull();
          break;
        }
        hull.loading = true;
        renderHull();
        // the hull kept with the case, when it has one and it holds the parts wanted; else the original
        const r = await readHull(repo, doc()?.hull, { tasks, fromSource: acq.fromSource });
        const fromStashDoc = r.path === "stash";
        if (disposed) return;
        if (doc()?.hull?.url !== url) {
          acq.again = true;
          continue;
        }
        // written only after something someone did (a link, parts the stash lacks, Re-read, Keep), never just on open
        const keep = !fromStashDoc && r.ok && acq.keep;
        acq.keep = false;
        acq.fromSource = false;
        hull = { ...hull, url, result: r, loading: false };
        prepared = null;
        prepare();
        if (keep) await keepHull(r, url);
      } while (acq.again && !disposed);
    } finally {
      acq.running = false;
    }
  }
  /** Keep the chosen parts of a model just read from its original with the case. */
  let keepNote = null;
  async function keepHull(r, url) {
    const stashUrl = await keepHullDoc(repo, r, model(), url);
    if (!stashUrl) {
      keepNote = "the hull is too big to keep with the case: it's read from the model each time";
      renderHull();
      return;
    }
    if (disposed) return;
    handle.change((d) => {
      if (d.hull?.url === url) d.hull.stash = stashUrl;
    });
    keepNote = null;
  }

  async function watchHull() {
    const url = doc()?.hull?.url ?? null;
    // watching starts before the doc is found: a find can take a minute
    if (url === hull.url && hull.watching) return;
    hull.sub?.();
    hull.sub = null;
    hull.url = url;
    hull.watching = !!url;
    acquire();
    if (!url) return;
    // a case with its hull kept doesn't load the original (it can be huge) just to watch it
    if (doc()?.hull?.stash) return;
    try {
      const h = await repo.find(url);
      if (disposed || doc()?.hull?.url !== url) return;
      let key = renderKey(h.doc());
      const headsOf = () => {
        try {
          return String(h.heads?.() ?? "");
        } catch {
          return "";
        }
      };
      let heads = headsOf();
      const on = () => {
        const isRender = h.doc()?.["@patchwork"]?.type === "scene-render";
        // a render rebuilds only when its GLB does; anything else, when its heads move
        if (isRender) {
          const k = renderKey(h.doc());
          if (k === key) return;
          key = k;
        } else {
          const now = headsOf();
          if (now && now === heads) return;
          heads = now;
        }
        clearTimeout(reacquire);
        reacquire = setTimeout(acquire, 400);
      };
      h.on("change", on);
      hull.sub = () => h.off("change", on);
    } catch {
      /* acquire() says why */
    }
  }

  /**
   * The model as read, and what of it is the hull: its parts (a GLB's named
   * meshes: a Rhino file's layers), the ones chosen (the case's, else those
   * reaching the waterline), the water plane if it draws one (its z is the
   * waterline), and which way its bow points.
   */
  const model = () => hullModel(hull.result, doc()?.hull);

  let prepTimer = null;
  function prepare() {
    clearTimeout(prepTimer);
    prepTimer = setTimeout(() => {
      const r = hull.result;
      if (!r?.ok) {
        prepared = null;
        renderHull();
        return;
      }
      const s = setup();
      const m = model();
      if (r.path === "stash" && !stashCovers(r.kept, m.names)) {
        acq.fromSource = true;
        acq.keep = true;
        acquire();
        return;
      }
      const key = JSON.stringify([s.attitude, m.names, m.frame]);
      if (prepared?.attitudeKey === key && prepared.result === r) return renderHull();
      try {
        prepared = { ...prepareModel(r, m, s.attitude), attitudeKey: key, result: r };
      } catch (err) {
        prepared = { error: String(err?.message ?? err), attitudeKey: key, result: r };
      }
      renderHull();
    }, 120);
  }

  $(".keep-displacement").addEventListener("click", () => {
    if (!hull.result?.ok) return;
    // what it displaces upright at this sinkage and trim, then the sinkage that displaces that heeled
    const sink = keepDisplacement(hull.result, model(), setup().attitude);
    $(".float-why").textContent = sink == null ? "the hull can't displace its upright volume at this heel" : "";
    if (sink != null) handle.change((d) => writeAttitude(d, { sinkage: sink }));
  });

  // floats at the trim and heel above: set those first (or after: then float again)
  $(".float-go").addEventListener("click", () => {
    const m = Number($(".float-mass").value) * ($(".float-unit").value === "t" ? 1000 : 1);
    if (!(m > 0) || !hull.result?.ok) return;
    const s = setup();
    const f = floatAt(hull.result, model(), { mass: m, water: s.water, temperature: s.temperature, trim: s.attitude.trim, heel: s.attitude.heel });
    $(".float-why").textContent =
      f == null
        ? `the whole hull displaces less than ${(m / 1000).toFixed(2)} t`
        : `${m.toLocaleString("en")} kg floats at sinkage ${f.sinkage.toFixed(4)} m with trim ${s.attitude.trim}° and heel ${s.attitude.heel}°: change either and float again`;
    if (f) handle.change((d) => writeAttitude(d, { sinkage: f.sinkage }));
  });

  function renderHull() {
    const d = doc();
    const chip = $(".hull-chip");
    $(".hull-unlink").hidden = !d?.hull?.url;
    const r = hull.result;
    if (!d?.hull?.url) chip.innerHTML = `<span class="hint">No hull yet. Drop in a 3D file (GLB, STL, Rhino 3DM, … whatever a loaded package reads) or any hull document, from the sidebar or a scene, or paste its link.</span>`;
    else if (hull.loading && !r) chip.innerHTML = `<span class="chip">loading the hull…</span>`;
    else if (!r?.ok) chip.innerHTML = `<span class="chip">${esc(d.hull.url.slice(0, 22))}…</span><div class="warn">${esc(r?.error ?? "")}</div>`;
    else if (r.path === "stash")
      chip.innerHTML = `<span class="chip" title="${esc(d.hull.url)}"><span class="dot" data-state="done"></span>${esc(r.title)} · kept with the case</span>
        <div class="hint">read ${r.stash?.builtAt ? new Date(r.stash.builtAt).toLocaleString() : ""}${r.providerName ? ` by ${esc(r.providerName)}` : ""}; the original isn't loaded <button class="hull-reread">Re-read the model</button></div>`;
    else
      chip.innerHTML = `<span class="chip" title="${esc(d.hull.url)}"><span class="dot" data-state="done"></span>${esc(r.title)} · ${esc(pathLabel(r))}</span>${
        d.hull.stash ? "" : `<div class="hint">${keepNote ? esc(keepNote) : `<button class="hull-keep">Keep the hull with this case</button> opens faster, and shares without the original`}</div>`
      }`;
    chip.querySelector(".hull-reread")?.addEventListener("click", () => {
      acq.fromSource = true;
      acq.keep = true;
      acquire();
    });
    chip.querySelector(".hull-keep")?.addEventListener("click", () => hull.result?.ok && keepHull(hull.result, d.hull.url));
    renderParts();
    $(".hull-warn").innerHTML = prepared?.warnings?.length ? prepared.warnings.map((w) => `<div>${esc(w)}</div>`).join("") : prepared?.error ? `<div class="warn">${esc(prepared.error)}</div>` : "";
    renderPreflight();
    renderRunButton();
  }

  const bowSel = $(".hull-bow");
  bowSel.addEventListener("change", () => handle.change((d) => d.hull && (d.hull.bow = bowSel.value)));
  function renderParts() {
    const box = $(".hull-parts");
    const r = hull.result;
    if (document.activeElement !== bowSel) bowSel.value = doc()?.hull?.bow === "-x" ? "-x" : "+x";
    bowSel.closest("label").hidden = !r?.ok;
    if (!r?.ok) return void (box.innerHTML = "");
    const m = model();
    if (m.parts.length < 2) return void (box.innerHTML = "");
    const chosen = new Set(m.names);
    // whether each part is a closed shell costs a weld a part: only once the list is opened
    const open = box.dataset.open === "1" || (box.dataset.open !== "0" && Array.isArray(doc()?.hull?.parts));
    const shells = open ? partShells(r, m) : {};
    const key = JSON.stringify([m.parts.map((p) => p.name), [...chosen], m.water?.name, open, r.path]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const tag = (p) => (p === m.water ? `water plane: the waterline (z = ${m.frame.waterZ.toFixed(3)} m)` : p.min[2] <= m.frame.waterZ ? "meets the water" : "above the water");
    const size = (p) => `${p.min.map((v, k) => (p.max[k] - v).toFixed(2)).join(" × ")} m`;
    const shell = (p) => {
      const v = shells[p.name];
      if (!v || p === m.water) return "";
      return v.checked ? ` · ${v.closed ? "closed" : `${v.openEdges.toLocaleString("en")} open edges`}` : "";
    };
    box.innerHTML = `<details ${open ? "open" : ""}><summary class="hint">Hull: ${chosen.size} of ${m.parts.length} parts${m.water ? `; waterline from “${esc(m.water.name)}”` : ""}</summary>
      ${m.parts
        .map(
          (p) => `<label class="part" style="display:flex;gap:6px;align-items:baseline"><input type="checkbox" data-part="${esc(p.name)}" ${chosen.has(p.name) ? "checked" : ""} ${p === m.water ? "disabled" : ""}>
          <span>${esc(p.name)}</span><span class="hint" title="x from ${p.min[0].toFixed(3)} to ${p.max[0].toFixed(3)}, y ${p.min[1].toFixed(3)} to ${p.max[1].toFixed(3)}, z ${p.min[2].toFixed(3)} to ${p.max[2].toFixed(3)} m, in the model's frame">${p.triangles.toLocaleString("en")} triangles · ${size(p)} · ${tag(p)}${shell(p)}</span></label>`,
        )
        .join("")}
      ${Array.isArray(doc()?.hull?.parts) ? `<button class="parts-reset">Back to what meets the water</button>` : ""}</details>`;
    box.querySelectorAll("input[data-part]").forEach((cb) =>
      cb.addEventListener("change", () => {
        const names = [...box.querySelectorAll("input[data-part]:checked")].map((x) => x.dataset.part);
        handle.change((d) => d.hull && (d.hull.parts = names));
      }),
    );
    box.querySelector("details").addEventListener("toggle", (e) => {
      const now = e.target.open ? "1" : "0";
      if (box.dataset.open === now) return;
      box.dataset.open = now;
      renderParts();
    });
    box.querySelector(".parts-reset")?.addEventListener("click", () => handle.change((d) => d.hull && delete d.hull.parts));
  }

  // ------------------------------------------------------------ the model's figures, and what a run will cost
  const row = (k, v, how = "") => `<tr><td>${k}</td><td>${v}</td><td class="method">${how}</td></tr>`;
  function renderPreflight() {
    const box = $(".model-figures");
    const est = $(".estimate-figures");
    const canvas = $(".hull-canvas");
    if (!prepared?.info) {
      canvas.hidden = true;
      box.innerHTML = `<div class="hint">Link a hull to see its waterline, displacement and wetted area.</div>`;
      est.innerHTML = `<div class="hint">With a hull linked: its Froude and Reynolds numbers at this speed, the friction floor, and how many cells and how long a run takes.</div>`;
      $(".model-sum").textContent = doc()?.hull?.url ? (hull.loading ? "loading…" : "") : "no hull yet";
      renderSetupSum(null);
      return;
    }
    canvas.hidden = false;
    const s = setup();
    const i = prepared.info;
    // drawing a big hull is tens of thousands of path segments: only when it, the width or the theme changes
    const drawKey = `${(canvas.parentElement?.clientWidth ?? 0)}|${document.documentElement.getAttribute("theme") ?? ""}`;
    if (canvas.parentElement?.clientWidth && (canvas.__drawn !== prepared || canvas.__drawKey !== drawKey)) {
      drawHull(canvas, prepared.mesh, i);
      canvas.__drawn = prepared;
      canvas.__drawKey = drawKey;
    }
    const pf = preflight(s, i);
    const { rho, nu, L, cells, cores, upTo, dom } = pf;
    const a = s.attitude;
    const floated = [a.sinkage && `sunk ${a.sinkage.toFixed(3)} m`, a.trim && `trimmed ${Math.abs(a.trim)}° ${a.trim > 0 ? "bow down" : "bow up"}`, a.heel && `heeled ${Math.abs(a.heel)}° to ${a.heel > 0 ? "starboard" : "port"}`].filter(Boolean);
    box.innerHTML = `
      <table class="figures">
        ${row("Length, waterline", `${L.toFixed(2)} m`, `overall ${i.loa.toFixed(2)} m`)}
        ${row("Beam, waterline", `${i.bwl.toFixed(2)} m`, `overall ${i.beam.toFixed(2)} m`)}
        ${row("Draft", `${i.draft.toFixed(2)} m`)}
        ${row("Displacement", `${((i.volume * rho) / 1000).toFixed(2)} t`, `${i.volume.toFixed(3)} m³ of ${s.water === "fresh" ? "fresh water" : "seawater"} at ${s.temperature} °C`)}
        ${row("Wetted area", `${i.wettedArea.toFixed(2)} m²`, "at rest")}
      </table>
      <div class="hint">${floated.length ? `Floating as the run setup has it: ${floated.join(", ")}.` : "Floating as drawn: the run setup can sink, trim and heel it."}</div>
      <div class="hint">${esc(sinkageMeaning(i.attitude.pivotX).replace(/^s/, "S"))}.</div>`;
    $(".model-sum").textContent = `${hull.result?.title ?? ""} · ${L.toFixed(2)} m on the waterline · ${((i.volume * rho) / 1000).toFixed(2)} t`;

    const fr = pf.friction;
    const secs = pf.seconds;
    est.innerHTML = `
      <table class="figures">
        ${row("Froude number", pf.Fn.toFixed(3), `${formatSpeed(s.speed)} on the waterline length`)}
        ${row("Reynolds number", pf.Re.toExponential(2), `ν = ${nu.toExponential(3)} m²/s (${pf.water})`)}
        ${row("Friction alone", fmtN(fr.R), `ITTC-57 C<sub>F</sub> = ${(fr.Cf * 1000).toFixed(3)}×10⁻³ on the wetted area: the floor the CFD's total should sit above`)}
        ${s.mode === "free-surface" ? row("Wavelength at this speed", `${pf.lambda.toFixed(2)} m`, `${dom.freeSurface ? `${dom.freeSurface.cellsPerWave.toFixed(0)} cells a wave near the hull` : ""}`) : ""}
        ${row(
          "Domain",
          pf.half ? "half (y ≤ 0)" : "full",
          pf.half
            ? "the hull is symmetric, so a symmetry plane halves the cost"
            : Math.abs(a.heel) > 1e-9
              ? `heeled ${Math.abs(a.heel)}° to ${a.heel > 0 ? "starboard" : "port"}: no symmetry plane${s.domain === "half" ? " (a half model can't be heeled)" : ""}`
              : i.symmetric
                ? "full domain asked for"
                : "the hull isn't symmetric",
        )}
        ${row("Cells", `≈ ${Math.round(cells / 1000)}k`, `${s.mesh} preset; checkMesh gives the real count (to within a factor of two or so)`)}
        ${row("Time", `${upTo ? "at most " : ""}≈ ${formatDuration(secs)}`, `on ${cores} cores, ${s.iterations} iterations${upTo ? "; it stops sooner once the resistance settles" : ""}`)}
        ${s.keepVolume ? row("Flow volume", `≈ ${Math.max(1, Math.round(pf.volumeBytes / 1048576))} MB`, "kept after the run, about 200 bytes a cell; fetching it ran at about 1 MB/s (2026-11)") : ""}
      </table>`;
    renderSetupSum(`${upTo ? "up to " : ""}≈ ${formatDuration(secs)}`);
  }
  function renderSetupSum(time) {
    const s = setup();
    const heel = s.attitude.heel ? `, ${Math.abs(s.attitude.heel)}° heel` : "";
    $(".setup-sum").textContent = `${MODE_LABELS[s.mode]} · ${formatSpeed(s.speed)}${heel} · ${s.mesh} mesh${time ? ` · ${time}` : ""}`;
  }

  // ------------------------------------------------------------ server
  const serverUrlInput = $(".server-url");
  serverUrlInput.addEventListener("change", () => {
    const u = parseAutomergeUrl(serverUrlInput.value);
    serverUrlInput.value = "";
    if (u) handle.change((d) => (d.server = u));
  });
  $(".server-forget").addEventListener("click", () => handle.change((d) => (d.server = null)));
  async function watchServer() {
    const url = doc()?.server ?? null;
    if (url === server.url) return;
    server.sub?.();
    server = { url, handle: null, sub: null, error: null, pools: [], since: Date.now() };
    renderServer();
    if (!url) return;
    const mine = server;
    try {
      const h = await repo.find(url);
      if (disposed || doc()?.server !== url) return;
      mine.handle = h;
      if (!isQueue(h.doc())) mine.error = "that link isn't a task queue";
      const on = () => renderServer();
      h.on("change", on);
      // who serves it: heard, not read (each machine says so every couple of seconds)
      const stopHearing = served(repo, url, (pools) => {
        mine.pools = pools;
        renderServer();
      });
      const listened = setTimeout(renderServer, BEAT_MS + 500);
      mine.sub = () => {
        h.off("change", on);
        stopHearing();
        clearTimeout(listened);
      };
    } catch (err) {
      mine.error = `couldn't load the queue (${err?.message ?? err})`;
    }
    renderServer();
  }
  /** Whether it's too soon to say nobody serves the queue: a machine says so every couple of seconds. */
  const listening = () => !server.pools.length && Date.now() - server.since < BEAT_MS + 500;
  function renderServer() {
    const box = $(".server-box");
    $(".server-forget").hidden = !server.url;
    $(".server-url").hidden = !!server.url;
    if (!server.url) {
      box.innerHTML = `<div class="hint">Start the OpenFOAM host where OpenFOAM is installed (<code>daemon/start.sh</code> in the openfoam package) and paste the queue link it prints.</div>`;
    } else if (server.error) box.innerHTML = `<div class="warn">${esc(server.error)}</div>`;
    else if (!server.handle) box.innerHTML = `<span class="chip">loading…</span>`;
    else {
      const s = server.handle.doc();
      const by = servedBy(server.pools);
      const q = queueCounts(s, server.pools);
      box.innerHTML = `
        <span class="chip"><span class="dot" data-state="${by ? "online" : "idle"}"></span>${esc(s.title ?? "OpenFOAM")}</span>
        <div class="hint">${by ? `served by ${esc(by)}` : listening() ? "listening for the machines that serve it…" : "nobody is serving it: runs wait in its queue until a machine does"}</div>
        <div class="hint">${q.running ? `running ${q.running}${q.slots > 1 ? ` of ${q.slots} at once` : ""}` : "idle"}${q.waiting ? `, ${q.waiting} waiting` : ""}</div>`;
    }
    renderRunButton();
  }

  // ------------------------------------------------------------ run
  const whyNot = () =>
    runBlocker({ tasks, hullUrl: doc()?.hull?.url, result: hull.result, loading: hull.loading, prepared, serverUrl: server.url, serverDoc: server.handle?.doc() ?? null, serverError: server.error });
  function renderRunButton() {
    const why = whyNot();
    $(".run").disabled = !!why;
    $(".run-sweep").disabled = !!why;
    const s = setup();
    $(".run").textContent = `Run at ${formatSpeed(s.speed)}`;
    $(".sweep").placeholder = `speeds in ${s.speed.unit}, e.g. 4, 5, 6, 7`;
    $(".run-why").textContent = why ?? (server.handle && !server.pools.length && !listening() ? "Nobody is serving the queue: the run will wait for a machine." : "");
  }
  async function runAt(speeds) {
    if (whyNot()) return;
    const by = await whoAmI(repo);
    showTab("runs");
    await queueRuns(repo, {
      tasks,
      caseHandle: handle,
      serverHandle: server.handle,
      result: hull.result,
      prepared,
      setups: speeds.map((speed) => ({ ...setup(), speed })),
      by,
      made: { tool: "openfoam", version: TOOL_VERSION },
    });
  }
  $(".run").addEventListener("click", () => runAt([setup().speed]));

  /** Put a run's setup, and the hull it was read from, back into the case. */
  function reuseRun(run) {
    const { setup: s, hull: h } = setupFromRun(run);
    handle.change((d) => {
      d.setup = s;
      if (!h) return;
      const same = d.hull?.url === h.url;
      const next = { url: h.url, bow: h.bow };
      if (h.parts) next.parts = h.parts;
      // the case's kept hull serves it if it's of the same doc (it's re-read when it lacks a part)
      const stash = same ? (d.hull.stash ?? h.stash) : h.stash;
      if (stash) next.stash = stash;
      d.hull = next;
    });
  }
  /** A new run with a finished one's setup and its frozen hull, exactly. */
  async function rerun(run) {
    if (!server.handle || server.error) return;
    const by = await whoAmI(repo);
    await queueRerun(repo, { tasks, caseHandle: handle, serverHandle: server.handle, run, by, made: { tool: "openfoam", version: TOOL_VERSION } });
  }
  $(".run-sweep").addEventListener("click", () => {
    // the sweep's speeds are in the speed's unit, as the field beside it says
    const unit = setup().speed.unit;
    const speeds = $(".sweep").value.split(/[\s,;]+/).map(Number).filter((v) => v > 0).map((value) => normalizeSetup({ speed: { value, unit } }).speed);
    if (speeds.length) runAt(speeds);
  });

  // ------------------------------------------------------------ runs
  async function watchRuns() {
    for (const url of doc()?.runs ?? []) {
      if (runHandles.has(url)) continue;
      runHandles.set(url, null);
      repo
        .find(url)
        .then((h) => {
          if (disposed) return;
          runHandles.set(url, h);
          let last = "";
          const on = () => {
            const r = h.doc();
            const t = runTasks.get(url);
            const k = `${r.status}|${r.summary ? 1 : 0}|${r.progress?.iteration}|${t?.state}|${t?.runs?.length}`;
            if (k !== last) {
              last = k;
              renderRuns();
            }
          };
          h.on("change", on);
          runSubs.push(() => h.off("change", on));
          // what the run doc can't say about a run that hasn't ended is read from its task (shownRun)
          const r0 = h.doc();
          if (r0?.server && !isTerminal(r0.status)) {
            const stop = watch(
              repo,
              r0.server,
              url,
              (view) => {
                runTasks.set(url, { state: view.state, error: view.error, runs: view.runs });
                on();
              },
              r0.task ? { from: r0.task } : {},
            );
            runSubs.push(stop);
          }
          renderRuns();
          showSelected();
        })
        .catch(() => {});
    }
  }
  /** A run as a person sees it: its doc, with the status its task gives it (shownRun). */
  const shownDoc = (u) => {
    const raw = runHandles.get(u)?.doc() ?? null;
    if (!raw) return null;
    const s = shownRun(raw, runTasks.get(u) ?? null);
    return s.status === raw.status && s.error === (raw.error ?? null) && !s.note ? raw : { ...raw, status: s.status, error: s.error, note: s.note };
  };
  /** The case's runs, newest first, split into those going (or waiting) and those finished. */
  function runLists() {
    const all = (doc()?.runs ?? []).map((u) => ({ u, r: shownDoc(u) })).reverse();
    return { going: all.filter(({ r }) => !r || !isTerminal(r.status)), finished: all.filter(({ r }) => r && isTerminal(r.status)) };
  }
  const dotOf = (st) => (st === "done" ? "done" : st === "failed" ? "failed" : isTerminal(st) || st === "queued" ? "idle" : "running");
  const selectOn = (box) =>
    box.querySelectorAll("tr[data-url]").forEach((tr) => tr.addEventListener("click", () => handle.change((x) => (x.selected = tr.dataset.url))));
  function renderRuns() {
    const d = doc();
    const { going, finished } = runLists();
    variants = variantLetters((d?.runs ?? []).map((u) => runHandles.get(u)?.doc()));
    const many = variants.size > 1;
    const live = liveRun(going);
    const result = resultRun(finished);

    // going: one line each, with how far along it is
    $(".running-list").innerHTML = !going.length
      ? `<div class="hint">Nothing running. A run goes to the server's queue from the run setup, and shows here until it finishes.</div>`
      : going.length === 1
        ? ""
        : `<table class="figures"><tr><th>Run</th><th>Status</th><th>Progress</th></tr>${going
            .map(({ u, r }) => {
              if (!r) return `<tr data-click data-url="${u}"><td colspan="3" class="hint">loading…</td></tr>`;
              const p = r.progress ?? {};
              return `<tr data-click data-url="${u}" ${u === live ? "data-selected" : ""}>
                <td><span class="dot" data-state="${dotOf(r.status)}" style="display:inline-block;margin-right:6px"></span>${esc(r.title)}</td>
                <td>${esc(r.status)}${r.note ? ` · ${esc(r.note)}` : ""}</td>
                <td>${r.status === "solving" && p.of ? `<progress max="${p.of}" value="${p.iteration ?? 0}" style="width:8em"></progress>` : ""}</td></tr>`;
            })
            .join("")}</table>`;
    selectOn($(".running-list"));
    const solving = going.filter(({ r }) => r && r.status !== "queued").length;
    const waiting = going.filter(({ r }) => r?.status === "queued").length;
    $(".running-sum").textContent = going.length ? [solving && `${solving} running`, waiting && `${waiting} waiting`].filter(Boolean).join(", ") : "nothing running";
    root.querySelector('[data-phase="running"]').hidden = !going.length;

    // finished: the table, the speed curve, and the one being read
    $(".runs-table").innerHTML = !finished.length
      ? `<div class="hint">No finished runs yet.</div>`
      : `<table class="figures"><tr>${many ? `<th title="The hull's variation: runs with one letter ran the same geometry">Hull</th>` : ""}<th>Run</th><th>Status</th><th>R<sub>T</sub></th><th>Power</th><th></th></tr>${finished
          .map(({ u, r }) => {
            const s = r.summary;
            const extra = !s ? "" : s.mode === "free-surface" ? `Cr ${(s.Cr * 1000).toFixed(2)}e-3` : `1+k ${s.formFactor?.toFixed(3)}`;
            return `<tr data-click data-url="${u}" ${u === result ? "data-selected" : ""}>
              ${many ? `<td title="${esc(r.hull?.source?.title ?? "")}${r.hull?.geometry?.digest ? ` · ${r.hull.geometry.digest.slice(0, 10)}` : ""}"><b>${esc(variantOf(r) ?? "")}</b></td>` : ""}
              <td><span class="dot" data-state="${dotOf(r.status)}" style="display:inline-block;margin-right:6px"></span>${esc(r.title)}</td>
              <td>${esc(r.status)}</td>
              <td>${s ? fmtN(s.Rt) : ""}</td><td>${s ? fmtW(s.power) : ""}</td><td>${extra}</td></tr>`;
          })
          .join("")}</table>`;
    selectOn($(".runs-table"));
    const done = finished.filter(({ r }) => r.status === "done").length;
    $(".results-sum").textContent = finished.length
      ? `${done} done${finished.length > done ? `, ${finished.length - done} stopped or failed` : ""}${many ? `; ${variants.size} variations of the hull (A–${[...variants.values()].at(-1)})` : ""}`
      : "none yet";
    $(".runs-tab-sum").textContent = going.length ? `· ${solving ? `${solving} running` : `${waiting} waiting`}` : finished.length ? `· ${finished.length}` : "";
    renderCurve();
    renderWarmOptions();
    showSelected();
    liveView.refresh();
    resultView.refresh();
  }
  /** The run to watch going: the selected one if it's going, else the one furthest along. */
  function liveRun(going = runLists().going) {
    const sel = doc()?.selected;
    if (going.some(({ u }) => u === sel)) return sel;
    return (going.findLast(({ r }) => r && r.status !== "queued") ?? going.at(-1))?.u ?? null;
  }
  /** The finished run to read: the selected one if it's finished, else the newest. */
  function resultRun(finished = runLists().finished) {
    const sel = doc()?.selected;
    if (finished.some(({ u }) => u === sel)) return sel;
    return finished[0]?.u ?? null;
  }
  /** The finished runs of this case's mode, to start a new one from. */
  function renderWarmOptions() {
    const sel = $(".warm-select");
    const s = setup();
    const opts = (doc()?.runs ?? [])
      .map((u) => ({ u, r: runHandles.get(u)?.doc() }))
      .filter(({ r }) => r?.status === "done" && r.setup?.mode === s.mode)
      .reverse();
    const html = `<option value="">rest</option>${opts.map(({ u, r }) => `<option value="${u}">${esc(r.title)}</option>`).join("")}${
      s.warmStart && !opts.some((o) => o.u === s.warmStart) ? `<option value="${s.warmStart}">another run</option>` : ""
    }`;
    if (sel.dataset.html !== html) {
      sel.innerHTML = html;
      sel.dataset.html = html;
    }
    if (document.activeElement !== sel) sel.value = s.warmStart ?? "";
  }
  function renderCurve() {
    const done = (doc()?.runs ?? []).map((u) => runHandles.get(u)?.doc()).filter((r) => r?.status === "done" && r.summary);
    // one line per hull variation, analysis and heel: a heeled run's drag isn't a point on the upright curve
    const lines = {};
    const many = variants.size > 1;
    for (const r of done) {
      const heel = r.summary.heel ?? r.setup?.attitude?.heel ?? 0;
      const v = many ? variantOf(r) : null;
      (lines[`${v}|${r.summary.mode}|${heel}`] ??= { v, mode: r.summary.mode, heel, pts: [] }).pts.push([r.summary.V / KNOT, r.summary.Rt]);
    }
    const series = Object.values(lines)
      .filter((l) => new Set(l.pts.map((p) => p[0].toFixed(3))).size >= 2)
      .slice(0, 4)
      .map((l, i) => ({
        name: `${l.v ? `${l.v}: ` : ""}${l.mode === "free-surface" ? "Free surface" : "Double body"}${l.heel ? `, ${Math.abs(l.heel)}° heel` : ""}`,
        color: seriesColors(root)[i],
        points: l.pts.sort((a, b) => a[0] - b[0]),
      }));
    $(".curve").hidden = !series.length;
    if (series.length) curveChart.update(series);
  }
  function showSelected() {
    const live = liveRun();
    const result = resultRun();
    liveView.show(live ? (runHandles.get(live) ?? null) : null);
    resultView.show(result ? (runHandles.get(result) ?? null) : null);
  }

  // ------------------------------------------------------------ everything
  let lastAttitude = "";
  function render() {
    syncForm();
    watchHull();
    watchServer();
    watchRuns();
    const a = JSON.stringify([setup().attitude, doc()?.hull?.parts ?? null, doc()?.hull?.bow ?? "+x"]);
    if (a !== lastAttitude) {
      lastAttitude = a;
      prepare();
    }
    renderHull();
    renderRuns();
    showSelected();
    if (tab === null) showTab(doc()?.runs?.length ? "runs" : "setup");
  }
  render();
  handle.on("change", render);
  const clock = setInterval(() => renderServer(), 10_000);
  // the hull drawing is a canvas too
  const themeWatch = typeof MutationObserver === "function" ? new MutationObserver(() => renderPreflight()) : null;
  themeWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ["theme", "class", "style"] });


  return () => {
    disposed = true;
    handle.off("change", render);
    clearInterval(clock);
    themeWatch?.disconnect();
    clearTimeout(prepTimer);
    clearTimeout(reacquire);
    hull.sub?.();
    server.sub?.();
    runSubs.forEach((off) => off());
    liveView.dispose();
    resultView.dispose();
    curveChart.dispose();
    root.remove();
    style.remove();
  };
}

