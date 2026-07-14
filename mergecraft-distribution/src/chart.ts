// Two bireactive widgets the tool composes into a lens:
//
//   • profileEditor — an editable cubic-Bézier "skyline": four control points
//     (two locked endpoints, two free interior handles) over the window's X
//     columns. Sample it with `heights()`; fit it to a skyline with
//     `setFromHeights()`. Display + intent only — it owns its control points and
//     a `dragging` signal and never touches the document.
//   • midpointPad — a top-down X/Z pad with one draggable dot picking the hill's
//     centre coordinate, snapped to the integer grid. Exposes `mx`/`mz` cells.

import {
  type Cell,
  type CurveSegment,
  curve,
  derive,
  handle,
  label,
  line,
  mount,
  Shape,
  SVG_NS,
  Vec,
  vec,
} from "bireactive";
import {
  clamp,
  COLS,
  HALF,
  MAX_LEVELS,
  MID_MAX,
  MID_MIN,
} from "./lens";

const ACCENT = "#2563eb";
// Derived from the inherited text colour so axes/labels read on any theme.
const POLY = "color-mix(in srgb, currentColor 35%, transparent)";
const AXIS = "color-mix(in srgb, currentColor 45%, transparent)";
const MUTED = "color-mix(in srgb, currentColor 55%, transparent)";
const GRID = "color-mix(in srgb, currentColor 14%, transparent)";

type V = { x: number; y: number };

/** Cubic Bézier point at parameter `t`. */
const cubicAt = (p0: V, p1: V, p2: V, p3: V, t: number): V => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
};

const makeSvg = (w: number, h: number): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.cssText =
    "display:block;width:100%;height:auto;overflow:visible;touch-action:none;";
  return svg;
};

// ---------------------------------------------------------------------------
// Profile editor
// ---------------------------------------------------------------------------

const W = 360;
const H = 240;
const PAD_L = 30;
const PAD_R = 16;
const PAD_T = 18;
const PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const BASE_Y = PAD_T + PLOT_H;

const idxToPx = (i: number): number => PAD_L + (i / (COLS - 1)) * PLOT_W;
const pxToIdx = (px: number): number => ((px - PAD_L) / PLOT_W) * (COLS - 1);
const levelToPx = (h: number): number => BASE_Y - (h / MAX_LEVELS) * PLOT_H;
const pxToLevel = (py: number): number => ((BASE_Y - py) / PLOT_H) * MAX_LEVELS;

export interface ProfileEditor {
  svg: SVGSVGElement;
  /** True while any control handle is being dragged. */
  dragging: Cell<boolean>;
  /** Sample the curve into one target block-count per window column. */
  heights: () => number[];
  /** Fit the four control points to a skyline (one count per column). */
  setFromHeights: (counts: number[]) => void;
  dispose: () => void;
}

export function profileEditor(xLabel = "x →"): ProfileEditor {
  const svg = makeSvg(W, H);
  const root = new Shape();
  svg.appendChild(root.el);
  const s = mount(root);

  // Control points in pixel space at column indices 0, 1/3, 2/3, end. Endpoints
  // lock their x; the interior two are free within the plot.
  const idxs = [0, (COLS - 1) / 3, (2 * (COLS - 1)) / 3, COLS - 1];
  const bases = idxs.map((i) => vec(idxToPx(i), levelToPx(0)));
  const clampY = (py: number) => clamp(py, levelToPx(MAX_LEVELS), BASE_Y);
  const clampX = (px: number) => clamp(px, idxToPx(0), idxToPx(COLS - 1));

  const handles = bases.map((base, i) => {
    const lockX = i === 0 || i === 3;
    const fixedX = idxToPx(idxs[i]);
    const bound = Vec.lens(
      base,
      (v) => v,
      (t: V) => ({ x: lockX ? fixedX : clampX(t.x), y: clampY(t.y) }),
    );
    return handle(bound, { r: 7, fill: ACCENT });
  });

  const dragging = derive(() => handles.some((h) => h.dragging.value));

  const sampleCurvePx = (n: number): V[] => {
    const [p0, p1, p2, p3] = bases.map((b) => b.value);
    const out: V[] = [];
    for (let i = 0; i <= n; i++) out.push(cubicAt(p0, p1, p2, p3, i / n));
    return out;
  };

  // Faint horizontal gridlines at every other level.
  for (let lvl = 0; lvl <= MAX_LEVELS; lvl += 2) {
    const y = levelToPx(lvl);
    s(line(vec(PAD_L, y), vec(PAD_L + PLOT_W, y), { stroke: GRID, thin: true }));
  }

  // Axes.
  s(line(vec(PAD_L, BASE_Y), vec(PAD_L + PLOT_W, BASE_Y), { stroke: AXIS, thin: true }));
  s(line(vec(PAD_L, PAD_T), vec(PAD_L, BASE_Y), { stroke: AXIS, thin: true }));

  // Centre marker (the chosen midpoint column).
  const cx = idxToPx(HALF);
  s(line(vec(cx, PAD_T), vec(cx, BASE_Y), { stroke: GRID, thin: true }));

  // Control polygon (faint), then the Bézier, then the draggable handles.
  s(
    curve(
      (): CurveSegment[] => {
        const p = bases.map((b) => b.value);
        return [
          { kind: "line", from: p[0], to: p[1] },
          { kind: "line", from: p[1], to: p[2] },
          { kind: "line", from: p[2], to: p[3] },
        ];
      },
      { stroke: POLY, strokeWidth: 1, thin: true },
    ),
  );

  s(
    curve(
      (): CurveSegment[] => {
        const pts = sampleCurvePx(48);
        const segs: CurveSegment[] = [];
        for (let i = 1; i < pts.length; i++) {
          segs.push({ kind: "line", from: pts[i - 1], to: pts[i] });
        }
        return segs;
      },
      { stroke: ACCENT, strokeWidth: 2.5 },
    ),
  );

  handles.forEach((h) => s(h));

  s(label(vec(PAD_L + PLOT_W / 2, H - 6), xLabel, { size: 11, fill: MUTED }));
  s(
    label(vec(PAD_L - 6, PAD_T + 2), String(MAX_LEVELS), {
      size: 10,
      fill: MUTED,
      align: { x: 1, y: 0.5 },
    }),
  );
  s(label(vec(PAD_L - 6, BASE_Y), "0", { size: 10, fill: MUTED, align: { x: 1, y: 0.5 } }));

  const heights = (): number[] => {
    const pts = sampleCurvePx(120).map((p) => ({
      idx: pxToIdx(p.x),
      level: pxToLevel(p.y),
    }));
    return Array.from({ length: COLS }, (_, i) => {
      let bestLevel = 0;
      let bestDist = Infinity;
      for (const p of pts) {
        const d = Math.abs(p.idx - i);
        if (d < bestDist) {
          bestDist = d;
          bestLevel = p.level;
        }
      }
      return clamp(Math.round(bestLevel), 0, MAX_LEVELS);
    });
  };

  const setFromHeights = (counts: number[]): void => {
    const at = (i: number): number =>
      clamp(counts[Math.round(i)] ?? 0, 0, MAX_LEVELS);
    bases.forEach((b, k) => {
      b.value = { x: idxToPx(idxs[k]), y: levelToPx(at(idxs[k])) };
    });
  };

  return { svg, dragging, heights, setFromHeights, dispose: () => root.dispose() };
}

// ---------------------------------------------------------------------------
// Midpoint pad (top-down X/Z coordinate selector)
// ---------------------------------------------------------------------------

const PAD = 220;
const PAD_M = 26;
const PAD_SPAN = MID_MAX - MID_MIN;

const wToPx = (w: number): number =>
  PAD_M + ((w - MID_MIN) / PAD_SPAN) * (PAD - 2 * PAD_M);
const pxToW = (px: number): number =>
  MID_MIN + ((px - PAD_M) / (PAD - 2 * PAD_M)) * PAD_SPAN;

export interface MidpointPad {
  svg: SVGSVGElement;
  /** Integer world X / Z of the dot, snapped to the grid. */
  mx: Cell<number>;
  mz: Cell<number>;
  dispose: () => void;
}

export function midpointPad(mx0: number, mz0: number): MidpointPad {
  const svg = makeSvg(PAD, PAD);
  const root = new Shape();
  svg.appendChild(root.el);
  const s = mount(root);

  const lo = wToPx(MID_MIN);
  const hi = wToPx(MID_MAX);

  // Grid every 4 world units + bold axes through the origin.
  for (let w = MID_MIN; w <= MID_MAX; w += 4) {
    const p = wToPx(w);
    s(line(vec(p, lo), vec(p, hi), { stroke: GRID, thin: true }));
    s(line(vec(lo, p), vec(hi, p), { stroke: GRID, thin: true }));
  }
  const ox = wToPx(0);
  s(line(vec(ox, lo), vec(ox, hi), { stroke: AXIS, thin: true }));
  s(line(vec(lo, ox), vec(hi, ox), { stroke: AXIS, thin: true }));

  // Border.
  s(line(vec(lo, lo), vec(hi, lo), { stroke: AXIS, thin: true }));
  s(line(vec(hi, lo), vec(hi, hi), { stroke: AXIS, thin: true }));
  s(line(vec(hi, hi), vec(lo, hi), { stroke: AXIS, thin: true }));
  s(line(vec(lo, hi), vec(lo, lo), { stroke: AXIS, thin: true }));

  const pos = vec(wToPx(mx0), wToPx(mz0));
  const clampPx = (p: number) => clamp(p, lo, hi);
  const bound = Vec.lens(
    pos,
    (v) => v,
    (t: V) => ({ x: clampPx(t.x), y: clampPx(t.y) }),
  );
  s(handle(bound, { r: 9, fill: ACCENT }));

  s(label(vec(hi - 4, ox - 6), "x →", { size: 11, fill: MUTED, align: { x: 1, y: 0.5 } }));
  s(label(vec(ox + 6, hi - 4), "z →", { size: 11, fill: MUTED, align: { x: 0, y: 0.5 } }));

  const mx = derive(() => clamp(Math.round(pxToW(pos.value.x)), MID_MIN, MID_MAX));
  const mz = derive(() => clamp(Math.round(pxToW(pos.value.y)), MID_MIN, MID_MAX));

  return { svg, mx, mz, dispose: () => root.dispose() };
}
