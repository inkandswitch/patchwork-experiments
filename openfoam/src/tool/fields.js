// A layer drawn flat: the wave pattern or waterplane from above, the hull's
// pressure from the side, the wake from astern. Equal scale on both axes,
// each triangle filled with its mean value's colour, a colour bar under it,
// and the value under the pointer on hover.

import { mirrorTriangles, fieldRange, mapFor, sampleColormap } from "../scene-build.js";
import { FIELD_INFO } from "../protocol.js";
import { formatNumber, cssColor } from "./charts.js";

/** Screen axes per view: [horizontal, vertical] as (index, sign) into floating xyz. */
export const VIEWS = Object.freeze({
  plan: { axes: [[0, 1], [1, 1]], label: "from above, bow right" },
  profile: { axes: [[0, 1], [2, 1]], label: "from starboard, bow right" },
  wake: { axes: [[1, -1], [2, 1]], label: "from astern" },
});

const css = (el, name, fallback) => cssColor(el, name, fallback);

/**
 * Add a triangle to the path, always wound the same way on screen. A closed
 * hull seen flat covers every point with as many triangles one way round as
 * the other, so under the nonzero rule one path of them fills nothing.
 */
function fanCCW(g, a, b, c) {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const [p, q] = cross < 0 ? [c, b] : [b, c];
  g.moveTo(a[0], a[1]);
  g.lineTo(p[0], p[1]);
  g.lineTo(q[0], q[1]);
  g.closePath();
}
const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;

/**
 * @param {HTMLElement} host
 * @returns {{ update(o: { layer: object, field: string, view: keyof VIEWS, mirror?: boolean, under?: object|null, maxHeight?: number }): void, dispose(): void }}
 */
export function fieldPlot(host) {
  const el = document.createElement("div");
  el.className = "chart";
  const canvas = document.createElement("canvas");
  const tip = document.createElement("div");
  tip.className = "tip";
  const bar = document.createElement("div");
  bar.className = "colorbar";
  el.append(canvas, tip, bar);
  host.append(el);
  let state = null;
  let proj = null;

  const draw = () => {
    if (!state?.layer) return;
    const { layer, field, view, mirror = true, under = null, focus = null, maxHeight = 320 } = state;
    const geom = mirrorTriangles(layer, mirror && layer.half);
    const values = geom.fields[field];
    if (!values) {
      bar.textContent = `this layer has no ${field}`;
      return;
    }
    const [[hi, hs], [vi, vs]] = VIEWS[view].axes;
    const P = geom.positions;
    const ug = under ? mirrorTriangles(under, mirror && under.half) : null;
    let minH = Infinity, maxH = -Infinity, minV = Infinity, maxV = -Infinity;
    const scan = (pos) => {
      for (let i = 0; i < pos.length; i += 3) {
        const h = hs * pos[i + hi], v = vs * pos[i + vi];
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    };
    scan(P);
    if (focus) {
      // crop to the hull's neighbourhood: the domain is many hull lengths across
      const F = focus.positions;
      let x0 = Infinity, x1 = -Infinity, yb = 0, z0 = 0;
      for (let i = 0; i < F.length; i += 3) {
        x0 = Math.min(x0, F[i]);
        x1 = Math.max(x1, F[i]);
        yb = Math.max(yb, Math.abs(F[i + 1]));
        z0 = Math.min(z0, F[i + 2]);
      }
      const L = x1 - x0 || 1;
      const win = { 0: [x0 - 0.9 * L, x1 + 0.35 * L], 1: [-(yb + 0.45 * L), yb + 0.45 * L], 2: [z0 - 0.3 * L, Infinity] };
      const clampAxis = (ax, sign, lo, hi) => {
        const [a, b] = win[ax].map((v) => sign * v).sort((p, q) => p - q);
        return [Math.max(lo, a), Math.min(hi, b)];
      };
      [minH, maxH] = clampAxis(hi, hs, minH, maxH);
      [minV, maxV] = clampAxis(vi, vs, minV, maxV);
    }
    const w = Math.max(200, el.clientWidth || 500);
    const pad = 6;
    const k = Math.min((w - 2 * pad) / (maxH - minH || 1), (maxHeight - 2 * pad) / (maxV - minV || 1));
    const height = Math.ceil((maxV - minV) * k + 2 * pad);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    const ox = (w - (maxH - minH) * k) / 2;
    const SX = (i) => ox + (hs * P[i * 3 + hi] - minH) * k;
    const SY = (i) => height - pad - (vs * P[i * 3 + vi] - minV) * k;
    const range = fieldRange(field, values);
    const cmap = mapFor(field);
    const span = range[1] - range[0] || 1;
    const idx = geom.indices;
    // far to near along the view's depth axis (the one not on screen)
    const depth = [0, 1, 2].find((a) => a !== hi && a !== vi);
    const toward = view === "profile" ? -1 : view === "wake" ? -1 : 1; // the camera sits at −y (profile), −x (wake), +z (plan)
    const order = Array.from({ length: idx.length / 3 }, (_, t) => t);
    const mean = (t, a) => (P[idx[t * 3] * 3 + a] + P[idx[t * 3 + 1] * 3 + a] + P[idx[t * 3 + 2] * 3 + a]) / 3;
    order.sort((a, b) => toward * (mean(a, depth) - mean(b, depth)));
    const tris = new Float32Array(order.length * 6);
    order.forEach((t, n) => {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      const x0 = SX(a), y0 = SY(a), x1 = SX(b), y1 = SY(b), x2 = SX(c), y2 = SY(c);
      tris.set([x0, y0, x1, y1, x2, y2], n * 6);
      const v = (values[a] + values[b] + values[c]) / 3;
      const col = rgb(sampleColormap(cmap, (v - range[0]) / span));
      g.fillStyle = col;
      g.strokeStyle = col;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.lineTo(x2, y2);
      g.closePath();
      g.fill();
      g.stroke();
    });
    // the hull over the water, plain
    if (ug) {
      g.fillStyle = css(el, "--openfoam-hull", "#bbb");
      const UP = ug.positions;
      const ux = (i) => ox + (hs * UP[i * 3 + hi] - minH) * k;
      const uy = (i) => height - pad - (vs * UP[i * 3 + vi] - minV) * k;
      g.beginPath();
      for (let t = 0; t < ug.indices.length; t += 3) fanCCW(g, [ux(ug.indices[t]), uy(ug.indices[t])], [ux(ug.indices[t + 1]), uy(ug.indices[t + 1])], [ux(ug.indices[t + 2]), uy(ug.indices[t + 2])]);
      g.fill();
    }
    proj = { tris, order, idx, values };
    const info = FIELD_INFO[field] ?? { label: field, unit: "" };
    const stops = Array.from({ length: 9 }, (_, i) => rgb(sampleColormap(cmap, i / 8)));
    bar.innerHTML = `<span>${formatNumber(range[0])}</span><span class="bar" style="background:linear-gradient(90deg,${stops.join(",")})"></span><span>${formatNumber(range[1])} ${info.unit && info.unit !== field ? info.unit : ""}</span>`;
    bar.title = `${info.label}, ${VIEWS[view].label}`;
  };

  const inside = (px, py, t) => {
    const [x0, y0, x1, y1, x2, y2] = proj.tris.subarray(t * 6, t * 6 + 6);
    const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (!d) return null;
    const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d;
    const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d;
    const l2 = 1 - l0 - l1;
    return l0 >= 0 && l1 >= 0 && l2 >= 0 ? [l0, l1, l2] : null;
  };
  canvas.addEventListener("pointermove", (ev) => {
    if (!proj) return;
    const r = canvas.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    // nearest to the viewer first: the last drawn
    for (let n = proj.order.length - 1; n >= 0; n--) {
      const l = inside(px, py, n);
      if (!l) continue;
      const t = proj.order[n];
      const v = l[0] * proj.values[proj.idx[t * 3]] + l[1] * proj.values[proj.idx[t * 3 + 1]] + l[2] * proj.values[proj.idx[t * 3 + 2]];
      const info = FIELD_INFO[state.field] ?? { label: state.field, unit: "" };
      tip.innerHTML = `${info.label} <b>${formatNumber(v)}</b> ${info.unit && info.unit !== state.field ? info.unit : ""}`;
      tip.style.left = `${Math.min(px + 12, r.width - 170)}px`;
      tip.style.top = `${Math.max(0, py - 30)}px`;
      tip.setAttribute("data-show", "");
      return;
    }
    tip.removeAttribute("data-show");
  });
  canvas.addEventListener("pointerleave", () => tip.removeAttribute("data-show"));
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null;
  ro?.observe(el);
  // a canvas keeps the colours it was painted with: repaint when the theme changes
  const mo = typeof MutationObserver === "function" ? new MutationObserver(() => draw()) : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["theme", "class", "style"] });
  return {
    update(o) {
      state = o;
      draw();
    },
    dispose() {
      ro?.disconnect();
      mo?.disconnect();
      el.remove();
    },
  };
}

/**
 * The hull frozen for a run, drawn as a silhouette in profile and plan with
 * the waterline, for the pre-flight. `mesh` is prepareHull()'s mesh.
 */
export function drawHull(canvas, mesh, info, { height = 230 } = {}) {
  const el = canvas.parentElement ?? canvas;
  const w = Math.max(200, el.clientWidth || 300);
  const dpr = window.devicePixelRatio || 1;
  const P = mesh.points;
  const F = mesh.faces;
  const b = info.bounds;
  const L = b.max[0] - b.min[0] || 1;
  const pad = 8;
  // profile on top, plan below, same scale
  const hP = b.max[2] - Math.min(b.min[2], 0);
  const hPl = b.max[1] - b.min[1];
  const k = Math.min((w - 2 * pad) / L, (height - 3 * pad) / (hP + hPl || 1));
  const H = Math.ceil((hP + hPl) * k + 3 * pad);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = "100%";
  canvas.style.height = `${H}px`;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, H);
  const ox = (w - L * k) / 2;
  const X = (x) => ox + (x - b.min[0]) * k;
  const top = Math.max(b.max[2], 0);
  const Zp = (z) => pad + (top - z) * k;
  const Yp = (y) => 2 * pad + hP * k + (b.max[1] - y) * k;
  const hull = css(el, "--openfoam-hull", "#bbb");
  const water = css(el, "--openfoam-water", "#cde");
  const ink = css(el, "--openfoam-fg", "black");
  // water below z = 0 in the profile
  g.fillStyle = water;
  g.fillRect(0, Zp(0), w, Zp(Math.min(b.min[2], 0)) - Zp(0));
  g.fillStyle = hull;
  for (const [proj, Y] of [
    [(i) => [X(P[i * 3]), Zp(P[i * 3 + 2])], null],
    [(i) => [X(P[i * 3]), Yp(P[i * 3 + 1])], null],
  ]) {
    void Y;
    g.beginPath();
    for (let f = 0; f < F.length; f += 3) fanCCW(g, proj(F[f]), proj(F[f + 1]), proj(F[f + 2]));
    g.fill();
  }
  // the waterline
  g.strokeStyle = ink;
  g.lineWidth = 1;
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(0, Math.round(Zp(0)) + 0.5);
  g.lineTo(w, Math.round(Zp(0)) + 0.5);
  g.stroke();
  g.setLineDash([]);
  if (info.wlXMin != null) {
    g.strokeStyle = ink;
    g.beginPath();
    g.moveTo(X(info.wlXMin), Yp(0));
    g.lineTo(X(info.wlXMax), Yp(0));
    g.stroke();
  }
}
