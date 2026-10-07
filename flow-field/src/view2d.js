// The top-down editor's geometry: world ↔ screen, hit tests, the heading
// dial, sampling a heatmap. Pure — the tool draws what these return.

import { velocityAt, cpFromSpeed, referenceSpeed, KIND_LABELS } from "./field.js";
import { isInsideBody } from "./integrate.js";

/**
 * Fit the domain's x/y extent into a w × h canvas (CSS px) with `pad` px
 * around it, same scale on both axes, north up.
 */
export function fitView(domain, w, h, pad = 28) {
  const { min, max } = domain;
  const dw = max[0] - min[0];
  const dh = max[1] - min[1];
  const scale = Math.max(1e-6, Math.min((w - 2 * pad) / dw, (h - 2 * pad) / dh));
  const ox = (w - dw * scale) / 2 - min[0] * scale;
  const oy = (h + dh * scale) / 2 + min[1] * scale;
  return { scale, ox, oy, w, h };
}

export function toScreen(view, x, y) {
  return [view.ox + x * view.scale, view.oy - y * view.scale];
}

export function toWorld(view, sx, sy) {
  return [(sx - view.ox) / view.scale, (view.oy - sy) / view.scale];
}

/** The closest element within `radius` px of (sx, sy), or null. */
export function hitElement(view, elements, sx, sy, radius = 12) {
  let best = null;
  let bestD = radius;
  for (const e of elements) {
    const [ex, ey] = toScreen(view, e.x, e.y);
    const d = Math.hypot(ex - sx, ey - sy);
    if (d <= bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** Where the freestream dial sits, in CSS px. */
export function dialGeometry(view) {
  const r = 30;
  return { cx: 16 + r, cy: 16 + r, r };
}

export function hitDial(dial, sx, sy) {
  return Math.hypot(sx - dial.cx, sy - dial.cy) <= dial.r + 6;
}

/**
 * Heading (degrees, counter-clockwise from east, 0 ≤ h < 360) pointed at by a
 * screen position relative to the dial centre. Screen y grows downward.
 * `snap` rounds to a multiple of that many degrees.
 */
export function headingFromDial(dial, sx, sy, snap = 1) {
  const a = (Math.atan2(-(sy - dial.cy), sx - dial.cx) * 180) / Math.PI;
  let h = ((a % 360) + 360) % 360;
  if (snap > 0) h = (Math.round(h / snap) * snap) % 360;
  return h;
}

/**
 * Sample speed and Cp on a cols × rows grid of cell centres over the domain
 * at height z, and (optionally) which cells lie inside a body, at `maskEvery`
 * × coarser resolution (the mask is the expensive part). Speeds are full 3D,
 * and so is the mask's upstream trace by default: a planar trace is held at
 * height z and misses sources and doublets that sit off that plane, so bodies
 * vanish from the mask away from the height their elements are at. `refine:
 * false` skips the edge refinement (cheaper, blockier: for use mid-drag).
 *
 * `exactBody: true` leaves a linked body (field.body) out of the cell mask:
 * the caller draws its outline filled on top, which is exact, where a mask of
 * whole cells is a staircase. The cells under it are returned in `bodyCells`,
 * with their values replaced by their outside neighbours' (dilated inward), so
 * a smoothed image blends the flow up to the outline instead of blending in
 * the meaningless values inside the body.
 */
export function sampleHeatmap(field, z, cols, rows, { mask = true, maskEvery = 2, refine = true, planar = false, exactBody = false } = {}) {
  const { min, max } = field.domain;
  const n = cols * rows;
  const speed = new Float32Array(n);
  const cp = new Float32Array(n);
  const inside = new Uint8Array(n);
  const V = [0, 0, 0];
  const cw = (max[0] - min[0]) / cols;
  const ch = (max[1] - min[1]) / rows;
  for (let j = 0; j < rows; j++) {
    const y = min[1] + (j + 0.5) * ch;
    for (let i = 0; i < cols; i++) {
      const x = min[0] + (i + 0.5) * cw;
      velocityAt(field, x, y, z, V);
      const s = Math.hypot(V[0], V[1], V[2]);
      speed[j * cols + i] = s;
      cp[j * cols + i] = cpFromSpeed(field, s);
    }
  }
  const emitters = field.elements.some((e) => e.kind !== "vortex-line");
  const linked = field.body && !field.body.empty ? field.body : null;
  const exact = !!(exactBody && linked);
  const body = exact ? null : linked;
  const bodyCells = exact ? new Uint8Array(n) : null;
  if (exact) {
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++)
        if (linked.contains(min[0] + (i + 0.5) * cw, min[1] + (j + 0.5) * ch, z)) bodyCells[j * cols + i] = 1;
    dilateInto(speed, bodyCells, cols, rows, cols + rows);
    dilateInto(cp, bodyCells, cols, rows, cols + rows);
  }
  if (mask && (emitters || body)) {
    // Coarse pass: one upstream trace per k × k block. Then refine: every
    // block whose neighbourhood disagrees (i.e. on the body's edge) is
    // re-traced cell by cell, so the edge is as sharp as the heatmap.
    const k = Math.max(1, Math.floor(maskEvery));
    const bc = Math.ceil(cols / k);
    const br = Math.ceil(rows / k);
    const step = Math.max(cw, ch) * k;
    const block = new Uint8Array(bc * br);
    // a linked body is exact geometry; only the doc's own emitters need a trace
    const test = (x, y, st) =>
      !!body?.contains(x, y, z) || (emitters && isInsideBody(field, [x, y, z], { step: st, planar, maxSteps: 600 }));
    for (let bj = 0; bj < br; bj++)
      for (let bi = 0; bi < bc; bi++) {
        const x = min[0] + Math.min(cols, bi * k + k / 2) * cw;
        const y = min[1] + Math.min(rows, bj * k + k / 2) * ch;
        block[bj * bc + bi] = test(x, y, step) ? 1 : 0;
      }
    const fineStep = Math.max(cw, ch);
    for (let bj = 0; bj < br; bj++)
      for (let bi = 0; bi < bc; bi++) {
        const b = block[bj * bc + bi];
        let edge = false;
        if (k > 1 && refine)
          for (let dj = -1; dj <= 1 && !edge; dj++)
            for (let di = -1; di <= 1; di++) {
              const ni = bi + di;
              const nj = bj + dj;
              if (ni < 0 || nj < 0 || ni >= bc || nj >= br) continue;
              if (block[nj * bc + ni] !== b) {
                edge = true;
                break;
              }
            }
        for (let j = bj * k; j < Math.min(rows, bj * k + k); j++)
          for (let i = bi * k; i < Math.min(cols, bi * k + k); i++) {
            const v = edge ? test(min[0] + (i + 0.5) * cw, min[1] + (j + 0.5) * ch, fineStep) : b;
            inside[j * cols + i] = v ? 1 : 0;
          }
      }
  }
  return { cols, rows, speed, cp, inside, bodyCells };
}

/**
 * Overwrite the `holes` cells of a cols × rows grid with the mean of their
 * non-hole neighbours, working inward a ring at a time (up to `passes` rings;
 * cells further in keep the nearest ring's value, or their own).
 */
export function dilateInto(values, holes, cols, rows, passes = 3) {
  let open = Uint8Array.from(holes);
  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(open);
    let filled = 0;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        if (!open[k]) continue;
        let sum = 0;
        let cnt = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ni = i + di;
            const nj = j + dj;
            if ((di || dj) && ni >= 0 && nj >= 0 && ni < cols && nj < rows && !open[nj * cols + ni]) {
              sum += values[nj * cols + ni];
              cnt++;
            }
          }
        if (cnt) {
          values[k] = sum / cnt;
          next[k] = 0;
          filled++;
        }
      }
    open = next;
    if (!filled) break;
  }
  return values;
}

/**
 * Split a streamline into the runs that lie outside masked (body) cells of a
 * `sampleHeatmap` result over `domain`. A planar trace ignores the vertical
 * velocity, so below or above a body's axis it runs straight through the body
 * the mask has blanked out; drawing it there would contradict the mask.
 * @returns {number[][][]} runs of points, each at least two long
 */
export function unmaskedRuns(points, sample, domain) {
  if (!sample?.inside) return points.length > 1 ? [points] : [];
  const { cols, rows, inside } = sample;
  const { min, max } = domain;
  const cw = (max[0] - min[0]) / cols;
  const ch = (max[1] - min[1]) / rows;
  const masked = (p) => {
    const i = Math.min(cols - 1, Math.max(0, Math.floor((p[0] - min[0]) / cw)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor((p[1] - min[1]) / ch)));
    return inside[j * cols + i] === 1;
  };
  const runs = [];
  let run = [];
  for (const p of points) {
    if (masked(p)) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** Round to millimetres, which is plenty and keeps the doc readable. */
export function roundMm(v) {
  return Math.round(v * 1000) / 1000;
}

/** A default strength for a new element, sized to be visible in this stream. */
export function defaultStrength(kind, U) {
  const u = U > 0 ? U : 1;
  if (kind === "doublet") return roundMm(2 * Math.PI * u); // a 1 m sphere
  if (kind === "vortex-line") return roundMm(4 * u);
  return roundMm(2.5 * u); // source/sink: a ~1.1 m half-body
}

/** A fresh element id that isn't already taken. */
export function newElementId(kind, taken, rand = Math.random) {
  const prefix = kind === "vortex-line" ? "vortex" : kind;
  for (;;) {
    const id = `${prefix}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0")}`;
    if (!taken || !(id in taken)) return id;
  }
}

/**
 * The cursor readout. Right next to a singularity the speed runs off to
 * infinity and the number means nothing (|V| 17892 m/s, Cp −8×10⁷), so past
 * 20× the free stream it names the element instead of printing it.
 */
export function probeText(field, x, y, z, fmt = (v) => v.toFixed(2)) {
  const V = velocityAt(field, x, y, z, [0, 0, 0]);
  const sp = Math.hypot(V[0], V[1], V[2]);
  const at = `x ${fmt(x)}  y ${fmt(y)}  z ${fmt(z)} m`;
  const cap = 20 * referenceSpeed(field);
  if (!(sp <= cap)) {
    let near = null;
    let best = Infinity;
    for (const e of field.elements) {
      const d = Math.hypot(x - e.x, y - e.y, e.kind === "vortex-line" ? 0 : z - e.z);
      if (d < best) { best = d; near = e; }
    }
    const what = near ? (KIND_LABELS[near.kind] ?? near.kind).toLowerCase() : "singularity";
    return `${at} · at the ${what}: |V| > ${fmt(cap)} m/s`;
  }
  return `${at} · |V| ${fmt(sp)} m/s · Cp ${fmt(cpFromSpeed(field, sp))}`;
}
