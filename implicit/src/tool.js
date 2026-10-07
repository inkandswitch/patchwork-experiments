// patchwork:tool "implicit-surface" — a collaborative SDF editor with a live,
// exact raymarched preview (no meshing: the field itself is rendered).
//
// Source text syncs through automerge-codemirror. Every change (local or
// remote) recompiles source -> AST -> IR -> GLSL off a short debounce; the
// last good shader stays on screen while the source has an error. Camera,
// view mode and slice height are per-viewer and never written to the doc.

import css from "./styles.css?inline";
import { updateText } from "@automerge/automerge";
import { createEditor } from "./editor.js";
import { tryCompile, toGLSL, GLSL_HELPERS, BUILTINS, GROUP_LABELS, signature } from "./lang/index.js";
import { EXAMPLES, exampleFor } from "./examples.js";
import { boundsProblem, normalizeBounds } from "./doc.js";
import { createRaymarcher } from "./preview/raymarcher.js";
import { MODES } from "./preview/shader.js";
import { frameBounds, orbit, pan, zoom } from "./preview/camera.js";
import { readThemeColors } from "./preview/theme-colors.js";

const STYLE_ID = "implicit-surface-styles";
let styleUsers = 0;
function mountStyles() {
  styleUsers++;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.append(style);
}
function unmountStyles() {
  if (--styleUsers > 0) return;
  document.getElementById(STYLE_ID)?.remove();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function referenceHTML() {
  const groups = {};
  for (const [name, b] of Object.entries(BUILTINS)) (groups[b.group] ??= []).push(name);
  return Object.entries(GROUP_LABELS)
    .filter(([g]) => groups[g])
    .map(
      ([g, label]) => `
      <section class="ref-group">
        <h3>${esc(label)}</h3>
        <ul>${groups[g]
          .map(
            (n) => `<li><button type="button" class="ref-item" data-insert="${esc(n)}(" title="Insert ${esc(n)}(…)">
              <code>${esc(signature(n))}</code><span>${esc(BUILTINS[n].doc)}</span></button></li>`,
          )
          .join("")}</ul>
      </section>`,
    )
    .join("");
}

const TEMPLATE = `
  <div class="layout">
    <section class="source-pane" aria-label="Source">
      <header class="bar">
        <label class="field">
          <span class="visually-hidden">Examples</span>
          <select class="examples" aria-label="Load an example">
            <option value="">Examples…</option>
            ${EXAMPLES.map((e) => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join("")}
          </select>
        </label>
        <span class="spacer"></span>
        <button type="button" class="button" data-action="reference" aria-expanded="false">Reference</button>
        <button type="button" class="button" data-action="copy-glsl" title="Copy the generated GLSL">Copy GLSL</button>
      </header>
      <div class="editor"></div>
      <button type="button" class="status" data-state="ok" aria-live="polite"></button>
      <div class="reference" hidden>
        <p class="ref-intro">One final expression is the shape: its value at each point (x, y, z) is the signed distance
          to the surface, negative inside. <code>let name = …</code> and <code>let f(a, b) = …</code> define names.
          Y is up; lengths are metres (or write <code>5mm</code>, <code>2cm</code>, <code>1in</code>);
          angles are radians (or <code>30deg</code>). Sizes are full sizes, centred on the origin.</p>
        ${referenceHTML()}
      </div>
      <details class="doc-fields">
        <summary>Bounds &amp; notes</summary>
        <div class="bounds" role="group" aria-label="Bounds in metres">
          <span></span><span class="axis">x</span><span class="axis">y</span><span class="axis">z</span>
          <span class="rowlabel">min</span>
          <input type="number" step="0.01" data-bound="min" data-axis="0" aria-label="min x">
          <input type="number" step="0.01" data-bound="min" data-axis="1" aria-label="min y">
          <input type="number" step="0.01" data-bound="min" data-axis="2" aria-label="min z">
          <span class="rowlabel">max</span>
          <input type="number" step="0.01" data-bound="max" data-axis="0" aria-label="max x">
          <input type="number" step="0.01" data-bound="max" data-axis="1" aria-label="max y">
          <input type="number" step="0.01" data-bound="max" data-axis="2" aria-label="max z">
        </div>
        <p class="bounds-note">Metres. The preview and the mesh are clipped to this box.</p>
        <label class="notes-label">Notes
          <textarea class="notes" rows="3" placeholder="What is this part for?"></textarea>
        </label>
      </details>
    </section>
    <section class="preview-pane" aria-label="Preview">
      <canvas class="stage" tabindex="0" aria-label="Raymarched preview. Drag to orbit, right-drag or shift-drag to pan, scroll to zoom, double-click to reset."></canvas>
      <div class="overlay top">
        <div class="segmented" role="radiogroup" aria-label="View">
          ${MODES.map((m) => `<button type="button" role="radio" data-mode="${m.value}" aria-checked="false">${esc(m.label)}</button>`).join("")}
        </div>
        <label class="slice" hidden>
          <span>Cut at</span>
          <input type="range" class="slice-y" min="0" max="1" step="0.001" aria-label="Slice height">
          <output class="slice-value"></output>
        </label>
      </div>
      <div class="overlay bottom">
        <span class="stats"></span>
        <span class="spacer"></span>
        <button type="button" class="button" data-action="reset-view" title="Reset view (double-click)">Reset view</button>
      </div>
      <div class="message" hidden></div>
    </section>
  </div>
`;

export default function ImplicitSurfaceTool(handle, element) {
  mountStyles();
  const root = document.createElement("div");
  root.className = "implicit-surface";
  root.innerHTML = TEMPLATE;
  element.append(root);

  const $ = (sel) => root.querySelector(sel);
  const statusEl = $(".status");
  const statsEl = $(".stats");
  const messageEl = $(".message");
  const canvas = $(".stage");
  const referenceEl = $(".reference");
  const sliceLabel = $(".slice");
  const sliceInput = $(".slice-y");
  const sliceValue = $(".slice-value");
  const notesEl = $(".notes");
  const examplesEl = $(".examples");

  // automerge-codemirror needs a text at ["source"]; repair a doc that lacks one
  if (typeof handle.doc()?.source !== "string") {
    handle.change((d) => {
      d.source = "";
    });
  }
  const editor = createEditor($(".editor"), handle);

  // ── preview ────────────────────────────────────────────────────────────
  const showMessage = (text) => {
    messageEl.hidden = !text;
    messageEl.textContent = text || "";
  };
  const rm = createRaymarcher(canvas, {
    onContextLost: () => {
      if (!disposed) showMessage("The preview lost its WebGL context (too many 3D views open, or a GPU reset). It will come back when the browser restores it.");
    },
    onContextRestored: (recompiled) => {
      if (disposed) return;
      showMessage("Restoring the preview…");
      recompiled.then((r) => {
        if (disposed || r.superseded) return;
        showMessage(r.ok ? "" : `The preview couldn't be restored: ${String(r.error ?? "").split("\n")[0]}`);
        requestRender();
      });
    },
  });
  let camera = null;
  let bounds = normalizeBounds(handle.doc()?.bounds);
  let raf = 0;
  let idleTimer = 0;
  let disposed = false;
  if (!rm) showMessage("This browser can't run WebGL2, so there is no live preview. The source still compiles and meshes for the Scene.");

  function requestRender(interactive = false) {
    if (!rm || disposed) return;
    rm.state.scale = interactive ? 0.5 : 1;
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        rm.state.camera = camera;
        rm.render();
      });
    clearTimeout(idleTimer);
    if (interactive) idleTimer = setTimeout(() => requestRender(false), 180);
  }

  function applyTheme() {
    if (!rm) return;
    rm.state.colors = readThemeColors(root);
    requestRender();
  }

  function resetView() {
    camera = frameBounds(bounds);
    requestRender();
  }

  function setMode(m) {
    if (rm) rm.state.mode = m;
    for (const b of root.querySelectorAll("[data-mode]")) b.setAttribute("aria-checked", String(Number(b.dataset.mode) === m));
    sliceLabel.hidden = m !== 4;
    requestRender();
  }

  let sliceFrac = 0.5;
  function updateSlice() {
    const y = bounds.min[1] + (bounds.max[1] - bounds.min[1]) * sliceFrac;
    if (rm) rm.state.sliceY = y;
    sliceInput.value = String(sliceFrac);
    sliceValue.textContent = `${(y * 1000).toFixed(0)} mm`;
    requestRender();
  }

  // ── compile loop ───────────────────────────────────────────────────────
  let lastSource = null;
  let lastGLSL = "";
  let compileTimer = 0;
  let statusTarget = null;

  function setStatus(state, text, target = null) {
    statusEl.dataset.state = state;
    statusEl.textContent = text;
    statusTarget = target;
    statusEl.disabled = !target;
  }

  async function recompile() {
    const doc = handle.doc();
    const source = String(doc?.source ?? "");
    if (source === lastSource) return;
    lastSource = source;
    const result = tryCompile(source);
    if (!result.ok) {
      const e = result.error;
      editor.setDiagnostics([{ start: e.start, end: e.end, severity: "error", message: e.message }]);
      setStatus("error", `Line ${e.line}, col ${e.col}: ${e.message}${rm?.ready ? " — showing the last good version." : ""}`, e);
      return;
    }
    editor.setDiagnostics(result.warnings.map((w) => ({ start: w.start, end: w.end, severity: "warning", message: w.message })));
    const ops = result.ir.count;
    const warn = result.warnings[0];
    if (!rm) {
      setStatus(warn ? "warning" : "ok", warn ? `Line ${warn.line}: ${warn.message}` : `${ops} operations.`, warn ?? null);
      return;
    }
    const glsl = toGLSL(result.ir, "isf_user");
    lastGLSL = `// generated by implicit-surface from the IR\n${GLSL_HELPERS}\n${glsl}\n`;
    setStatus("busy", `Compiling ${ops} operations…`);
    const r = await rm.setField(glsl);
    if (disposed || r.superseded) return;
    if (!r.ok) {
      setStatus("error", `The GPU rejected the shader: ${String(r.error).split("\n")[0]}`);
      console.warn("[implicit-surface] shader error\n", r.error);
      return;
    }
    if (warn) setStatus("warning", `Line ${warn.line}: ${warn.message}`, warn);
    else setStatus("ok", `${ops} operations · shader ready in ${Math.round(r.ms)} ms`);
    statsEl.textContent = `${ops} ops`;
    requestRender();
  }

  function scheduleCompile() {
    clearTimeout(compileTimer);
    compileTimer = setTimeout(recompile, 120);
  }

  // ── doc fields ─────────────────────────────────────────────────────────
  function syncFields() {
    const doc = handle.doc() ?? {};
    const b = doc.bounds;
    for (const input of root.querySelectorAll("[data-bound]")) {
      if (input === document.activeElement) continue;
      const v = b?.[input.dataset.bound]?.[Number(input.dataset.axis)];
      input.value = v == null ? "" : String(v);
    }
    const problem = boundsProblem(b);
    root.querySelector(".bounds-note").textContent = problem ?? "Metres. The preview and the mesh are clipped to this box.";
    root.querySelector(".bounds-note").dataset.state = problem ? "error" : "ok";
    if (notesEl !== document.activeElement) notesEl.value = String(doc.notes ?? "");
    const next = normalizeBounds(b);
    if (JSON.stringify(next) !== JSON.stringify(bounds)) {
      bounds = next;
      if (rm) rm.state.bounds = bounds;
      updateSlice();
    }
  }

  const onDocChange = () => {
    syncFields();
    scheduleCompile();
  };
  handle.on("change", onDocChange);

  // ── events ─────────────────────────────────────────────────────────────
  const onClick = (e) => {
    const t = e.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.dataset.mode != null) return setMode(Number(t.dataset.mode));
    if (t.dataset.insert) return editor.insert(t.dataset.insert);
    if (t === statusEl && statusTarget) return editor.select(statusTarget.start, statusTarget.end);
    switch (t.dataset.action) {
      case "reference": {
        referenceEl.hidden = !referenceEl.hidden;
        t.setAttribute("aria-expanded", String(!referenceEl.hidden));
        return;
      }
      case "reset-view":
        return resetView();
      case "copy-glsl": {
        const text = lastGLSL || "// nothing compiled yet";
        navigator.clipboard?.writeText(text).then(
          () => setStatus(statusEl.dataset.state === "error" ? "error" : "ok", "Copied the generated GLSL to the clipboard."),
          () => setStatus("warning", "Couldn't reach the clipboard."),
        );
        return;
      }
    }
  };
  root.addEventListener("click", onClick);

  examplesEl.addEventListener("change", () => {
    const ex = EXAMPLES.find((x) => x.id === examplesEl.value);
    examplesEl.value = "";
    if (!ex) return;
    const doc = handle.doc() ?? {};
    const current = String(doc.source ?? "");
    if (current.trim() && !exampleFor(current) && !window.confirm(`Replace the current source with “${ex.title}”?`)) return;
    handle.change((d) => {
      if (typeof d.source === "string") updateText(d, ["source"], ex.source);
      else d.source = ex.source;
      d.bounds = { min: [...ex.bounds.min], max: [...ex.bounds.max] };
      const title = String(d.title ?? "");
      if (!title || title === "Implicit surface" || EXAMPLES.some((x) => x.title === title)) d.title = ex.title;
    });
    bounds = normalizeBounds(ex.bounds);
    if (rm) rm.state.bounds = bounds;
    updateSlice();
    resetView();
  });

  for (const input of root.querySelectorAll("[data-bound]")) {
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      const key = input.dataset.bound;
      const axis = Number(input.dataset.axis);
      handle.change((d) => {
        if (!d.bounds || !Array.isArray(d.bounds.min) || !Array.isArray(d.bounds.max)) d.bounds = normalizeBounds(d.bounds);
        d.bounds[key][axis] = v;
      });
    });
  }

  // notes are written 250 ms after the last keystroke, and at once on blur
  // or unmount so the last few characters are never dropped
  let notesTimer = 0;
  function flushNotes() {
    if (!notesTimer) return;
    clearTimeout(notesTimer);
    notesTimer = 0;
    const value = notesEl.value;
    handle.change((d) => {
      if (typeof d.notes === "string") updateText(d, ["notes"], value);
      else d.notes = value;
    });
  }
  notesEl.addEventListener("input", () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(flushNotes, 250);
  });
  notesEl.addEventListener("blur", flushNotes);

  sliceInput.addEventListener("input", () => {
    sliceFrac = Number(sliceInput.value);
    updateSlice();
  });

  // camera: drag to orbit, right/shift-drag to pan, wheel/pinch to zoom
  const pointers = new Map();
  let pinchStart = null;
  const onPointerDown = (e) => {
    if (!camera) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: camera.dist };
    }
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !camera) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) camera = { ...camera, dist: pinchStart.dist * (pinchStart.d / d) };
    } else if (p.button === 2 || p.button === 1 || p.shift || e.shiftKey) {
      camera = pan(camera, dx, dy, canvas.clientHeight);
    } else {
      camera = orbit(camera, dx, dy);
    }
    requestRender(true);
  };
  const onPointerUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    requestRender(false);
  };
  const onWheel = (e) => {
    if (!camera) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 0.05 : 0.0015;
    camera = zoom(camera, Math.exp(e.deltaY * scale));
    requestRender(true);
  };
  const onContextMenu = (e) => e.preventDefault();
  const onDblClick = () => resetView();
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("dblclick", onDblClick);

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => requestRender(false)) : null;
  resizeObserver?.observe(canvas);

  // re-read theme colours when the theme attribute changes
  const themeObserver =
    typeof MutationObserver !== "undefined" ? new MutationObserver(() => applyTheme()) : null;
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["theme", "class", "style", "data-theme"] });

  // ── go ─────────────────────────────────────────────────────────────────
  if (rm) rm.state.bounds = bounds;
  syncFields();
  resetView();
  updateSlice();
  setMode(0);
  applyTheme();
  recompile();

  return () => {
    disposed = true;
    handle.off("change", onDocChange);
    clearTimeout(compileTimer);
    clearTimeout(idleTimer);
    flushNotes();
    if (raf) cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    root.removeEventListener("click", onClick);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("dblclick", onDblClick);
    editor.destroy();
    rm?.dispose();
    root.remove();
    unmountStyles();
  };
}
