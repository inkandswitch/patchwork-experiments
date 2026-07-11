/**
 * PatternWitch — a pixel painter for Patchwork (bundleless, vanilla JS)
 *
 * @typedef {Object} PatternWitchDoc
 * @property {string}   title
 * @property {number}   height   - number of rows
 * @property {number}   width    - number of columns
 * @property {number[][]} pixels - rows of palette indices
 * @property {string[]} palette  - hex colours, 2..6 entries
 */

// ============================================================================
// Datatype
// ============================================================================

const DEFAULT_PALETTE = ["#f4f1de", "#e07a5f", "#3d405b", "#81b29a"];
const DEFAULT_SIZE = 50;
const MIN_SIZE = 4;
const MAX_SIZE = 200;
const MIN_COLORS = 2;
const MAX_COLORS = 6;

function makePixels(width, height, fill = 0) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => fill),
  );
}

export const PatternWitchDatatype = {
  init(doc) {
    doc.title = "PatternWitch";
    doc.width = DEFAULT_SIZE;
    doc.height = DEFAULT_SIZE;
    doc.palette = [...DEFAULT_PALETTE];
    doc.pixels = makePixels(DEFAULT_SIZE, DEFAULT_SIZE, 0);
  },
  getTitle(doc) {
    return doc.title || "PatternWitch";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ============================================================================
// Styles
// ============================================================================

function createStyles() {
  const style = document.createElement("style");
  style.textContent = `
@layer package {
  :root, :host, [theme] {
    --pw-bg: var(--editor-fill, #fff);
    --pw-fg: var(--editor-line, #1a1a1a);
    --pw-muted: var(--editor-line-offset-50, #888);
    --pw-panel: color-mix(in oklch, var(--editor-fill), var(--editor-line) 4%);
    --pw-border: var(--editor-fill-offset-20, #ddd);
    --pw-hover: color-mix(in oklch, var(--editor-fill), var(--editor-line) 8%);
    --pw-accent: var(--studio-primary, #35f7ca);
    --pw-danger: var(--studio-danger, #e5484d);
    --pw-family: var(--editor-family-sans, system-ui, sans-serif);
    --pw-shadow: var(--studio-shadow-lg, 0 8px 32px rgba(0,0,0,.18));
  }
}

.pw {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--pw-bg);
  color: var(--pw-fg);
  font-family: var(--pw-family);
  box-sizing: border-box;
  overflow: hidden;
  user-select: none;
}
.pw * { box-sizing: border-box; }

/* Toolbar */
.pw .toolbar {
  display: flex;
  align-items: center;
  gap: var(--studio-space-2xs, 4px);
  padding: var(--studio-space-xs, 8px) var(--studio-space-sm, 12px);
  border-bottom: 1px solid var(--pw-border);
}
.pw .tool-group {
  display: flex;
  align-items: center;
  gap: var(--studio-space-2xs, 4px);
}
.pw .spacer { flex: 1; }

.pw .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  min-width: 34px;
  padding: 0 10px;
  border: 1px solid var(--pw-border);
  border-radius: var(--studio-radius-sm, 6px);
  background: var(--pw-bg);
  color: var(--pw-fg);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--studio-transition-fast, .1s ease),
              border-color var(--studio-transition-fast, .1s ease);
}
.pw .btn:hover { background: var(--pw-hover); }
.pw .btn svg { width: 17px; height: 17px; display: block; }
.pw .btn[data-active] {
  border-color: var(--pw-accent);
  background: color-mix(in oklch, var(--pw-accent), var(--editor-fill) 78%);
}
.pw .btn[data-danger]:hover {
  border-color: var(--pw-danger);
  color: var(--pw-danger);
}

/* Palette strip */
.pw .palette {
  display: flex;
  align-items: center;
  gap: var(--studio-space-2xs, 6px);
  padding: var(--studio-space-xs, 8px) var(--studio-space-sm, 12px);
  border-bottom: 1px solid var(--pw-border);
  flex-wrap: wrap;
}
.pw .swatch {
  width: 30px;
  height: 30px;
  border-radius: var(--studio-radius-round, 9999px);
  border: 2px solid var(--pw-border);
  cursor: pointer;
  padding: 0;
  transition: transform var(--studio-transition-fast, .1s ease);
  position: relative;
}
.pw .swatch:hover { transform: scale(1.08); }
.pw .swatch[data-active] {
  border-color: var(--pw-fg);
  box-shadow: 0 0 0 2px var(--pw-bg), 0 0 0 4px var(--pw-accent);
}

/* Canvas stage */
.pw .stage {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  overflow: hidden;
  background:
    repeating-conic-gradient(var(--pw-panel) 0% 25%, transparent 0% 50%)
    0 0 / 20px 20px;
}
.pw .canvas-wrap {
  position: relative;
  box-shadow: var(--pw-shadow);
  line-height: 0;
}
.pw canvas {
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  touch-action: none;
  cursor: crosshair;
}
.pw .grid-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, color-mix(in oklch, var(--pw-fg), transparent 88%) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklch, var(--pw-fg), transparent 88%) 1px, transparent 1px);
  opacity: 0;
  transition: opacity var(--studio-transition-fast, .1s ease);
}
.pw .grid-overlay[data-show] { opacity: 1; }

/* Resize grip, bottom-right */
.pw .grip {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 18px;
  height: 18px;
  border-radius: var(--studio-radius-round, 9999px);
  background: var(--pw-bg);
  border: 2px solid var(--pw-accent);
  cursor: nwse-resize;
  box-shadow: var(--studio-shadow-sm, 0 1px 4px rgba(0,0,0,.2));
}
.pw .grip:hover { background: var(--pw-accent); }

.pw .caption {
  position: absolute;
  left: 14px;
  bottom: 8px;
  font-size: 11px;
  letter-spacing: .04em;
  color: var(--pw-muted);
  text-transform: uppercase;
}

/* Settings modal */
.pw .modal-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in oklch, var(--pw-fg), transparent 60%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.pw .modal {
  width: min(380px, 90%);
  max-height: 90%;
  overflow: auto;
  background: var(--pw-bg);
  border: 1px solid var(--pw-border);
  border-radius: var(--studio-radius-lg, 12px);
  box-shadow: var(--pw-shadow);
  padding: var(--studio-space-md, 18px);
}
.pw .modal h2 {
  margin: 0 0 var(--studio-space-sm, 12px);
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.pw .modal h2 svg {
  width: 18px;
  height: 18px;
  flex: none;
}
.pw .modal .section-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--pw-muted);
  margin: var(--studio-space-md, 18px) 0 var(--studio-space-2xs, 6px);
}
.pw .palette-editor {
  display: flex;
  flex-direction: column;
  gap: var(--studio-space-2xs, 6px);
}
.pw .palette-row {
  display: flex;
  align-items: center;
  gap: var(--studio-space-xs, 8px);
}
.pw .palette-row input[type="color"] {
  width: 42px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--pw-border);
  border-radius: var(--studio-radius-sm, 6px);
  background: none;
  cursor: pointer;
}
.pw .palette-row .hex {
  flex: 1;
  font-family: var(--editor-family-code, ui-monospace, monospace);
  font-size: 13px;
  color: var(--pw-muted);
}
.pw .size-row {
  display: flex;
  align-items: center;
  gap: var(--studio-space-sm, 12px);
}
.pw .size-row label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.pw .size-row input[type="number"] {
  width: 68px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--pw-border);
  border-radius: var(--studio-radius-sm, 6px);
  background: var(--pw-bg);
  color: var(--pw-fg);
  font: inherit;
}
.pw .modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--studio-space-2xs, 6px);
  margin-top: var(--studio-space-md, 18px);
}
`;
  return style;
}

// ============================================================================
// Icons (inline lucide-style SVG)
// ============================================================================

const ICONS = {
  pencil: `<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  fill: `<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>`,
  undo: `<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>`,
  trash: `<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  cog: `<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>`,
  plus: `<path d="M12 5v14"/><path d="M5 12h14"/>`,
  x: `<path d="M18 6 6 18"/><path d="M6 6l12 12"/>`,
  grid: `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>`,
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

// ============================================================================
// Tool
// ============================================================================

function PatternWitchTool(handle, element) {
  const root = document.createElement("div");
  root.className = "pw";
  const style = createStyles();
  element.append(style, root);

  // ---- local UI state ----
  let activeColor = 0;
  let activeTool = "draw"; // "draw" | "fill"
  let showSettings = false;
  const history = []; // stack of pixel snapshots for undo (local)
  const HISTORY_MAX = 40;

  // ---- helpers ----
  const getDoc = () => handle.doc();
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function pushHistory() {
    const doc = getDoc();
    history.push(doc.pixels.map((row) => row.slice()));
    if (history.length > HISTORY_MAX) history.shift();
  }

  // Resize the grid, preserving overlapping pixels.
  function resize(newW, newH, record = true) {
    newW = clamp(Math.round(newW), MIN_SIZE, MAX_SIZE);
    newH = clamp(Math.round(newH), MIN_SIZE, MAX_SIZE);
    const doc = getDoc();
    if (newW === doc.width && newH === doc.height) return;
    if (record) pushHistory();
    const old = doc.pixels;
    const next = makePixels(newW, newH, 0);
    for (let y = 0; y < Math.min(newH, doc.height); y++)
      for (let x = 0; x < Math.min(newW, doc.width); x++)
        next[y][x] = old[y][x];
    handle.change((d) => {
      d.width = newW;
      d.height = newH;
      d.pixels = next;
    });
  }

  function floodFill(sx, sy, target) {
    const doc = getDoc();
    const { width, height } = doc;
    const from = doc.pixels[sy][sx];
    if (from === target) return;
    pushHistory();
    const grid = doc.pixels.map((r) => r.slice());
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (grid[y][x] !== from) continue;
      grid[y][x] = target;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    handle.change((d) => {
      d.pixels = grid;
    });
  }

  function undo() {
    if (!history.length) return;
    const prev = history.pop();
    handle.change((d) => {
      d.pixels = prev;
      d.height = prev.length;
      d.width = prev[0].length;
    });
  }

  function clearAll() {
    pushHistory();
    const doc = getDoc();
    handle.change((d) => {
      d.pixels = makePixels(doc.width, doc.height, activeColor);
    });
  }

  // ============================================================
  // Static UI skeleton (built once)
  // ============================================================
  root.innerHTML = `
    <div class="toolbar">
      <div class="tool-group">
        <button class="btn" data-tool="draw" title="Draw">${icon("pencil")}</button>
        <button class="btn" data-tool="fill" title="Fill">${icon("fill")}</button>
      </div>
      <div class="tool-group">
        <button class="btn" data-act="undo" title="Undo">${icon("undo")}</button>
        <button class="btn" data-act="clear" data-danger title="Clear all">${icon("trash")}</button>
      </div>
      <div class="spacer"></div>
      <button class="btn" data-act="settings" title="Settings">${icon("cog")}</button>
    </div>
    <div class="palette"></div>
    <div class="stage">
      <div class="canvas-wrap">
        <canvas></canvas>
        <div class="grid-overlay"></div>
        <div class="grip" title="Drag to resize canvas"></div>
      </div>
      <div class="caption"></div>
    </div>
    <div class="modal-mount"></div>
  `;

  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const wrap = root.querySelector(".canvas-wrap");
  const stage = root.querySelector(".stage");
  const gridOverlay = root.querySelector(".grid-overlay");
  const paletteEl = root.querySelector(".palette");
  const captionEl = root.querySelector(".caption");
  const grip = root.querySelector(".grip");
  const modalMount = root.querySelector(".modal-mount");

  // ============================================================
  // Rendering
  // ============================================================
  function drawCanvas() {
    const doc = getDoc();
    const { width, height, pixels, palette } = doc;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        ctx.fillStyle = palette[pixels[y][x]] || palette[0];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    layout();
  }

  // Fit the canvas display size into the stage, keeping square cells.
  function layout() {
    const doc = getDoc();
    const { width, height } = doc;
    const pad = 56;
    const availW = Math.max(40, stage.clientWidth - pad);
    const availH = Math.max(40, stage.clientHeight - pad);
    const cell = Math.max(1, Math.floor(Math.min(availW / width, availH / height)));
    const dispW = cell * width;
    const dispH = cell * height;
    canvas.style.width = dispW + "px";
    canvas.style.height = dispH + "px";
    gridOverlay.style.backgroundSize = `${cell}px ${cell}px`;
    gridOverlay.toggleAttribute("data-show", cell >= 6);
    captionEl.textContent = `${width} × ${height} px`;
  }

  function renderPalette() {
    const { palette } = getDoc();
    paletteEl.innerHTML = "";
    palette.forEach((hex, i) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = hex;
      b.title = `Colour ${i + 1} (${hex})`;
      if (i === activeColor) b.setAttribute("data-active", "");
      b.addEventListener("click", () => {
        activeColor = i;
        renderPalette();
      });
      paletteEl.append(b);
    });
  }

  function renderToolbar() {
    root.querySelectorAll("[data-tool]").forEach((el) => {
      el.toggleAttribute("data-active", el.dataset.tool === activeTool);
    });
  }

  // ============================================================
  // Painting interaction
  // ============================================================
  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const doc = getDoc();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * doc.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * doc.height);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
    return { x, y };
  }

  let painting = false;
  let strokeRows = null; // Map<y, row array> of pending changes
  let lastCell = null; // last painted cell in the current stroke

  function paintCell(x, y) {
    const doc = getDoc();
    if (!strokeRows.has(y)) strokeRows.set(y, doc.pixels[y].slice());
    const row = strokeRows.get(y);
    if (row[x] === activeColor) return;
    row[x] = activeColor;
    // immediate visual feedback
    ctx.fillStyle = doc.palette[activeColor];
    ctx.fillRect(x, y, 1, 1);
  }

  // Paint a continuous line so fast drags leave no gaps (shapes stay sealed).
  function paintLine(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (true) {
      paintCell(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  function commitStroke() {
    if (!strokeRows || strokeRows.size === 0) {
      strokeRows = null;
      return;
    }
    const rows = strokeRows;
    strokeRows = null;
    handle.change((d) => {
      for (const [y, row] of rows) d.pixels[y] = row;
    });
  }

  canvas.addEventListener("pointerdown", (e) => {
    const c = cellFromEvent(e);
    if (!c) return;
    if (activeTool === "fill") {
      floodFill(c.x, c.y, activeColor);
      return;
    }
    // draw
    painting = true;
    strokeRows = new Map();
    pushHistory();
    canvas.setPointerCapture(e.pointerId);
    paintCell(c.x, c.y);
    lastCell = c;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const c = cellFromEvent(e);
    if (!c) return;
    if (lastCell) paintLine(lastCell.x, lastCell.y, c.x, c.y);
    else paintCell(c.x, c.y);
    lastCell = c;
  });

  function endStroke(e) {
    if (!painting) return;
    painting = false;
    lastCell = null;
    if (e && canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    commitStroke();
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  // ============================================================
  // Toolbar / actions
  // ============================================================
  root.querySelectorAll("[data-tool]").forEach((el) => {
    el.addEventListener("click", () => {
      activeTool = el.dataset.tool;
      renderToolbar();
    });
  });
  root.querySelector('[data-act="undo"]').addEventListener("click", undo);
  root.querySelector('[data-act="clear"]').addEventListener("click", clearAll);
  root.querySelector('[data-act="settings"]').addEventListener("click", () => {
    showSettings = true;
    renderModal();
  });

  // ============================================================
  // Resize grip (bottom-left)
  // ============================================================
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const doc = getDoc();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = doc.width;
    const startH = doc.height;
    const rect = canvas.getBoundingClientRect();
    const step = Math.max(4, rect.width / doc.width); // px per cell
    grip.setPointerCapture(e.pointerId);
    pushHistory(); // one undo entry for the whole drag

    const onMove = (ev) => {
      // bottom-right: dragging right grows width, dragging down grows height
      const dW = Math.round((ev.clientX - startX) / step);
      const dH = Math.round((ev.clientY - startY) / step);
      resize(startW + dW, startH + dH, false);
    };
    const onUp = (ev) => {
      grip.releasePointerCapture(ev.pointerId);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
  });

  // ============================================================
  // Settings modal
  // ============================================================
  function renderModal() {
    modalMount.innerHTML = "";
    if (!showSettings) return;
    const doc = getDoc();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop) {
        showSettings = false;
        renderModal();
      }
    });

    const paletteRows = doc.palette
      .map(
        (hex, i) => `
      <div class="palette-row" data-i="${i}">
        <input type="color" value="${hex}" />
        <span class="hex">${hex}</span>
        <button class="btn" data-remove data-danger title="Remove colour"
          ${doc.palette.length <= MIN_COLORS ? "disabled style='opacity:.4;cursor:default'" : ""}>
          ${icon("x")}
        </button>
      </div>`,
      )
      .join("");

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <h2>${icon("cog")} Settings</h2>

      <div class="section-label">Palette (${doc.palette.length}/${MAX_COLORS})</div>
      <div class="palette-editor">${paletteRows}</div>
      <button class="btn" data-add style="margin-top:8px"
        ${doc.palette.length >= MAX_COLORS ? "disabled style='opacity:.4;cursor:default;margin-top:8px'" : ""}>
        ${icon("plus")} Add colour
      </button>

      <div class="section-label">Canvas size</div>
      <div class="size-row">
        <label>W <input type="number" data-dim="w" min="${MIN_SIZE}" max="${MAX_SIZE}" value="${doc.width}"/></label>
        <label>H <input type="number" data-dim="h" min="${MIN_SIZE}" max="${MAX_SIZE}" value="${doc.height}"/></label>
        <button class="btn" data-apply-size>${icon("grid")} Apply</button>
      </div>

      <div class="modal-actions">
        <button class="btn" data-close>Done</button>
      </div>
    `;

    // palette colour pickers
    modal.querySelectorAll(".palette-row").forEach((rowEl) => {
      const i = Number(rowEl.dataset.i);
      const input = rowEl.querySelector('input[type="color"]');
      const hexLabel = rowEl.querySelector(".hex");
      input.addEventListener("input", () => {
        hexLabel.textContent = input.value;
        handle.change((d) => {
          d.palette[i] = input.value;
        });
      });
      const rm = rowEl.querySelector("[data-remove]");
      rm.addEventListener("click", () => {
        if (getDoc().palette.length <= MIN_COLORS) return;
        removeColor(i);
        renderModal();
      });
    });

    modal.querySelector("[data-add]").addEventListener("click", () => {
      if (getDoc().palette.length >= MAX_COLORS) return;
      handle.change((d) => {
        d.palette.push("#000000");
      });
      renderModal();
    });

    modal.querySelector("[data-apply-size]").addEventListener("click", () => {
      const w = Number(modal.querySelector('[data-dim="w"]').value);
      const h = Number(modal.querySelector('[data-dim="h"]').value);
      resize(w, h);
    });

    modal.querySelector("[data-close]").addEventListener("click", () => {
      showSettings = false;
      renderModal();
    });

    backdrop.append(modal);
    modalMount.append(backdrop);
  }

  // Remove a palette colour and remap pixels that referenced it.
  function removeColor(index) {
    pushHistory();
    const doc = getDoc();
    handle.change((d) => {
      d.palette.splice(index, 1);
      const max = d.palette.length - 1;
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++) {
          let v = d.pixels[y][x];
          if (v === index) v = 0;
          else if (v > index) v = v - 1;
          d.pixels[y][x] = clamp(v, 0, max);
        }
    });
    if (activeColor >= getDoc().palette.length) activeColor = 0;
  }

  // ============================================================
  // Sync
  // ============================================================
  function render() {
    drawCanvas();
    renderPalette();
    renderToolbar();
    renderModal();
  }
  render();

  const onChange = () => {
    // Don't fight the user's live stroke; canvas is already drawn locally.
    drawCanvas();
    renderPalette();
    if (showSettings) renderModal();
  };
  handle.on("change", onChange);

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);

  return () => {
    handle.off("change", onChange);
    ro.disconnect();
    root.remove();
    style.remove();
  };
}

// ============================================================================
// Plugins
// ============================================================================

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "patternwitch",
    name: "PatternWitch",
    icon: "Grid3x3",
    async load() {
      return PatternWitchDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "patternwitch",
    name: "PatternWitch",
    icon: "Grid3x3",
    supportedDatatypes: ["patternwitch"],
    async load() {
      return PatternWitchTool;
    },
  },
];
