/**
 * SyncTeX bridge between the LaTeX source and the compiled PDF.
 *
 * The actual parsing is delegated to `synctex-js` — a small, established
 * implementation (originally written for the BlueLaTeX web editor) that
 * understands the full record grammar: nested v/h boxes, leaf elements,
 * per-line indexing and the unit/offset header. Rolling our own parser was
 * the source of the earlier flakiness; this one is battle-tested.
 *
 * Siglum compiles with SyncTeX enabled and returns the *uncompressed* body
 * as `result.syncTexData`, which `parseSyncTex` consumes directly.
 *
 * Coordinates are SyncTeX-native: PDF points, origin at the page's top-left,
 * y growing downward (see `synctex-js.d.ts`). Both search directions return /
 * accept positions in that space, so the preview maps them to pixels with a
 * single per-page scale factor and never has to flip an axis.
 *
 *   forward search  — source line  → page + box rectangle (scroll + flash)
 *   inverse search  — click on PDF → source line (move the cursor)
 *
 * Everything is best-effort: on any failure the caller gets `null` and the
 * editor keeps working without sync.
 */

import synctexjs, { type PdfSyncObject } from "synctex-js";

/** The editor only ever edits this file; the engine writes it as document.tex. */
const DEFAULT_MAIN_FILE = "document.tex";

export type SyncTexData = {
  obj: PdfSyncObject;
  /** basename of the source the editor is editing, as SyncTeX named it. */
  mainFile: string;
};

/** A box on a page, in SyncTeX points (top-left origin, y down). */
export type SyncTexRect = {
  page: number; // 1-based
  x: number; // left edge
  y: number; // top edge
  width: number;
  height: number;
};

/** A resolved source position from an inverse search. */
export type SyncTexHit = {
  file: string;
  line: number;
};

export function parseSyncTex(
  text: string | null | undefined,
  mainFileName: string = DEFAULT_MAIN_FILE
): SyncTexData | null {
  if (!text || typeof text !== "string") return null;
  try {
    const obj = synctexjs.parser.parseSyncTex(text);
    if (!obj || obj.numberPages === 0) return null;
    return { obj, mainFile: resolveFileKey(obj, mainFileName) };
  } catch {
    return null;
  }
}

/** Match the editor's file against the names SyncTeX recorded (by basename). */
function resolveFileKey(obj: PdfSyncObject, name: string): string {
  const keys = Object.keys(obj.blockNumberLine);
  if (obj.blockNumberLine[name]) return name;
  const hit = keys.find(
    (k) => k === name || k.endsWith(`/${name}`) || name.endsWith(`/${k}`)
  );
  return hit ?? keys[0] ?? name;
}

/**
 * Forward search: a source line → the rectangle to reveal in the PDF.
 *
 * Uses SyncTeX's per-line index. If the exact line carries no glyphs (a blank
 * line, a comment, a line of pure markup) we snap to the nearest line that
 * does, so the jump still lands somewhere sensible. The rectangle is the
 * bounding box of every element recorded for that line on its first page.
 */
export function forwardSearch(
  data: SyncTexData,
  line: number,
  file: string = data.mainFile
): SyncTexRect | null {
  const byLine = data.obj.blockNumberLine[file];
  if (!byLine) return null;

  const targetLine = nearestLine(byLine, line);
  if (targetLine == null) return null;

  const byPage = byLine[targetLine];
  const pageKeys = Object.keys(byPage)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const page = pageKeys[0];
  if (page == null) return null;

  const elements = byPage[page];
  if (!elements || elements.length === 0) return null;

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const e of elements) {
    const eTop = e.bottom - e.height;
    left = Math.min(left, e.left);
    right = Math.max(right, e.left + (e.width ?? 0));
    top = Math.min(top, eTop);
    bottom = Math.max(bottom, e.bottom);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;

  return {
    page,
    x: left,
    y: top,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

function nearestLine(
  byLine: Record<string, unknown>,
  line: number
): number | null {
  if (byLine[line]) return line;
  let best: number | null = null;
  let bestDelta = Infinity;
  for (const key of Object.keys(byLine)) {
    const n = Number(key);
    if (!Number.isFinite(n)) continue;
    const delta = Math.abs(n - line);
    if (delta < bestDelta) {
      best = n;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Inverse search: a click at (x, y) on `page` → the source line.
 *
 * Walks the flat list of horizontal (line-level) boxes and keeps the smallest
 * one that contains the point — the most specific match — preferring boxes
 * from the editor's own file over ones pulled in from packages/classes. If the
 * click lands in whitespace, falls back to the nearest line box on the page.
 */
export function inverseSearch(
  data: SyncTexData,
  page: number,
  x: number,
  y: number
): SyncTexHit | null {
  const TOL = 4; // points of slack so edge/whitespace clicks still land
  const main = data.mainFile;

  let best: { line: number; file: string } | null = null;
  let bestArea = Infinity;
  let bestMain: { line: number; file: string } | null = null;
  let bestMainArea = Infinity;

  let nearestMain: { line: number; file: string } | null = null;
  let nearestMainDist = Infinity;

  for (const b of data.obj.hBlocks) {
    if (b.page !== page) continue;
    const fileName = b.file?.name ?? "";
    const left = b.left;
    const right = b.left + b.width;
    const top = b.bottom - b.height;
    const bottom = b.bottom + (b.depth ?? 0);
    const isMain = fileName === main;

    if (isMain) {
      // Track the vertically-nearest main-file line for the whitespace case.
      const dy =
        y < top ? top - y : y > bottom ? y - bottom : 0;
      const dx =
        x < left ? left - x : x > right ? x - right : 0;
      const dist = dy * dy * 4 + dx * dx;
      if (dist < nearestMainDist) {
        nearestMainDist = dist;
        nearestMain = { line: b.line, file: fileName };
      }
    }

    if (
      x < left - TOL ||
      x > right + TOL ||
      y < top - TOL ||
      y > bottom + TOL
    ) {
      continue;
    }

    const area = Math.max(b.width, 1) * Math.max(b.height, 1);
    if (area < bestArea) {
      best = { line: b.line, file: fileName };
      bestArea = area;
    }
    if (isMain && area < bestMainArea) {
      bestMain = { line: b.line, file: fileName };
      bestMainArea = area;
    }
  }

  return bestMain ?? best ?? nearestMain;
}
