/**
 * Sparse Projection - Bundleless Patchwork Tool
 *
 * Prototype 1: Manual Sparse Projection. Use a projector as a second monitor
 * showing an almost-entirely-black fullscreen page, drawing only a few small
 * bright "islands" (outlined boxes / labels) at chosen positions so only
 * selected parts of a physical surface receive light.
 *
 * Island geometry is stored as fractions (0-1) of the projection surface so the
 * same layout lands in the same physical spot regardless of the rendering
 * window's resolution. Positions live in the automerge doc, so you can
 * drag/resize the islands from your laptop while the projector window (a second
 * view of the same doc) updates live, and a calibrated layout persists.
 *
 * @typedef {Object} Island
 * @property {string} id
 * @property {string} label    - optional text drawn centered in the box
 * @property {number} left      - fraction 0-1 of stage width
 * @property {number} top       - fraction 0-1 of stage height
 * @property {number} width     - fraction 0-1 of stage width
 * @property {number} height    - fraction 0-1 of stage height
 *
 * @typedef {Object} SparseProjectionDoc
 * @property {string} title
 * @property {Island[]} islands
 * @property {boolean} showLabels
 */

// ============================================================================
// Datatype
// ============================================================================

// Bump this whenever the tool code changes so you can confirm at a glance that
// the running build is the latest one (shown in the top-right version badge).
const VERSION = "0.0.6";

export const SparseProjectionDatatype = {
  init(doc) {
    doc.title = "Sparse Projection";
    doc.showLabels = true;
    doc.showFrame = true;
    doc.islands = [
      {
        id: "island-1",
        label: "A",
        left: 0.12,
        top: 0.15,
        width: 0.18,
        height: 0.14,
      },
      {
        id: "island-2",
        label: "B",
        left: 0.42,
        top: 0.45,
        width: 0.16,
        height: 0.12,
      },
      {
        id: "island-3",
        label: "C",
        left: 0.7,
        top: 0.2,
        width: 0.18,
        height: 0.16,
      },
    ];
  },

  getTitle(doc) {
    return doc.title || "Sparse Projection";
  },

  setTitle(doc, title) {
    doc.title = title;
  },

  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ============================================================================
// Helpers
// ============================================================================

function nextIslandId(islands) {
  // Deterministic incrementing id derived from existing ids (no Math.random).
  let max = 0;
  for (const isl of islands) {
    const m = /^island-(\d+)$/.exec(isl.id || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return "island-" + (max + 1);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function createStyles() {
  const style = document.createElement("style");
  style.textContent = `
    @layer package {
      :root,
      :host,
      [theme] {
        --sparse-proj-bar-bg: var(--studio-fill, white);
        --sparse-proj-bar-fg: var(--studio-line, black);
        --sparse-proj-bar-border: var(--studio-fill-offset-20, #ccc);
        --sparse-proj-bar-muted: var(--studio-line-offset-50, #888);
        --sparse-proj-accent: var(--studio-primary, #35f7ca);
        --sparse-proj-danger: var(--studio-danger, #e5484d);
        --sparse-proj-family: var(--studio-family-sans, system-ui, sans-serif);
      }
    }

    .sparse-proj {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      overflow: hidden;
      font-family: var(--sparse-proj-family);
    }

    /* The projection stage. Literal black and white are a deliberate exception
       to the "derive colors from the theme" rule: the projector surface must be
       true black with bright-white islands regardless of the active theme. */
    .sparse-proj .stage {
      position: absolute;
      inset: 0;
      background: #000;
    }

    /* Project mode hides the cursor only when explicitly opted in, so by
       default you can see where you're pointing on the projected surface. */
    .sparse-proj[data-mode="project"][data-hide-cursor] .stage {
      cursor: none;
    }

    /* Full-screen frame outline. A fixed chrome element (not an island) so it
       appears on every doc and can't be accidentally lost. Inset slightly so
       its white border is fully inside the stage rather than clipped. White is
       intentional, same projector-surface exception as the islands. */
    .sparse-proj .frame {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid #fff;
      background: transparent;
      pointer-events: none;
    }

    /* Version badge, top-right. Themed chrome; hidden in project mode so it is
       never projected. */
    .sparse-proj .version-badge {
      position: absolute;
      top: var(--studio-space-xs, 0.375rem);
      right: var(--studio-space-xs, 0.375rem);
      z-index: 10;
      padding: 0.15rem 0.4rem;
      font: 500 0.7rem/1 var(--sparse-proj-family);
      color: var(--sparse-proj-bar-muted);
      background: color-mix(in oklch, var(--sparse-proj-bar-bg), transparent 15%);
      border: 1px solid var(--sparse-proj-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      pointer-events: none;
      user-select: none;
    }
    .sparse-proj[data-mode="project"] .version-badge {
      display: none;
    }

    /* Minimal "Edit" affordance shown in project mode so you can re-open the
       controls without leaving fullscreen. Kept small and faint so it barely
       adds light to the projection; brightens on hover. */
    .sparse-proj .exit-project {
      position: absolute;
      top: var(--studio-space-xs, 0.375rem);
      left: var(--studio-space-xs, 0.375rem);
      z-index: 10;
      opacity: 0.25;
      transition: opacity var(--studio-transition-fast, 0.1s ease);
    }
    .sparse-proj .exit-project:hover {
      opacity: 1;
    }

    .sparse-proj .island {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid #fff;
      background: transparent;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font: 600 1rem/1 var(--sparse-proj-family);
      user-select: none;
    }

    .sparse-proj[data-mode="edit"] .island {
      cursor: move;
      touch-action: none;
    }

    .sparse-proj[data-mode="edit"] .island[data-selected] {
      border-color: var(--sparse-proj-accent);
      box-shadow: 0 0 0 1px var(--sparse-proj-accent);
    }

    .sparse-proj .island .resize-handle {
      position: absolute;
      right: -6px;
      bottom: -6px;
      width: 12px;
      height: 12px;
      background: var(--sparse-proj-accent);
      border-radius: 2px;
      cursor: nwse-resize;
      touch-action: none;
    }
    .sparse-proj[data-mode="project"] .island .resize-handle {
      display: none;
    }

    /* Control bar — themed chrome. Hidden in project mode and fullscreen. */
    .sparse-proj .control-bar {
      position: absolute;
      top: var(--studio-space-sm, 0.5rem);
      left: var(--studio-space-sm, 0.5rem);
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--studio-space-xs, 0.375rem);
      padding: var(--studio-space-xs, 0.375rem);
      background: var(--sparse-proj-bar-bg);
      color: var(--sparse-proj-bar-fg);
      border: 1px solid var(--sparse-proj-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      box-shadow: var(--studio-shadow-sm, 0 1px 3px rgba(0,0,0,0.2));
      max-width: calc(100% - 1rem);
    }

    .sparse-proj[data-mode="project"] .control-bar {
      display: none;
    }

    .sparse-proj button {
      font: inherit;
      font-size: 0.85rem;
      padding: 0.3rem 0.6rem;
      background: var(--sparse-proj-bar-bg);
      color: var(--sparse-proj-bar-fg);
      border: 1px solid var(--sparse-proj-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
      cursor: pointer;
    }
    .sparse-proj button:hover {
      background: color-mix(in oklch, var(--sparse-proj-bar-bg), var(--sparse-proj-bar-fg) 6%);
    }
    .sparse-proj button[data-variant="primary"] {
      border-color: var(--sparse-proj-accent);
    }
    .sparse-proj button[data-variant="danger"] {
      color: var(--sparse-proj-danger);
      border-color: color-mix(in oklch, var(--sparse-proj-danger), transparent 50%);
    }
    .sparse-proj button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .sparse-proj .label-input {
      font: inherit;
      font-size: 0.85rem;
      padding: 0.3rem 0.5rem;
      width: 8rem;
      background: var(--sparse-proj-bar-bg);
      color: var(--sparse-proj-bar-fg);
      border: 1px solid var(--sparse-proj-bar-border);
      border-radius: var(--studio-radius-sm, 4px);
    }

    .sparse-proj .control-bar label {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.85rem;
      color: var(--sparse-proj-bar-muted);
    }

    .sparse-proj .control-bar .sep {
      width: 1px;
      align-self: stretch;
      background: var(--sparse-proj-bar-border);
      margin: 0 0.15rem;
    }
  `;
  return style;
}

// ============================================================================
// Tool
// ============================================================================

export function Tool(handle, element) {
  const style = createStyles();
  element.appendChild(style);

  // Make the host element the positioning context and a definite-size box, so
  // .sparse-proj (position:absolute; inset:0) fills exactly the visible host
  // area. Without this the stage can overflow an unsized host and push the
  // frame's right/bottom borders out of view. Record prior values to restore.
  const prevPosition = element.style.position;
  const prevHeight = element.style.height;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  if (!element.style.height) {
    element.style.height = "100%";
  }

  const root = document.createElement("div");
  root.className = "sparse-proj";
  element.appendChild(root);

  // Local (non-persisted) UI state.
  let mode = "edit"; // "edit" | "project"
  let selectedId = null;
  let renderCount = 0; // bumps on every render; shown in the version badge

  function render() {
    const doc = handle.doc();
    if (!doc) return;

    renderCount++;
    root.setAttribute("data-mode", mode);
    if (doc.hideCursor) root.setAttribute("data-hide-cursor", "");
    else root.removeAttribute("data-hide-cursor");
    root.innerHTML = "";

    const stage = document.createElement("div");
    stage.className = "stage";
    root.appendChild(stage);

    const islands = doc.islands || [];
    if (selectedId && !islands.some((i) => i.id === selectedId)) {
      selectedId = null;
    }

    for (const isl of islands) {
      stage.appendChild(buildIsland(isl, stage, doc));
    }

    // Full-screen frame outline (default on for docs without the field set).
    if (doc.showFrame !== false) {
      const frame = document.createElement("div");
      frame.className = "frame";
      stage.appendChild(frame);
    }

    // Version badge, top-right — updates on every change via renderCount.
    const badge = document.createElement("div");
    badge.className = "version-badge";
    badge.textContent = `v${VERSION} · #${renderCount}`;
    root.appendChild(badge);

    if (mode === "edit") {
      // Clicking empty stage deselects.
      stage.addEventListener("pointerdown", (e) => {
        if (e.target === stage) selectIsland(null);
      });
      const bar = document.createElement("div");
      bar.className = "control-bar";
      root.appendChild(bar);
      refreshControlBar(doc, islands, bar);
    } else {
      // Project mode: clean black-only view. Show a single small "Edit" button
      // so you can return to full controls without leaving fullscreen.
      const exitBtn = button("Edit", () => {
        mode = "edit";
        render();
      });
      exitBtn.className = "exit-project";
      root.appendChild(exitBtn);
    }
  }

  // Update the selection surgically (without a full re-render, so an in-flight
  // drag/resize gesture keeps its pointer capture). Refreshes the data-selected
  // outlines and the control bar's selection-dependent state.
  function selectIsland(id) {
    if (selectedId === id) return;
    selectedId = id;
    syncSelectionUI();
  }

  function syncSelectionUI() {
    for (const el of root.querySelectorAll(".island")) {
      if (el.dataset.islandId === selectedId)
        el.setAttribute("data-selected", "");
      else el.removeAttribute("data-selected");
    }
    const doc = handle.doc();
    const bar = root.querySelector(".control-bar");
    if (doc && bar) refreshControlBar(doc, doc.islands || [], bar);
  }

  function buildIsland(isl, stage, doc) {
    const el = document.createElement("div");
    el.className = "island";
    el.dataset.islandId = isl.id;
    el.style.left = isl.left * 100 + "%";
    el.style.top = isl.top * 100 + "%";
    el.style.width = isl.width * 100 + "%";
    el.style.height = isl.height * 100 + "%";
    if (selectedId === isl.id) el.setAttribute("data-selected", "");
    if (doc.showLabels && isl.label) el.textContent = isl.label;

    if (mode === "edit") {
      el.addEventListener("pointerdown", (e) => {
        // Ignore if the resize handle started the gesture.
        if (e.target.classList.contains("resize-handle")) return;
        e.stopPropagation();
        selectIsland(isl.id);
        startDrag(e, isl, stage, el);
      });

      const handleEl = document.createElement("div");
      handleEl.className = "resize-handle";
      handleEl.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        selectIsland(isl.id);
        startResize(e, isl, stage, el);
      });
      el.appendChild(handleEl);
    }

    return el;
  }

  function startDrag(e, isl, stage, el) {
    const rect = stage.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origLeft = isl.left;
    const origTop = isl.top;
    let cur = { left: origLeft, top: origTop };

    function onMove(ev) {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      cur.left = clamp01(origLeft + dx);
      cur.top = clamp01(origTop + dy);
      // Keep the box from sliding off the right/bottom edges.
      cur.left = Math.min(cur.left, 1 - isl.width);
      cur.top = Math.min(cur.top, 1 - isl.height);
      el.style.left = cur.left * 100 + "%";
      el.style.top = cur.top * 100 + "%";
    }

    function onUp(ev) {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      handle.change((d) => {
        const target = d.islands.find((i) => i.id === isl.id);
        if (target) {
          target.left = cur.left;
          target.top = cur.top;
        }
      });
    }

    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }

  function startResize(e, isl, stage, el) {
    const rect = stage.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = isl.width;
    const origH = isl.height;
    const MIN = 0.02;
    let cur = { width: origW, height: origH };

    function onMove(ev) {
      const dw = (ev.clientX - startX) / rect.width;
      const dh = (ev.clientY - startY) / rect.height;
      cur.width = Math.max(MIN, Math.min(origW + dw, 1 - isl.left));
      cur.height = Math.max(MIN, Math.min(origH + dh, 1 - isl.top));
      el.style.width = cur.width * 100 + "%";
      el.style.height = cur.height * 100 + "%";
    }

    function onUp(ev) {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      handle.change((d) => {
        const target = d.islands.find((i) => i.id === isl.id);
        if (target) {
          target.width = cur.width;
          target.height = cur.height;
        }
      });
    }

    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }

  function refreshControlBar(doc, islands, bar) {
    bar.innerHTML = "";

    const projectBtn = button("Project", () => {
      mode = "project";
      render();
    });
    bar.appendChild(projectBtn);

    const fsBtn = button("Fullscreen", enterFullscreen);
    bar.appendChild(fsBtn);

    bar.appendChild(sep());

    const addBtn = button("+ Island", () => {
      handle.change((d) => {
        const id = nextIslandId(d.islands);
        d.islands.push({
          id,
          label: "",
          left: 0.4,
          top: 0.4,
          width: 0.16,
          height: 0.12,
        });
        selectedId = id;
      });
    });
    addBtn.setAttribute("data-variant", "primary");
    bar.appendChild(addBtn);

    const selected = islands.find((i) => i.id === selectedId) || null;

    const labelInput = document.createElement("input");
    labelInput.className = "label-input";
    labelInput.type = "text";
    labelInput.placeholder = selected ? "Label…" : "Select an island";
    labelInput.value = selected ? selected.label : "";
    labelInput.disabled = !selected;
    labelInput.addEventListener("input", () => {
      if (!selected) return;
      const value = labelInput.value;
      handle.change((d) => {
        const t = d.islands.find((i) => i.id === selected.id);
        if (t) t.label = value;
      });
    });
    bar.appendChild(labelInput);

    const delBtn = button("Delete", () => {
      if (!selectedId) return;
      const id = selectedId;
      selectedId = null;
      handle.change((d) => {
        const idx = d.islands.findIndex((i) => i.id === id);
        if (idx !== -1) d.islands.splice(idx, 1);
      });
    });
    delBtn.setAttribute("data-variant", "danger");
    delBtn.disabled = !selected;
    bar.appendChild(delBtn);

    bar.appendChild(sep());

    const labelsLabel = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!doc.showLabels;
    cb.addEventListener("change", () => {
      const checked = cb.checked;
      handle.change((d) => {
        d.showLabels = checked;
      });
    });
    labelsLabel.append(cb, document.createTextNode("Labels"));
    bar.appendChild(labelsLabel);

    const frameLabel = document.createElement("label");
    const frameCb = document.createElement("input");
    frameCb.type = "checkbox";
    frameCb.checked = doc.showFrame !== false;
    frameCb.addEventListener("change", () => {
      const checked = frameCb.checked;
      handle.change((d) => {
        d.showFrame = checked;
      });
    });
    frameLabel.append(frameCb, document.createTextNode("Frame"));
    bar.appendChild(frameLabel);

    const cursorLabel = document.createElement("label");
    const cursorCb = document.createElement("input");
    cursorCb.type = "checkbox";
    cursorCb.checked = !!doc.hideCursor;
    cursorCb.addEventListener("change", () => {
      const checked = cursorCb.checked;
      handle.change((d) => {
        d.hideCursor = checked;
      });
    });
    cursorLabel.append(cursorCb, document.createTextNode("Hide cursor"));
    bar.appendChild(cursorLabel);
  }

  function enterFullscreen() {
    // Fullscreen the host element so the projector's second-monitor window goes
    // edge-to-edge. Stay in whatever mode we're in (edit by default) so the
    // islands remain interactive and the control bar stays available — you can
    // move/add/delete islands directly on the projected surface. Use the
    // Project toggle (or Escape) to collapse to the clean black-only view.
    const target = element;
    if (target.requestFullscreen) {
      target.requestFullscreen().catch(() => {});
    }
  }

  function button(text, onClick) {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function sep() {
    const s = document.createElement("div");
    s.className = "sep";
    return s;
  }

  // Pressing Escape leaves project mode (in addition to exiting fullscreen).
  function onKeyDown(e) {
    if (
      e.key === "Escape" &&
      mode === "project" &&
      !document.fullscreenElement
    ) {
      mode = "edit";
      render();
    }
  }

  function onFullscreenChange() {
    // When the user exits fullscreen (Esc / OS), drop back to edit mode so the
    // controls return.
    if (!document.fullscreenElement && mode === "project") {
      mode = "edit";
      render();
    }
  }

  render();
  handle.on("change", render);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("fullscreenchange", onFullscreenChange);

  return () => {
    handle.off("change", render);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    if (document.fullscreenElement === element) {
      document.exitFullscreen?.().catch(() => {});
    }
    element.style.position = prevPosition;
    element.style.height = prevHeight;
    root.remove();
    style.remove();
  };
}

// ============================================================================
// Plugin Exports
// ============================================================================

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "sparse-projection",
    name: "Sparse Projection",
    icon: "Projector",
    async load() {
      return SparseProjectionDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "sparse-projection",
    name: "Sparse Projection",
    icon: "Projector",
    supportedDatatypes: ["sparse-projection"],
    async load() {
      return Tool;
    },
  },
];
