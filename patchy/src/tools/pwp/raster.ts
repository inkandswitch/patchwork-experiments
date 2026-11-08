import type { PatchEntry } from "../../layers/index.js";

import { isStroke, type PictureShape, type Shape } from "./shapes.js";

// A layer's shapes become patternwitch pixels: one `["pixels", y, x]` put per
// cell the layer covers, each a palette index. Cells it doesn't cover get no
// entry, so whatever is behind shows through.

/** A grid of palette indices, row by row; -1 where nothing is drawn. */
export type Grid = { width: number; height: number; cells: Int16Array };

export type RGB = [number, number, number];

// How opaque a cell of a drawn shape must be to count as covered.
const COVER = 110;
// Pictures go by their own alpha: half or more.
const PICTURE_COVER = 128;

export function emptyGrid(width: number, height: number): Grid {
  return { width, height, cells: new Int16Array(width * height).fill(-1) };
}

export function parseColour(css: string): RGB {
  let hex = css.trim().replace(/^#/, "");
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex.slice(0, 3)].map((c) => c + c).join("");
  }
  const n = parseInt(hex.slice(0, 6), 16);
  if (hex.length < 6 || Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function nearest(palette: readonly RGB[], r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    // Weighted towards green, the way eyes are.
    const d = 2 * (pr - r) ** 2 + 4 * (pg - g) ** 2 + 3 * (pb - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * An image's pixels as palette indices, -1 where they're mostly transparent.
 * With `dither`, each cell's error is spread to the ones after it
 * (Floyd–Steinberg), so a few colours can stand in for many.
 */
export function quantize(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly RGB[],
  dither: boolean
): Int16Array {
  const out = new Int16Array(width * height).fill(-1);
  const work = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    work[i * 3] = rgba[i * 4];
    work[i * 3 + 1] = rgba[i * 4 + 1];
    work[i * 3 + 2] = rgba[i * 4 + 2];
  }
  const spread = (x: number, y: number, e: number[], k: number) => {
    if (x < 0 || x >= width || y >= height) return;
    const j = y * width + x;
    if (rgba[j * 4 + 3] < PICTURE_COVER) return;
    work[j * 3] += e[0] * k;
    work[j * 3 + 1] += e[1] * k;
    work[j * 3 + 2] += e[2] * k;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (rgba[i * 4 + 3] < PICTURE_COVER) continue;
      const r = work[i * 3], g = work[i * 3 + 1], b = work[i * 3 + 2];
      const index = nearest(palette, r, g, b);
      out[i] = index;
      if (!dither) continue;
      const [pr, pg, pb] = palette[index];
      const e = [r - pr, g - pg, b - pb];
      spread(x + 1, y, e, 7 / 16);
      spread(x - 1, y + 1, e, 3 / 16);
      spread(x, y + 1, e, 5 / 16);
      spread(x + 1, y + 1, e, 1 / 16);
    }
  }
  return out;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function scratch(width: number, height: number): Ctx {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as Ctx | null;
  if (!ctx) throw new Error("[pwp] no 2d canvas to draw layers with");
  return ctx;
}

const bitmaps = new Map<string, Promise<ImageBitmap>>();

/** A picture's image, decoded once per shape. */
export function bitmapOf(s: PictureShape): Promise<ImageBitmap> {
  let p = bitmaps.get(s.id);
  if (!p) {
    p = createImageBitmap(new Blob([s.bytes as BlobPart], { type: s.mime }));
    bitmaps.set(s.id, p);
    p.catch(() => bitmaps.delete(s.id));
  }
  return p;
}

function trace(ctx: Ctx, s: Shape) {
  ctx.beginPath();
  if (isStroke(s)) {
    const p = s.points;
    ctx.moveTo(p[0], p[1]);
    // A single point still makes a dot.
    if (p.length === 2) ctx.lineTo(p[0] + 0.01, p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    return;
  }
  if (s.kind === "rect") {
    const inset = s.fill ? 0 : s.stroke / 2;
    ctx.rect(s.x + inset, s.y + inset, Math.max(0, s.w - 2 * inset), Math.max(0, s.h - 2 * inset));
  } else if (s.kind === "ellipse") {
    const inset = s.fill ? 0 : s.stroke / 2;
    ctx.ellipse(
      s.x + s.w / 2,
      s.y + s.h / 2,
      Math.max(0, s.w / 2 - inset),
      Math.max(0, s.h / 2 - inset),
      0,
      0,
      Math.PI * 2
    );
  }
}

/**
 * Draw `shapes` (back first) onto a `width`×`height` grid of palette indices.
 * Each shape is drawn on its own and laid over the ones before it, so a
 * shape's soft edge never blends with another's.
 */
export async function rasterize(
  shapes: readonly Shape[],
  width: number,
  height: number,
  palette: readonly string[]
): Promise<Grid> {
  const grid = emptyGrid(width, height);
  if (width <= 0 || height <= 0 || palette.length === 0) return grid;
  const rgb = palette.map(parseColour);
  const ctx = scratch(width, height);
  for (const s of shapes) {
    ctx.clearRect(0, 0, width, height);
    if (s.kind === "picture") {
      if (s.w <= 0 || s.h <= 0) continue;
      let image: ImageBitmap;
      try {
        image = await bitmapOf(s);
      } catch (err) {
        console.error(`[pwp] picture ${s.id} won't decode:`, err);
        continue;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, s.x, s.y, s.w, s.h);
      const data = ctx.getImageData(0, 0, width, height).data;
      const cells = quantize(data, width, height, rgb, s.dither);
      for (let i = 0; i < cells.length; i++) if (cells[i] >= 0) grid.cells[i] = cells[i];
      continue;
    }
    const color = Math.min(Math.max(0, s.color), palette.length - 1);
    trace(ctx, s);
    if (isStroke(s) || !s.fill) {
      ctx.lineWidth = Math.max(0.5, s.stroke);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000";
      ctx.stroke();
    } else {
      ctx.fillStyle = "#000";
      ctx.fill();
    }
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < width * height; i++) {
      if (data[i * 4 + 3] >= COVER) grid.cells[i] = color;
    }
  }
  return grid;
}

// Which row an entry of ours is on, and where it starts: runs, and the
// single-pixel puts layers used to be made of. Anything else isn't ours.
function pixelKey(entry: PatchEntry): string | undefined {
  const p = entry.path;
  if (p.length !== 3 || p[0] !== "pixels") return undefined;
  if (typeof p[1] !== "number" || typeof p[2] !== "number") return undefined;
  if (!("values" in entry) && !("value" in entry)) return undefined;
  return `${p[1]},${p[2]}`;
}

/** Each row's covered stretches, as `"y,x"` → the palette indices there. */
export function runsOf(grid: Grid): Map<string, number[]> {
  const runs = new Map<string, number[]>();
  for (let y = 0; y < grid.height; y++) {
    let run: number[] | undefined;
    for (let x = 0; x < grid.width; x++) {
      const v = grid.cells[y * grid.width + x];
      if (v < 0) {
        run = undefined;
        continue;
      }
      if (!run) runs.set(`${y},${x}`, (run = []));
      run.push(v);
    }
  }
  return runs;
}

const same = (a: unknown, b: readonly number[]) =>
  Array.isArray(a) && a.length === b.length && b.every((v, i) => a[i] === v);

/**
 * Make `patches` say what `grid` says: one run entry per stretch of a row the
 * layer covers. A run that's already right is left as it is, so a small edit
 * is a small change to the patch doc. `patches` may be an Automerge list being
 * changed. Entries that aren't on `pixels` are left alone. Says whether
 * anything changed.
 */
export function syncEntries(patches: PatchEntry[], grid: Grid): boolean {
  const want = runsOf(grid);
  let changed = false;
  // Back to front, so of two entries starting at one cell the later (the one
  // that wins) is the one kept.
  for (let i = patches.length - 1; i >= 0; i--) {
    const entry = patches[i];
    const key = pixelKey(entry);
    if (key === undefined) continue;
    const values = want.get(key);
    if (!values || !("values" in entry)) {
      patches.splice(i, 1);
      changed = true;
      continue;
    }
    if (!same(entry.values, values)) {
      entry.values = [...values];
      changed = true;
    }
    want.delete(key);
  }
  for (const [key, values] of want) {
    const [y, x] = key.split(",").map(Number);
    patches.push({ path: ["pixels", y, x], values });
    changed = true;
  }
  return changed;
}
