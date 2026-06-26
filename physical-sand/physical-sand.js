/**
 * Physical Sand — a falling-sand tool for physical Patchwork.
 *
 * Sand rains from the top of the box and collides with the WALLS the recognition
 * layer detects (black marker drawings), treating them as physical barriers:
 * draw a U and sand piles inside until it overflows; draw a slanted line and sand
 * pours off it at an angle. It subscribes to `physical:marks` and runs a classic
 * cellular falling-sand simulation on a grid in the box's coordinate space.
 *
 * Marks are rasterized into solid cells every frame, so live drawing changes take
 * effect immediately (erase a mark → sand on it falls; reshape → it resettles).
 * Bottom edge is a floor; left/right are open (grains flowing off disappear).
 * Sand-only rendering — the marks aren't drawn here (the host blacks out the
 * physical drawing). State is ephemeral (Reset / reload clears it).
 *
 * @typedef {Object} PhysicalSandDoc
 * @property {string} title
 */

// ---------------------------------------------------------------------------
// Inlined patchwork-providers `subscribe` (v0.2.x) — dependency-free.
// ---------------------------------------------------------------------------
function subscribe(element, selector, listener) {
  const view = element.closest("patchwork-view");
  const dispatchEl = view ?? element;
  const channel = new MessageChannel();
  const port = channel.port2;
  const controller = new AbortController();
  port.addEventListener(
    "message",
    (event) => {
      if (event.data?.type === "change") listener(event.data.value);
    },
    { signal: controller.signal },
  );
  port.start();
  dispatchEl.dispatchEvent(
    new CustomEvent("patchwork:subscribe", {
      detail: { selector, port: channel.port1 },
      bubbles: true,
      composed: true,
    }),
  );
  return () => {
    if (controller.signal.aborted) return;
    controller.abort();
    port.postMessage({ type: "unsubscribe" });
    port.close();
  };
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const GRID_LONG = 240; // cells along the box's longer edge (higher = finer grains)
const RAIN_RATE = 0.06; // fraction of top-row cells seeded with sand per step
// Sand color (warm). The background is transparent so you see the surface.
const SAND_RGB = [222, 184, 110];

// Cell states.
const EMPTY = 0;
const SAND = 1;

// ---------------------------------------------------------------------------
// Datatype
// ---------------------------------------------------------------------------
export const PhysicalSandDatatype = {
  init(doc) {
    doc.title = "Physical Sand";
  },
  getTitle(doc) {
    return doc.title || "Physical Sand";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc);
  },
};

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------
export function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = `
    .physical-sand {
      position: absolute;
      inset: 0;
      overflow: hidden;
      background: transparent;
      font-family: var(--studio-family-sans, system-ui, sans-serif);
    }
    .physical-sand canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      image-rendering: pixelated;
    }
    .physical-sand .sand-bar {
      position: absolute;
      top: 0.4rem;
      left: 0.4rem;
      z-index: 5;
      display: flex;
      gap: 0.35rem;
      padding: 0.3rem;
      background: var(--studio-fill, white);
      color: var(--studio-line, black);
      border: 1px solid var(--studio-fill-offset-20, #ccc);
      border-radius: var(--studio-radius-sm, 4px);
    }
    .physical-sand .sand-bar button {
      font: inherit; font-size: 0.85rem;
      padding: 0.3rem 0.6rem;
      background: var(--studio-fill, white);
      color: var(--studio-line, black);
      border: 1px solid var(--studio-fill-offset-20, #ccc);
      border-radius: var(--studio-radius-sm, 4px);
      cursor: pointer;
    }
  `;
  element.appendChild(style);

  const prevPosition = element.style.position;
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  const root = document.createElement("div");
  root.className = "physical-sand";
  element.appendChild(root);

  const canvas = document.createElement("canvas");
  root.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // --- grid state ----------------------------------------------------------
  let cols = 0;
  let rows = 0;
  let cells = new Uint8Array(0); // EMPTY | SAND
  let markMask = new Uint8Array(0); // 1 = solid mark
  let img = null; // ImageData for blitting
  let shapes = []; // latest marks
  let running = false;

  function resize() {
    const rect = root.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const long = Math.max(w, h);
    const scale = GRID_LONG / long;
    const nc = Math.max(1, Math.round(w * scale));
    const nr = Math.max(1, Math.round(h * scale));
    if (nc === cols && nr === rows) return;
    // Re-grid, preserving existing sand by nearest-cell copy.
    const old = cells;
    const oldCols = cols;
    const oldRows = rows;
    cols = nc;
    rows = nr;
    cells = new Uint8Array(cols * rows);
    markMask = new Uint8Array(cols * rows);
    if (oldCols && oldRows) {
      for (let y = 0; y < rows; y++) {
        const oy = Math.min(oldRows - 1, Math.floor((y / rows) * oldRows));
        for (let x = 0; x < cols; x++) {
          const ox = Math.min(oldCols - 1, Math.floor((x / cols) * oldCols));
          cells[y * cols + x] = old[oy * oldCols + ox];
        }
      }
    }
    canvas.width = cols;
    canvas.height = rows;
    img = ctx ? ctx.createImageData(cols, rows) : null;
  }

  // --- mark rasterization (scanline fill of each polygon into markMask) ----
  function rebuildMarks() {
    markMask.fill(0);
    for (const shape of shapes) {
      const pts = Array.isArray(shape.points) ? shape.points : [];
      if (pts.length < 3) continue;
      fillPolygon(pts);
    }
  }

  function fillPolygon(pts) {
    // pts are normalized 0..1; work in grid (cell) space.
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const y = p.ny * rows;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(rows - 1, Math.ceil(maxY));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const ay = pts[i].ny * rows;
        const by = pts[j].ny * rows;
        if (ay <= yc ? by > yc : by <= yc) {
          const ax = pts[i].nx * cols;
          const bx = pts[j].nx * cols;
          xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(cols - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) markMask[y * cols + x] = 1;
      }
    }
  }

  // --- simulation step -----------------------------------------------------
  function step() {
    rebuildMarks();

    // Sand can't occupy a mark cell — drop any grain a mark grew into.
    for (let i = 0; i < cells.length; i++) {
      if (markMask[i] && cells[i] === SAND) cells[i] = EMPTY;
    }

    // Seed rain across the whole top row (into empty, non-mark cells).
    for (let x = 0; x < cols; x++) {
      if (cells[x] === EMPTY && !markMask[x] && Math.random() < RAIN_RATE) {
        cells[x] = SAND;
      }
    }

    // Fall update into a fresh buffer (double-buffer avoids moving a grain
    // twice in one step). Scan bottom-up; alternate L/R bias per row.
    const next = new Uint8Array(cells.length);
    // Carry marks? No — `next` holds only sand; marks live in markMask.
    const blocked = (x, y) =>
      x < 0 || x >= cols || y >= rows || markMask[y * cols + x] === 1;
    // A target sand cell is taken if next already has sand there OR the source
    // still has sand there that won't move (approx via next once filled).
    for (let y = rows - 1; y >= 0; y--) {
      const leftFirst = (y & 1) === 0;
      for (let x = 0; x < cols; x++) {
        if (cells[y * cols + x] !== SAND) continue;
        if (markMask[y * cols + x]) continue; // already dropped above, guard anyway

        // Try straight down.
        if (tryMove(next, x, y, x, y + 1, blocked)) continue;
        // Diagonals (biased order per row).
        const dirs = leftFirst
          ? [
              [x - 1, y + 1],
              [x + 1, y + 1],
            ]
          : [
              [x + 1, y + 1],
              [x - 1, y + 1],
            ];
        let moved = false;
        for (const [tx, ty] of dirs) {
          if (tryMove(next, x, y, tx, ty, blocked)) {
            moved = true;
            break;
          }
        }
        if (moved) continue;
        // Couldn't fall or slide → rest in place.
        next[y * cols + x] = SAND;
      }
    }
    cells = next;
  }

  // Move a grain to (tx,ty) in `next` if that target is in-bounds-or-open and
  // not already filled. Moving off the left/right edge (tx out of range, ty in
  // range) removes the grain (open sides). Returns true if it moved/exited.
  function tryMove(next, x, y, tx, ty, blocked) {
    if (ty >= rows) return false; // floor: can't go below the bottom row
    if (tx < 0 || tx >= cols) {
      // Open side: only "exit" diagonally (ty>y) — grain leaves the box.
      return true;
    }
    if (blocked(tx, ty)) return false;
    if (next[ty * cols + tx] === SAND) return false;
    next[ty * cols + tx] = SAND;
    return true;
  }

  // --- render --------------------------------------------------------------
  function render() {
    if (!ctx || !img) return;
    const data = img.data;
    const [r, g, b] = SAND_RGB;
    for (let i = 0, p = 0; i < cells.length; i++, p += 4) {
      if (cells[i] === SAND) {
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      } else {
        data[p + 3] = 0; // transparent (surface shows through)
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // --- loop ----------------------------------------------------------------
  let raf = 0;
  function frame() {
    resize();
    if (running) step();
    else rebuildMarks(); // keep mark state current even when paused
    render();
    raf = requestAnimationFrame(frame);
  }

  // --- controls ------------------------------------------------------------
  const bar = document.createElement("div");
  bar.className = "sand-bar";
  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "Start";
  toggleBtn.onclick = () => {
    running = !running;
    toggleBtn.textContent = running ? "Pause" : "Start";
  };
  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.onclick = () => cells.fill(EMPTY);
  bar.append(toggleBtn, resetBtn);
  root.appendChild(bar);

  // --- wiring --------------------------------------------------------------
  const unsub = subscribe(element, { type: "physical:marks" }, (value) => {
    shapes = (value && value.shapes) || [];
  });

  resize();
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    unsub();
    root.remove();
    style.remove();
    element.style.position = prevPosition;
  };
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "physical-sand",
    name: "Physical Sand",
    icon: "Hourglass",
    async load() {
      return PhysicalSandDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "physical-sand",
    name: "Physical Sand",
    icon: "Hourglass",
    supportedDatatypes: ["physical-sand"],
    async load() {
      return Tool;
    },
  },
];
