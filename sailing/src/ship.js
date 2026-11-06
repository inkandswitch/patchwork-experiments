// A procedural sloop, as GLB bytes. Pure: no DOM, no THREE, runs anywhere.
//
// About 12 m overall, drawn in the ship's body frame (DESIGN.md): bow toward
// −Z, starboard +X, up +Y, the waterline at y = 0 and the keel at −1.9. Each
// part is its own GLB with its origin where it pivots, so the layout can
// attach it under the hull and a play extension can turn it by its object's
// rotation alone: the wheel about its axle (local Z), the boom and sail
// about the mast (local Y). FIT says where each part goes on the hull.
//
// The hull is lofted from a few curves along its length (sheer, keel line,
// half-breadths at deck and waterline, and how full the sections are), so
// the sections run from a rounded V forward to flat and wide aft.

import { computeBounds, computeNormals, encodeGLB } from "./glb.js";

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * A smooth curve through [x, y] points (monotone cubic, Fritsch–Carlson), so
 * it never overshoots between them: a hull line that bulges past its control
 * points reads as a lump.
 */
function spline(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    x = clamp(x, xs[0], xs[n - 1]);
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ─── Colours (sRGB) ───────────────────────────────────────────────────────

const PAINT = {
  topsides: "#1c2a43",
  boot: "#efe8d6",
  cove: "#c9a04a",
  antifouling: "#93271f",
  teak: "#b08458",
  teakDark: "#6f4a2c",
  gelcoat: "#f0ede4",
  glass: "#18232c",
  spar: "#b3773c",
  wood: "#7a4a25",
  bronze: "#b48a4e",
  iron: "#34373a",
  wire: "#3a3c3e",
  sail: "#f3eee2",
  cover: "#3d5f84",
};

// ─── The hull's lines ─────────────────────────────────────────────────────

/** The hull's main dimensions, metres. */
export const HULL = Object.freeze({ length: 12, beam: 3.8, freeboard: 1.2, draft: 1.9, bow: -6, stern: 6 });

// Each curve is over u: 0 at the stem, 1 at the transom.
const SHEER = spline([[0, 1.66], [0.2, 1.42], [0.45, 1.26], [0.7, 1.19], [0.88, 1.19], [1, 1.25]]);
const KEEL_LINE = spline([[0, 1.3], [0.03, 0.82], [0.08, 0.2], [0.14, -0.16], [0.25, -0.42], [0.45, -0.56], [0.65, -0.46], [0.85, -0.2], [1, 0.03]]);
const DECK_HALF = spline([[0, 0], [0.04, 0.4], [0.12, 0.98], [0.25, 1.47], [0.45, 1.8], [0.6, 1.85], [0.8, 1.77], [1, 1.52]]);
const WATER_HALF = spline([[0, 0], [0.04, 0.1], [0.12, 0.66], [0.25, 1.3], [0.45, 1.8], [0.6, 1.9], [0.8, 1.84], [1, 1.6]]);
// superellipse exponent of the underwater sections: under 2 a rounded V, over 2 flat with a firm bilge
const FULLNESS = spline([[0, 1.3], [0.2, 1.45], [0.5, 2.2], [0.8, 3], [1, 3.4]]);
const CAMBER = 0.06;

const uAt = (z) => clamp((z - HULL.bow) / HULL.length, 0, 1);

/** The sheer (the deck's edge) height at z. */
export const sheerAt = (z) => SHEER(uAt(z));
/** The deck's half-breadth at z. */
export const halfBreadthAt = (z) => DECK_HALF(uAt(z));
/** The deck's height at (x, z): the sheer, crowned toward the centreline. */
export function deckAt(x, z) {
  const b = halfBreadthAt(z);
  const s = sheerAt(z);
  if (b < 1e-6) return s;
  const r = clamp(Math.abs(x) / b, 0, 1);
  return s + CAMBER * Math.min(1, b / 1.5) * (1 - r * r);
}

/** The half-section at z: t runs from the keel (0) to the sheer (1), giving [x ≥ 0, y]. */
function section(z) {
  const u = uAt(z);
  const s = SHEER(u);
  const yb = Math.min(KEEL_LINE(u), s);
  const bw = WATER_HALF(u);
  const bd = DECK_HALF(u);
  const e = 2 / FULLNESS(u);
  const ym = yb + (s - yb) * 0.48; // where the bottom's curve meets the topsides
  const T0 = 0.72;
  const point = (t) => {
    if (t <= T0) {
      const th = (t / T0) * (Math.PI / 2);
      return [bw * Math.pow(Math.sin(th), e), ym - (ym - yb) * Math.pow(Math.cos(th), e)];
    }
    const tau = (t - T0) / (1 - T0);
    return [bw + (bd - bw) * Math.pow(tau, 1.6), ym + (s - ym) * tau];
  };
  // y rises with t, so the t at a height is a bisection
  const tAt = (y) => {
    if (y <= yb) return 0;
    if (y >= s) return 1;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (point(mid)[1] < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { s, yb, point, tAt };
}

// ─── Building meshes ──────────────────────────────────────────────────────

/** Positions and triangles being built up; vertices are shared only within what one call adds. */
class Shape {
  constructor() {
    this.p = [];
    this.i = [];
  }
  get count() {
    return this.p.length / 3;
  }
  v(x, y, z) {
    this.p.push(x, y, z);
    return this.count - 1;
  }
  tri(a, b, c) {
    this.i.push(a, b, c);
  }
  /** rows × cols vertices from at(r, c), and the quads between them; wrap closes the columns (and rows) into rings. */
  grid(rows, cols, at, { wrap = false, wrapRows = false } = {}) {
    const base = this.count;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.v(...at(r, c));
    const rr = wrapRows ? rows : rows - 1;
    const cc = wrap ? cols : cols - 1;
    for (let r = 0; r < rr; r++) {
      for (let c = 0; c < cc; c++) {
        const r1 = (r + 1) % rows;
        const c1 = (c + 1) % cols;
        const a = base + r * cols + c;
        const b = base + r * cols + c1;
        const d = base + r1 * cols + c;
        const e = base + r1 * cols + c1;
        this.tri(a, b, e);
        this.tri(a, e, d);
      }
    }
    return base;
  }
  /** A fan from `centre` around the ring of points (closed). */
  fan(centre, ring, { closed = true } = {}) {
    const c = this.v(...centre);
    const first = this.count;
    for (const p of ring) this.v(...p);
    const n = ring.length;
    for (let k = 0; k < (closed ? n : n - 1); k++) this.tri(c, first + k, first + ((k + 1) % n));
  }
  /** Add another shape, its points mapped through fn. */
  add(shape, fn = (p) => p) {
    const off = this.count;
    for (let k = 0; k < shape.p.length; k += 3) this.v(...fn([shape.p[k], shape.p[k + 1], shape.p[k + 2]]));
    for (const ix of shape.i) this.i.push(ix + off);
    return this;
  }
}

/** A finished primitive for glb.js: smooth normals, unless `flat`. */
function prim(shape, color, { roughness = 0.7, metallic = 0, flat = false, normals = null } = {}) {
  if (flat) {
    const pos = [];
    for (const ix of shape.i) pos.push(shape.p[ix * 3], shape.p[ix * 3 + 1], shape.p[ix * 3 + 2]);
    const positions = Float32Array.from(pos);
    return { positions, normals: computeNormals(positions), color, roughness, metallic };
  }
  const positions = Float32Array.from(shape.p);
  const indices = Uint32Array.from(shape.i);
  return { positions, normals: normals ?? computeNormals(positions, indices), indices, color, roughness, metallic };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A round rod from a to b (radius r at a, r2 at b), with optional end caps. */
function rod(shape, a, b, r, { r2 = r, sides = 6, caps = false } = {}) {
  const d = norm(sub(b, a));
  const u = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const w = cross(d, u);
  const ring = (p, rad, k) => {
    const th = (k / sides) * Math.PI * 2;
    const c = Math.cos(th) * rad;
    const s = Math.sin(th) * rad;
    return [p[0] + u[0] * c + w[0] * s, p[1] + u[1] * c + w[1] * s, p[2] + u[2] * c + w[2] * s];
  };
  shape.grid(2, sides, (row, k) => (row === 0 ? ring(a, r, k) : ring(b, r2, k)), { wrap: true });
  if (caps) {
    shape.fan(a, Array.from({ length: sides }, (_, k) => ring(a, r, sides - k)));
    shape.fan(b, Array.from({ length: sides }, (_, k) => ring(b, r2, k)));
  }
}

/** A tube along a polyline, radius r. */
function tube(shape, path, r, sides = 6) {
  const frames = path.map((p, k) => {
    const prev = path[Math.max(0, k - 1)];
    const next = path[Math.min(path.length - 1, k + 1)];
    return norm(sub(next, prev));
  });
  let u = norm(cross(frames[0], Math.abs(frames[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const rings = path.map((p, k) => {
    const d = frames[k];
    // carry the frame along so the tube doesn't twist
    const w = norm(cross(d, u));
    u = norm(cross(w, d));
    return { p, u, w };
  });
  shape.grid(path.length, sides, (row, k) => {
    const { p, u: uu, w } = rings[row];
    const th = (k / sides) * Math.PI * 2;
    const c = Math.cos(th) * r;
    const s = Math.sin(th) * r;
    return [p[0] + uu[0] * c + w[0] * s, p[1] + uu[1] * c + w[1] * s, p[2] + uu[2] * c + w[2] * s];
  }, { wrap: true });
}

/**
 * A solid of revolution about +Y: profile [[radius, y], …] from bottom to
 * top. A point given twice makes a crease there (the zero-height band
 * between the copies has no area, so neither side's normals bend round it).
 */
function lathe(shape, profile, segs = 24, at = [0, 0, 0]) {
  shape.grid(profile.length, segs, (row, k) => {
    const [r, y] = profile[row];
    const th = (k / segs) * Math.PI * 2;
    return [at[0] + Math.cos(th) * r, at[1] + y, at[2] - Math.sin(th) * r];
  }, { wrap: true });
}

/** An axis-aligned box with hard edges, from min to max. */
function box(shape, [x0, y0, z0], [x1, y1, z1]) {
  const faces = [
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
  ];
  for (const f of faces) {
    const b = shape.count;
    for (const p of f) shape.v(...p);
    shape.tri(b, b + 1, b + 2);
    shape.tri(b, b + 2, b + 3);
  }
}

/** A NACA 00xx foil lofted from root to tip, leading edge forward (−Z), with a capped tip. */
function foil(shape, { root, tip, thick = 0.12, rows = 8, chordPts = 12 }) {
  // root/tip: { y, lead (z of the leading edge), chord }
  const half = (c) => 5 * thick * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
  const cs = Array.from({ length: chordPts + 1 }, (_, k) => 0.5 - 0.5 * Math.cos((k / chordPts) * Math.PI));
  // around the section: starboard from the leading edge to the trailing edge, then port back
  const around = [...cs.map((c) => [c, 1]), ...cs.slice(1, -1).reverse().map((c) => [c, -1])];
  const at = (row, k) => {
    const t = row / (rows - 1);
    const y = lerp(root.y, tip.y, t);
    const lead = lerp(root.lead, tip.lead, t);
    const chord = lerp(root.chord, tip.chord, t);
    const [c, side] = around[k];
    return [side * half(c) * chord, y, lead + c * chord];
  };
  shape.grid(rows, around.length, at, { wrap: true });
  const ring = around.map((_, k) => at(rows - 1, k));
  const cx = 0;
  const cz = tip.lead + tip.chord * 0.4;
  shape.fan([cx, tip.y, cz], ring);
}

/** A torus about +Z in the XY plane (a wheel's rim, a ring). */
function torus(shape, R, r, segs = 48, sides = 8, at = [0, 0, 0]) {
  shape.grid(segs, sides, (row, k) => {
    const a = (row / segs) * Math.PI * 2;
    const b = (k / sides) * Math.PI * 2;
    const rr = R + Math.cos(b) * r;
    return [at[0] + Math.cos(a) * rr, at[1] + Math.sin(a) * rr, at[2] + Math.sin(b) * r];
  }, { wrap: true, wrapRows: true });
}

/** A sphere (or an ellipsoid, with radii [rx, ry, rz]). */
function ellipsoid(shape, at, [rx, ry, rz], rows = 10, segs = 16) {
  shape.grid(rows + 1, segs, (row, k) => {
    const phi = (row / rows) * Math.PI;
    const th = (k / segs) * Math.PI * 2;
    return [at[0] + Math.sin(phi) * Math.cos(th) * rx, at[1] - Math.cos(phi) * ry, at[2] - Math.sin(phi) * Math.sin(th) * rz];
  }, { wrap: true });
}

// ─── Where the parts go ───────────────────────────────────────────────────

const MAST_Z = -1.6;
const MAST_HEIGHT = 14;
// the gooseneck, above the deck at the mast: high enough that the boom
// swings clear over a head standing in the cockpit (sole 0.72, eye 1.6 up)
const BOOM_HEIGHT = 1.45;
const COCKPIT = { z0: 1.95, z1: 5.15, half: 0.8, floor: 0.72 };
const CABIN = { z0: -1.3, z1: 1.95, half: 0.95, top: 1.72 };
const WHEEL_Z = 4.25;
const WHEEL_AXLE = 1.62;
const WINDLASS_Z = -4.35;
const LADDER_Z = 0.4;
const STEMHEAD = [0, sheerAt(HULL.bow) + 0.08, HULL.bow - 0.22];

const mastStep = [0, deckAt(0, MAST_Z), MAST_Z];
const gooseneck = [0, mastStep[1] + BOOM_HEIGHT, MAST_Z + 0.1];

/** Where each part goes, in the hull's frame: { position, rotation (Euler XYZ, radians) }. */
export const FIT = Object.freeze({
  mast: { position: mastStep, rotation: [0, 0, 0] },
  rig: { position: gooseneck, rotation: [0, 0, 0] },
  wheel: { position: [0, WHEEL_AXLE, WHEEL_Z], rotation: [0, 0, 0] },
  windlass: { position: [0, deckAt(0, WINDLASS_Z), WINDLASS_Z], rotation: [0, 0, 0] },
  ladder: { position: [halfBreadthAt(LADDER_Z), sheerAt(LADDER_Z), LADDER_Z], rotation: [0, 0, 0] },
  anchor: { position: [0, STEMHEAD[1] - 0.04, STEMHEAD[2] + 0.02], rotation: [0, 0, 0] },
});

// The sail, in the rig's frame (origin at the gooseneck): the boom runs aft along +Z.
const BOOM_LENGTH = 4.95;
const SAIL = {
  tack: [0, 0.1, 0.06],
  clew: [0, 0.14, 4.75],
  head: [0, mastStep[1] + MAST_HEIGHT - 0.35 - gooseneck[1], 0.1],
};

// ─── The hull ─────────────────────────────────────────────────────────────

/** The stations along the hull, closer together at the ends where the shape turns fastest, and at the cockpit's ends. */
function stations() {
  const N = 50;
  const must = [COCKPIT.z0, COCKPIT.z1];
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 0.5 * t + 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * t));
    const z = HULL.bow + u * HULL.length;
    if (must.every((m) => Math.abs(m - z) > 0.04)) out.push(z);
  }
  return [...out, ...must].sort((a, b) => a - b);
}

// The paint, as bands up the hull's side: below the waterline, a boot stripe
// at it, the topsides, a cove line just under the sheer. Each band ends at a
// height (or one measured down from the sheer) and has its own rows, so its
// edges are crisp.
const BANDS = [
  { top: () => -0.02, rows: 11, paint: "antifouling" },
  { top: () => 0.09, rows: 2, paint: "boot" },
  { top: (s) => s - 0.2, rows: 6, paint: "topsides" },
  { top: (s) => s - 0.165, rows: 1, paint: "cove" },
  { top: (s) => s, rows: 2, paint: "topsides" },
];

function hullMeshes() {
  const zs = stations();
  const T = BANDS.reduce((n, b) => n + b.rows, 0);
  const cross = 2 * T + 1;
  // the whole skin as one grid (station × around the section, port sheer to
  // starboard sheer), so its normals are smooth across the bands
  const skin = new Shape();
  const sections = zs.map((z) => {
    const sec = section(z);
    const ts = [0];
    let from = 0;
    for (const band of BANDS) {
      const to = sec.tAt(clamp(band.top(sec.s), sec.yb, sec.s));
      for (let r = 1; r <= band.rows; r++) ts.push(lerp(from, to, r / band.rows));
      from = to;
    }
    return { z, sec, ts };
  });
  const point = (i, k) => {
    const { z, sec, ts } = sections[i];
    const side = k < T ? -1 : 1;
    const [x, y] = sec.point(ts[Math.abs(k - T)]);
    return [side * x, y, z];
  };
  skin.grid(zs.length, cross, point);
  const normals = computeNormals(Float32Array.from(skin.p), Uint32Array.from(skin.i));

  // then each band cut out of it, port and starboard, with the skin's normals
  const byPaint = new Map();
  let row = 0;
  for (const band of BANDS) {
    const ranges = row === 0 ? [[T - band.rows, T + band.rows]] : [[T - row - band.rows, T - row], [T + row, T + row + band.rows]];
    for (const [k0, k1] of ranges) {
      const s = byPaint.get(band.paint) ?? { shape: new Shape(), normals: [] };
      byPaint.set(band.paint, s);
      const cols = k1 - k0 + 1;
      s.shape.grid(zs.length, cols, (i, c) => {
        const ix = i * cross + k0 + c;
        s.normals.push(normals[ix * 3], normals[ix * 3 + 1], normals[ix * 3 + 2]);
        return [skin.p[ix * 3], skin.p[ix * 3 + 1], skin.p[ix * 3 + 2]];
      });
    }
    row += band.rows;
  }
  const finish = { antifouling: { roughness: 0.9 }, boot: { roughness: 0.4 }, topsides: { roughness: 0.3 }, cove: { roughness: 0.4, metallic: 0.3 } };
  const prims = [...byPaint].map(([paint, s]) => prim(s.shape, PAINT[paint], { ...finish[paint], normals: Float32Array.from(s.normals) }));

  // the transom: the last section closed by the deck's crown
  const last = zs.length - 1;
  const zT = zs[last];
  const outline = Array.from({ length: cross }, (_, k) => point(last, k));
  const cols = deckColumns(zT);
  for (let j = cols.length - 2; j >= 1; j--) outline.push([cols[j], deckAt(cols[j], zT), zT]);
  const transom = new Shape();
  const cy = outline.reduce((a, p) => a + p[1], 0) / outline.length;
  transom.fan([0, cy, zT], outline.reverse());
  prims.push(prim(transom, PAINT.topsides, { roughness: 0.3 }));

  // keel and rudder, painted as the bottom is
  const under = new Shape();
  foil(under, { root: { y: -0.3, lead: -1.05, chord: 1.55 }, tip: { y: -1.58, lead: -0.62, chord: 1.0 }, thick: 0.13 });
  foil(under, { root: { y: 0.05, lead: 4.5, chord: 0.58 }, tip: { y: -1.38, lead: 4.62, chord: 0.4 }, thick: 0.12 });
  // the ballast bulb: a torpedo, blunt forward
  const bulb = new Shape();
  lathe(bulb, [[0, -0.92], [0.12, -0.84], [0.2, -0.66], [0.25, -0.35], [0.26, 0], [0.24, 0.35], [0.17, 0.66], [0.08, 0.86], [0, 0.95]], 20);
  under.add(bulb, ([x, y, z]) => [x * 1.12, -1.66 - z, -0.05 + y]);
  prims.push(prim(under, PAINT.antifouling, { roughness: 0.9 }));

  return [{ name: "Hull", primitives: [...prims, ...deckMeshes(zs)] }];
}

/** The deck's columns at z: the two sheer edges, and fixed lines between (the cockpit's sides among them). */
function deckColumns(z) {
  const b = halfBreadthAt(z);
  const inner = [-1.5, -1.15, -0.8, -0.4, 0, 0.4, 0.8, 1.15, 1.5].map((x) => clamp(x, -b, b));
  return [-b, ...inner, b];
}

function deckMeshes(zs) {
  const prims = [];
  const inCockpit = (x, z) => z > COCKPIT.z0 && z < COCKPIT.z1 && Math.abs(x) < COCKPIT.half;

  // the deck: a crowned grid between the sheers, open over the cockpit
  const deck = new Shape();
  const cols = zs.map((z) => deckColumns(z));
  const nc = cols[0].length;
  const base = deck.count;
  zs.forEach((z, i) => cols[i].forEach((x) => deck.v(x, deckAt(x, z), z)));
  for (let i = 0; i < zs.length - 1; i++) {
    for (let j = 0; j < nc - 1; j++) {
      const xm = (cols[i][j] + cols[i][j + 1]) / 2;
      const zm = (zs[i] + zs[i + 1]) / 2;
      if (inCockpit(xm, zm)) continue;
      const a = base + i * nc + j;
      const b = base + (i + 1) * nc + j;
      const c = base + (i + 1) * nc + j + 1;
      const d = base + i * nc + j + 1;
      deck.tri(a, b, c);
      deck.tri(a, c, d);
    }
  }
  prims.push(prim(deck, PAINT.teak, { roughness: 0.85 }));

  // the cockpit well: white sides, a teak sole and benches either side
  const well = new Shape();
  const wz = zs.filter((z) => z >= COCKPIT.z0 - 1e-9 && z <= COCKPIT.z1 + 1e-9);
  for (const side of [-1, 1]) {
    const x = side * COCKPIT.half;
    well.grid(wz.length, 2, (i, r) => [x, r === 0 ? deckAt(x, wz[i]) : COCKPIT.floor, wz[i]]);
  }
  const xs = [-0.8, -0.4, 0, 0.4, 0.8];
  for (const z of [COCKPIT.z0, COCKPIT.z1]) well.grid(xs.length, 2, (j, r) => [xs[j], r === 0 ? deckAt(xs[j], z) : COCKPIT.floor, z]);
  prims.push(prim(well, PAINT.gelcoat, { roughness: 0.5 }));
  const sole = new Shape();
  box(sole, [-COCKPIT.half, COCKPIT.floor - 0.02, COCKPIT.z0], [COCKPIT.half, COCKPIT.floor, COCKPIT.z1]);
  for (const side of [-1, 1]) {
    const [x0, x1] = side < 0 ? [-COCKPIT.half, -COCKPIT.half + 0.42] : [COCKPIT.half - 0.42, COCKPIT.half];
    box(sole, [x0, COCKPIT.floor, COCKPIT.z0], [x1, COCKPIT.floor + 0.36, 3.75]);
  }
  prims.push(prim(sole, PAINT.teak, { roughness: 0.85 }));
  // coamings: low teak walls round the cockpit's sides, a backrest for the benches
  const coaming = new Shape();
  for (const side of [-1, 1]) {
    const x = side * (COCKPIT.half + 0.02);
    const cz = wz.filter((z) => z <= 4.1);
    coaming.grid(cz.length, 3, (i, r) => {
      const z = cz[i];
      const h = 0.2 * smoothstep(4.1, 3.5, z);
      return r === 0 ? [x - side * 0.02, deckAt(x, z) - 0.02, z] : r === 1 ? [x - side * 0.02, deckAt(x, z) + h, z] : [x + side * 0.02, deckAt(x, z) + h, z];
    });
  }
  prims.push(prim(coaming, PAINT.teakDark, { roughness: 0.7 }));

  // the cabin trunk: a rounded box, its sides leaning in, its top crowned
  const K = 56;
  const zc = (CABIN.z0 + CABIN.z1) / 2;
  const L = (CABIN.z1 - CABIN.z0) / 2;
  // in plan a superellipse (|x/W|^5 + |z/L|^5 = 1), narrower forward
  const cabinHalf = (z) => CABIN.half * lerp(0.74, 1, smoothstep(CABIN.z0, CABIN.z1, z)) * Math.pow(Math.max(0, 1 - Math.abs((z - zc) / L) ** 5), 1 / 5);
  const plan = Array.from({ length: K }, (_, k) => {
    const a = (k / K) * Math.PI * 2;
    const c = Math.cos(a);
    const z = zc + L * Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 2 / 5);
    return [Math.sign(c) * cabinHalf(z), z];
  });
  const inset = (p, d) => {
    const x = p[0] - Math.sign(p[0]) * d * Math.min(1, Math.abs(p[0]) / 0.3);
    const z = zc + (p[1] - zc) * ((L - d) / L);
    return [x, z];
  };
  const walls = new Shape();
  walls.grid(2, K, (r, k) => {
    const [x, z] = r === 0 ? plan[k] : inset(plan[k], 0.07);
    return [x, r === 0 ? 1.0 : CABIN.top, z];
  }, { wrap: true });
  const roof = new Shape();
  const rings = [0, 0.3, 0.55, 0.75, 0.9, 1];
  roof.grid(rings.length, K, (r, k) => {
    const [x, z] = inset(plan[k], 0.07);
    const q = 1 - rings[r];
    return [x * q, CABIN.top + 0.05 * (1 - q * q), zc + (z - zc) * q];
  }, { wrap: true });
  prims.push(prim(walls, PAINT.gelcoat, { roughness: 0.45 }));
  prims.push(prim(roof, PAINT.gelcoat, { roughness: 0.55 }));

  // portlights along the cabin's sides, on its leaning wall
  const ports = new Shape();
  const onWall = (side, y, z) => [side * (cabinHalf(z) - ((y - 1.0) / (CABIN.top - 1.0)) * 0.07 + 0.01), y, z];
  for (const side of [-1, 1]) {
    for (const z0 of [-0.7, 0.2, 1.05]) {
      const pts = Array.from({ length: 16 }, (_, k) => {
        const a = (k / 16) * Math.PI * 2;
        const z = z0 + Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.5) * 0.28;
        return onWall(side, 1.47 + Math.sin(a) * 0.075, z);
      });
      ports.fan(onWall(side, 1.47, z0), pts);
    }
  }
  prims.push(prim(ports, PAINT.glass, { roughness: 0.15, metallic: 0.2 }));

  // the companionway: washboards in the cabin's aft end, and its sliding hatch
  const hatch = new Shape();
  box(hatch, [-0.27, COCKPIT.floor, CABIN.z1 - 0.12], [0.27, CABIN.top - 0.04, CABIN.z1 + 0.015]);
  box(hatch, [-0.32, CABIN.top + 0.02, 1.15], [0.32, CABIN.top + 0.1, CABIN.z1 + 0.02]);
  box(hatch, [-0.35, CABIN.top + 0.02, -0.75], [0.35, CABIN.top + 0.1, -0.15]);
  prims.push(prim(hatch, PAINT.teakDark, { roughness: 0.7 }));

  // a toe rail along the sheer, both sides
  const rail = new Shape();
  for (const side of [-1, 1]) {
    const prof = [[0.005, 0], [0.005, 0.055], [-0.04, 0.055], [-0.04, 0.0]];
    rail.grid(zs.length, prof.length, (i, r) => {
      const b = halfBreadthAt(zs[i]);
      const s = sheerAt(zs[i]);
      const shrink = Math.min(1, b / 0.3);
      return [side * Math.max(0, b + prof[r][0] * shrink), s + prof[r][1], zs[i]];
    });
  }
  prims.push(prim(rail, PAINT.teakDark, { roughness: 0.7 }));

  // stainless: the bow fitting the anchor hangs from, stanchions, the pulpit,
  // the pushpit, and the lifelines between them
  const steel = new Shape();
  // the bow roller: two cheeks past the stem, a roller between them
  for (const x of [-0.06, 0.05]) box(steel, [x, STEMHEAD[1] - 0.09, STEMHEAD[2] - 0.05], [x + 0.012, STEMHEAD[1] + 0.03, HULL.bow + 0.4]);
  box(steel, [-0.06, sheerAt(HULL.bow + 0.4) - 0.01, HULL.bow - 0.02], [0.06, sheerAt(HULL.bow + 0.4) + 0.012, HULL.bow + 0.4]);
  rod(steel, [-0.05, STEMHEAD[1] - 0.03, STEMHEAD[2]], [0.05, STEMHEAD[1] - 0.03, STEMHEAD[2]], 0.035, { sides: 10, caps: true });
  const H = 0.62;
  const posts = [-3.9, -2.4, -0.9, 0.6, 2.1, 3.6];
  const postAt = (side, z) => {
    const x = side * (halfBreadthAt(z) - 0.07);
    return [x, deckAt(x, z), z];
  };
  for (const side of [-1, 1]) {
    for (const z of posts) {
      const p = postAt(side, z);
      rod(steel, p, [p[0], p[1] + H, p[2]], 0.014);
    }
  }
  // pulpit: a hoop round the bow; pushpit: one round the stern
  const hoop = (zs, side) => zs.map((z) => postAt(side, z));
  const pulpitZ = [-4.9, -5.3, -5.6];
  const pulpit = [...hoop(pulpitZ, -1), postAt(0, -5.75), ...hoop([...pulpitZ].reverse(), 1)].map((p) => [p[0] * 0.92, p[1] + H, p[2]]);
  tube(steel, pulpit, 0.016);
  for (const p of [pulpit[0], pulpit[2], pulpit[4], pulpit[6]]) rod(steel, [p[0], deckAt(p[0], p[2]), p[2]], p, 0.016);
  const pushpitZ = [4.9, 5.5, 5.85];
  const pushpit = [...hoop(pushpitZ, -1), ...hoop([...pushpitZ].reverse(), 1)].map((p) => [p[0] * 0.95, p[1] + H, p[2]]);
  tube(steel, pushpit, 0.016);
  for (const p of [pushpit[0], pushpit[2], pushpit[3], pushpit[5]]) rod(steel, [p[0], deckAt(p[0], p[2]), p[2]], p, 0.016);
  prims.push(prim(steel, "#cfd3d6", { roughness: 0.3, metallic: 0.8 }));
  const lines = new Shape();
  for (const side of [-1, 1]) {
    const tops = [pulpitZ[0], ...posts, pushpitZ[0]].map((z) => postAt(side, z));
    for (const h of [H, H * 0.55]) tube(lines, tops.map((p) => [p[0], p[1] + h, p[2]]), 0.006, 4);
  }
  prims.push(prim(lines, PAINT.wire, { roughness: 0.5, metallic: 0.5 }));

  // the wheel's pedestal, with a compass on top
  const ped = new Shape();
  lathe(ped, [[0, 0], [0.13, 0], [0.13, 0.04], [0.13, 0.04], [0.07, 0.08], [0.06, 0.5], [0.08, 0.8], [0.12, 0.86], [0.12, 0.86], [0.12, 0.92], [0.12, 0.92], [0, 0.92]], 20, [0, COCKPIT.floor, WHEEL_Z - 0.22]);
  rod(ped, [0, WHEEL_AXLE, WHEEL_Z - 0.2], [0, WHEEL_AXLE, WHEEL_Z - 0.05], 0.03, { caps: true });
  prims.push(prim(ped, PAINT.gelcoat, { roughness: 0.4 }));
  const compass = new Shape();
  ellipsoid(compass, [0, COCKPIT.floor + 0.92, WHEEL_Z - 0.22], [0.1, 0.08, 0.1], 8, 16);
  prims.push(prim(compass, PAINT.glass, { roughness: 0.1, metallic: 0.3 }));
  return prims;
}

// ─── The rig ──────────────────────────────────────────────────────────────

function mastMeshes() {
  const top = MAST_HEIGHT;
  // the mast: an oval section, tapering above the spreaders
  const mast = new Shape();
  const ys = [0, 0.4, 3, 6, 7.5, 9, 11, 12.5, 13.5, top];
  mast.grid(ys.length, 16, (r, k) => {
    const y = ys[r];
    const taper = 1 - 0.45 * smoothstep(7.5, top, y);
    const a = (k / 16) * Math.PI * 2;
    return [Math.cos(a) * 0.065 * taper, y, Math.sin(a) * 0.095 * taper];
  }, { wrap: true });
  mast.fan([0, top + 0.03, 0], Array.from({ length: 16 }, (_, k) => {
    const a = (k / 16) * Math.PI * 2;
    return [Math.cos(a) * 0.065 * 0.55, top, Math.sin(a) * 0.095 * 0.55];
  }).reverse());
  // spreaders, swept a little aft
  const spreaderY = 7.5;
  const tips = [-1, 1].map((s) => [s * 0.92, spreaderY + 0.04, 0.16]);
  for (const t of tips) rod(mast, [0, spreaderY, 0], t, 0.035, { r2: 0.02, caps: true });
  // the masthead's crane, where the backstay and halyard sit
  box(mast, [-0.04, top - 0.05, -0.12], [0.04, top + 0.02, 0.22]);
  const parts = [prim(mast, PAINT.spar, { roughness: 0.45 })];

  // standing rigging, from the mast to the hull (FIT gives where the mast stands)
  const [, baseY, baseZ] = mastStep;
  const onHull = (x, y, z) => [x, y - baseY, z - baseZ];
  const wires = new Shape();
  const chain = (side, dz) => {
    const z = MAST_Z + 0.25 + dz;
    const x = side * (halfBreadthAt(z) - 0.06);
    return onHull(x, sheerAt(z) + 0.05, z);
  };
  for (const [side, tip] of [[-1, tips[0]], [1, tips[1]]]) {
    tube(wires, [[0, top - 0.2, 0], tip, chain(side, 0)], 0.008, 4);
    rod(wires, [0, spreaderY - 0.1, 0], chain(side, -0.45), 0.008, { sides: 4 });
    rod(wires, [0, spreaderY - 0.1, 0], chain(side, 0.45), 0.008, { sides: 4 });
  }
  const stem = onHull(STEMHEAD[0], STEMHEAD[1], STEMHEAD[2] + 0.1);
  const stern = onHull(0, sheerAt(HULL.stern) + 0.05, HULL.stern - 0.08);
  rod(wires, [0, top - 0.1, -0.08], stem, 0.009, { sides: 4 });
  rod(wires, [0, top, 0.2], stern, 0.009, { sides: 4 });
  parts.push(prim(wires, PAINT.wire, { roughness: 0.5, metallic: 0.6 }));

  // a jib rolled up on the forestay, in its blue cover
  const furl = new Shape();
  const fa = [0, top - 0.1, -0.08];
  const along = (t) => [lerp(fa[0], stem[0], t), lerp(fa[1], stem[1], t), lerp(fa[2], stem[2], t)];
  const path = [0.04, 0.1, 0.3, 0.55, 0.8, 0.95].map(along);
  const radii = [0.02, 0.045, 0.065, 0.07, 0.06, 0.035];
  const d = norm(sub(stem, fa));
  const u = norm(cross(d, [1, 0, 0]));
  const w = cross(d, u);
  furl.grid(path.length, 10, (r, k) => {
    const th = (k / 10) * Math.PI * 2;
    const p = path[r];
    const rr = radii[r];
    return [p[0] + (u[0] * Math.cos(th) + w[0] * Math.sin(th)) * rr, p[1] + (u[1] * Math.cos(th) + w[1] * Math.sin(th)) * rr, p[2] + (u[2] * Math.cos(th) + w[2] * Math.sin(th)) * rr];
  }, { wrap: true });
  parts.push(prim(furl, PAINT.cover, { roughness: 0.85 }));
  return [{ name: "Mast", primitives: parts }];
}

/** The mainsail: luff up the mast, foot along the boom, a roach to the leech and a camber to starboard. */
function sailShape() {
  const rows = 26;
  const cols = 12;
  const { tack, clew, head } = SAIL;
  const leech = [head[1] - clew[1], head[2] - clew[2]];
  const ll = Math.hypot(leech[0], leech[1]);
  const out = [-leech[1] / ll, leech[0] / ll]; // across the leech, up and aft, in (y, z)
  const shape = new Shape();
  shape.grid(rows + 1, cols + 1, (r, c) => {
    const h = r / rows;
    const lu = [lerp(tack[1], head[1], h), lerp(tack[2], head[2], h)];
    const roach = 0.55 * Math.pow(Math.sin(Math.PI * h), 0.9) * (1 - h * 0.3);
    const le = [lerp(clew[1], head[1], h) + out[0] * roach, lerp(clew[2], head[2], h) + out[1] * roach];
    const t = c / cols;
    const chord = Math.hypot(le[0] - lu[0], le[1] - lu[1]);
    // deepest at 40% of the chord; flat along the boom, full up the middle, twisted off at the top
    const shapeAt = (t * Math.pow(1 - t, 1.5)) / 0.186;
    const depth = 0.085 * chord * shapeAt * smoothstep(0, 0.14, h);
    const twist = 0.35 * h * t * t;
    return [depth + twist, lerp(lu[0], le[0], t), lerp(lu[1], le[1], t)];
  });
  return shape;
}

function rigMeshes() {
  const parts = [];
  const boom = new Shape();
  lathe(boom, [[0, 0], [0.05, 0], [0.05, 0], [0.065, 0.25], [0.068, 2.5], [0.06, BOOM_LENGTH - 0.15], [0.045, BOOM_LENGTH], [0.045, BOOM_LENGTH], [0, BOOM_LENGTH]], 12);
  const along = new Shape().add(boom, ([x, y, z]) => [x, -z, y]);
  parts.push(prim(along, PAINT.spar, { roughness: 0.45 }));
  const fittings = new Shape();
  box(fittings, [-0.05, -0.06, -0.1], [0.05, 0.06, 0.04]);
  parts.push(prim(fittings, PAINT.bronze, { roughness: 0.35, metallic: 0.8 }));
  // the sail is its own mesh (node "Sail"), so a view can lower it to the boom
  const cloth = [prim(sailShape(), PAINT.sail, { roughness: 0.9 })];
  // battens: four stiff strips in pockets, darker against the cloth
  const battens = new Shape();
  const sail = sailShape();
  const cols = 13;
  for (const r of [6, 11, 16, 21]) {
    const pts = [];
    for (let c = 6; c < cols; c++) {
      const ix = r * cols + c;
      pts.push([sail.p[ix * 3] + 0.012, sail.p[ix * 3 + 1], sail.p[ix * 3 + 2]]);
    }
    tube(battens, pts, 0.018, 4);
  }
  cloth.push(prim(battens, "#d8d2c3", { roughness: 0.8 }));
  return [
    { name: "Boom and sail", primitives: parts },
    { name: "Sail", primitives: cloth },
  ];
}

// ─── Fittings ─────────────────────────────────────────────────────────────

function wheelMeshes() {
  const wood = new Shape();
  torus(wood, 0.43, 0.032, 56, 8);
  const bronze = new Shape();
  rod(bronze, [0, 0, -0.08], [0, 0, 0.08], 0.085, { caps: true, sides: 16 });
  ellipsoid(bronze, [0, 0, 0.08], [0.05, 0.05, 0.03], 6, 12);
  const spokes = 8;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const dir = [Math.cos(a), Math.sin(a), 0];
    const p = (r) => [dir[0] * r, dir[1] * r, 0];
    rod(wood, p(0.08), p(0.44), 0.02, { r2: 0.016, sides: 6 });
    // a turned handle beyond the rim
    rod(wood, p(0.46), p(0.55), 0.022, { r2: 0.03, sides: 8 });
    ellipsoid(wood, p(0.58), [0.032, 0.032, 0.032], 6, 8);
  }
  return [{ name: "Wheel", primitives: [prim(wood, PAINT.wood, { roughness: 0.55 }), prim(bronze, PAINT.bronze, { roughness: 0.3, metallic: 0.85 })] }];
}

function windlassMeshes() {
  const drum = new Shape();
  lathe(drum, [[0.17, 0.08], [0.15, 0.2], [0.13, 0.32], [0.15, 0.44], [0.19, 0.5], [0.19, 0.5], [0.24, 0.52], [0.25, 0.62], [0.25, 0.62], [0.2, 0.66], [0, 0.68]], 24);
  // whelps: ribs down the drum the rode grips on
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const c = Math.cos(a);
    const s = -Math.sin(a);
    rod(drum, [c * 0.15, 0.1, s * 0.15], [c * 0.16, 0.48, s * 0.16], 0.022, { r2: 0.028, sides: 5 });
  }
  const base = new Shape();
  lathe(base, [[0, 0], [0.3, 0], [0.3, 0.05], [0.3, 0.05], [0.24, 0.07], [0.18, 0.1], [0, 0.1]], 24);
  ellipsoid(base, [0, 0.68, 0], [0.07, 0.04, 0.07], 6, 12);
  const bars = new Shape();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const dir = [Math.cos(a), 0, -Math.sin(a)];
    rod(bars, [dir[0] * 0.2, 0.57, dir[2] * 0.2], [dir[0] * 0.62, 0.6, dir[2] * 0.62], 0.024, { r2: 0.028, sides: 6, caps: true });
  }
  return [{
    name: "Windlass",
    primitives: [prim(drum, PAINT.wood, { roughness: 0.6 }), prim(base, PAINT.bronze, { roughness: 0.3, metallic: 0.85 }), prim(bars, PAINT.spar, { roughness: 0.5 })],
  }];
}

/** A boarding ladder, hooked over the gunwale (its origin) and hanging down the starboard side (+X) into the water. */
function ladderMeshes() {
  const wood = new Shape();
  const bottom = -sheerAt(LADDER_Z) - 0.95;
  for (const z of [-0.22, 0.22]) {
    // hook over the toe rail, out past the topsides' bulge, then straight down
    tube(wood, [[-0.1, 0.02, z], [-0.08, 0.12, z], [0.04, 0.16, z], [0.15, 0.08, z], [0.17, -0.15, z], [0.17, bottom, z]], 0.026, 6);
  }
  for (let y = -0.3; y > bottom + 0.05; y -= 0.3) rod(wood, [0.17, y, -0.22], [0.17, y, 0.22], 0.022, { sides: 6 });
  // standoffs that hold it off the hull
  const steel = new Shape();
  for (const z of [-0.22, 0.22]) rod(steel, [0.17, -0.55, z], [0.03, -0.55, z], 0.015, { caps: true });
  return [{ name: "Ladder", primitives: [prim(wood, PAINT.wood, { roughness: 0.6 }), prim(steel, "#cfd3d6", { roughness: 0.3, metallic: 0.8 })] }];
}

/** An old-fashioned anchor, hanging from its ring (the origin). */
function anchorMeshes() {
  const iron = new Shape();
  // the ring, at right angles to the arms
  const ring = new Shape();
  torus(ring, 0.07, 0.013, 24, 6);
  iron.add(ring, ([x, y, z]) => [-z, y - 0.07, x]);
  rod(iron, [0, -0.13, 0], [0, -1.02, 0], 0.03, { r2: 0.038, sides: 8, caps: true });
  // the crown and arms: an arc round the shank's foot
  const arc = [];
  for (let k = 0; k <= 12; k++) {
    const a = -Math.PI / 2 + ((k - 6) / 6) * 1.05;
    arc.push([Math.cos(a) * 0.42, -0.62 + Math.sin(a) * 0.42, 0]);
  }
  tube(iron, arc, 0.034, 8);
  // flukes: broad spades at the arms' ends, across the arms' plane
  for (const end of [arc[0], arc[12]]) {
    const prev = end === arc[0] ? arc[1] : arc[11];
    const t = norm(sub(end, prev));
    const n = norm(cross(t, [0, 0, 1])); // in the arms' plane, across the arm
    const p = (along, wide, thick) => [end[0] - t[0] * along + n[0] * thick, end[1] - t[1] * along + n[1] * thick, wide];
    const b = iron.count;
    for (const th of [0.012, -0.012]) {
      iron.v(...p(-0.06, 0, th));
      iron.v(...p(0.08, 0.13, th));
      iron.v(...p(0.24, 0, th));
      iron.v(...p(0.08, -0.13, th));
    }
    iron.tri(b, b + 1, b + 2);
    iron.tri(b, b + 2, b + 3);
    iron.tri(b + 4, b + 6, b + 5);
    iron.tri(b + 4, b + 7, b + 6);
  }
  const stock = new Shape();
  rod(stock, [0, -0.2, -0.48], [0, -0.2, 0.48], 0.022, { sides: 8 });
  ellipsoid(stock, [0, -0.2, -0.5], [0.035, 0.035, 0.035], 6, 8);
  ellipsoid(stock, [0, -0.2, 0.5], [0.035, 0.035, 0.035], 6, 8);
  return [{ name: "Anchor", primitives: [prim(iron, PAINT.iron, { roughness: 0.6, metallic: 0.5 }), prim(stock, PAINT.iron, { roughness: 0.6, metallic: 0.5 })] }];
}

// ─── Landmarks ────────────────────────────────────────────────────────────

/** A channel buoy floating at y = 0: a red can or a green cone. */
function buoyMeshes(kind) {
  const red = kind === "red";
  const paint = red ? "#b8261e" : "#2f7a3a";
  const body = new Shape();
  lathe(body, [[0, -0.7], [0.3, -0.7], [0.5, -0.3], [0.55, 0], [0.55, 0.15], [0.55, 0.15], [0.48, 0.2], [0.48, 0.2], [0.42, 1.2], [0.42, 1.2], [0, 1.2]], 20);
  const mark = new Shape();
  if (red) lathe(mark, [[0, 1.6], [0.22, 1.6], [0.22, 1.6], [0.22, 2.05], [0.22, 2.05], [0, 2.05]], 16);
  else lathe(mark, [[0, 1.6], [0.26, 1.6], [0.26, 1.6], [0, 2.15]], 16);
  const pole = new Shape();
  rod(pole, [0, 1.2, 0], [0, 1.62, 0], 0.04);
  ellipsoid(pole, [0, 2.3, 0], [0.07, 0.1, 0.07], 6, 10);
  return [{
    name: red ? "Red buoy" : "Green buoy",
    primitives: [prim(body, paint, { roughness: 0.55 }), prim(mark, paint, { roughness: 0.55 }), prim(pole, "#e8e4da", { roughness: 0.5 })],
  }];
}

/** Deterministic value noise in [−1, 1] (a hash, not Math.random, so every peer draws the same rock). */
function noise(x, y) {
  const h = (i, j) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return 2 * lerp(lerp(h(i, j), h(i + 1, j), ux), lerp(h(i, j + 1), h(i + 1, j + 1), ux), uy) - 1;
}

/** A rocky islet with a lighthouse, standing in the sea (its base at −4). */
function isletMeshes() {
  const R = 24;
  const H = 8;
  const rings = 9;
  const segs = 30;
  const rock = new Shape();
  rock.grid(rings + 1, segs, (r, k) => {
    const q = r / rings;
    const a = (k / segs) * Math.PI * 2;
    const wob = 1 + 0.22 * noise(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 1) + 0.08 * noise(a * 3, q * 4);
    const rad = q === 0 ? 0 : R * q * wob;
    const y = q === 1 ? -4 : H * Math.pow(1 - Math.pow(q, 1.6), 0.9) * (1 + 0.15 * q * noise(a * 2.3, q * 5)) - 0.6 * q;
    return [Math.cos(a) * rad, y, -Math.sin(a) * rad];
  }, { wrap: true });
  // flat-shaded, coloured face by face: sand at the water, grass on the gentle top, rock elsewhere
  const pos = [];
  const col = [];
  const C = { sand: [0.69, 0.6, 0.4], grass: [0.16, 0.26, 0.08], rock: [0.22, 0.2, 0.18] };
  for (let t = 0; t < rock.i.length; t += 3) {
    const v = [0, 1, 2].map((k) => rock.i[t + k]).map((ix) => [rock.p[ix * 3], rock.p[ix * 3 + 1], rock.p[ix * 3 + 2]]);
    const n = norm(cross(sub(v[1], v[0]), sub(v[2], v[0])));
    const y = (v[0][1] + v[1][1] + v[2][1]) / 3;
    const c = y < 0.9 ? C.sand : Math.abs(n[1]) > 0.82 && y > 2.5 ? C.grass : C.rock;
    const shade = 0.85 + 0.3 * (Math.sin(t * 12.9898) * 0.5 + 0.5);
    for (const p of v) {
      pos.push(...p);
      col.push(c[0] * shade, c[1] * shade, c[2] * shade);
    }
  }
  const positions = Float32Array.from(pos);
  const ground = { positions, normals: computeNormals(positions), colors: Float32Array.from(col), roughness: 0.95 };

  // the lighthouse on the top
  const top = H - 0.4;
  const bands = [
    [0, 2.6, "#efece4"],
    [2.6, 4.2, "#b8261e"],
    [4.2, 6.8, "#efece4"],
    [6.8, 8.4, "#b8261e"],
  ];
  const tower = [];
  for (const [y0, y1, paint] of bands) {
    const s = new Shape();
    const r = (y) => lerp(1.5, 1.0, y / 8.4);
    lathe(s, [[r(y0), y0], [r(y1), y1]], 24, [0, top, 0]);
    tower.push(prim(s, paint, { roughness: 0.6 }));
  }
  const gallery = new Shape();
  lathe(gallery, [[0, 8.4], [1.45, 8.4], [1.45, 8.4], [1.45, 8.6], [1.45, 8.6], [0, 8.6]], 24, [0, top, 0]);
  lathe(gallery, [[0.85, 9.9], [0.85, 9.9], [1.0, 9.9], [0.2, 10.7], [0, 10.9]], 24, [0, top, 0]);
  const lantern = new Shape();
  lathe(lantern, [[0.75, 8.6], [0.75, 9.9]], 16, [0, top, 0]);
  return [{
    name: "Islet",
    primitives: [ground, ...tower, prim(gallery, "#2a2c2e", { roughness: 0.5, metallic: 0.4 }), prim(lantern, "#f4e7b0", { roughness: 0.2 })],
  }];
}

// ─── Parts, as GLBs ───────────────────────────────────────────────────────

const PARTS = {
  // the hull says its own principal dimensions: its box also holds the cabin,
  // the sheer's rise to the bow and the lifelines, which stand above the deck
  hull: { name: "Hull", meshes: hullMeshes, extras: () => ({ ship: { length: HULL.length, beam: HULL.beam, draft: HULL.draft, freeboard: HULL.freeboard } }) },
  mast: { name: "Mast", meshes: mastMeshes },
  rig: { name: "Boom and sail", meshes: rigMeshes, extras: () => ({ sail: sailFacts() }) },
  wheel: { name: "Wheel", meshes: wheelMeshes },
  windlass: { name: "Windlass", meshes: windlassMeshes },
  ladder: { name: "Ladder", meshes: ladderMeshes },
  anchor: { name: "Anchor", meshes: anchorMeshes },
  redBuoy: { name: "Red buoy", meshes: () => buoyMeshes("red") },
  greenBuoy: { name: "Green buoy", meshes: () => buoyMeshes("green") },
  islet: { name: "Islet", meshes: isletMeshes },
};

/** The kinds of part there are. */
export const KINDS = Object.freeze(Object.keys(PARTS));

/** The sail's size, in the rig's frame, for anyone who'd rather read it than measure the mesh. */
function sailFacts() {
  const { tack, clew, head } = SAIL;
  const luff = Math.hypot(...sub(head, tack));
  const foot = Math.hypot(...sub(clew, tack));
  const area = 0.5 * Math.hypot(...cross(sub(clew, tack), sub(head, tack)));
  return { tack: [...tack], clew: [...clew], head: [...head], luff, foot, area };
}

/** A part's meshes (glb.js meshes: name and primitives). */
export function partMeshes(kind) {
  const part = PARTS[kind];
  if (!part) throw new Error(`ship: no part "${kind}"`);
  return part.meshes();
}

/**
 * A part as a GLB, with what an importer writes as the object's hint.
 * @returns {{ name: string, bytes: Uint8Array, bounds: { min: number[], max: number[] }, triangles: number }}
 */
export function partGLB(kind) {
  const part = PARTS[kind];
  const meshes = partMeshes(kind);
  let triangles = 0;
  const all = [];
  for (const m of meshes) {
    for (const p of m.primitives) {
      triangles += (p.indices ? p.indices.length : p.positions.length / 3) / 3;
      all.push(p.positions);
    }
  }
  const flat = new Float32Array(all.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of all) {
    flat.set(a, off);
    off += a.length;
  }
  const bytes = encodeGLB({ generator: "patchwork sailing", meshes, ...(part.extras ? { extras: part.extras() } : {}) });
  return { name: part.name, bytes, bounds: computeBounds(flat), triangles };
}
