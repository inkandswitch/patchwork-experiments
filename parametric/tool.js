/**
 * The parametric renderer.
 *
 * One tool for every parametric document. It loads the document's source file
 * (a file doc inside a pushwork directory), builds controls from the document's
 * `params`, draws the picture through the source's `render()`, and writes
 * parameter values back on intent. The contract it drives is DATATYPE.md.
 *
 * Layout follows lattice's grid builder, which this generalizes: controls are
 * flush on the desk, the picture is a raised card on it, a docket runs along
 * the bottom. Every colour derives from theme tokens with a fallback.
 */
import { fillTitle } from "./datatype.js";

/* ------------------------------------------------------------------ styles */

const STYLES = `
@layer package {
  :root, :host, [theme] {
    --pm-desk: var(--editor-fill, #fff);
    --pm-sheet: var(--elevation-raised-fill, var(--editor-fill, #fff));
    --pm-edge: var(--elevation-stroke, var(--editor-fill-offset-20, #ddd));
    --pm-raised: var(--elevation-raised-shadow, 0 1px 0 var(--pm-edge));
    --pm-ink: var(--editor-line, #1a1a1a);
    --pm-ink-dim: var(--editor-line-offset-30, #555);
    --pm-ink-faint: var(--editor-line-offset-50, #888);
    --pm-accent: var(--studio-primary, #35f7ca);
    --pm-accent-ink: var(--studio-primary-line, #fff);
    --pm-field: var(--editor-fill-offset-10, #f2f2f2);
    --pm-field-hover: var(--editor-fill-offset-20, #e8e8e8);
    --pm-family: var(--editor-family-sans, system-ui, sans-serif);
    --pm-family-code: var(--editor-family-code, ui-monospace, monospace);
  }
}
.parametric { height: 100%; display: flex; flex-direction: column; background: var(--pm-desk); color: var(--pm-ink); font-family: var(--pm-family); font-size: 13px; }
.parametric * { box-sizing: border-box; }
.parametric .desk { flex: 1; min-height: 0; display: flex; align-items: stretch; }

/* control surface: flush, no box. type and space do the grouping. */
.parametric .controls { flex: none; width: 248px; overflow-y: auto; overscroll-behavior: contain; padding: var(--studio-space-md, 16px); display: flex; flex-direction: column; gap: var(--studio-space-lg, 24px); }
.parametric .layer + .layer { border-top: 1px solid var(--pm-edge); padding-top: var(--studio-space-md, 16px); }
.parametric .layer-head { display: flex; align-items: center; gap: 5px; width: 100%; padding: 0 0 var(--studio-space-sm, 8px); border: 0; background: none; color: var(--pm-ink); font: inherit; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; text-align: left; }
.parametric .layer-head svg { width: 11px; height: 11px; flex: none; color: var(--pm-ink-faint); transition: transform var(--studio-transition-fast, .1s ease); }
.parametric .layer[data-open] .layer-head svg { transform: rotate(90deg); }
.parametric .layer-summary { font-family: var(--pm-family-code); font-size: 10px; font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--pm-ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.parametric .layer[data-open] .layer-summary { display: none; }
.parametric .layer-index { margin-left: auto; font-family: var(--pm-family-code); font-size: 10px; font-weight: 400; letter-spacing: 0; color: var(--pm-ink-faint); }
.parametric .layer-body { display: flex; flex-direction: column; gap: var(--studio-space-md, 16px); }
.parametric .layer-body[hidden] { display: none; }
.parametric .group { display: flex; flex-direction: column; gap: var(--studio-space-sm, 8px); }
.parametric .group[hidden] { display: none; }
.parametric .group > h3 { margin: 0; font-size: 10px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--pm-ink-faint); }
.parametric .field { display: flex; flex-direction: column; gap: 3px; }
.parametric .field[hidden] { display: none; }
.parametric .field > label { font-size: 11px; color: var(--pm-ink-dim); display: flex; justify-content: space-between; gap: 6px; }
.parametric .field > label[hidden] { display: none; }
.parametric .field > label .val { font-family: var(--pm-family-code); color: var(--pm-ink-faint); }
.parametric .caption { font-family: var(--pm-family-code); font-size: 10px; color: var(--pm-ink-faint); line-height: 1.4; }
.parametric .caption:empty { display: none; }

/* options are pills */
.parametric .seg { display: flex; flex-wrap: wrap; gap: 3px; }
.parametric .seg button { display: inline-flex; align-items: center; gap: 4px; min-width: 0; padding: 3px 9px; border: 1px solid transparent; border-radius: var(--studio-radius-round, 999px); background: var(--pm-field); color: var(--pm-ink-dim); font: inherit; font-size: 11px; cursor: pointer; transition: background var(--studio-transition-fast, .1s ease); white-space: nowrap; }
.parametric .seg button:hover { background: var(--pm-field-hover); }
.parametric .seg button[data-selected] { background: var(--pm-accent); color: var(--pm-accent-ink); }

/* tiles: each option drawn through render() */
.parametric .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.parametric .tiles button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 5px 2px 4px; border: 1px solid var(--pm-edge); border-radius: var(--studio-radius-sm, 4px); background: var(--pm-sheet); color: var(--pm-ink-dim); font: inherit; font-size: 10px; cursor: pointer; }
.parametric .tiles canvas, .parametric .tiles svg { width: 34px; height: 34px; display: block; background: none; }
.parametric .tiles button:hover { border-color: var(--pm-ink-faint); }
.parametric .tiles button[data-selected] { border-color: var(--pm-accent); box-shadow: 0 0 0 1px var(--pm-accent); color: var(--pm-ink); }

.parametric input[type="number"], .parametric input[type="text"], .parametric select { width: 100%; padding: 4px 6px; border: 1px solid var(--pm-edge); border-radius: var(--studio-radius-sm, 4px); background: var(--pm-field); color: var(--pm-ink); font: inherit; font-size: 12px; font-family: var(--pm-family-code); }
.parametric select { font-family: var(--pm-family); cursor: pointer; }
.parametric select:hover, .parametric input:hover { border-color: var(--pm-ink-faint); }
.parametric input[type="range"] { width: 100%; margin: 2px 0; accent-color: var(--pm-accent); }
.parametric input[type="checkbox"] { accent-color: var(--pm-accent); margin: 0; }
.parametric .check { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--pm-ink-dim); }

/* colour: named inks as round chips, one square well for anything else */
.parametric .swatches { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; }
.parametric .swatches button { width: 17px; height: 17px; padding: 0; border: 1px solid var(--pm-edge); border-radius: var(--studio-radius-round, 999px); cursor: pointer; }
.parametric .swatches button[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--pm-accent); }
.parametric .swatch { width: 17px; height: 17px; padding: 0; border: 1px solid var(--pm-edge); border-radius: var(--studio-radius-sm, 4px); background: none; cursor: pointer; overflow: hidden; }
.parametric .swatch::-webkit-color-swatch-wrapper { padding: 0; }
.parametric .swatch::-webkit-color-swatch { border: 0; border-radius: calc(var(--studio-radius-sm, 4px) - 1px); }
.parametric .swatch::-moz-color-swatch { border: 0; border-radius: calc(var(--studio-radius-sm, 4px) - 1px); }

.parametric .chips { display: flex; flex-wrap: wrap; gap: 2px; }
.parametric .chips button { padding: 2px 6px; border: 0; border-radius: var(--studio-radius-round, 999px); background: none; color: var(--pm-ink-faint); font: inherit; font-size: 10px; font-family: var(--pm-family-code); cursor: pointer; }
.parametric .chips button:hover { background: var(--pm-field); color: var(--pm-ink); }

/* lists: one bordered row per record */
.parametric .list { display: flex; flex-direction: column; gap: 6px; }
.parametric .list .row { border-left: 2px solid var(--pm-edge); padding-left: 8px; display: flex; flex-direction: column; gap: 4px; }
.parametric .list .row-head { display: flex; align-items: center; gap: 6px; font-family: var(--pm-family-code); font-size: 10px; color: var(--pm-ink-faint); }
.parametric .list .row-head button, .parametric .list > .add { border: 0; background: none; color: var(--pm-ink-faint); font: inherit; font-size: 10px; font-family: var(--pm-family-code); cursor: pointer; padding: 1px 5px; border-radius: var(--studio-radius-round, 999px); }
.parametric .list .row-head button:hover, .parametric .list > .add:hover { background: var(--pm-field); color: var(--pm-ink); }
.parametric .list > .add { align-self: flex-start; }

/* the stage: open desk. the picture rests on it as a card. */
.parametric .stage { flex: 1; min-width: 0; display: grid; place-content: safe center; overflow: auto; scrollbar-gutter: stable; padding: var(--studio-space-lg, 24px); }
.parametric .paper { position: relative; background: var(--pm-sheet); box-shadow: var(--pm-raised); border: 1px solid var(--pm-edge); }
.parametric .paper[data-unit="px"] { border-radius: var(--studio-radius-sm, 4px); overflow: hidden; }
.parametric .paper canvas, .parametric .paper svg { display: block; }
.parametric .stage .empty { font-family: var(--pm-family-code); font-size: 11px; color: var(--pm-ink-faint); max-width: 40ch; white-space: pre-wrap; }

/* bottom chrome */
.parametric .docket { flex: none; display: flex; align-items: center; gap: var(--studio-space-md, 16px); padding: var(--studio-space-xs, 6px) var(--studio-space-md, 16px); border-top: 1px solid var(--pm-edge); font-family: var(--pm-family-code); font-size: 11px; color: var(--pm-ink-faint); min-height: 28px; }
.parametric .docket .status { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.parametric .docket .status[data-error] { color: var(--studio-danger, #b00020); white-space: normal; }
.parametric .docket button, .parametric .docket select { border: 0; background: none; font: inherit; color: var(--pm-ink-faint); cursor: pointer; padding: 1px 5px; border-radius: var(--studio-radius-sm, 4px); }
.parametric .docket select { font-family: var(--pm-family-code); width: auto; }
.parametric .docket button:hover, .parametric .docket select:hover { background: var(--pm-field); color: var(--pm-ink); }
.parametric .docket button[data-selected] { background: var(--pm-field); color: var(--pm-ink); }
.parametric .docket button.update { color: var(--editor-primary-text, var(--pm-accent)); }
`;

/* ----------------------------------------------------------------- helpers */

const CHEVRON = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 2.5L8 6l-3.5 3.5"/></svg>`;

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
};

const clone = v => (v === undefined ? undefined : structuredClone(v));

const defaultOf = p => p.kind === "list"
  ? clone(p.default) ?? Array.from({ length: p.minItems ?? 0 }, () => rowDefault(p))
  : clone(p.default);
const rowDefault = p => Object.fromEntries((p.item ?? []).map(i => [i.key, defaultOf(i)]));

const controlOf = p => p.control ?? ({ num: "number", int: "number", str: "select", bool: "checkbox", color: "color", list: "list", data: "none" })[p.kind];

function holds(c, v) {
  if (!c) return true;
  if (c.all) return c.all.every(x => holds(x, v));
  if (c.any) return c.any.some(x => holds(x, v));
  if (c.not) return !holds(c.not, v);
  const x = v[c.key];
  if ("eq" in c) return x === c.eq;
  if ("neq" in c) return x !== c.neq;
  if ("in" in c) return c.in.includes(x);
  return true;
}

/** Same-origin URL the service worker resolves to a doc's content at its current heads. */
function importableUrl(handle) {
  const pinned = handle.view(handle.heads()).url;
  let origin;
  try { origin = new URL(document.baseURI).origin; } catch { origin = location.origin; }
  return `${origin}/${encodeURIComponent(pinned)}/`;
}

const MM_PER_IN = 25.4;
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const fmtNum = (v, p) => {
  if (typeof v !== "number") return String(v);
  const d = p.step && p.step < 1 ? Math.min(4, Math.ceil(-Math.log10(p.step))) : 0;
  return String(round(v, d));
};

/* -------------------------------------------------------------------- tool */

export default function ParametricTool(handle, element) {
  const root = el("div", "parametric");
  const style = el("style");
  style.textContent = STYLES;

  const desk = el("div", "desk");
  const controls = el("div", "controls");
  const stage = el("div", "stage");
  const paper = el("div", "paper");
  stage.append(paper);
  desk.append(controls, stage);

  const docket = el("div", "docket");
  const statusEl = el("span", "status");
  const sourceSel = el("select");
  sourceSel.title = "Source file";
  const updateBtn = el("button", "update", "update params");
  updateBtn.type = "button";
  updateBtn.hidden = true;
  const exportSvg = el("button", null, "svg");
  const exportPng = el("button", null, "png");
  exportSvg.type = exportPng.type = "button";
  docket.append(statusEl, updateBtn, sourceSel, exportSvg, exportPng);

  root.append(desk, docket);
  element.append(style, root);

  /* ---- state ---- */
  let mod = null;          // the loaded source module
  let fileHandle = null;   // its file doc
  let dirHandle = null;    // the directory doc holding it
  let loadedFor = "";      // `${url}/${path}` the module was loaded for
  let loadError = null;
  const view = { open: {} };   // view-bucket values + which layers are open; never written
  const preview = {};          // in-flight design values, this session only
  let fields = [], groups = [], summaries = [], builtFor = null;
  let surfaceEl = null, raf = 0, t0 = performance.now(), disposed = false;

  const say = (text, error) => {
    statusEl.textContent = text;
    statusEl.toggleAttribute("data-error", !!error);
  };

  /* ---- the values the source sees ---- */
  const params = () => handle.doc()?.params ?? [];
  const designParams = () => params().filter(p => p.bucket !== "view");
  const viewParams = () => params().filter(p => p.bucket === "view");

  function designValues(doc) {
    const out = {};
    for (const p of designParams()) out[p.key] = defaultOf(p);
    for (const [k, v] of Object.entries(doc.values ?? {})) out[k] = clone(v);
    Object.assign(out, preview);
    return out;
  }
  function ensureView() {
    for (const p of viewParams()) if (!(p.key in view)) view[p.key] = defaultOf(p);
  }

  /* ---- writes: commit on intent ---- */
  const commit = (key, value) => {
    const doc = handle.doc();
    if (JSON.stringify(doc.values?.[key]) === JSON.stringify(value)) return;
    handle.change(d => { d.values[key] = value; });
  };
  const commitRow = (listKey, idx, itemKey, value, p) => {
    handle.change(d => {
      if (!d.values[listKey]) d.values[listKey] = defaultOf(p);
      d.values[listKey][idx][itemKey] = value;
    });
  };
  const addRow = (p) => handle.change(d => {
    if (!d.values[p.key]) d.values[p.key] = defaultOf(p);
    d.values[p.key].push(rowDefault(p));
  });
  const removeRow = (p, idx) => handle.change(d => {
    if (!d.values[p.key]) d.values[p.key] = defaultOf(p);
    d.values[p.key].splice(idx, 1);
  });
  const applyPatch = (patch) => {
    if (!patch) return;
    if (patch.values && Object.keys(patch.values).length) {
      handle.change(d => { for (const [k, v] of Object.entries(patch.values)) d.values[k] = v; });
    }
    if (patch.view) { Object.assign(view, patch.view); syncControls(handle.doc()); }
  };

  /* ---- template: copy the source's exports into the document ---- */
  function copyTemplate() {
    if (!mod) return;
    handle.change(d => {
      d.params = clone(mod.params);
      d.output = clone(mod.output);
      d.presets = clone(mod.presets ?? []);
      if (mod.titleTemplate) d.titleTemplate = mod.titleTemplate; else delete d.titleTemplate;
      d.sourceVersion = mod.version;
    });
    builtFor = null;
  }
  function updateFromSource() {
    if (!mod) return;
    const doc = handle.doc();
    const migrated = typeof mod.migrate === "function" && doc.sourceVersion != null
      ? mod.migrate(designValues(doc), doc.sourceVersion) : null;
    handle.change(d => {
      d.params = clone(mod.params);
      d.output = clone(mod.output);
      d.presets = clone(mod.presets ?? []);
      if (mod.titleTemplate) d.titleTemplate = mod.titleTemplate; else delete d.titleTemplate;
      d.sourceVersion = mod.version;
      if (migrated) for (const [k, v] of Object.entries(migrated)) d.values[k] = v;
    });
    builtFor = null;
  }
  updateBtn.addEventListener("click", updateFromSource);

  /* ---- loading the source ---- */
  const repo = window.repo;

  async function loadSource() {
    const doc = handle.doc();
    const src = doc?.source;
    if (!src?.url || !src?.path) { loadError = "document has no source"; return; }
    const key = `${src.url}/${src.path}`;
    try {
      if (!dirHandle || dirHandle.url !== src.url) {
        dirHandle = await repo.find(src.url);
        dirHandle.on("change", onDirChange);
        fillSourceSelect();
      }
      const leaf = dirHandle.doc()?.[src.path];
      if (!leaf) throw new Error(`${src.path} is not in ${src.url}`);
      const bare = String(leaf).split("#")[0];
      if (!fileHandle || fileHandle.url.split("#")[0] !== bare) {
        fileHandle?.off("change", onFileChange);
        fileHandle = await repo.find(bare);
        fileHandle.on("change", onFileChange);
      }
      const h = src.heads?.length ? fileHandle.view(src.heads) : fileHandle;
      const m = await import(importableUrl(h));
      if (disposed) return;
      if (!Array.isArray(m.params) || !m.output || typeof m.render !== "function") {
        throw new Error(`${src.path} must export params, output and render`);
      }
      mod = m; loadedFor = key; loadError = null;
      if (handle.doc().sourceVersion == null) copyTemplate();
    } catch (e) {
      mod = null; loadedFor = key; loadError = e?.message ?? String(e);
      console.error("parametric: could not load source", e);
    }
    builtFor = null;
    paint();
  }
  function onFileChange() { loadedFor = ""; loadSource(); }
  function onDirChange() { fillSourceSelect(); if (!mod) loadSource(); }

  function fillSourceSelect() {
    const d = dirHandle?.doc() ?? {};
    const files = Object.keys(d).filter(k => k.endsWith(".js") && !k.startsWith("@")).sort();
    sourceSel.replaceChildren(...files.map(f => { const o = el("option", null, f); o.value = f; return o; }));
    sourceSel.value = handle.doc()?.source?.path ?? "";
  }
  sourceSel.addEventListener("change", () => {
    const path = sourceSel.value;
    handle.change(d => { d.source.path = path; delete d.source.heads; delete d.sourceVersion; });
  });

  /* ---- control builders. each returns { el, sync(values) } ---- */

  function numberControl(p, get, set) {
    const wrap = el("div");
    const input = el("input");
    input.type = "number";
    if (p.min != null) input.min = p.min;
    if (p.max != null) input.max = p.max;
    input.step = p.step ?? "any";
    // `change`, never `input`: fired on blur or Enter, which is "I meant this".
    input.addEventListener("change", () => {
      let v = p.kind === "int" ? parseInt(input.value, 10) : parseFloat(input.value);
      if (!Number.isFinite(v)) return sync(get());
      if (p.min != null) v = Math.max(p.min, v);
      if (p.max != null) v = Math.min(p.max, v);
      set(v);
    });
    wrap.append(input);
    const sync = v => { if (document.activeElement !== input) input.value = fmtNum(v, p); };
    return { el: wrap, sync };
  }

  function rangeControl(p, get, set, key) {
    const wrap = el("div");
    const input = el("input");
    input.type = "range";
    input.min = p.min ?? 0; input.max = p.max ?? 100; input.step = p.step ?? 1;
    // A drag has to show its result to be usable, but a drag is one decision:
    // `input` writes an ephemeral value only this session sees, `change` commits.
    input.addEventListener("input", () => {
      const v = p.kind === "int" ? parseInt(input.value, 10) : parseFloat(input.value);
      if (key) preview[key] = v;
      wrap.dispatchEvent(new CustomEvent("pm:preview", { bubbles: true, detail: { key, v } }));
      paint();
    });
    input.addEventListener("change", () => {
      const v = p.kind === "int" ? parseInt(input.value, 10) : parseFloat(input.value);
      if (key) delete preview[key];
      set(v);
    });
    wrap.append(input);
    const sync = v => { if (document.activeElement !== input) input.value = v; };
    return { el: wrap, sync };
  }

  function checkboxControl(p, get, set) {
    const wrap = el("label", "check");
    const input = el("input");
    input.type = "checkbox";
    input.addEventListener("change", () => set(input.checked));
    wrap.append(input, el("span", null, p.label ?? p.key));
    const sync = v => { input.checked = !!v; };
    return { el: wrap, sync, ownLabel: true };
  }

  function textControl(p, get, set) {
    const input = el("input");
    input.type = "text";
    input.addEventListener("change", () => set(input.value));
    const sync = v => { if (document.activeElement !== input) input.value = v ?? ""; };
    return { el: input, sync };
  }

  function selectControl(p, get, set) {
    const sel = el("select");
    for (const [value, label] of p.options ?? []) {
      const o = el("option", null, label); o.value = String(value); sel.append(o);
    }
    sel.addEventListener("change", () => {
      const hit = (p.options ?? []).find(([value]) => String(value) === sel.value);
      set(hit ? hit[0] : sel.value);
    });
    const sync = v => { if (document.activeElement !== sel) sel.value = String(v); };
    return { el: sel, sync };
  }

  function segControl(p, get, set) {
    const wrap = el("div", "seg");
    const buttons = (p.options ?? []).map(([value, label]) => {
      const b = el("button", null, label); b.type = "button"; b.title = label;
      b.addEventListener("click", () => set(value));
      wrap.append(b);
      return [value, b];
    });
    const sync = v => { for (const [value, b] of buttons) b.toggleAttribute("data-selected", value === v); };
    return { el: wrap, sync };
  }

  /**
   * Tiles: each option drawn through the real render() at thumbnail size, so
   * the tile is the option's actual geometry. Needs the source; without it the
   * tiles degrade to labelled buttons.
   */
  function tilesControl(p, get, set) {
    const wrap = el("div", "tiles");
    const base = {};
    for (const q of designParams()) base[q.key] = defaultOf(q);
    Object.assign(base, p.thumbnail ?? {});
    const buttons = (p.options ?? []).map(([value, label]) => {
      const b = el("button"); b.type = "button"; b.title = label;
      const vals = { ...base, [value === undefined ? p.key : p.key]: value };
      const thumb = drawThumb(vals, 34);
      if (thumb) b.append(thumb);
      b.append(el("span", null, label));
      b.addEventListener("click", () => set(value));
      wrap.append(b);
      return [value, b];
    });
    const sync = v => { for (const [value, b] of buttons) b.toggleAttribute("data-selected", value === v); };
    return { el: wrap, sync };
  }

  function drawThumb(vals, px) {
    if (!mod) return null;
    const doc = handle.doc();
    const output = doc.output;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ext = mod.extent?.(vals);
    const w = ext?.width ?? output.width ?? 100;
    const h = ext?.height ?? output.height ?? 100;
    const scale = px / Math.max(w, h);
    const viewVals = {}; for (const q of viewParams()) viewVals[q.key] = defaultOf(q);
    try {
      if (output.surfaces.includes("canvas2d")) {
        const c = el("canvas");
        c.width = Math.round(w * scale * dpr); c.height = Math.round(h * scale * dpr);
        const ctx = c.getContext("2d");
        ctx.fillStyle = output.background ?? "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.scale(scale * dpr, scale * dpr);
        mod.render(vals, { kind: "canvas2d", ctx, width: w, height: h, scale: scale * dpr, dpi: 96, export: false, t: 0, view: viewVals });
        return c;
      }
      const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      s.setAttribute("viewBox", `0 0 ${w} ${h}`);
      mod.render(vals, { kind: "svg", root: s, width: w, height: h, scale, dpi: 96, export: false, t: 0, view: viewVals });
      return s;
    } catch (e) { console.warn("parametric: thumbnail failed", e); return null; }
  }

  function colorControl(p, get, set, key) {
    const wrap = el("div", "swatches");
    const chips = (p.presets ?? []).map(chip => {
      const b = el("button"); b.type = "button";
      b.style.background = chip.value; b.title = chip.label; b.setAttribute("aria-label", chip.label);
      b.dataset.hex = String(chip.value).toLowerCase();
      b.addEventListener("click", () => set(chip.value));
      wrap.append(b);
      return b;
    });
    // The custom well streams `input` while you hunt for a colour; those go to
    // preview so the picture follows, and only `change` reaches the document.
    const input = el("input", "swatch");
    input.type = "color";
    input.setAttribute("aria-label", `${p.label ?? p.key} (custom)`);
    input.addEventListener("input", () => { if (key) { preview[key] = input.value; paint(); } });
    input.addEventListener("change", () => { if (key) delete preview[key]; set(input.value); });
    wrap.append(input);
    const sync = v => {
      const cur = String(v ?? "#000000").toLowerCase();
      if (document.activeElement !== input && /^#[0-9a-f]{6}$/.test(cur)) input.value = cur;
      for (const b of chips) b.setAttribute("aria-pressed", String(b.dataset.hex === cur));
    };
    return { el: wrap, sync, noChips: true };
  }

  function listControl(p, get) {
    const wrap = el("div", "list");
    const box = el("div");
    const add = el("button", "add", "+ add"); add.type = "button";
    add.addEventListener("click", () => addRow(p));
    wrap.append(box, add);
    let rows = [];   // [{ items: [{ p, sync }] }]
    const sync = v => {
      const list = Array.isArray(v) ? v : [];
      if (rows.length !== list.length) {
        box.replaceChildren();
        rows = list.map((_, idx) => {
          const r = el("div", "row");
          const head = el("div", "row-head", `${idx + 1}`);
          const rm = el("button", null, "remove"); rm.type = "button";
          rm.addEventListener("click", () => removeRow(p, idx));
          head.append(rm);
          r.append(head);
          const items = (p.item ?? []).map(ip => {
            const f = buildField(ip, () => (handle.doc().values?.[p.key]?.[idx] ?? {})[ip.key],
              value => commitRow(p.key, idx, ip.key, value, p), null);
            r.append(f.row);
            return f;
          });
          box.append(r);
          return { items };
        });
        add.hidden = p.maxItems != null && list.length >= p.maxItems;
        for (const r of box.querySelectorAll(".row-head button")) r.disabled = list.length <= (p.minItems ?? 0);
      }
      list.forEach((row, idx) => rows[idx]?.items.forEach(f => f.sync(row[f.p.key])));
    };
    return { el: wrap, sync };
  }

  const BUILDERS = {
    number: numberControl, range: rangeControl, checkbox: checkboxControl, text: textControl,
    select: selectControl, seg: segControl, tiles: tilesControl, color: colorControl, list: listControl,
  };

  /** A labelled field for one param. `key` is the top-level values key for preview, or null inside a row. */
  function buildField(p, get, set, key) {
    const kind = controlOf(p);
    const row = el("div", "field");
    const label = el("label");
    const name = el("span", null, p.label ?? p.key);
    const val = el("span", "val");
    label.append(name, val);
    const build = BUILDERS[kind];
    let built = build ? build(p, get, set, key) : { el: el("div", "caption", `edited on the picture`), sync: () => {} };
    if (built.ownLabel) label.hidden = true;
    row.append(label, built.el);
    if (p.presets?.length && !built.noChips) {
      const chips = el("div", "chips");
      for (const chip of p.presets) {
        const b = el("button", null, chip.label); b.type = "button";
        b.addEventListener("click", () => {
          if (chip.also && key) handle.change(d => { for (const [k, v] of Object.entries(chip.also)) d.values[k] = v; d.values[key] = chip.value; });
          else set(chip.value);
        });
        chips.append(b);
      }
      row.append(chips);
    }
    const caption = el("div", "caption", p.note ?? "");
    const dyn = el("div", "caption");
    row.append(caption, dyn);
    const field = { p, row, caption: dyn, sync: v => { built.sync(v); if (kind === "range" || kind === "number") val.textContent = p.unit ? `${fmtNum(v, p)} ${p.unit}` : ""; } };
    return field;
  }

  /* ---- the control surface: layers > groups > fields ---- */
  function buildControls(doc) {
    controls.replaceChildren();
    fields = []; groups = []; summaries = [];
    const ps = doc.params ?? [];
    if (!ps.length) return;

    // Presets, first: starting points for the whole design.
    if (doc.presets?.length) {
      const g = el("div", "group");
      g.append(el("h3", null, "Starting points"));
      const chips = el("div", "seg");
      for (const preset of doc.presets) {
        const b = el("button", null, preset.name); b.type = "button";
        b.addEventListener("click", () => handle.change(d => { for (const [k, v] of Object.entries(preset.values ?? {})) d.values[k] = clone(v); }));
        chips.append(b);
      }
      g.append(chips);
      controls.append(g);
    }

    // Layers in order of first appearance; params with no layer form one unnamed layer.
    const layers = [];
    const byLayer = new Map();
    for (const p of ps) {
      const name = p.bucket === "view" ? "View" : (p.layer ?? "");
      if (!byLayer.has(name)) { byLayer.set(name, []); layers.push(name); }
      byLayer.get(name).push(p);
    }
    if (byLayer.has("View")) { layers.splice(layers.indexOf("View"), 1); layers.push("View"); }

    layers.forEach((name, index) => {
      const section = el("section", "layer");
      const body = el("div", "layer-body");
      let head = null;
      if (name) {
        head = el("button", "layer-head");
        head.type = "button";
        head.innerHTML = CHEVRON;
        const summary = el("span", "layer-summary");
        head.append(el("span", null, name), summary, el("span", "layer-index", String(index)));
        summaries.push({ el: summary, name });
        section.append(head);
        const setOpen = open => {
          view.open[name] = open;
          section.toggleAttribute("data-open", open);
          head.setAttribute("aria-expanded", String(open));
          body.hidden = !open;
        };
        setOpen(view.open[name] !== false);
        head.addEventListener("click", () => setOpen(!(view.open[name] !== false)));
      }

      // Groups: consecutive params sharing a section.
      let g = null, current = null;
      for (const p of byLayer.get(name)) {
        const sec = p.section ?? "";
        if (!g || sec !== current) {
          g = el("div", "group");
          if (sec) g.append(el("h3", null, sec));
          body.append(g); groups.push(g); current = sec;
        }
        const isView = p.bucket === "view";
        const field = buildField(p,
          () => isView ? view[p.key] : (handle.doc().values?.[p.key] ?? defaultOf(p)),
          value => { if (isView) { view[p.key] = value; paint(); } else commit(p.key, value); },
          isView ? null : p.key);
        g.append(field.row);
        fields.push(field);
      }
      section.append(body);
      controls.append(section);
    });
    builtFor = doc.sourceVersion + ":" + ps.length + ":" + (mod ? 1 : 0);
  }

  function syncControls(doc) {
    const dv = designValues(doc);
    ensureView();
    const notes = safeNotes(dv);
    for (const f of fields) {
      const isView = f.p.bucket === "view";
      f.row.hidden = !holds(f.p.showWhen, dv);
      f.sync(isView ? view[f.p.key] : dv[f.p.key]);
      f.caption.textContent = notes[f.p.key] ?? "";
    }
    for (const { el: e, name } of summaries) e.textContent = notes[`$layer:${name}`] ?? "";
    for (const g of groups) {
      const rows = [...g.querySelectorAll(":scope > .field")];
      g.hidden = rows.length > 0 && rows.every(r => r.hidden);
    }
    return notes;
  }
  function safeNotes(dv) {
    try { return (mod?.notes?.(dv, view)) ?? {}; } catch (e) { console.warn("parametric: notes() failed", e); return {}; }
  }

  /* ---- the picture ---- */
  function sizeFor(dv, output) {
    let w = output.width, h = output.height;
    try { const ext = mod?.extent?.(dv); if (ext) { w = ext.width; h = ext.height; } } catch (e) { console.warn(e); }
    if (w == null || h == null) {
      const cs = getComputedStyle(stage);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      w = Math.max(stage.clientWidth - padX - 2, 40); h = Math.max(stage.clientHeight - padY - 2, 40);
    }
    return [w, h];
  }
  function scaleFor(w, h, output) {
    const cs = getComputedStyle(stage);
    const availW = Math.max(stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2, 40);
    const availH = Math.max(stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2, 40);
    const z = view.zoom;
    if (output.unit === "mm") {
      if (z === "actual") return 96 / MM_PER_IN;
      const fit = Math.min(availW / w, availH / h);
      return typeof z === "number" ? fit * z : fit;
    }
    const fit = Math.min(1, availW / w, availH / h);
    return fit * (typeof z === "number" ? z : 1);
  }

  function paint() {
    if (disposed) return;
    const doc = handle.doc();
    if (!doc) return;
    const key = doc.source ? `${doc.source.url}/${doc.source.path}` : "";
    if (key && key !== loadedFor) { loadedFor = key; loadSource(); }

    const wantBuilt = doc.sourceVersion + ":" + (doc.params?.length ?? 0) + ":" + (mod ? 1 : 0);
    if (builtFor !== wantBuilt) buildControls(doc);
    sourceSel.value = doc.source?.path ?? "";
    updateBtn.hidden = !(mod && doc.sourceVersion != null && mod.version > doc.sourceVersion);
    updateBtn.textContent = `update params (v${mod?.version})`;

    if (!mod) {
      syncControls(doc);
      paper.replaceChildren(el("div", "empty", loadError ? `source failed to load\n${loadError}` : "loading source…"));
      paper.style.width = paper.style.height = "";
      say(loadError ?? "loading…", !!loadError);
      return;
    }
    const output = doc.output;
    const dv = designValues(doc);
    const [w, h] = sizeFor(dv, output);
    const scale = scaleFor(w, h, output);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const kind = output.surfaces.includes("canvas2d") ? "canvas2d" : "svg";
    paper.dataset.unit = output.unit;
    exportSvg.hidden = !output.surfaces.includes("svg");
    const t = (performance.now() - t0) / 1000;
    try {
      if (kind === "canvas2d") {
        if (!surfaceEl || surfaceEl.tagName !== "CANVAS") { surfaceEl = el("canvas"); paper.replaceChildren(surfaceEl); }
        surfaceEl.style.width = `${w * scale}px`; surfaceEl.style.height = `${h * scale}px`;
        const pw = Math.round(w * scale * dpr), ph = Math.round(h * scale * dpr);
        if (surfaceEl.width !== pw) surfaceEl.width = pw;
        if (surfaceEl.height !== ph) surfaceEl.height = ph;
        const ctx = surfaceEl.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = output.background ?? "#fff"; ctx.fillRect(0, 0, pw, ph);
        ctx.scale(scale * dpr, scale * dpr);
        mod.render(dv, { kind, ctx, width: w, height: h, scale: scale * dpr, dpi: 96 * scale * dpr, export: false, t, view });
      } else {
        if (!surfaceEl || surfaceEl.tagName !== "svg") { surfaceEl = document.createElementNS("http://www.w3.org/2000/svg", "svg"); paper.replaceChildren(surfaceEl); }
        surfaceEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
        surfaceEl.setAttribute("width", w * scale); surfaceEl.setAttribute("height", h * scale);
        surfaceEl.style.background = output.background ?? "#fff";
        surfaceEl.replaceChildren();
        mod.render(dv, { kind, root: surfaceEl, width: w, height: h, scale, dpi: 96 * scale, export: false, t, view });
      }
      paper.style.width = `${w * scale}px`; paper.style.height = `${h * scale}px`;
      const notes = syncControls(doc);
      say(notes.$status ?? `${w} × ${h} ${output.unit}`);
    } catch (e) {
      syncControls(doc);
      say(`render failed: ${e?.message ?? e}`, true);
      console.error("parametric: render failed", e);
    }
    if (output.animated) { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); }
  }

  /* ---- pointer events on the picture, in output units ---- */
  function forward(ev) {
    if (!mod?.interact || !surfaceEl) return;
    const doc = handle.doc();
    const dv = designValues(doc);
    const [w, h] = sizeFor(dv, doc.output);
    const r = surfaceEl.getBoundingClientRect();
    const e = { type: ev.type, x: (ev.clientX - r.left) / r.width * w, y: (ev.clientY - r.top) / r.height * h,
      shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey, buttons: ev.buttons };
    let patch = null;
    try { patch = mod.interact(e, dv, { width: w, height: h, view }); } catch (err) { console.warn("parametric: interact() failed", err); }
    if (patch) { applyPatch(patch); paint(); }
  }
  for (const type of ["pointerdown", "pointermove", "pointerup"]) paper.addEventListener(type, forward);

  /* ---- export ---- */
  function download(name, blob) {
    const a = el("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }
  const fileStem = () => (handle.doc().title || fillTitle(handle.doc().titleTemplate, handle.doc().params, handle.doc().values) || "parametric").replace(/[^\w.-]+/g, "-");
  exportSvg.addEventListener("click", () => {
    const doc = handle.doc(); const dv = designValues(doc); const [w, h] = sizeFor(dv, doc.output);
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.setAttribute("width", doc.output.unit === "mm" ? `${w}mm` : w);
    s.setAttribute("height", doc.output.unit === "mm" ? `${h}mm` : h);
    mod.render(dv, { kind: "svg", root: s, width: w, height: h, scale: 1, dpi: doc.output.dpi, export: true, t: 0, view });
    download(`${fileStem()}.svg`, new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(s)], { type: "image/svg+xml" }));
  });
  exportPng.addEventListener("click", () => {
    const doc = handle.doc(); const dv = designValues(doc); const [w, h] = sizeFor(dv, doc.output);
    const pxPerUnit = doc.output.unit === "mm" ? doc.output.dpi / MM_PER_IN : 2;
    const c = el("canvas"); c.width = Math.round(w * pxPerUnit); c.height = Math.round(h * pxPerUnit);
    const ctx = c.getContext("2d");
    ctx.fillStyle = doc.output.background ?? "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(pxPerUnit, pxPerUnit);
    const kind = doc.output.surfaces.includes("canvas2d") ? "canvas2d" : "svg";
    if (kind === "canvas2d") {
      mod.render(dv, { kind, ctx, width: w, height: h, scale: pxPerUnit, dpi: doc.output.dpi, export: true, t: 0, view });
      c.toBlob(b => b && download(`${fileStem()}.png`, b), "image/png");
    } else {
      const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      s.setAttribute("xmlns", "http://www.w3.org/2000/svg"); s.setAttribute("viewBox", `0 0 ${w} ${h}`);
      s.setAttribute("width", c.width); s.setAttribute("height", c.height);
      mod.render(dv, { kind: "svg", root: s, width: w, height: h, scale: pxPerUnit, dpi: doc.output.dpi, export: true, t: 0, view });
      const img = new Image();
      img.onload = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(img, 0, 0); c.toBlob(b => b && download(`${fileStem()}.png`, b), "image/png"); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(s));
    }
  });

  /* ---- lifecycle ---- */
  paint();
  handle.on("change", paint);
  const observer = new ResizeObserver(() => paint());
  observer.observe(stage);

  return () => {
    disposed = true;
    handle.off("change", paint);
    fileHandle?.off("change", onFileChange);
    dirHandle?.off("change", onDirChange);
    cancelAnimationFrame(raf);
    observer.disconnect();
    root.remove();
    style.remove();
  };
}
