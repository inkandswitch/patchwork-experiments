// Pure data layer for the Mergecraft block-distribution tool.
//
// A Mergecraft doc is just `{ cubes: [x, y, z][] }`. The lens sculpts a single
// vertical slice (one block deep) centred on a chosen ground coordinate
// (x₀, z₀):
//
//   • one editable Bézier silhouette — the height outline across X, one
//     block-count per window column.
//   • a 0..1 `fill` — the fraction of the cells *under* that outline that hold a
//     block. fill = 1 is solid; lowering it deterministically erodes the
//     interior into random-looking gaps.
//
// The catch with fill is round-tripping: the silhouette is read back as the top
// of each column, so if erosion could delete the top block the curve would
// collapse. We therefore *anchor* the top block of every column (it is always
// present) and only erode below it. The envelope — and hence the fitted curve —
// stays exact at any fill; at fill = 0 a column reduces to its bare one-block
// outline rather than vanishing.
//
// Fill is read back as K/N (interior blocks present / interior cells under the
// curve), so for the lens to be truly two-way it must be an exact fixed point:
// generating with K/N has to reproduce the very same set. We get that by ranking
// interior cells by a fixed per-cell noise and placing the lowest `round(fill·N)`
// of them — regenerating with K/N places exactly K cells again, the same ones.
// Dragging fill then reveals/erases cells monotonically (minimal diffs), and a
// manual edit in the world (removing/adding blocks) moves K, so the slider
// tracks it — the whole point of a lens.
//
//   generateFilledSlice(...) rebuilds the slice from silhouette + fill;
//   fitSlice(...) is its inverse. Everything here is pure (plain arrays in/out),
//   trivial to test offline; the reactive/Automerge wiring lives in the tool.

export type Cube = [number, number, number];

const r = Math.round;

// Tallest stack the editor allows.
export const MAX_LEVELS = 12;

// The slice spans a window of `COLS` columns centred on x₀: offsets d ∈
// [-HALF, HALF]. The Bézier samples to one height per X column.
export const HALF = 7;
export const COLS = HALF * 2 + 1;

// Range the 2D centre selector spans (the world is unbounded, but the pad needs
// finite extents to be useful).
export const MID_MIN = -12;
export const MID_MAX = 12;

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** Deterministic pseudo-random in [0, 1) keyed on a world cell. Stable across
 *  regenerations, so each interior cell keeps a fixed rank and editing fill is a
 *  monotonic reveal/erase rather than a reshuffle. */
function cellNoise(x: number, y: number): number {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const inSlice = (c: Cube, mx: number, mz: number): boolean =>
  r(c[2]) === mz && Math.abs(r(c[0]) - mx) <= HALF;

export interface SliceFit {
  /** One height per window column (index i ⇒ x-offset i − HALF). */
  silhouette: number[];
  /** Interior fill fraction (0..1) of the slice. */
  fill: number;
  /** False when the slice is empty (so the caller can leave fill alone). */
  any: boolean;
}

/** Read a silhouette + fill back out of the world — the backward half of the
 *  lens. Height is the top of each column (always exact thanks to the anchored
 *  top block); fill is the share of *interior* cells (below each top) present. */
export function fitSlice(cubes: Cube[], mx: number, mz: number): SliceFit {
  const heights = new Array<number>(COLS).fill(0);
  const present = new Array<number>(COLS).fill(0);
  let any = false;

  for (const c of cubes) {
    if (!inSlice(c, mx, mz)) continue;
    const i = r(c[0]) - mx + HALF;
    present[i] += 1;
    const top = r(c[1]) + 1;
    if (top > heights[i]) heights[i] = top;
    any = true;
  }

  let interiorPresent = 0;
  let interiorTotal = 0;
  for (let i = 0; i < COLS; i++) {
    const H = heights[i];
    if (H <= 0) continue;
    interiorTotal += H - 1; // exclude the anchored top block
    interiorPresent += Math.max(0, present[i] - 1);
  }
  const fill = interiorTotal > 0 ? clamp(interiorPresent / interiorTotal, 0, 1) : 1;

  return { silhouette: heights, fill, any };
}

/** Rebuild the slice from a silhouette + fill — the forward half of the lens.
 *  Every column's top block is placed unconditionally (the anchor that keeps the
 *  curve stable). Of the N interior cells under the curve, the lowest-ranked
 *  `round(fill·N)` by cell noise are placed — an exact fixed point with
 *  `fitSlice`, so fill round-trips and editing it is monotonic. Cubes *outside*
 *  the slice are preserved verbatim, so separate slices coexist and the result
 *  diffs minimally under keyed reconcile. */
export function generateFilledSlice(
  cubes: Cube[],
  mx: number,
  mz: number,
  silhouette: number[],
  fill: number,
): Cube[] {
  const f = clamp(fill, 0, 1);
  const others = cubes.filter((c) => !inSlice(c, mx, mz));

  const anchors: Cube[] = [];
  const interior: { cell: Cube; n: number }[] = [];
  for (let i = 0; i < COLS; i++) {
    const H = clamp(r(silhouette[i] ?? 0), 0, MAX_LEVELS);
    if (H <= 0) continue;
    const x = mx + (i - HALF);
    anchors.push([x, H - 1, mz]);
    for (let y = 0; y < H - 1; y++) interior.push({ cell: [x, y, mz], n: cellNoise(x, y) });
  }

  const K = clamp(Math.round(f * interior.length), 0, interior.length);
  // Lowest-ranked first; tiebreak on y so the order is fully deterministic.
  interior.sort((a, b) => a.n - b.n || a.cell[1] - b.cell[1]);
  const placed = interior.slice(0, K).map((e) => e.cell);

  return [...others, ...anchors, ...placed];
}

/** Seed the centre selector at the world's block centroid (clamped to the pad),
 *  so the editor opens framed on whatever already exists. */
export function dominantMidpoint(cubes: Cube[] | undefined): {
  mx: number;
  mz: number;
} {
  if (!cubes || cubes.length === 0) return { mx: 0, mz: 0 };
  let sx = 0;
  let sz = 0;
  for (const c of cubes) {
    sx += r(c[0]);
    sz += r(c[2]);
  }
  return {
    mx: clamp(Math.round(sx / cubes.length), MID_MIN, MID_MAX),
    mz: clamp(Math.round(sz / cubes.length), MID_MIN, MID_MAX),
  };
}
