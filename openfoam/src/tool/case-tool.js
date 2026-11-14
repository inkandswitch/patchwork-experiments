// The case tool: link a hull, describe the analysis, see what it will cost,
// send it to a daemon, watch it run, and read what it found.

import css from "./styles.css?inline";
import { normalizeSetup, MODE_LABELS, MESH_PRESETS, DEFAULT_ITERATIONS, KNOT, waterProperties, froude, reynolds, frictionEstimate, waveLength, estimateCells, estimateSeconds, formatDuration, formatSpeed, domainForHull } from "../setup.js";
import { newRun, enqueue, daemonOnline, queueView, isTerminal, SERVER_TYPE } from "../protocol.js";
import { acquireHull, pathLabel } from "../hull/acquire.js";
import { prepareHull, sinkageForVolume } from "../hull/prepare.js";
import { partsOf, waterPlanes, defaultParts, hullTriangles } from "../hull/parts.js";
import { makeStash, fromStash, stashCovers } from "../hull/stash.js";
import { findWhenThere } from "../find.js";
import { renderKey } from "../render-read.js";
import { hasPatchworkDrop, parsePatchworkDrop, parseAutomergeUrl } from "../dnd.js";
import { drawHull } from "./fields.js";
import { mountRunView, fmtN, fmtW } from "./run-view.js";
import { lineChart, seriesColors } from "./charts.js";

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

export default function CaseTool(handle, element) {
  const repo = repoOf(handle);
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "openfoam";
  root.innerHTML = `
    <div class="layout">
      <div class="flow setup">
        <input class="title" aria-label="Title">
        <div class="section">
          <h2>Hull</h2>
          <div class="drop hull-drop">
            <div class="hull-chip"></div>
            <div class="cluster" style="margin-top:6px"><input type="text" class="hull-url" placeholder="Drop a 3D file or hull here, or paste its link"><button class="hull-unlink" hidden>Unlink</button></div>
          </div>
          <label class="field"><span>Bow points</span><select class="hull-bow" title="Which way the model's bow points; the analysis turns it to +x"><option value="+x">+x</option><option value="-x">−x</option></select></label>
          <div class="hull-parts"></div>
          <div class="hull-warn hint"></div>
          <label class="field"><span>Sinkage</span><input type="number" step="0.01" data-k="sinkage" title="Metres the hull is lowered from as drawn (negative raises it)"></label>
          <label class="field"><span>Trim</span><input type="number" step="0.1" data-k="trim" title="Degrees, bow down positive"></label>
          <label class="field"><span>Heel</span><span class="pair"><input type="number" step="1" data-k="heel" title="Degrees, starboard down positive. A heeled hull runs the full domain (no symmetry plane), at about twice the cells"><button class="keep-displacement" title="Heeling about the centreline changes what's under water: sink the hull until it displaces what it does upright">Keep displacement</button></span></label>
          <label class="field"><span>Float at</span><span class="pair"><input type="number" step="1" class="float-mass" placeholder="mass"><select class="float-unit"><option value="kg">kg</option><option value="t">t</option></select><button class="float-go">Set</button></span></label>
        </div>
        <div class="section">
          <h2>Analysis</h2>
          <label class="field"><span>Model</span><select data-k="mode">${Object.entries(MODE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
          <label class="field"><span>Speed</span><span class="pair"><input type="number" step="0.1" min="0" data-k="speed"><select data-k="speedUnit"><option value="kn">kn</option><option value="m/s">m/s</option></select></span></label>
          <label class="field"><span>Water</span><span class="pair"><select data-k="water"><option value="salt">Seawater</option><option value="fresh">Fresh</option></select><input type="number" step="1" min="0" max="30" data-k="temperature" title="°C"></span></label>
          <label class="field"><span>Mesh</span><select data-k="mesh">${MESH_PRESETS.map((m) => `<option value="${m}">${m}</option>`).join("")}</select></label>
          <label class="field"><span>Iterations</span><input type="number" step="100" min="50" data-k="iterations"></label>
          <label class="field"><span>Start from</span><select data-k="warmStart" class="warm-select" title="A finished run's solution, mapped onto the new mesh, on the daemon that ran it. Helps a free-surface run most: its waves are already there"><option value="">rest</option></select></label>
          <label class="field"><span>Stop</span><select data-k="stop" title="Settled: when the resistance holds within 1% over two windows of iterations; the iterations are then a ceiling"><option value="settled">when settled (±1%)</option><option value="iterations">after the iterations</option></select></label>
          <label class="field"><span>Domain</span><select data-k="domain"><option value="auto">Half if symmetric</option><option value="half">Half (y ≤ 0)</option><option value="full">Full</option></select></label>
          <label class="field"><span>Cores</span><input type="number" step="1" min="0" data-k="cores" title="0: the daemon decides"></label>
        </div>
        <div class="section">
          <h2>Server</h2>
          <div class="server-box"></div>
          <div class="cluster" style="margin-top:6px"><input type="text" class="server-url" placeholder="Paste the daemon's inbox link"><button class="server-forget" hidden>Change</button></div>
        </div>
        <div class="section flow" style="--flow-space:8px">
          <button class="run" data-primary>Run</button>
          <label class="field"><span>Sweep</span><span class="pair"><input type="text" class="sweep" placeholder="e.g. 4, 5, 6, 7"><button class="run-sweep">Run</button></span></label>
          <div class="run-why hint"></div>
        </div>
      </div>
      <div class="flow main">
        <div class="preflight"><h2>Before you run</h2><canvas class="hull-canvas"></canvas><div class="preflight-figures"></div></div>
        <div class="section runs-box" hidden><h2>Runs</h2><div class="runs-table"></div><div class="curve" hidden><h2 style="margin-top:12px">Resistance against speed</h2><div class="curve-chart"></div></div></div>
        <div class="section run-host"></div>
      </div>
    </div>`;
  element.append(style, root);
  const $ = (s) => root.querySelector(s);
  const runView = mountRunView($(".run-host"), {
    repo,
    // a double-body run's predicted running attitude, as the setup of a free-surface run
    onUseAttitude: (attitude) =>
      handle.change((d) => {
        if (!d.setup) d.setup = setup();
        d.setup.attitude = { sinkage: +attitude.sinkage.toFixed(4), trim: +attitude.trim.toFixed(3) };
        if (d.setup.mode !== "free-surface") {
          const s = normalizeSetup(d.setup);
          d.setup.mode = "free-surface";
          d.setup.iterations = DEFAULT_ITERATIONS["free-surface"][s.mesh];
        }
      }),
  });
  const curveChart = lineChart($(".curve-chart"), { height: 180, xLabel: "speed (kn)", markers: true, format: (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)) });

  // ------------------------------------------------------------ state
  let hull = { url: null, result: null, key: null, loading: false, sub: null };
  let prepared = null; // { mesh, stl, info, warnings, attitudeKey }
  let server = { url: null, handle: null, sub: null };
  const runHandles = new Map(); // url → handle (subscribed)
  const runSubs = [];
  let disposed = false;

  const doc = () => handle.doc();
  const setup = () => normalizeSetup(doc()?.setup);

  // ------------------------------------------------------------ form binding
  const title = $(".title");
  title.addEventListener("change", () => handle.change((d) => (d.title = title.value)));
  const fieldValue = (k, s) => {
    if (k === "sinkage" || k === "trim" || k === "heel") return s.attitude[k];
    if (k === "speed") return s.speedUnit === "kn" ? +(s.speed / KNOT).toFixed(3) : +s.speed.toFixed(3);
    if (k === "warmStart") return s.warmStart ?? "";
    return s[k];
  };
  root.querySelectorAll("[data-k]").forEach((input) => {
    input.addEventListener("change", () => {
      const k = input.dataset.k;
      const raw = input.type === "number" ? Number(input.value) : input.value;
      if (input.type === "number" && !Number.isFinite(raw)) return;
      handle.change((d) => {
        const s = normalizeSetup(d.setup);
        if (!d.setup) d.setup = s;
        if (k === "sinkage" || k === "trim" || k === "heel") {
          if (!d.setup.attitude) d.setup.attitude = { sinkage: 0, trim: 0, heel: 0 };
          d.setup.attitude[k] = raw;
        } else if (k === "speed") d.setup.speed = s.speedUnit === "kn" ? raw * KNOT : raw;
        else if (k === "warmStart") d.setup.warmStart = raw || null;
        else if (k === "mode" || k === "mesh") {
          // the two modes need iterations an order of magnitude apart, so a new
          // mode always takes its default; a new mesh keeps a count someone chose
          const wasDefault = Object.values(DEFAULT_ITERATIONS[s.mode]).includes(s.iterations);
          d.setup[k] = raw;
          const next = normalizeSetup({ ...s, [k]: raw });
          if (k === "mode" || wasDefault) d.setup.iterations = DEFAULT_ITERATIONS[next.mode][next.mesh];
        } else d.setup[k] = raw;
      });
    });
  });
  function syncForm() {
    const d = doc();
    const s = setup();
    if (document.activeElement !== title) title.value = d.title ?? "";
    root.querySelectorAll("[data-k]").forEach((input) => {
      if (document.activeElement === input) return;
      const v = fieldValue(input.dataset.k, s);
      if (String(input.value) !== String(v)) input.value = v;
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
        // the hull kept with the case, when it has one and it holds the parts wanted
        let r = null;
        const stashUrl = doc()?.hull?.stash;
        if (stashUrl && !acq.fromSource) {
          try {
            r = fromStash((await findWhenThere(repo, stashUrl, { tries: 4 })).doc());
          } catch {
            r = null;
          }
          if (r) {
            r.stashUrl = stashUrl;
            if (!stashCovers(r.kept, wantedParts(r))) r = null; // parts it doesn't hold: read the original
          }
        }
        const fromStashDoc = !!r;
        if (!r) r = await acquireHull(repo, url).catch((err) => ({ ok: false, error: String(err?.message ?? err) }));
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
  /** The parts the case wants from a read model: its choice, else the default. */
  function wantedParts(r) {
    const chosen = doc()?.hull?.parts;
    if (Array.isArray(chosen)) return chosen;
    const parts = r.parts ?? partsOf(r.triangles, r.ranges ?? []);
    const water = waterPlanes(parts)[0] ?? null;
    return defaultParts(parts, water ? water.min[2] : 0);
  }

  /** Keep the chosen parts of a model just read from its original with the case. */
  let keepNote = null;
  async function keepHull(r, url) {
    const m = model();
    const stash = makeStash({
      triangles: r.triangles,
      ranges: m.ranges,
      parts: m.parts,
      chosen: m.names,
      source: { url, heads: r.heads ?? null, path: r.path, providerId: r.providerId ?? null, providerName: r.providerName ?? null, title: r.title },
      now: Date.now(),
    });
    if (!stash) {
      keepNote = "the hull is too big to keep with the case: it's read from the model each time";
      renderHull();
      return;
    }
    const h = await repo.create2(stash);
    if (disposed) return;
    handle.change((d) => {
      if (d.hull?.url === url) d.hull.stash = h.url;
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
  function model() {
    const r = hull.result;
    const ranges = r?.ranges?.length ? r.ranges : [{ name: "hull", from: 0, to: (r?.triangles?.length ?? 0) / 9 }];
    const parts = r?.parts ?? r?.partsCache ?? (r ? (r.partsCache = partsOf(r.triangles, ranges)) : []);
    const water = waterPlanes(parts)[0] ?? null;
    const waterZ = water ? water.min[2] : 0;
    const chosen = doc()?.hull?.parts;
    const names = Array.isArray(chosen) ? chosen.filter((n) => parts.some((p) => p.name === n)) : defaultParts(parts, waterZ);
    const bow = doc()?.hull?.bow === "-x" ? "-x" : "+x";
    return { ranges, parts, water, names, frame: { bow, waterZ } };
  }

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
        if (!m.names.length) throw new Error("no parts chosen for the hull");
        prepared = { ...prepareHull(hullTriangles(r.triangles, m.ranges, m.names, m.frame), s.attitude), attitudeKey: key, result: r, model: m };
      } catch (err) {
        prepared = { error: String(err?.message ?? err), attitudeKey: key, result: r };
      }
      renderHull();
    }, 120);
  }

  $(".keep-displacement").addEventListener("click", () => {
    if (!hull.result?.ok) return;
    const s = setup();
    const md = model();
    const tris = hullTriangles(hull.result.triangles, md.ranges, md.names, md.frame);
    // what it displaces upright at this sinkage and trim, then the sinkage that displaces that heeled
    const upright = prepareHull(tris, { ...s.attitude, heel: 0 }).info.volume;
    const sink = sinkageForVolume(tris, upright, { trim: s.attitude.trim, heel: s.attitude.heel });
    if (sink == null) return void ($(".hull-warn").textContent = "the hull can't displace its upright volume at this heel");
    handle.change((d) => {
      if (!d.setup.attitude) d.setup.attitude = { sinkage: 0, trim: 0, heel: 0 };
      d.setup.attitude.sinkage = +sink.toFixed(4);
    });
  });

  $(".float-go").addEventListener("click", () => {
    const m = Number($(".float-mass").value) * ($(".float-unit").value === "t" ? 1000 : 1);
    if (!(m > 0) || !hull.result?.ok) return;
    const s = setup();
    const { rho } = waterProperties(s.water, s.temperature);
    const md = model();
    const sink = sinkageForVolume(hullTriangles(hull.result.triangles, md.ranges, md.names, md.frame), m / rho, { trim: s.attitude.trim, heel: s.attitude.heel });
    const why = $(".hull-warn");
    if (sink == null) {
      why.textContent = `the whole hull displaces less than ${(m / 1000).toFixed(2)} t`;
      return;
    }
    handle.change((d) => {
      if (!d.setup.attitude) d.setup.attitude = { sinkage: 0, trim: 0, heel: 0 };
      d.setup.attitude.sinkage = +sink.toFixed(4);
    });
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
    const key = JSON.stringify([m.parts.map((p) => p.name), [...chosen], m.water?.name]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const tag = (p) => (p === m.water ? `water plane: the waterline (z = ${m.frame.waterZ.toFixed(3)} m)` : p.min[2] <= m.frame.waterZ ? "meets the water" : "above the water");
    box.innerHTML = `<details ${Array.isArray(doc()?.hull?.parts) ? "open" : ""}><summary class="hint">Hull: ${chosen.size} of ${m.parts.length} parts${m.water ? `; waterline from “${esc(m.water.name)}”` : ""}</summary>
      ${m.parts
        .map(
          (p) => `<label class="part" style="display:flex;gap:6px;align-items:baseline"><input type="checkbox" data-part="${esc(p.name)}" ${chosen.has(p.name) ? "checked" : ""} ${p === m.water ? "disabled" : ""}>
          <span>${esc(p.name)}</span><span class="hint">${p.triangles.toLocaleString("en")} triangles · ${tag(p)}</span></label>`,
        )
        .join("")}
      ${Array.isArray(doc()?.hull?.parts) ? `<button class="parts-reset">Back to what meets the water</button>` : ""}</details>`;
    box.querySelectorAll("input[data-part]").forEach((cb) =>
      cb.addEventListener("change", () => {
        const names = [...box.querySelectorAll("input[data-part]:checked")].map((x) => x.dataset.part);
        handle.change((d) => d.hull && (d.hull.parts = names));
      }),
    );
    box.querySelector(".parts-reset")?.addEventListener("click", () => handle.change((d) => d.hull && delete d.hull.parts));
  }

  // ------------------------------------------------------------ pre-flight
  function renderPreflight() {
    const box = $(".preflight-figures");
    const canvas = $(".hull-canvas");
    if (!prepared?.info) {
      canvas.hidden = true;
      box.innerHTML = `<div class="hint">Link a hull to see its waterline, wetted area and what the run will cost.</div>`;
      return;
    }
    canvas.hidden = false;
    const s = setup();
    const i = prepared.info;
    // drawing a big hull is tens of thousands of path segments: only when it, the width or the theme changes
    const drawKey = `${(canvas.parentElement?.clientWidth ?? 0)}|${document.documentElement.getAttribute("theme") ?? ""}`;
    if (canvas.__drawn !== prepared || canvas.__drawKey !== drawKey) {
      drawHull(canvas, prepared.mesh, i);
      canvas.__drawn = prepared;
      canvas.__drawKey = drawKey;
    }
    const { rho, nu, source } = waterProperties(s.water, s.temperature);
    const L = i.lwl > 0 ? i.lwl : i.loa;
    const V = s.speed;
    const fr = frictionEstimate({ V, S: i.wettedArea, L, rho, nu });
    const pv = domainForHull(s, i);
    const cells = estimateCells(pv.dom, i.wettedArea);
    const sv = server.handle?.doc();
    const cores = s.cores || sv?.daemon?.cores || 8;
    const secs = estimateSeconds(s, cells, cores);
    const row = (k, v, how = "") => `<tr><td>${k}</td><td>${v}</td><td class="method">${how}</td></tr>`;
    box.innerHTML = `
      <table class="figures">
        ${row("Length, waterline", `${L.toFixed(2)} m`, `overall ${i.loa.toFixed(2)} m`)}
        ${row("Beam, waterline", `${i.bwl.toFixed(2)} m`, `overall ${i.beam.toFixed(2)} m`)}
        ${row("Draft", `${i.draft.toFixed(2)} m`)}
        ${row("Displacement", `${((i.volume * rho) / 1000).toFixed(2)} t`, `${i.volume.toFixed(3)} m³ of ${s.water === "fresh" ? "fresh water" : "seawater"} at ${s.temperature} °C`)}
        ${row("Wetted area", `${i.wettedArea.toFixed(2)} m²`, "at rest")}
        ${row("Froude number", froude(V, L).toFixed(3), `${formatSpeed(V, s.speedUnit)} on the waterline length`)}
        ${row("Reynolds number", reynolds(V, L, nu).toExponential(2), `ν = ${nu.toExponential(3)} m²/s (${source})`)}
        ${row("Friction alone", fmtN(fr.R), `ITTC-57 C<sub>F</sub> = ${(fr.Cf * 1000).toFixed(3)}×10⁻³ on the wetted area: the floor the CFD's total should sit above`)}
        ${s.mode === "free-surface" ? row("Wavelength at this speed", `${waveLength(V).toFixed(2)} m`, `${pv.dom.freeSurface ? `${pv.dom.freeSurface.cellsPerWave.toFixed(0)} cells a wave near the hull` : ""}`) : ""}
        ${row(
          "Model",
          pv.half ? "half (y ≤ 0)" : "full",
          pv.half
            ? "the hull is symmetric, so a symmetry plane halves the cost"
            : Math.abs(s.attitude.heel) > 1e-9
              ? `heeled ${Math.abs(s.attitude.heel)}° to ${s.attitude.heel > 0 ? "starboard" : "port"}: no symmetry plane${s.domain === "half" ? " (a half model can't be heeled)" : ""}`
              : i.symmetric
                ? "full domain asked for"
                : "the hull isn't symmetric",
        )}
        ${row("Cells", `≈ ${Math.round(cells / 1000)}k`, `${s.mesh} preset; checkMesh gives the real count (to within a factor of two or so)`)}
        ${row("Time", `${s.stop === "settled" || s.mode === "double-body" ? "at most " : ""}≈ ${formatDuration(secs)}`, `on ${cores} cores, ${s.iterations} iterations${s.stop === "settled" || s.mode === "double-body" ? "; it stops sooner once the resistance settles" : ""}`)}
      </table>`;
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
    server = { url, handle: null, sub: null, error: null };
    renderServer();
    if (!url) return;
    try {
      const h = await repo.find(url);
      if (disposed || doc()?.server !== url) return;
      server.handle = h;
      if (h.doc()?.["@patchwork"]?.type !== SERVER_TYPE) server.error = "that link isn't an OpenFOAM daemon's inbox";
      const on = () => {
        renderServer();
        renderPreflight();
      };
      h.on("change", on);
      server.sub = () => h.off("change", on);
    } catch (err) {
      server.error = `couldn't load the inbox (${err?.message ?? err})`;
    }
    renderServer();
    renderPreflight();
  }
  function renderServer() {
    const box = $(".server-box");
    $(".server-forget").hidden = !server.url;
    $(".server-url").hidden = !!server.url;
    if (!server.url) {
      box.innerHTML = `<div class="hint">Start a daemon where OpenFOAM is installed (<code>daemon/start.sh</code> in the openfoam package) and paste the inbox link it prints.</div>`;
    } else if (server.error) box.innerHTML = `<div class="warn">${esc(server.error)}</div>`;
    else if (!server.handle) box.innerHTML = `<span class="chip">loading…</span>`;
    else {
      const s = server.handle.doc();
      const online = daemonOnline(s, Date.now());
      const q = queueView(s);
      const d = s.daemon ?? {};
      box.innerHTML = `
        <span class="chip"><span class="dot" data-state="${online ? "online" : "idle"}"></span>${esc(s.title ?? "OpenFOAM")}</span>
        <div class="hint">${online ? `online · OpenFOAM ${esc(d.openfoam ?? "?")} · ${d.cores ?? "?"} cores · ${esc(d.platform ?? "")}` : `offline${d.heartbeat ? ` since ${new Date(d.heartbeat).toLocaleString()}` : ""}: runs wait in its queue until it's back`}</div>
        <div class="hint">${q.active.length ? `running ${q.active.length}${d.jobs > 1 ? ` of ${d.jobs} at once` : ""}` : "idle"}${q.waiting.length ? `, ${q.waiting.length} waiting` : ""}</div>`;
    }
    renderRunButton();
  }

  // ------------------------------------------------------------ run
  function whyNot() {
    if (!doc()?.hull?.url) return "Link a hull first.";
    if (!hull.result?.ok) return hull.loading ? "Loading the hull…" : "The hull can't be read here.";
    if (!prepared?.info) return "Measuring the hull…";
    if (!prepared.info.pierces) return "The hull doesn't cross the waterline: set its sinkage.";
    if (!server.url) return "Choose a server.";
    if (server.error) return server.error;
    if (!server.handle) return "Loading the server…";
    return null;
  }
  function renderRunButton() {
    const why = whyNot();
    $(".run").disabled = !!why;
    $(".run-sweep").disabled = !!why;
    const s = setup();
    $(".run").textContent = `Run at ${formatSpeed(s.speed, s.speedUnit)}`;
    $(".run-why").textContent = why ?? (server.handle && !daemonOnline(server.handle.doc(), Date.now()) ? "The daemon is offline: the run will wait for it." : "");
  }
  async function runAt(speeds) {
    if (whyNot()) return;
    const by = await whoAmI(repo);
    const d = doc();
    const p = prepared;
    const r = hull.result;
    for (const speed of speeds) {
      const s = normalizeSetup({ ...setup(), speed });
      const run = newRun({
        caseUrl: handle.url,
        serverUrl: server.url,
        setup: s,
        hull: {
          stl: p.stl,
          info: JSON.parse(JSON.stringify(p.info)),
          warnings: [...p.warnings],
          source: { url: d.hull.url, path: r.path, title: r.title, providerId: r.providerId ?? null, parts: [...p.model.names], stash: r.stashUrl ?? null },
          // how the analysis frame sits in the model's (the scene draws results back in the model's)
          frame: { ...p.model.frame },
        },
        by,
        now: Date.now(),
      });
      const suggested = d["@patchwork"]?.suggestedImportUrl;
      if (suggested) run["@patchwork"].suggestedImportUrl = suggested;
      const rh = await repo.create2(run);
      handle.change((x) => {
        if (!Array.isArray(x.runs)) x.runs = [];
        x.runs.push(rh.url);
        x.selected = rh.url;
      });
      server.handle.change((x) => enqueue(x, rh.url, { now: Date.now(), by }));
    }
  }
  $(".run").addEventListener("click", () => runAt([setup().speed]));
  $(".run-sweep").addEventListener("click", () => {
    const s = setup();
    const k = s.speedUnit === "kn" ? KNOT : 1;
    const speeds = $(".sweep").value.split(/[\s,;]+/).map(Number).filter((v) => v > 0).map((v) => v * k);
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
            const k = `${r.status}|${r.summary ? 1 : 0}|${r.progress?.iteration}`;
            if (k !== last) {
              last = k;
              renderRuns();
            }
          };
          h.on("change", on);
          runSubs.push(() => h.off("change", on));
          renderRuns();
          showSelected();
        })
        .catch(() => {});
    }
  }
  function renderRuns() {
    const d = doc();
    const urls = d?.runs ?? [];
    $(".runs-box").hidden = !urls.length;
    if (!urls.length) return;
    const rows = urls
      .map((u) => ({ u, r: runHandles.get(u)?.doc() }))
      .reverse()
      .map(({ u, r }) => {
        if (!r) return `<tr data-click data-url="${u}"><td colspan="5" class="hint">loading…</td></tr>`;
        const s = r.summary;
        const st = r.status;
        const dot = st === "done" ? "done" : st === "failed" ? "failed" : isTerminal(st) || st === "queued" ? "idle" : "running";
        const extra = !s ? "" : s.mode === "free-surface" ? `Cr ${(s.Cr * 1000).toFixed(2)}e-3` : `1+k ${s.formFactor?.toFixed(3)}`;
        return `<tr data-click data-url="${u}" ${u === d.selected ? "data-selected" : ""}>
          <td><span class="dot" data-state="${dot}" style="display:inline-block;margin-right:6px"></span>${esc(r.title)}</td>
          <td>${st === "solving" ? `${r.progress?.iteration ?? 0}/${r.progress?.of}` : esc(st)}</td>
          <td>${s ? fmtN(s.Rt) : ""}</td><td>${s ? fmtW(s.power) : ""}</td><td>${extra}</td></tr>`;
      });
    $(".runs-table").innerHTML = `<table class="figures"><tr><th>Run</th><th>Status</th><th>R<sub>T</sub></th><th>Power</th><th></th></tr>${rows.join("")}</table>`;
    $(".runs-table")
      .querySelectorAll("tr[data-url]")
      .forEach((tr) => tr.addEventListener("click", () => handle.change((x) => (x.selected = tr.dataset.url))));
    renderCurve();
    renderWarmOptions();
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
    // one line per analysis and heel: a heeled run's drag isn't a point on the upright curve
    const lines = {};
    for (const r of done) {
      const heel = r.summary.heel ?? r.setup?.attitude?.heel ?? 0;
      (lines[`${r.summary.mode}|${heel}`] ??= { mode: r.summary.mode, heel, pts: [] }).pts.push([r.summary.V / KNOT, r.summary.Rt]);
    }
    const series = Object.values(lines)
      .filter((l) => new Set(l.pts.map((p) => p[0].toFixed(3))).size >= 2)
      .slice(0, 4)
      .map((l, i) => ({
        name: `${l.mode === "free-surface" ? "Free surface" : "Double body"}${l.heel ? `, ${Math.abs(l.heel)}° heel` : ""}`,
        color: seriesColors(root)[i],
        points: l.pts.sort((a, b) => a[0] - b[0]),
      }));
    $(".curve").hidden = !series.length;
    if (series.length) curveChart.update(series);
  }
  function showSelected() {
    const url = doc()?.selected;
    const h = url ? runHandles.get(url) : null;
    runView.show(h ?? null);
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
    runView.dispose();
    curveChart.dispose();
    root.remove();
    style.remove();
  };
}

