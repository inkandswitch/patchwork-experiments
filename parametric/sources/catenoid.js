/**
 * Catenoid: an isometric wireframe of a catenoid, lifted from catenoid/index.html.
 *
 * A parametric source. See ../DATATYPE.md for the contract. Template exports
 * (version, params, output, presets, titleTemplate) are plain JSON; render() is
 * pure in (values, view, size). The module keeps a geometry memo keyed by the
 * geometry values, the same cache the original kept.
 */

export const version = 1;

export const titleTemplate = "Catenoid";

export const output = {
  surfaces: ["canvas2d"],
  unit: "px",
  width: null,   // fills the viewport; the renderer passes surface.width/height
  height: null,
  dpi: 96,
  background: "#fafafa",  // the original's PARAMS.bg, only ever used as the clear colour
  animated: false,
};

export const params = [
  { key: "a",        label: "a",      kind: "num", default: 96,  min: 6,  step: 2,
    section: "Geometry", note: "Waist radius. The surface is r = a·cosh(z/a)." },
  { key: "L",        label: "L",      kind: "num", default: 192, min: 40, step: 4,
    section: "Geometry", note: "Half height, before zScale." },
  { key: "zScale",   label: "zScale", kind: "num", default: 3, min: 0.5, max: 4, step: 0.1,
    section: "Geometry" },
  { key: "segZ",     label: "zseg",   kind: "int", default: 8,  min: 4, max: 100, step: 2,
    section: "Geometry", note: "Rings along z." },
  { key: "segTheta", label: "theta",  kind: "int", default: 16, min: 4, max: 100, step: 4,
    section: "Geometry", note: "Meridians around the axis." },
  { key: "stroke",   label: "stroke", kind: "color", default: "#111111", section: "Ink" },
  { key: "screenRotateDeg", label: "rot", kind: "num", default: 60, step: 1, bucket: "view",
    section: "View", note: "Screen-space rotation. Snaps to multiples of 90° within 0.75°.",
    presets: [
      { label: "0°", value: 0 }, { label: "60°", value: 60 }, { label: "90°", value: 90 },
    ] },
  { key: "zoom", label: "zoom", kind: "num", default: 0.8, min: 0.2, max: 5, step: 0.1,
    bucket: "view", section: "View", presets: [{ label: "1×", value: 1 }] },
];

export const presets = [
  { name: "default", values: { a: 96, L: 192, zScale: 3, segZ: 8, segTheta: 16 } },
  { name: "fine mesh", values: { a: 96, L: 192, zScale: 3, segZ: 24, segTheta: 48 } },
  { name: "tall neck", values: { a: 40, L: 240, zScale: 2, segZ: 12, segTheta: 24 } },
];

/* ---------------------------------------------------------------- math */

const TAU = Math.PI * 2;

// Isometric projection (Ry 45°, Rx ≈ 35.264°).
const iso = (() => {
  const ry = Math.PI / 4;
  const rx = Math.atan(1 / Math.sqrt(2));
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  return ([x, y, z]) => {
    const x1 = x * cy + z * sy;
    const y1 = y;
    const z1 = -x * sy + z * cy;
    return [x1, y1 * cx - z1 * sx, y1 * sx + z1 * cx];
  };
})();

function toScreen([x, y, z], w, h, scale) {
  const p = iso([x, y, z]);
  return [w / 2 + p[0] * scale, h / 2 - p[1] * scale, p[2]];
}

function rotate2D([sx, sy], deg, cx, cy) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = sx - cx, dy = sy - cy;
  return [cx + c * dx - s * dy, cy + s * dx + c * dy];
}

function computeScreenScale(w, h, L, zScale, zoom) {
  const bb = Math.max(260, 2 * L * zScale);
  return 0.9 * Math.min(w, h) / bb * zoom;
}

function snapDeg(d, inc = 90, tol = 0.75) {
  const n = Math.round(d / inc);
  return Math.abs(d - n * inc) <= tol ? n * inc : d;
}

const catenoidR = (z, a) => a * Math.cosh(z / a);

/* ------------------------------------------------------------- geometry */

function buildLines({ a, L, segTheta, segZ, zScale }) {
  const lines = [];
  // Meridians
  for (let k = 0; k < segTheta; k++) {
    const th = (k / segTheta) * TAU, cos = Math.cos(th), sin = Math.sin(th);
    const pts = [];
    for (let i = 0; i <= segZ; i++) {
      const z0 = -L + (2 * L) * i / segZ;
      const r = catenoidR(z0, a);
      pts.push([r * cos, r * sin, z0 * zScale]);
    }
    lines.push(pts);
  }
  // Parallels (rings)
  for (let i = 0; i <= segZ; i++) {
    const z0 = -L + (2 * L) * i / segZ, z = z0 * zScale, r = catenoidR(z0, a);
    const pts = [];
    for (let k = 0; k <= segTheta; k++) {
      const th = (k / segTheta) * TAU;
      pts.push([r * Math.cos(th), r * Math.sin(th), z]);
    }
    lines.push(pts);
  }
  return lines;
}

// Memo keyed by the geometry values, as the original GEOM_CACHE was.
let geomMemo = { key: "", lines: [] };
function linesFor(v) {
  const key = JSON.stringify([v.a, v.L, v.zScale, v.segZ, v.segTheta]);
  if (geomMemo.key !== key) geomMemo = { key, lines: buildLines(v) };
  return geomMemo.lines;
}

/* --------------------------------------------------------------- render */

export function render(values, surface) {
  const { ctx, width: w, height: h, view = {} } = surface;
  const zoom = view.zoom ?? 0.8;
  const rot = snapDeg(view.screenRotateDeg ?? 60);

  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = values.stroke;

  const S = computeScreenScale(w, h, values.L, values.zScale, zoom);

  // Project, rotate in screen space, then depth-sort so far lines draw first.
  const projected = linesFor(values).map(pts => {
    const ps = pts.map(p => {
      const [x, y, z] = toScreen(p, w, h, S);
      const [rx, ry] = rotate2D([x, y], rot, w / 2, h / 2);
      return [rx, ry, z];
    });
    const zAvg = ps.reduce((s, p) => s + p[2], 0) / ps.length;
    return { pts: ps, zAvg };
  }).sort((p, q) => p.zAvg - q.zAvg);

  for (const ln of projected) {
    ctx.beginPath();
    ln.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  }
}

export function notes(values, view) {
  return {
    $status: `a ${values.a}  L ${values.L}  z ${values.zScale}  ${values.segTheta}×${values.segZ}  ` +
      `rot ${snapDeg(view.screenRotateDeg ?? 60)}°  zoom ${+(view.zoom ?? 0.8).toFixed(2)}`,
  };
}
