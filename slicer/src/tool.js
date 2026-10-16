// The patchwork-slicer tool, for two kinds of document:
//
//   slice-job  a persistent job: a source (scene render or GLB/STL file),
//              settings, and the G-code it made. Watches the source and
//              re-slices when its geometry changes (or says it's stale).
//   file       a quick slice of a GLB/STL file doc. Settings live only in this
//              view; "Make slice job" turns it into a job that keeps them.

import css from "./styles.css?inline";
import { JOB_TYPE, newJobDoc, normalizeJob } from "./datatype.js";
import { DEFAULT_SETTINGS, SETTINGS, settingsKey, settingWrites } from "./settings.js";
import { PEER_HOLD_MS, SLICING_MESSAGE, debounceFor, decide, slicingKey } from "./staleness.js";
import { currentSourceKey, describeSource, loadModel, sourceName } from "./source.js";
import { errorMessage, sliceJob, sliceModel } from "./job.js";
import { parseGcodePreview } from "./gcode-preview.js";
import { fileBytes } from "./render-read.js";
import { bounds } from "./stl.js";
import { bedOffset } from "./toolpaths.js";
import { fitScale, unitLabel } from "./units.js";
import { gcodeName } from "./output.js";
import { hasPatchworkDrop, parseAutomergeUrl, parsePatchworkDrop, sceneRowFromDrop, sliceUrlForSceneObject } from "./dnd.js";
import { onThemeChange, resolveCssColor } from "./theme.js";

const TOOL_ID = "patchwork-slicer";
const OPEN_EVENT = "patchwork:open-document";
/** Settings that change the geometry the viewer shows (the rest only change toolpaths). */
const GEOMETRY_KEYS = ["stlUnit", "stlUp", "glbUnit", "scale"];
const OPEN_GROUPS = new Set(["Model", "Quality"]);
const DROP_TEXT = "Drop an object from a scene's outline here, or a GLB / STL file, or paste its link.";

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

const fmtTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

function ago(t) {
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleString();
}

const isFileView = (doc) => doc?.["@patchwork"]?.type === "file" || (doc && doc.content != null && doc["@patchwork"]?.type !== JOB_TYPE && !("settings" in doc));

export default function SlicerTool(handle, element) {
  const repo = element.repo ?? globalThis.repo;
  const fileMode = isFileView(handle.doc());

  // ── DOM ──────────────────────────────────────────────────────────────────
  const style = el("style");
  style.textContent = css;
  const root = el("div", { class: "patchwork-slicer", tabindex: "-1" });
  element.append(style, root);

  const canvasHost = el("div", { class: "canvas-host" });
  const empty = el("div", { class: "empty" }, fileMode ? "Reading the file…" : DROP_TEXT);
  const legend = el(
    "div",
    { class: "legend", hidden: true },
    el("span", {}, el("span", { class: "swatch", dataset: { feature: "wall" } }), "walls"),
    el("span", {}, el("span", { class: "swatch", dataset: { feature: "solid" } }), "solid"),
    el("span", {}, el("span", { class: "swatch", dataset: { feature: "infill" } }), "infill"),
  );
  const layerSlider = el("input", { type: "range", min: "0", max: "0", step: "1", "aria-label": "Layer" });
  const layerLabel = el("span", { class: "layer-label" });
  const modelToggle = el("button", { type: "button", class: "button", "aria-pressed": "false", title: "Show the model instead of the toolpaths" }, "Model");
  const layerBar = el("div", { class: "layer-bar", hidden: true }, layerLabel, layerSlider, modelToggle);
  const dropHint = el("div", { class: "drop-hint", hidden: true }, "Drop to slice this");
  const view = el("div", { class: "view" }, canvasHost, empty, legend, layerBar, dropHint);

  const title = el("h2");
  const sourceNameEl = el("div", { class: "source-name" });
  const sourceKindEl = el("div", { class: "note" });
  const unitsEl = el("div", { class: "note" });
  const meshWarn = el("div", { class: "warning", hidden: true });
  const notice = el("div", { class: "note", hidden: true });
  const openSourceBtn = el("button", { type: "button", class: "button", dataset: { link: "" }, onclick: () => job().source && openDoc(job().source) }, "Open source");
  const pasteInput = el("input", { type: "text", placeholder: "automerge:… (render, GLB or STL)", "aria-label": "Source link" });
  const makeJobBtn = el("button", { type: "button", class: "button", dataset: { primary: "" }, onclick: makeJob }, "Make slice job");

  const sourceSection = el(
    "div",
    { class: "section flow" },
    el("div", { class: "section-title" }, "Source"),
    sourceNameEl,
    sourceKindEl,
    unitsEl,
    meshWarn,
    fileMode
      ? el("div", { class: "flow" }, el("div", { class: "note" }, "A quick slice of this file. Settings here aren't saved: make a slice job to keep them, its G-code, and re-slice when the file changes."), makeJobBtn)
      : el(
          "div",
          { class: "flow" },
          el("div", { class: "cluster" }, openSourceBtn),
          el("label", { class: "row", dataset: { wide: "" } }, el("span", {}, "Link"), pasteInput),
          el("div", { class: "note" }, "Drag an object from a scene's outline (or a GLB / STL file from the sidebar) onto the slicer, or paste its link."),
        ),
    notice,
  );

  const statusEl = el("div", { class: "status", role: "status" });
  const sliceBtn = el("button", { type: "button", class: "button", dataset: { primary: "" }, onclick: () => runSlice() }, "Slice now");
  const downloadBtn = el("button", { type: "button", class: "button", onclick: download }, "Download G-code");
  const openGcodeBtn = el("button", { type: "button", class: "button", dataset: { link: "" }, onclick: () => job().gcodeUrl && openDoc(job().gcodeUrl) }, "Open G-code");
  const autoBox = el("input", { type: "checkbox" });
  const statsEl = el("dl", { class: "stats" });
  const supportsWarn = el("div", { class: "warning", hidden: true }, "Supports are on, but this slicer doesn't generate them yet.");
  const outputSection = el(
    "div",
    { class: "section flow" },
    el("div", { class: "section-title" }, "Output"),
    statusEl,
    el("div", { class: "cluster" }, sliceBtn, downloadBtn, fileMode ? null : openGcodeBtn),
    fileMode ? null : el("label", { class: "row" }, el("span", {}, "Re-slice automatically"), autoBox),
    supportsWarn,
    statsEl,
  );

  const inputs = new Map(); // setting key → input element
  const fitBtn = el("button", { type: "button", class: "button", title: "Set Scale so the model fits the bed", onclick: fitToBed }, "Fit to bed");
  const groups = [];
  for (const spec of SETTINGS) {
    let g = groups.find((x) => x.name === spec.group);
    if (!g) groups.push((g = { name: spec.group, specs: [] }));
    g.specs.push(spec);
  }
  const settingsEls = groups.map((g) => {
    const det = el("details", { class: "section", open: OPEN_GROUPS.has(g.name) }, el("summary", {}, g.name));
    for (const spec of g.specs) {
      let input;
      if (spec.kind === "enum") {
        input = el("select", {}, spec.options.map((o) => el("option", { value: String(o.value) }, o.label)));
      } else if (spec.kind === "boolean") {
        input = el("input", { type: "checkbox" });
      } else if (spec.kind === "string") {
        input = el("input", { type: "text" });
      } else {
        input = el("input", { type: "number", step: String(spec.step ?? "any"), min: spec.min != null ? String(spec.min) : null, max: spec.max != null ? String(spec.max) : null });
      }
      input.addEventListener("change", () => {
        const v = spec.kind === "boolean" ? input.checked : spec.kind === "number" || spec.kind === "integer" ? input.value : input.value;
        writeSetting(spec.key, v);
      });
      inputs.set(spec.key, input);
      det.append(el("label", { class: "row", title: spec.hint ?? null, dataset: spec.kind === "string" ? { wide: "" } : {} }, el("span", {}, spec.label), input));
    }
    if (g.name === "Model") det.append(el("div", { class: "cluster" }, fitBtn));
    return det;
  });

  const side = el("div", { class: "side" }, title, sourceSection, outputSection, settingsEls);
  root.append(el("div", { class: "layout" }, view, side));

  // ── state ───────────────────────────────────────────────────────────────
  let dead = false;
  let busy = false;
  let progress = 0;
  // file mode keeps its job in memory; job mode reads the doc
  const local = fileMode
    ? { title: "", source: handle.url, settings: { ...DEFAULT_SETTINGS }, auto: false, gcodeUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, errorFrom: null, stats: null }
    : null;
  const job = () => (fileMode ? { ...local, title: sourceName(handle.doc()) } : normalizeJob(handle.doc()));

  let src = null; // { url, handle, onChange }
  let cur = { sourceState: "loading", sourceKey: null };
  let keyCache = { url: null, heads: "", value: null };
  let model = null; // { key, tris, offset, sizeMm, units, openEdges }
  let modelGen = 0;
  let preview = null; // { url, text, data }
  let previewGen = 0;
  let lastGcode = null; // { text, name }
  let peerHold = null; // { key, until }
  let sliceTimer = 0, sliceTimerKey = null, keyTimer = 0, peerTimer = 0;
  let showingModel = false;

  // ── viewer ──────────────────────────────────────────────────────────────
  const colors = () => ({
    bg: resolveCssColor(root, "--slicer-viewport-bg", [0.96, 0.96, 0.96]),
    bed: resolveCssColor(root, "--slicer-bed", [0.9, 0.9, 0.9]),
    grid: resolveCssColor(root, "--slicer-grid", [0.7, 0.7, 0.7]),
    model: resolveCssColor(root, "--slicer-model", [0.45, 0.55, 0.75]),
    wall: resolveCssColor(root, "--slicer-wall", [0.85, 0.3, 0.2]),
    solid: resolveCssColor(root, "--slicer-solid", [0.95, 0.75, 0.2]),
    infill: resolveCssColor(root, "--slicer-infill", [0.3, 0.65, 0.35]),
  });
  let viewer = null;
  import("./viewer.js")
    .then(({ createViewer }) => {
      if (dead) return;
      viewer = createViewer(canvasHost, colors());
      const s = job().settings;
      viewer.setBed(s.bedX, s.bedY);
      if (model) viewer.showModel(model.tris, model.offset);
      if (preview?.data) showPreviewData(preview.data);
    })
    .catch((err) => {
      console.warn("[slicer] no 3D preview", err);
      empty.textContent = `No 3D preview: ${errorMessage(err)}`;
      empty.hidden = false;
    });
  const offTheme = onThemeChange(() => viewer?.setColors(colors()));

  layerSlider.addEventListener("input", () => {
    const n = Number(layerSlider.value);
    viewer?.setLayer(n);
    layerLabel.textContent = `Layer ${n + 1} / ${Number(layerSlider.max) + 1}`;
  });
  modelToggle.addEventListener("click", () => {
    showingModel = !showingModel;
    modelToggle.setAttribute("aria-pressed", String(showingModel));
    viewer?.setModelVisible(showingModel);
  });

  function showPreviewData(data) {
    if (!viewer) return;
    viewer.showPreview(data);
    showingModel = false;
    modelToggle.setAttribute("aria-pressed", "false");
    const has = !!data?.layers;
    legend.hidden = layerBar.hidden = !has;
    if (has) {
      layerSlider.max = String(data.layers - 1);
      layerSlider.value = layerSlider.max;
      layerLabel.textContent = `Layer ${data.layers} / ${data.layers}`;
    }
  }

  // ── writes ──────────────────────────────────────────────────────────────
  function writeSetting(key, value) {
    const w = settingWrites(key, value);
    if (!w) return refresh(); // put the input back
    if (fileMode) {
      Object.assign(local.settings, w);
      refresh();
      return;
    }
    handle.change((d) => {
      if (!d.settings || typeof d.settings !== "object") d.settings = {};
      for (const [k, v] of Object.entries(w)) d.settings[k] = v;
    });
  }

  autoBox.addEventListener("change", () => {
    if (!fileMode) handle.change((d) => void (d.auto = autoBox.checked));
  });

  function say(msg) {
    notice.textContent = msg || "";
    notice.hidden = !msg;
  }

  async function setSource(url) {
    if (fileMode || !url) return;
    try {
      const h = await repo.find(url);
      const d = h.doc();
      const desc = describeSource(d);
      if (desc.kind === "unsupported") {
        if (d?.["@patchwork"]?.type === "scene") return say("That's a whole scene. Drag one object from its outline instead.");
        if (d?.["@patchwork"]?.type === JOB_TYPE) return say("That's another slice job.");
        return say(desc.type === "openscad" ? "That's an OpenSCAD document: add it to a scene, then drag its object from the scene's outline." : `Can't slice a ${desc.type ?? "document of unknown type"}. Use a scene object, or a GLB or STL file.`);
      }
    } catch (err) {
      return say(`Couldn't open that document: ${errorMessage(err)}`);
    }
    say("");
    if (job().source === url) return;
    handle.change((d) => {
      d.source = url;
    });
  }

  async function makeJob() {
    const doc = handle.doc();
    const name = sourceName(doc).replace(/\.[a-z0-9]{2,5}$/i, "");
    try {
      const h = await repo.create2(newJobDoc({ title: `${name} slice`, source: handle.url, settings: local.settings, auto: true }));
      openDoc(h.url, TOOL_ID);
    } catch (err) {
      say(`Couldn't make a slice job: ${errorMessage(err)}`);
    }
  }

  function openDoc(url, toolId = null) {
    root.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url, ...(toolId ? { toolId } : {}) }, bubbles: true, composed: true }));
  }

  function fitToBed() {
    if (!model) return say("Load a model first.");
    const s = job().settings;
    const at1 = model.sizeMm.map((v) => v / (s.scale || 1));
    writeSetting("scale", fitScale(at1, s));
  }

  async function download() {
    let text = lastGcode?.text;
    const j = job();
    if (!text && j.gcodeUrl) {
      try {
        text = new TextDecoder().decode(fileBytes((await repo.find(j.gcodeUrl)).doc()));
      } catch (err) {
        return say(`Couldn't read the G-code: ${errorMessage(err)}`);
      }
    }
    if (!text) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/x-gcode" }));
    a.download = gcodeName(j.title || sourceName(src?.handle?.doc()));
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  // ── the source ──────────────────────────────────────────────────────────
  async function attachSource(url) {
    detachSource();
    model = null;
    modelGen++;
    if (!url) {
      cur = { sourceState: "none", sourceKey: null };
      return;
    }
    cur = { sourceState: "loading", sourceKey: null };
    const mine = (src = { url, handle: null, onChange: null });
    try {
      const h = await repo.find(url);
      if (dead || src !== mine) return;
      mine.handle = h;
      mine.onChange = () => {
        clearTimeout(keyTimer);
        keyTimer = setTimeout(computeKey, 250);
      };
      h.on("change", mine.onChange);
      await computeKey();
    } catch (err) {
      if (dead || src !== mine) return;
      cur = { sourceState: "missing", sourceKey: null, error: errorMessage(err) };
      refresh();
    }
  }

  function detachSource() {
    clearTimeout(keyTimer);
    if (src?.handle && src.onChange) src.handle.off("change", src.onChange);
    src = null;
  }

  /** Work out the source's key now. A file's is a content hash, cached per heads. */
  async function computeKey() {
    const mine = src;
    if (!mine?.handle) return;
    const doc = mine.handle.doc();
    const heads = (mine.handle.heads?.() ?? []).map(String).sort().join(",");
    let next;
    if (keyCache.url === mine.url && keyCache.heads === heads && keyCache.value) next = keyCache.value;
    else {
      try {
        next = await currentSourceKey(mine.url, doc);
      } catch (err) {
        next = { sourceState: "error", sourceKey: null, error: errorMessage(err) };
      }
      if (dead || src !== mine) return;
      keyCache = { url: mine.url, heads, value: next };
    }
    const changed = next.sourceKey !== cur.sourceKey || next.sourceState !== cur.sourceState;
    cur = next;
    if (changed) refresh();
    else renderSource();
  }

  // ── the model, for the viewer ───────────────────────────────────────────
  function geometryKey(s) {
    return `${cur.sourceKey} ${GEOMETRY_KEYS.map((k) => s[k]).join(" ")}`;
  }

  async function loadDisplayModel() {
    const s = job().settings;
    if (cur.sourceState !== "ok") {
      if (model) {
        model = null;
        viewer?.showModel(null);
      }
      return;
    }
    const key = geometryKey(s);
    if (model?.key === key) return;
    const gen = ++modelGen;
    try {
      const m = await loadModel({ repo, url: src.url, settings: s });
      if (dead || gen !== modelGen) return;
      const b = bounds(m.tris);
      const first = !model;
      model = { key, tris: m.tris, offset: bedOffset(b, s), sizeMm: b.max.map((v, i) => v - b.min[i]), units: m.units, openEdges: m.openEdges, triangles: m.triangles };
      viewer?.showModel(model.tris, model.offset, { frame: first });
      if (showingModel || !preview?.data) viewer?.setModelVisible(true);
      renderSource();
    } catch (err) {
      if (dead || gen !== modelGen) return;
      model = null;
      viewer?.showModel(null);
      if (!fileMode || cur.sourceState === "ok") say(errorMessage(err));
    }
  }

  // ── the G-code, for the viewer ──────────────────────────────────────────
  async function loadPreview() {
    const url = job().gcodeUrl;
    if (!url || preview?.url === url) return;
    const gen = ++previewGen;
    try {
      const text = new TextDecoder().decode(fileBytes((await repo.find(url)).doc()));
      if (dead || gen !== previewGen || preview?.url === url) return;
      setPreview(url, text);
    } catch (err) {
      console.warn("[slicer] couldn't read the G-code", err);
    }
  }

  function setPreview(url, text) {
    const data = parseGcodePreview(text);
    preview = { url, text, data };
    lastGcode = { text };
    showPreviewData(data);
  }

  // ── slicing ─────────────────────────────────────────────────────────────
  function nowKeys(j) {
    return { sourceState: cur.sourceState, sourceKey: cur.sourceKey, settingsKey: settingsKey(j.settings) };
  }

  function peerSlicing(keys) {
    return !!peerHold && peerHold.until > Date.now() && peerHold.key === slicingKey(keys);
  }

  function evaluate() {
    const j = job();
    const keys = nowKeys(j);
    const d = decide(j, keys, { busy, peerSlicing: peerSlicing(keys) });
    schedule(d, keys);
    renderStatus(j, d);
  }

  function schedule(d, keys) {
    if (d.slice && !fileMode) {
      const k = slicingKey(keys);
      if (sliceTimer && sliceTimerKey === k) return;
      clearTimeout(sliceTimer);
      sliceTimerKey = k;
      sliceTimer = setTimeout(() => {
        sliceTimer = 0;
        sliceTimerKey = null;
        const j2 = job();
        const k2 = nowKeys(j2);
        if (decide(j2, k2, { busy, peerSlicing: peerSlicing(k2) }).slice) runSlice();
      }, debounceFor(d.reason));
    } else if (!d.slice && sliceTimer) {
      clearTimeout(sliceTimer);
      sliceTimer = 0;
      sliceTimerKey = null;
    }
  }

  async function runSlice() {
    if (busy || dead) return;
    clearTimeout(sliceTimer);
    sliceTimer = 0;
    sliceTimerKey = null;
    busy = true;
    progress = 0;
    say("");
    evaluate();
    const onProgress = (p) => {
      progress = p;
      if (!dead) renderStatus(job(), { state: "slicing", slice: false });
    };
    try {
      if (fileMode) {
        const s = { ...local.settings };
        const sKey = settingsKey(s);
        try {
          const m = await loadModel({ repo, url: handle.url, settings: s });
          const provenance = { source: handle.url, sourceKind: m.sourceKind, sourceKey: m.sourceKey, unit: m.units.unit, unitSource: m.units.source, scale: s.scale, settings: s };
          const r = await sliceModel({ model: m, settings: s, provenance, onProgress });
          if (dead) return;
          Object.assign(local, { builtFrom: { sourceKey: m.sourceKey, settingsKey: sKey }, builtAt: Date.now(), status: "idle", error: null, errorFrom: null, stats: r.stats });
          setPreview(null, r.gcode);
        } catch (err) {
          Object.assign(local, { status: "error", error: errorMessage(err), errorFrom: { sourceKey: cur.sourceKey, settingsKey: sKey } });
        }
      } else {
        const r = await sliceJob({
          repo,
          handle,
          onProgress,
          onInputs: (inp) => {
            try {
              handle.broadcast?.({ type: SLICING_MESSAGE, key: slicingKey(inp) });
            } catch {
              // presence is best-effort
            }
          },
        });
        if (dead) return;
        if (r.ok) setPreview(r.gcodeUrl, r.gcode);
      }
    } finally {
      busy = false;
      if (!dead) refresh();
    }
  }

  function onEphemeral(payload) {
    const msg = payload?.message;
    if (msg?.type !== SLICING_MESSAGE || typeof msg.key !== "string") return;
    peerHold = { key: msg.key, until: Date.now() + PEER_HOLD_MS };
    clearTimeout(peerTimer);
    peerTimer = setTimeout(() => !dead && evaluate(), PEER_HOLD_MS + 50);
    evaluate();
  }

  // ── rendering ───────────────────────────────────────────────────────────
  const KIND_LABEL = { render: "Scene object (render)", glb: "GLB file", stl: "STL file" };

  function renderSource() {
    const j = job();
    const doc = src?.handle?.doc();
    const desc = doc ? describeSource(doc) : null;
    sourceNameEl.textContent = j.source ? (doc ? sourceName(doc) : j.source) : "No source";
    sourceKindEl.textContent = desc ? (desc.kind === "render" ? KIND_LABEL.render : desc.kind === "file" ? KIND_LABEL[desc.format] : `Unsupported: ${desc.type ?? "unknown type"}`) : "";
    if (j.migratedSource) sourceKindEl.textContent += " · from an old bambu-slicer job";
    openSourceBtn.disabled = !j.source;
    if (model?.units) {
      unitsEl.textContent = `Units: ${model.units.label}${model.units.up === "y" ? ", Y up" : ", Z up"} · ${model.sizeMm.map((v) => v.toFixed(1)).join(" × ")} mm at scale ${j.settings.scale}`;
      unitsEl.classList.toggle("warning", !!model.units.guessed);
    } else if (desc?.kind === "render") {
      unitsEl.textContent = `Units: ${unitLabel("m", "render")}`;
      unitsEl.classList.remove("warning");
    } else unitsEl.textContent = "";
    meshWarn.hidden = !(model?.openEdges > 0);
    if (model?.openEdges > 0) meshWarn.textContent = `${model.openEdges} open or non-manifold edges: the mesh isn't watertight, so some layers may come out broken.`;
    if (document.activeElement !== pasteInput) pasteInput.value = j.source ?? "";
    empty.hidden = !!model || !!preview?.data;
    if (!empty.hidden && !fileMode) empty.textContent = !j.source ? DROP_TEXT : cur.sourceState === "loading" ? "Loading…" : "";
    else if (!empty.hidden && cur.sourceState !== "loading") empty.textContent = cur.sourceState === "ok" ? "" : "This file isn't a GLB or STL.";
  }

  function renderStatus(j, d) {
    let text = "";
    const pending = sliceTimer ? " Slicing…" : "";
    switch (d.state) {
      case "no-source":
        text = fileMode ? "This file can't be read." : "No source yet. Drop a scene object here.";
        break;
      case "waiting":
        text =
          d.reason === "unbuilt"
            ? "The scene hasn't built this object yet (or its build failed). Open its scene."
            : d.reason === "missing"
              ? `Can't load the source document${cur.error ? `: ${cur.error}` : "."}`
              : d.reason === "error"
                ? `Can't read the source${cur.error ? `: ${cur.error}` : "."}`
                : "Loading the source…";
        break;
      case "unsupported":
        text = "The source isn't a scene object, a GLB or an STL.";
        break;
      case "slicing":
        text = d.reason === "peer" ? "Someone else is slicing this…" : `Slicing… ${Math.round(progress * 100)}%`;
        break;
      case "fresh":
        text = fileMode ? "Sliced. Download it, or make a slice job to keep it." : `Up to date · sliced ${ago(j.builtAt)}.`;
        break;
      case "stale":
        text =
          (d.reason === "never-sliced" ? "Not sliced yet." : d.reason === "source" ? "Out of date: the model changed." : "Out of date: settings changed.") +
          (j.auto ? pending || (d.reason === "never-sliced" ? " Slicing…" : "") : " Press Slice now.");
        break;
      case "error":
        text = j.error ?? "Slicing failed.";
        break;
    }
    statusEl.textContent = text;
    statusEl.dataset.state = d.state;
    sliceBtn.disabled = busy || !["stale", "fresh", "error"].includes(d.state);
    sliceBtn.textContent = d.state === "fresh" ? "Re-slice" : "Slice now";
    if (d.state === "fresh") delete sliceBtn.dataset.primary;
    else sliceBtn.dataset.primary = "";
    downloadBtn.disabled = !(lastGcode?.text || j.gcodeUrl);
    openGcodeBtn.disabled = !j.gcodeUrl;
  }

  function renderStats(j) {
    const s = j.stats;
    statsEl.replaceChildren();
    if (!s) return;
    const rows = [
      ["Layers", s.layers],
      ["Print time", fmtTime(s.timeSeconds ?? 0)],
      ["Filament", `${((s.filamentMm ?? 0) / 1000).toFixed(2)} m · ${s.grams} g`],
      ["Size", Array.isArray(s.sizeMm) ? `${s.sizeMm.map((v) => (+v).toFixed(1)).join(" × ")} mm` : "–"],
      ["Triangles", s.triangles],
      ["G-code lines", s.lines],
    ];
    for (const [k, v] of rows) statsEl.append(el("dt", {}, k), el("dd", {}, String(v ?? "–")));
  }

  function renderSettings(j) {
    for (const spec of SETTINGS) {
      const input = inputs.get(spec.key);
      if (!input || document.activeElement === input) continue;
      const v = j.settings[spec.key];
      if (spec.kind === "boolean") input.checked = !!v;
      else input.value = String(v);
    }
    autoBox.checked = !!j.auto;
    supportsWarn.hidden = !j.settings.supports;
  }

  let lastSourceUrl;
  let lastBed = "";
  function refresh() {
    if (dead) return;
    const j = job();
    title.textContent = j.title;
    if (!fileMode && j.source !== lastSourceUrl) {
      lastSourceUrl = j.source;
      attachSource(j.source);
    }
    const bed = `${j.settings.bedX}x${j.settings.bedY}`;
    if (bed !== lastBed) {
      lastBed = bed;
      viewer?.setBed(j.settings.bedX, j.settings.bedY);
      if (model) model = { ...model, key: null }; // re-place on the new bed
    }
    renderSettings(j);
    renderSource();
    renderStats(j);
    evaluate();
    loadDisplayModel();
    if (!fileMode && !busy) loadPreview();
  }

  handle.on("change", refresh);
  if (!fileMode) handle.on("ephemeral-message", onEphemeral);

  // ── drop & paste (job only) ─────────────────────────────────────────────
  let dragDepth = 0;
  const onDragEnter = (e) => {
    if (fileMode || !hasPatchworkDrop(e.dataTransfer)) return;
    dragDepth++;
    dropHint.hidden = false;
  };
  const onDragOver = (e) => {
    if (fileMode || !hasPatchworkDrop(e.dataTransfer)) return;
    e.preventDefault();
    const ea = e.dataTransfer.effectAllowed;
    e.dataTransfer.dropEffect = ea === "move" ? "move" : ea === "link" ? "link" : "copy";
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropHint.hidden = true;
  };
  const onDrop = async (e) => {
    dragDepth = 0;
    dropHint.hidden = true;
    if (fileMode || !hasPatchworkDrop(e.dataTransfer)) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    const row = sceneRowFromDrop(dt);
    const items = row ? [] : parsePatchworkDrop(dt);
    if (row) {
      try {
        const url = sliceUrlForSceneObject((await repo.find(row.scene)).doc(), row.id);
        if (!url) return say("That scene row has no geometry (is it a group?).");
        return setSource(url);
      } catch (err) {
        return say(`Couldn't read that scene: ${errorMessage(err)}`);
      }
    }
    if (!items.length) return say("Nothing to slice there.");
    setSource(items[0].url);
  };
  const onPaste = (e) => {
    if (fileMode) return;
    const t = e.target;
    if (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const url = parseAutomergeUrl(e.clipboardData?.getData("text/plain"));
    if (url) {
      e.preventDefault();
      setSource(url);
    }
  };
  pasteInput.addEventListener("change", () => {
    const url = parseAutomergeUrl(pasteInput.value);
    if (url) setSource(url);
    else if (pasteInput.value.trim()) say("That isn't an automerge link.");
  });
  root.addEventListener("dragenter", onDragEnter);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("dragleave", onDragLeave);
  root.addEventListener("drop", onDrop);
  root.addEventListener("paste", onPaste);

  // ── start ───────────────────────────────────────────────────────────────
  if (fileMode) {
    src = { url: handle.url, handle, onChange: () => {
      clearTimeout(keyTimer);
      keyTimer = setTimeout(computeKey, 250);
    } };
    handle.on("change", src.onChange);
    computeKey();
  }
  refresh();

  return () => {
    dead = true;
    clearTimeout(sliceTimer);
    clearTimeout(keyTimer);
    clearTimeout(peerTimer);
    handle.off("change", refresh);
    handle.off("ephemeral-message", onEphemeral);
    if (fileMode && src?.onChange) handle.off("change", src.onChange);
    else detachSource();
    offTheme();
    viewer?.dispose();
    root.remove();
    style.remove();
  };
}
