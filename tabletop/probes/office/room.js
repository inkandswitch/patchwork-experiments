// The games room: a still, quiet interior to set game tables in. Drawn here
// as GLB meshes for the office probe (office-probe.html, publish-office.mjs);
// nothing in the tabletop package ships it. The room is the scene's own
// files, shown by the scene's GLB loader like anything else.
//
// Everything in the room is unlit, its light baked into vertex colours: a
// big window onto an autumn garden on the north wall (-z), a paper lamp over
// each tatami square, and a low warm fill, with soft darkening in corners and
// under the tables already set. So it looks the same in every view and on
// every machine, whatever the stage's own lights are doing; only the tables,
// the games and the chairs are lit by the stage.
//
// Plan (metres, y up): the room is 13 × 9 m, 3 m to the ceiling, the floor at
// y = 0. Six tatami squares (the four-and-a-half-mat pattern, 2.7 m) in two
// rows: tables go on the back row, by the window, and the front row is left
// for more. A tokonoma alcove on the west wall (a scroll with an ensō and a
// bonsai), shoji screens along the east wall, sliding doors on the south
// wall with a mat inside them where people come in.

import { encodeGLB, hexToLinear } from "../../src/kit/glb.js";

// ─── the plan ───────────────────────────────────────────────────────────────

export const ROOM = Object.freeze({ x0: -6.5, x1: 6.5, z0: -4.5, z1: 4.5, h: 3.0 });
/** The tatami's top, above the floor. */
export const MAT_TOP = 0.035;
/** A tatami square's side (the four-and-a-half-mat pattern: four 0.9 × 1.8 mats round a half mat). */
export const SQUARE = 2.7;
/** The six squares' middles: the back row (by the window) first, west to east. */
export const SPOTS = Object.freeze([
  [-4.2, -1.75],
  [0, -1.75],
  [4.2, -1.75],
  [-4.2, 1.95],
  [0, 1.95],
  [4.2, 1.95],
]);
/** The window in the north wall. */
const WIN = Object.freeze({ x0: -5.4, x1: 5.4, y0: 0.12, y1: 2.4, z: ROOM.z0 });
/** Where people come in: the mat inside the doors, facing the window (-z). */
export const ENTRANCE = Object.freeze({ position: [0, 0, 3.75], yaw: 0 });

// ─── colour and light ───────────────────────────────────────────────────────

const lin = (hex) => hexToLinear(hex).slice(0, 3);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mul = (a, b) => a.map((v, i) => v * (Array.isArray(b) ? b[i] : b));
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return a.map((v) => v / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** A fixed hash noise (no randomness: the room is the same every time it's drawn). */
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Smooth value noise in [0, 1]. */
function noise(x, y = 0, z = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const fbm = (x, y = 0, z = 0) => 0.5 * noise(x, y, z) + 0.3 * noise(x * 2.1, y * 2.1, z * 2.1) + 0.2 * noise(x * 4.3, y * 4.3, z * 4.3);

/** Light per vertex, then a soft shoulder, so bright paper and dim corners both keep their colour. */
const EXPOSURE = 1.45;
const tone = (c) => c.map((v) => 1 - Math.exp(-EXPOSURE * Math.max(0, v)));

// inside: a warm fill, the window (an area light, sampled), the lamps
const FILL = lin("#ffe6c4");
const DAY = lin("#fff7ec");
const LAMP = lin("#ffb768");
/** Each square's paper lamp, hanging over its middle; the andon in two corners. */
export const LAMP_Y = 2.2;
/** Over an empty square the lamp hangs higher, out of the way of a view across the room. */
const lampY = (i) => (i < 3 ? LAMP_Y : 2.45);
const LAMPS = [
  ...SPOTS.map(([x, z], i) => ({ p: [x, lampY(i), z], k: 0.42 })),
  { p: [-5.95, 0.42, 3.95], k: 0.22 },
  { p: [5.95, 0.42, 3.95], k: 0.22 },
];
/** Where the tables are set (floor shadows under them), filled in by setTables. */
let shadowsAt = [];
export function setTables(list) {
  shadowsAt = list.map((t) => ({ ...t }));
}

/** How much the room's corners and edges darken a point (a cheap ambient occlusion). */
function corners(p, n) {
  let f = 1;
  const planes = [
    [p[1], n[1] > 0.7],
    [ROOM.h - p[1], n[1] < -0.7],
    [p[0] - ROOM.x0, n[0] > 0.7],
    [ROOM.x1 - p[0], n[0] < -0.7],
    [p[2] - ROOM.z0, n[2] > 0.7],
    [ROOM.z1 - p[2], n[2] < -0.7],
  ];
  for (const [d, on] of planes) if (!on && d >= -0.01) f *= 1 - 0.3 * Math.exp(-Math.max(0, d) / 0.32);
  return f;
}

/** Soft shadows on the floor under the tables already set, and their chairs. */
function underTables(p, n) {
  if (n[1] < 0.7 || p[1] > 0.1) return 1;
  let f = 1;
  for (const t of shadowsAt) {
    const d = Math.hypot(p[0] - t.x, p[2] - t.z);
    f *= 1 - 0.42 * Math.exp(-((d / 0.5) ** 2));
    for (const c of t.chairs ?? []) f *= 1 - 0.3 * Math.exp(-((Math.hypot(p[0] - c[0], p[2] - c[1]) / 0.3) ** 2));
  }
  return f;
}

const WIN_SAMPLES = (() => {
  const out = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 4; j++) out.push([WIN.x0 + ((i + 0.5) / 10) * (WIN.x1 - WIN.x0), WIN.y0 + ((j + 0.5) / 4) * (WIN.y1 - WIN.y0), WIN.z]);
  return out;
})();
const WIN_AREA = (WIN.x1 - WIN.x0) * (WIN.y1 - WIN.y0);

/** The light inside at a point facing `n`. */
export function inside(p, n) {
  const ao = corners(p, n) * underTables(p, n);
  let c = mul(FILL, 0.26 * ao * (0.82 + 0.18 * (p[1] / ROOM.h)));
  // the window: daylight from the garden, brighter near it and on what faces it
  let e = 0;
  for (const s of WIN_SAMPLES) {
    const L = sub(s, p);
    const r2 = dot(L, L);
    const r = Math.sqrt(r2);
    const cn = dot(n, L) / r;
    const cw = -L[2] / r;
    if (cn > 0 && cw > 0) e += (cn * cw) / Math.max(r2, 0.25);
  }
  e *= (WIN_AREA / WIN_SAMPLES.length / Math.PI) * 1.05 * (0.55 + 0.45 * ao);
  c = add(c, mul(DAY, e));
  for (const l of LAMPS) {
    const L = sub(l.p, p);
    const d2 = dot(L, L);
    const cn = dot(n, L) / Math.sqrt(d2);
    if (cn > 0) c = add(c, mul(LAMP, (l.k * cn) / (d2 + 0.2)));
    // a little light all round each lamp, whatever faces it
    c = add(c, mul(LAMP, (0.06 * l.k) / (d2 + 0.6)));
  }
  return c;
}

// outside: an autumn afternoon, the sun low in the west
const SUN = norm([-0.72, 0.45, 0.48]);
const SUN_C = lin("#ffd9a8");
const SKY_C = lin("#bcd0e4");
const GROUND_C = lin("#8c7a5c");
const HAZE = lin("#e8dccb");
/** The light outside at a point facing `n`; under the eaves, the shade. */
export function outside(p, n) {
  const eaves = p[2] > -6.1 && p[1] < 2.95 ? 0.45 : 1;
  const hemi = 0.5 + 0.5 * n[1];
  let c = add(mul(SKY_C, 0.62 * hemi * eaves), mul(GROUND_C, 0.25 * (1 - hemi) * eaves));
  const s = Math.max(0, dot(n, SUN));
  if (eaves === 1) c = add(c, mul(SUN_C, 1.15 * s));
  return c;
}
/** A colour seen across `d` metres of autumn air. */
const hazed = (c, d) => mix(c, HAZE, 1 - Math.exp(-d / 160));

// ─── meshes ─────────────────────────────────────────────────────────────────

/**
 * A mesh being drawn: positions, a colour per vertex (light baked in, unless
 * it's `lit`: then the stage lights it and the colours are the surface's),
 * triangles.
 */
function Mesh(name, { lit = false, blend = false } = {}) {
  const P = [], N = [], C = [], I = [];
  const alpha = blend;
  const m = {
    name,
    /** one vertex: where, its normal, its colour ([r, g, b] or [r, g, b, a]) */
    v(p, n, c) {
      P.push(p[0], p[1], p[2]);
      N.push(n[0], n[1], n[2]);
      if (alpha) C.push(c[0], c[1], c[2], c[3] ?? 1);
      else C.push(c[0], c[1], c[2]);
      return P.length / 3 - 1;
    },
    /**
     * A quad a b c d (a→b is u, a→d is v), cut into cells about `cell` across,
     * its normal `n` (else b−a × d−a), each vertex coloured `paint(p, n)`.
     */
    quad(a, b, c, d, paint, { cell = 0.5, n = null, nu = null, nv = null } = {}) {
      const nn = n ?? norm(cross(sub(b, a), sub(d, a)));
      const U = nu ?? Math.max(1, Math.ceil(len(sub(b, a)) / cell));
      const V = nv ?? Math.max(1, Math.ceil(len(sub(d, a)) / cell));
      const base = P.length / 3;
      for (let j = 0; j <= V; j++) {
        for (let i = 0; i <= U; i++) {
          const u = i / U, w = j / V;
          const ab = mix(a, b, u), dc = mix(d, c, u);
          const p = mix(ab, dc, w);
          m.v(p, nn, paint(p, nn, u, w));
        }
      }
      for (let j = 0; j < V; j++) {
        for (let i = 0; i < U; i++) {
          const k = base + j * (U + 1) + i;
          I.push(k, k + 1, k + U + 2, k, k + U + 2, k + U + 1);
        }
      }
    },
    /** An axis-aligned box, each face outward (`skip`: faces not drawn: "-x", "+y", …). */
    box(min, max, paint, { cell = 0.5, skip = [] } = {}) {
      const [x0, y0, z0] = min, [x1, y1, z1] = max;
      const f = (key, a, b, c, d, n) => !skip.includes(key) && m.quad(a, b, c, d, paint, { cell, n });
      f("+y", [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
      f("-y", [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
      f("+z", [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
      f("-z", [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
      f("+x", [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
      f("-x", [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    },
    /** A turned shape about the vertical through `at`: profile [[r, y], …] from the bottom up. */
    lathe(at, profile, paint, { segments = 24, scale = [1, 1, 1] } = {}) {
      const base = P.length / 3;
      const rows = profile.length;
      for (let k = 0; k < rows; k++) {
        const [r, y] = profile[k];
        const [r0, y0] = profile[Math.max(0, k - 1)], [r1, y1] = profile[Math.min(rows - 1, k + 1)];
        // the profile's normal: across its slope
        const dr = r1 - r0, dy = y1 - y0;
        const pn = norm([dy, -dr, 0]);
        for (let s = 0; s <= segments; s++) {
          const a = (s / segments) * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          const p = [at[0] + r * ca * scale[0], at[1] + y * scale[1], at[2] + r * sa * scale[2]];
          const n = norm([pn[0] * ca, pn[1], pn[0] * sa]);
          m.v(p, n, paint(p, n, s / segments, k / (rows - 1)));
        }
      }
      for (let k = 0; k < rows - 1; k++) {
        for (let s = 0; s < segments; s++) {
          const i = base + k * (segments + 1) + s;
          I.push(i, i + segments + 1, i + 1, i + 1, i + segments + 1, i + segments + 2);
        }
      }
    },
    /** A lumpy ball: a sphere at `at` with radii `r`, pushed in and out by noise (`rough`, seeded by `seed`). */
    blob(at, r, paint, { rows = 10, segments = 16, rough = 0.18, seed = 0, flat = 0 } = {}) {
      const base = P.length / 3;
      for (let k = 0; k <= rows; k++) {
        const t = (k / rows) * Math.PI;
        for (let s = 0; s <= segments; s++) {
          const a = (s / segments) * Math.PI * 2;
          const d = [Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a)];
          // the same noise at the seam and the poles, so it closes
          const q = s === segments ? [Math.sin(t), Math.cos(t), 0] : d;
          const bump = 1 + rough * (fbm(q[0] * 1.7 + seed, q[1] * 1.7 + seed * 0.37, q[2] * 1.7 - seed) - 0.5) * 2;
          let y = d[1] * r[1] * bump;
          if (flat && y < -r[1] * flat) y = -r[1] * flat;
          const p = [at[0] + d[0] * r[0] * bump, at[1] + y, at[2] + d[2] * r[2] * bump];
          const n = norm([d[0] / r[0], d[1] / r[1], d[2] / r[2]]);
          m.v(p, n, paint(p, n, s / segments, k / rows));
        }
      }
      for (let k = 0; k < rows; k++) {
        for (let s = 0; s < segments; s++) {
          const i = base + k * (segments + 1) + s;
          I.push(i, i + 1, i + segments + 1, i + 1, i + segments + 2, i + segments + 1);
        }
      }
    },
    /** A tapered tube from p0 (radius r0) to p1 (r1). */
    tube(p0, p1, r0, r1, paint, { segments = 10 } = {}) {
      const axis = norm(sub(p1, p0));
      const side = norm(Math.abs(axis[1]) < 0.9 ? cross(axis, [0, 1, 0]) : cross(axis, [1, 0, 0]));
      const up = cross(side, axis);
      const base = P.length / 3;
      for (const [p, r] of [[p0, r0], [p1, r1]]) {
        for (let s = 0; s <= segments; s++) {
          const a = (s / segments) * Math.PI * 2;
          const n = add(mul(side, Math.cos(a)), mul(up, Math.sin(a)));
          const q = add(p, mul(n, r));
          m.v(q, n, paint(q, n));
        }
      }
      for (let s = 0; s < segments; s++) {
        const i = base + s;
        I.push(i, i + segments + 1, i + 1, i + 1, i + segments + 1, i + segments + 2);
      }
    },
    tri(a, b, c) {
      I.push(a, b, c);
    },
    get count() {
      return P.length / 3;
    },
    out() {
      return {
        name,
        positions: new Float32Array(P),
        ...(lit ? { normals: new Float32Array(N) } : {}),
        colors: { array: new Float32Array(C), itemSize: alpha ? 4 : 3 },
        indices: new Uint32Array(I),
        unlit: !lit,
        roughness: 0.8,
        ...(blend ? { blend: true } : {}),
      };
    },
  };
  return m;
}

/** A painter: a surface colour (a hex, or a function of the point) lit inside, toned. */
const indoor = (albedo) => (p, n, u, w) => tone(mul(typeof albedo === "function" ? albedo(p, n, u, w) : lin(albedo), inside(p, n)));
const outdoor = (albedo, { haze = true } = {}) => (p, n, u, w) => {
  const a = typeof albedo === "function" ? albedo(p, n, u, w) : lin(albedo);
  const c = tone(mul(a, outside(p, n)));
  return haze ? hazed(c, Math.hypot(p[0], p[2] - ROOM.z0)) : c;
};
/** Something that gives light: its own colour, not lit. */
const glow = (hex, k = 1) => () => tone(mul(lin(hex), k));
/** For a lit mesh: the surface's own colour. */
const own = (hex) => () => lin(hex);

// ─── the room ───────────────────────────────────────────────────────────────

const OAK = "#cdb38d";
const PLASTER = "#e7ddcb";
const CEDAR = "#b98d62";
const POST = "#8a6544";
const DARK = "#3e2f24";
const PAPER = "#f5efe2";

/** The floor: pale oak boards running east–west, each a little different. */
function floor() {
  const m = Mesh("floor");
  const W = 0.19;
  const n = Math.round((ROOM.z1 - ROOM.z0) / W);
  for (let k = 0; k < n; k++) {
    const z0 = ROOM.z0 + k * W, z1 = z0 + W;
    // boards end at staggered joints
    const off = (hash3(k, 7, 1) * 2.4) % 2.4;
    const xs = [ROOM.x0];
    for (let x = ROOM.x0 + 0.6 + off; x < ROOM.x1 - 0.3; x += 2.4) xs.push(x);
    xs.push(ROOM.x1);
    for (let j = 0; j < xs.length - 1; j++) {
      const tint = 0.9 + 0.16 * hash3(k, j, 3);
      const warm = hash3(k, j, 9) * 0.06;
      const board = (p) => {
        const grain = 0.97 + 0.06 * noise(p[0] * 3.1 + k * 13, k * 0.7);
        const c = lin(OAK);
        return [c[0] * tint * grain * (1 + warm), c[1] * tint * grain, c[2] * tint * grain * (1 - warm)];
      };
      // the joint between boards: a hairline a little darker
      m.quad([xs[j], 0, z1 - 0.004], [xs[j + 1] - 0.003, 0, z1 - 0.004], [xs[j + 1] - 0.003, 0, z0], [xs[j], 0, z0], indoor(board), { cell: 0.45, n: [0, 1, 0], nv: 1 });
    }
  }
  // the gaps show as a darker floor just under the boards
  m.quad([ROOM.x0, -0.002, ROOM.z1], [ROOM.x1, -0.002, ROOM.z1], [ROOM.x1, -0.002, ROOM.z0], [ROOM.x0, -0.002, ROOM.z0], indoor("#6f5538"), { cell: 1, n: [0, 1, 0] });
  return [m.out()];
}

/** Six squares of tatami, each four mats round a half mat, a dark cloth edge along each mat's long sides. */
function tatami() {
  const m = Mesh("tatami");
  const edge = Mesh("tatami-edge");
  const t = MAT_TOP;
  const straw = (seed) => (p) => {
    const c = lin("#d3c595");
    const g = 0.94 + 0.08 * hash3(seed, 2, 5);
    const weave = 0.985 + 0.03 * noise(p[0] * 40, p[2] * 40);
    return [c[0] * g * weave, c[1] * g * weave * 1.01, c[2] * g * weave * 0.95];
  };
  SPOTS.forEach(([cx, cz], si) => {
    const x0 = cx - SQUARE / 2, z0 = cz - SQUARE / 2;
    // [x, z, w, d] in the square, and whether the long side runs along x
    const mats = [
      [0, 0, 1.8, 0.9],
      [1.8, 0, 0.9, 1.8],
      [0.9, 1.8, 1.8, 0.9],
      [0, 0.9, 0.9, 1.8],
      [0.9, 0.9, 0.9, 0.9],
    ];
    mats.forEach(([x, z, w, d], mi) => {
      const a = [x0 + x + 0.003, z0 + z + 0.003];
      const b = [x0 + x + w - 0.003, z0 + z + d - 0.003];
      m.box([a[0], 0, a[1]], [b[0], t, b[1]], indoor(straw(si * 7 + mi)), { cell: 0.3, skip: ["-y"] });
      if (w === d) return; // the half mat has no edge cloth
      const along = w > d;
      const E = 0.028;
      const cloth = indoor("#3a3a2e");
      for (const s of [0, 1]) {
        if (along) {
          const z = s ? b[1] - E : a[1];
          edge.box([a[0], t, z], [b[0], t + 0.0015, z + E], cloth, { cell: 0.45, skip: ["-y"] });
        } else {
          const xx = s ? b[0] - E : a[0];
          edge.box([xx, t, a[1]], [xx + E, t + 0.0015, b[1]], cloth, { cell: 0.45, skip: ["-y"] });
        }
      }
    });
  });
  return [m.out(), edge.out()];
}

/** The walls, posts, beams, skirting, ceiling and the tokonoma: the shell. */
function shell() {
  const wall = Mesh("plaster");
  const wood = Mesh("timber");
  const ceil = Mesh("ceiling");
  const { x0, x1, z0, z1, h } = ROOM;
  const plaster = indoor((p) => {
    const c = lin(PLASTER);
    const v = 0.97 + 0.05 * fbm(p[0] * 0.9 + p[2] * 0.9, p[1] * 0.9);
    return mul(c, v);
  });
  const NAGESHI = 2.2;
  // north wall: plaster either side of the window, and a band above it
  wall.quad([x0, 0, z0], [WIN.x0, 0, z0], [WIN.x0, h, z0], [x0, h, z0], plaster, { cell: 0.3, n: [0, 0, 1] });
  wall.quad([WIN.x1, 0, z0], [x1, 0, z0], [x1, h, z0], [WIN.x1, h, z0], plaster, { cell: 0.3, n: [0, 0, 1] });
  wall.quad([WIN.x0, WIN.y1 + 0.08, z0], [WIN.x1, WIN.y1 + 0.08, z0], [WIN.x1, h, z0], [WIN.x0, h, z0], plaster, { cell: 0.3, n: [0, 0, 1] });
  // south wall, round the doors (x −1.5…1.5, up to 2.1)
  wall.quad([x1, 0, z1], [1.5, 0, z1], [1.5, h, z1], [x1, h, z1], plaster, { cell: 0.3, n: [0, 0, -1] });
  wall.quad([-1.5, 0, z1], [x0, 0, z1], [x0, h, z1], [-1.5, h, z1], plaster, { cell: 0.3, n: [0, 0, -1] });
  wall.quad([1.5, 2.1, z1], [-1.5, 2.1, z1], [-1.5, h, z1], [1.5, h, z1], plaster, { cell: 0.3, n: [0, 0, -1] });
  // west wall, round the tokonoma (z −1.2…1.2)
  const TK = { z0: -1.2, z1: 1.2, depth: 0.85, top: 2.25 };
  wall.quad([x0, 0, z1], [x0, 0, TK.z1], [x0, h, TK.z1], [x0, h, z1], plaster, { cell: 0.3, n: [1, 0, 0] });
  wall.quad([x0, 0, TK.z0], [x0, 0, z0], [x0, h, z0], [x0, h, TK.z0], plaster, { cell: 0.3, n: [1, 0, 0] });
  wall.quad([x0, TK.top, TK.z1], [x0, TK.top, TK.z0], [x0, h, TK.z0], [x0, h, TK.z1], plaster, { cell: 0.3, n: [1, 0, 0] });
  // the alcove: its back, sides and ceiling, a little warmer and dimmer
  const nook = indoor((p) => mul(lin("#dccdb3"), 0.9 + 0.06 * fbm(p[2] * 1.3, p[1] * 1.3)));
  const bx = x0 - TK.depth;
  wall.quad([bx, 0, TK.z1], [bx, 0, TK.z0], [bx, TK.top, TK.z0], [bx, TK.top, TK.z1], nook, { cell: 0.2, n: [1, 0, 0] });
  wall.quad([bx, 0, TK.z0], [x0, 0, TK.z0], [x0, TK.top, TK.z0], [bx, TK.top, TK.z0], nook, { cell: 0.2, n: [0, 0, 1] });
  wall.quad([x0, 0, TK.z1], [bx, 0, TK.z1], [bx, TK.top, TK.z1], [x0, TK.top, TK.z1], nook, { cell: 0.2, n: [0, 0, -1] });
  wall.quad([bx, TK.top, TK.z0], [x0, TK.top, TK.z0], [x0, TK.top, TK.z1], [bx, TK.top, TK.z1], nook, { cell: 0.2, n: [0, -1, 0] });
  // its raised floor: a polished board on a dark lacquered edge
  wood.box([bx, 0, TK.z0], [x0 + 0.02, 0.14, TK.z1], indoor((p) => mul(lin("#7a5536"), 0.9 + 0.12 * noise(p[2] * 6, p[0] * 2))), { cell: 0.25 });
  wood.box([x0 - 0.02, 0, TK.z0], [x0 + 0.05, 0.15, TK.z1], indoor(DARK), { cell: 0.3 });
  // the small beam across its mouth, and the post at its side (the tokobashira: a natural trunk)
  wood.box([x0 - 0.02, TK.top - 0.09, TK.z0], [x0 + 0.06, TK.top, TK.z1], indoor(CEDAR), { cell: 0.3 });
  wood.lathe([x0 + 0.02, 0, TK.z1 + 0.07], [[0.07, 0], [0.065, 1.2], [0.06, h]], indoor((p) => mul(lin("#9a7652"), 0.85 + 0.25 * noise(p[1] * 2.3, 4))), { segments: 14 });
  // the east wall above the shoji: plaster
  wall.quad([x1, 2.1, z0], [x1, 2.1, z1], [x1, h, z1], [x1, h, z0], plaster, { cell: 0.3, n: [-1, 0, 0] });

  // posts: the corners, and the bays of the long walls
  const post = indoor((p) => mul(lin(POST), 0.92 + 0.1 * noise(p[1] * 3, p[0] + p[2])));
  const P = 0.12;
  const posts = [
    [x0, z0], [x1, z0], [x0, z1], [x1, z1],
    [WIN.x0, z0], [-1.8, z0], [1.8, z0], [WIN.x1, z0],
    [x1, -1.5], [x1, 1.5],
    [-1.5, z1], [1.5, z1], [-4.0, z1], [4.0, z1],
    [x0, -3.0], [x0, 3.0],
  ];
  for (const [x, z] of posts) {
    const px = Math.min(Math.max(x, x0 + P / 2), x1 - P / 2), pz = Math.min(Math.max(z, z0 + P / 2), z1 - P / 2);
    wood.box([px - P / 2, 0, pz - P / 2], [px + P / 2, h, pz + P / 2], post, { cell: 0.35, skip: ["-y", "+y"] });
  }
  // the nageshi (a beam round the room at the head of the doors) and the skirting
  const beam = indoor(CEDAR);
  const ring = (y0, y1, out) => {
    wood.box([x0, y0, z0], [x1, y1, z0 + out], beam, { cell: 0.5, skip: ["-z"] });
    wood.box([x0, y0, z1 - out], [x1, y1, z1], beam, { cell: 0.5, skip: ["+z"] });
    wood.box([x0, y0, z0], [x0 + out, y1, TK.z0], beam, { cell: 0.5, skip: ["-x"] });
    wood.box([x0, y0, TK.z1], [x0 + out, y1, z1], beam, { cell: 0.5, skip: ["-x"] });
    wood.box([x1 - out, y0, z0], [x1, y1, z1], beam, { cell: 0.5, skip: ["+x"] });
  };
  ring(NAGESHI, NAGESHI + 0.1, 0.05);
  ring(h - 0.06, h, 0.05);
  // skirting, dark, where there's wall to meet the floor
  const skirt = indoor(DARK);
  wood.box([x0, 0, z0 + 0.0], [WIN.x0, 0.06, z0 + 0.02], skirt, { cell: 0.5 });
  wood.box([WIN.x1, 0, z0], [x1, 0.06, z0 + 0.02], skirt, { cell: 0.5 });
  wood.box([x0, 0, z1 - 0.02], [-1.5, 0.06, z1], skirt, { cell: 0.5 });
  wood.box([1.5, 0, z1 - 0.02], [x1, 0.06, z1], skirt, { cell: 0.5 });
  wood.box([x0, 0, z0], [x0 + 0.02, 0.06, TK.z0], skirt, { cell: 0.5 });
  wood.box([x0, 0, TK.z1], [x0 + 0.02, 0.06, z1], skirt, { cell: 0.5 });

  // the ceiling: pale cedar boards, thin dark battens across them every 45 cm
  ceil.quad([x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1], indoor((p) => mul(lin("#d9c39e"), 0.94 + 0.08 * noise(p[0] * 0.8, p[2] * 4.2))), { cell: 0.35, n: [0, -1, 0] });
  for (let x = x0 + 0.45; x < x1 - 0.1; x += 0.45) ceil.box([x - 0.009, h - 0.022, z0], [x + 0.009, h, z1], indoor("#9a7a58"), { cell: 0.6, skip: ["+y"] });
  return [wall.out(), wood.out(), ceil.out()];
}

/** The window in the north wall: three bays of two sliding panes, a sill, a transom of slats above. */
function windowFrame() {
  const wood = Mesh("window-frame");
  const glass = Mesh("glass", { blend: true });
  const z = ROOM.z0;
  const frame = indoor(CEDAR);
  const F = 0.05;
  // sill and head
  wood.box([WIN.x0, 0, z - 0.06], [WIN.x1, WIN.y0, z + 0.04], indoor("#8d6b4a"), { cell: 0.4 });
  wood.box([WIN.x0, WIN.y1, z - 0.05], [WIN.x1, WIN.y1 + 0.08, z + 0.03], frame, { cell: 0.4 });
  // the panes' frames: a stile at each edge of each pane
  const bays = [WIN.x0, -1.8, 1.8, WIN.x1];
  for (let b = 0; b < 3; b++) {
    const mid = (bays[b] + bays[b + 1]) / 2;
    for (const [a, c, dz] of [[bays[b], mid + 0.02, -0.035], [mid - 0.02, bays[b + 1], 0.0]]) {
      for (const x of [a, c - F]) wood.box([x, WIN.y0, z + dz - 0.015], [x + F, WIN.y1, z + dz + 0.015], frame, { cell: 0.5 });
      wood.box([a, WIN.y0, z + dz - 0.015], [c, WIN.y0 + F, z + dz + 0.015], frame, { cell: 0.5 });
      wood.box([a, WIN.y1 - F, z + dz - 0.015], [c, WIN.y1, z + dz + 0.015], frame, { cell: 0.5 });
      // the glass: barely there, a little sky in it toward the top
      glass.quad([a + F, WIN.y0 + F, z + dz], [c - F, WIN.y0 + F, z + dz], [c - F, WIN.y1 - F, z + dz], [a + F, WIN.y1 - F, z + dz], (p) => [0.82, 0.88, 0.95, 0.035 + 0.04 * smooth(WIN.y0, WIN.y1, p[1])], { cell: 3, n: [0, 0, 1] });
    }
  }
  return [wood.out(), glass.out()];
}

/** Shoji along the east wall: three bays of four panels, paper lit from behind, a fine grid of kumiko. */
function shoji() {
  const paper = Mesh("shoji-paper");
  const wood = Mesh("shoji-wood");
  const x = ROOM.x1 - 0.03;
  const H = 2.1;
  const bays = [ROOM.z0 + 0.06, -1.5 - 0.06, -1.5 + 0.06, 1.5 - 0.06, 1.5 + 0.06, ROOM.z1 - 0.06];
  const glowing = (p, n) => {
    // daylight behind the paper: even, warmest low and in the middle of each panel
    const base = lin(PAPER);
    const k = 0.88 + 0.12 * smooth(0, 1.6, p[1]) - 0.06 * smooth(1.6, 2.1, p[1]);
    return tone(add(mul(base, 1.02 * k), mul(mul(base, inside(p, n)), 0.22)));
  };
  const kumiko = indoor("#d6bf98");
  const stile = indoor("#a98260");
  for (let b = 0; b < 3; b++) {
    const za = bays[b * 2], zb = bays[b * 2 + 1];
    const w = (zb - za) / 4;
    for (let k = 0; k < 4; k++) {
      const p0 = za + k * w, p1 = p0 + w;
      const KOSHI = 0.32;
      paper.quad([x, KOSHI, p1], [x, KOSHI, p0], [x, H, p0], [x, H, p1], glowing, { cell: 0.25, n: [-1, 0, 0] });
      // the wooden panel at the foot
      wood.box([x - 0.01, 0, p0], [x + 0.01, KOSHI, p1], indoor("#9b7553"), { cell: 0.3 });
      // stiles and rails
      const S = 0.03;
      for (const zz of [p0, p1 - S]) wood.box([x - 0.022, 0, zz], [x + 0.008, H, zz + S], stile, { cell: 0.4 });
      wood.box([x - 0.022, H - S, p0], [x + 0.008, H, p1], stile, { cell: 0.4 });
      wood.box([x - 0.022, KOSHI, p0], [x + 0.008, KOSHI + 0.02, p1], stile, { cell: 0.4 });
      // kumiko: three across, seven up
      for (let i = 1; i < 4; i++) {
        const zz = p0 + (i * w) / 4;
        wood.box([x - 0.014, KOSHI, zz - 0.006], [x, H - S, zz + 0.006], kumiko, { cell: 0.6 });
      }
      for (let j = 1; j < 8; j++) {
        const y = KOSHI + (j * (H - S - KOSHI)) / 8;
        wood.box([x - 0.014, y - 0.006, p0 + S], [x, y + 0.006, p1 - S], kumiko, { cell: 0.6 });
      }
    }
  }
  return [paper.out(), wood.out()];
}

/** The doors in the south wall: four fusuma, warm paper in dark frames, a round pull on each. */
function doors() {
  const paper = Mesh("fusuma");
  const wood = Mesh("fusuma-frame");
  const z = ROOM.z1 - 0.02;
  const w = 3.0 / 4;
  for (let k = 0; k < 4; k++) {
    const x0 = -1.5 + k * w, x1 = x0 + w;
    const dz = k % 2 ? -0.03 : 0;
    paper.quad([x1, 0.04, z + dz], [x0, 0.04, z + dz], [x0, 2.06, z + dz], [x1, 2.06, z + dz], indoor((p) => mul(lin("#e4d6b8"), 0.95 + 0.06 * fbm(p[0] * 3, p[1] * 3))), { cell: 0.2, n: [0, 0, -1] });
    const F = 0.025;
    const frame = indoor("#2f2620");
    wood.box([x0, 0, z + dz - 0.012], [x0 + F, 2.1, z + dz + 0.004], frame, { cell: 0.5 });
    wood.box([x1 - F, 0, z + dz - 0.012], [x1, 2.1, z + dz + 0.004], frame, { cell: 0.5 });
    wood.box([x0, 2.1 - F, z + dz - 0.012], [x1, 2.1, z + dz + 0.004], frame, { cell: 0.5 });
    wood.box([x0, 0, z + dz - 0.012], [x1, F, z + dz + 0.004], frame, { cell: 0.5 });
    const pull = k % 2 ? x0 + 0.09 : x1 - 0.09;
    wood.lathe([pull, 0.92, z + dz - 0.004], [[0, 0], [0.028, 0], [0.028, 0.005], [0, 0.005]], indoor("#20201e"), { segments: 18, scale: [1, 1, 1] });
  }
  // the head of the door: a beam
  wood.box([-1.6, 2.1, ROOM.z1 - 0.06], [1.6, 2.2, ROOM.z1], indoor(CEDAR), { cell: 0.5 });
  return [paper.out(), wood.out()];
}

/** The mat inside the doors: where people come in (it carries the walk package's spawn point). */
export function entranceMat() {
  const m = Mesh("entrance-mat");
  const [x, , z] = ENTRANCE.position;
  // drawn about its own origin (the object is placed at ENTRANCE), lit as it lies
  const at = (p) => [p[0] + x, p[1], p[2] + z];
  const rush = (p, n) => tone(mul(mul(lin("#8c7a52"), 0.92 + 0.1 * noise(p[0] * 30, p[2] * 6)), inside(at(p), n)));
  m.box([-0.6, 0, -0.38], [0.6, 0.012, 0.38], rush, { cell: 0.2, skip: ["-y"] });
  m.box([-0.6, 0.012, -0.38], [0.6, 0.0135, -0.34], (p, n) => tone(mul(lin("#2d2a22"), inside(at(p), n))), { cell: 0.4, skip: ["-y"] });
  m.box([-0.6, 0.012, 0.34], [0.6, 0.0135, 0.38], (p, n) => tone(mul(lin("#2d2a22"), inside(at(p), n))), { cell: 0.4, skip: ["-y"] });
  return [m.out()];
}

/** Paper lamps: one hanging over each square on a thin cord, and two andon on the floor by the doors. */
function lamps() {
  const shade = Mesh("lamp-paper");
  const wood = Mesh("lamp-frame");
  SPOTS.forEach(([x, z], i) => {
    const Y = lampY(i);
    // a tall soft lantern: a turned paper shade, ribbed, glowing warmest in its middle
    const prof = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      prof.push([0.035 + 0.135 * Math.sin(Math.PI * (0.06 + 0.88 * t)) ** 0.7, -0.19 + 0.38 * t]);
    }
    shade.lathe([x, Y, z], prof, (p, n) => {
      const h = (p[1] - Y + 0.19) / 0.38;
      const ribs = 0.93 + 0.07 * Math.cos((p[1] - Y) * 85);
      const edge = Math.abs(n[1]);
      return tone(mul(mix(lin("#ffe2b0"), lin("#f0a85c"), 0.35 * edge + 0.4 * Math.abs(h - 0.5)), (1.5 - 0.3 * edge) * ribs));
    }, { segments: 28 });
    wood.tube([x, Y + 0.19, z], [x, ROOM.h, z], 0.0035, 0.0035, indoor("#2a2420"), { segments: 6 });
    wood.lathe([x, ROOM.h - 0.02, z], [[0, 0], [0.04, 0], [0.04, 0.02], [0, 0.02]], indoor("#2a2420"), { segments: 12 });
  });
  for (const [x, z] of [[-5.95, 3.95], [5.95, 3.95]]) {
    const H = 0.7;
    shade.box([x - 0.16, 0.12, z - 0.16], [x + 0.16, H, z + 0.16], (p) => tone(mul(lin("#ffdcae"), 1.3 - 0.4 * (p[1] / H))), { cell: 0.1, skip: ["-y"] });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) wood.box([x + dx * 0.17 - 0.015, 0, z + dz * 0.17 - 0.015], [x + dx * 0.17 + 0.015, H + 0.03, z + dz * 0.17 + 0.015], indoor("#3a2b20"), { cell: 0.4 });
    wood.box([x - 0.19, H, z - 0.19], [x + 0.19, H + 0.03, z + 0.19], indoor("#3a2b20"), { cell: 0.4 });
  }
  return [shade.out(), wood.out()];
}

/** The tokonoma's things: a hanging scroll with an ensō, a bonsai pine on a low stand, a small stone. */
function alcove() {
  const m = Mesh("alcove");
  const bx = ROOM.x0 - 0.85 + 0.012;
  // the scroll: a silk mount round a paper panel, a wooden roller at its foot
  const mount = indoor("#6c6a57");
  const paperC = indoor((p) => mul(lin("#efe4cc"), 0.97 + 0.04 * noise(p[1] * 9, p[2] * 9)));
  const zc = -0.12;
  m.quad([bx, 0.62, zc + 0.33], [bx, 0.62, zc - 0.33], [bx, 2.06, zc - 0.33], [bx, 2.06, zc + 0.33], mount, { cell: 0.2, n: [1, 0, 0] });
  m.quad([bx + 0.003, 0.82, zc + 0.26], [bx + 0.003, 0.82, zc - 0.26], [bx + 0.003, 1.86, zc - 0.26], [bx + 0.003, 1.86, zc + 0.26], paperC, { cell: 0.08, n: [1, 0, 0] });
  m.tube([bx + 0.02, 0.6, zc - 0.37], [bx + 0.02, 0.6, zc + 0.37], 0.016, 0.016, indoor("#2a211b"), { segments: 8 });
  m.tube([bx + 0.01, 2.07, zc - 0.34], [bx + 0.01, 2.07, zc + 0.34], 0.01, 0.01, indoor("#5a4632"), { segments: 6 });
  // the ensō: one brushstroke round, thick where it starts, thinning to a dry tail with a gap
  const c = [bx + 0.006, 1.36, zc];
  const R = 0.17;
  const ink = (p, n) => tone(mul(lin("#1d1b19"), inside(p, n)));
  const N = 72;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    if (t1 > 0.93) break;
    const w0 = 0.006 + 0.026 * Math.sin(Math.PI * Math.min(1, t0 * 1.15)) ** 0.6 * (1 - 0.5 * t0);
    const w1 = 0.006 + 0.026 * Math.sin(Math.PI * Math.min(1, t1 * 1.15)) ** 0.6 * (1 - 0.5 * t1);
    const a0 = -2.2 + t0 * Math.PI * 2, a1 = -2.2 + t1 * Math.PI * 2;
    const wob = (t) => 1 + 0.03 * Math.sin(t * 17);
    const pt = (a, r) => [c[0], c[1] + Math.sin(a) * r, c[2] + Math.cos(a) * r];
    m.quad(pt(a0, R * wob(t0) - w0), pt(a1, R * wob(t1) - w1), pt(a1, R * wob(t1) + w1), pt(a0, R * wob(t0) + w0), ink, { n: [1, 0, 0], nu: 1, nv: 1 });
  }
  // the bonsai: a low dark stand, a shallow glazed pot, a twisting trunk, cloud pads of needles
  const sx = ROOM.x0 - 0.42, sz = 0.62;
  m.box([sx - 0.24, 0.14, sz - 0.17], [sx + 0.24, 0.2, sz + 0.17], indoor("#2c221b"), { cell: 0.2 });
  m.lathe([sx, 0.2, sz], [[0, 0], [0.16, 0], [0.19, 0.02], [0.2, 0.07], [0.185, 0.075], [0, 0.075]], indoor("#5b6d7a"), { segments: 28, scale: [1, 1, 0.72] });
  m.lathe([sx, 0.272, sz], [[0, 0], [0.18, 0], [0.18, 0.004], [0, 0.004]], indoor("#4b3a2a"), { segments: 24, scale: [1, 1, 0.7] });
  const bark = indoor((p) => mul(lin("#5a4231"), 0.85 + 0.25 * noise(p[1] * 30, p[2] * 30)));
  const trunk = [[sx + 0.01, 0.27, sz], [sx - 0.03, 0.38, sz + 0.05], [sx + 0.04, 0.5, sz + 0.08], [sx + 0.0, 0.6, sz - 0.02], [sx - 0.05, 0.68, sz - 0.1]];
  for (let i = 0; i < trunk.length - 1; i++) m.tube(trunk[i], trunk[i + 1], 0.034 - i * 0.006, 0.028 - i * 0.006, bark, { segments: 9 });
  m.tube(trunk[2], [sx + 0.12, 0.55, sz + 0.2], 0.014, 0.008, bark, { segments: 6 });
  m.tube(trunk[3], [sx - 0.04, 0.62, sz + 0.2], 0.012, 0.007, bark, { segments: 6 });
  const needles = indoor((p) => mul(lin("#3e5a34"), 0.8 + 0.35 * fbm(p[0] * 25, p[1] * 25, p[2] * 25)));
  for (const [p, r, s] of [
    [[sx + 0.13, 0.58, sz + 0.22], [0.11, 0.045, 0.09], 1],
    [[sx - 0.04, 0.65, sz + 0.21], [0.09, 0.04, 0.08], 2],
    [[sx - 0.06, 0.72, sz - 0.12], [0.13, 0.05, 0.11], 3],
    [[sx + 0.03, 0.62, sz + 0.0], [0.08, 0.035, 0.07], 4],
  ])
    m.blob(p, r, needles, { rows: 7, segments: 12, rough: 0.35, seed: s, flat: 0.35 });
  // a smooth dark stone on the board, beside the scroll
  m.blob([ROOM.x0 - 0.4, 0.17, -0.72], [0.09, 0.05, 0.07], indoor("#3d3c3a"), { rows: 7, segments: 12, rough: 0.12, seed: 9, flat: 0.5 });
  return [m.out()];
}

/** Bamboo in a tall glazed pot in the north-east corner, and a moss ball on a stand by the doors. */
function plants() {
  const m = Mesh("plants");
  const px = ROOM.x1 - 0.5, pz = ROOM.z0 + 0.5;
  m.lathe([px, 0, pz], [[0, 0], [0.16, 0], [0.2, 0.08], [0.22, 0.45], [0.2, 0.52], [0.205, 0.54], [0, 0.54]], indoor("#40454a"), { segments: 28 });
  m.lathe([px, 0.52, pz], [[0, 0], [0.19, 0], [0.19, 0.004], [0, 0.004]], indoor("#3a2c22"), { segments: 20 });
  const stalk = indoor((p) => mul(lin("#8fa257"), 0.85 + 0.18 * Math.sin(p[1] * 2.1)));
  const node = indoor("#6c7a3e");
  const leaf = indoor((p) => mul(lin("#6f8f3e"), 0.8 + 0.3 * noise(p[0] * 9, p[1] * 9, p[2] * 9)));
  const canes = [[0.04, 0.02, 2.55, 0.06], [-0.07, 0.05, 2.3, -0.05], [0.06, -0.08, 2.75, 0.03], [-0.03, -0.05, 2.1, -0.08], [0.1, 0.06, 1.9, 0.09]];
  canes.forEach(([dx, dz, H, lean], ci) => {
    const base = [px + dx, 0.52, pz + dz];
    const top = [px + dx + lean * 1.3, H, pz + dz + lean * 0.6];
    const segs = 6;
    for (let s = 0; s < segs; s++) {
      const a = mix(base, top, s / segs), b = mix(base, top, (s + 1) / segs);
      m.tube(a, b, 0.016, 0.014, stalk, { segments: 7 });
      m.tube(sub(b, [0, 0.012, 0]), add(b, [0, 0.008, 0]), 0.019, 0.019, node, { segments: 7 });
    }
    // leaves: narrow blades in sprays near the top
    for (let k = 0; k < 9; k++) {
      const t = 0.55 + 0.45 * hash3(ci, k, 1);
      const at = mix(base, top, t);
      const ang = hash3(ci, k, 2) * Math.PI * 2;
      const dir = [Math.cos(ang), -0.35 - 0.3 * hash3(ci, k, 3), Math.sin(ang)];
      const L = 0.2 + 0.1 * hash3(ci, k, 4);
      const tip = add(at, mul(norm(dir), L));
      const side = mul(norm(cross(dir, [0, 1, 0])), 0.018);
      m.quad(at, add(mix(at, tip, 0.5), side), tip, sub(mix(at, tip, 0.5), side), leaf, { nu: 1, nv: 1 });
    }
  });
  // a moss ball (kokedama) on a dark slab, west of the doors
  const kx = -2.3, kz = ROOM.z1 - 0.35;
  m.box([kx - 0.22, 0, kz - 0.14], [kx + 0.22, 0.05, kz + 0.14], indoor("#2c2621"), { cell: 0.2 });
  m.blob([kx, 0.15, kz], [0.1, 0.1, 0.1], indoor((p) => mul(lin("#4f6a2d"), 0.75 + 0.4 * fbm(p[0] * 30, p[1] * 30, p[2] * 30))), { rows: 9, segments: 14, rough: 0.12, seed: 3 });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    m.tube([kx, 0.22, kz], [kx + Math.cos(a) * 0.14, 0.36 + 0.05 * hash3(k, 1, 1), kz + Math.sin(a) * 0.12], 0.004, 0.002, leaf, { segments: 4 });
    m.blob([kx + Math.cos(a) * 0.15, 0.37 + 0.05 * hash3(k, 1, 1), kz + Math.sin(a) * 0.13], [0.05, 0.012, 0.03], leaf, { rows: 4, segments: 8, rough: 0.1, seed: k });
  }
  return [m.out()];
}

// ─── outside: the veranda, the garden, the hills ────────────────────────────

function garden() {
  const near = Mesh("garden");
  const far = Mesh("hills");
  const Z0 = ROOM.z0;
  // the veranda: grey weathered boards under the eaves, a step stone off it
  for (let k = 0; k < 6; k++) {
    const z1 = Z0 - 0.08 - k * 0.2, z0 = z1 - 0.19;
    near.quad([ROOM.x0 - 0.5, -0.02, z1], [ROOM.x1 + 0.5, -0.02, z1], [ROOM.x1 + 0.5, -0.02, z0], [ROOM.x0 - 0.5, -0.02, z0], outdoor((p) => mul(lin("#b9a68a"), 0.9 + 0.12 * hash3(k, Math.floor(p[0] / 2.2), 1))), { cell: 0.7, n: [0, 1, 0], nv: 1 });
  }
  const vz = Z0 - 0.08 - 6 * 0.2;
  near.box([ROOM.x0 - 0.5, -0.45, vz], [ROOM.x1 + 0.5, -0.02, vz + 0.06], outdoor("#5b4a3a"), { cell: 0.8 });
  // the eaves above: a dark underside, a thin fascia
  near.quad([ROOM.x0 - 0.6, 2.98, Z0], [ROOM.x1 + 0.6, 2.98, Z0], [ROOM.x1 + 0.6, 2.98, Z0 - 1.6], [ROOM.x0 - 0.6, 2.98, Z0 - 1.6], outdoor("#6e5845"), { cell: 1, n: [0, -1, 0] });
  near.box([ROOM.x0 - 0.6, 2.98, Z0 - 1.66], [ROOM.x1 + 0.6, 3.12, Z0 - 1.6], outdoor("#4a3a2c"), { cell: 1 });
  // posts holding the eaves
  for (const x of [ROOM.x0 - 0.4, -1.8, 1.8, ROOM.x1 + 0.4]) near.box([x - 0.06, -0.45, Z0 - 1.5], [x + 0.06, 2.98, Z0 - 1.38], outdoor("#7c6248"), { cell: 0.5 });
  near.blob([0.6, -0.27, vz - 0.45], [0.45, 0.16, 0.3], outdoor("#8b867c"), { rows: 7, segments: 14, rough: 0.1, seed: 2, flat: 0.2 });

  // the garden floor: raked gravel in the middle, moss round it, a little lower than the house
  const G = -0.45;
  const gx0 = -18, gx1 = 18, gz0 = -17, gz1 = vz;
  const moss = (p) => mul(lin("#5d7036"), 0.75 + 0.45 * fbm(p[0] * 0.9, p[2] * 0.9));
  const gravelRegion = (x, z) => {
    // an oval of gravel, raked in lines along x, round two islands of moss and rock
    const ex = x / 7.5, ez = (z + 8.5) / 3.6;
    return ex * ex + ez * ez < 1;
  };
  const ground = (p) => {
    if (gravelRegion(p[0], p[2])) {
      const rake = 0.9 + 0.12 * Math.sin((p[2] * 2 * Math.PI) / 0.24);
      return mul(lin("#d4cfc2"), rake * (0.96 + 0.06 * noise(p[0] * 2, p[2] * 2)));
    }
    return moss(p);
  };
  const heightAt = (x, z) => {
    if (gravelRegion(x, z)) return G;
    // soft moss mounds outside the gravel
    return G + 0.35 * Math.max(0, fbm(x * 0.25 + 3, z * 0.25) - 0.45) * 2.2;
  };
  {
    const cell = 0.06;
    const nx = Math.ceil((gx1 - gx0) / 0.4), nz = Math.ceil((gz1 - gz0) / cell);
    const base = near.count;
    const ptAt = (i, j) => {
      const x = gx0 + (i / nx) * (gx1 - gx0), z = gz0 + (j / nz) * (gz1 - gz0);
      return [x, heightAt(x, z), z];
    };
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const p = ptAt(i, j);
        const dx = sub(ptAt(Math.min(nx, i + 1), j), ptAt(Math.max(0, i - 1), j));
        const dz = sub(ptAt(i, Math.min(nz, j + 1)), ptAt(i, Math.max(0, j - 1)));
        const n = norm(cross(dz, dx));
        near.v(p, n, outdoor(ground)(p, n));
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = base + j * (nx + 1) + i;
      near.tri(k, k + 1, k + nx + 2);
      near.tri(k, k + nx + 2, k + nx + 1);
    }
  }
  // rocks: a group of three in the gravel, and one by the basin
  const rock = (hex) => outdoor((p) => mul(lin(hex), 0.78 + 0.35 * fbm(p[0] * 3, p[1] * 3, p[2] * 3)));
  near.blob([-1.6, G, -8.4], [0.75, 0.55, 0.55], rock("#77736a"), { rows: 10, segments: 18, rough: 0.28, seed: 11, flat: 0.15 });
  near.blob([-0.85, G, -8.0], [0.42, 0.3, 0.38], rock("#827d72"), { rows: 9, segments: 16, rough: 0.25, seed: 12, flat: 0.15 });
  near.blob([2.1, G, -9.6], [0.5, 0.36, 0.42], rock("#6f6b63"), { rows: 9, segments: 16, rough: 0.3, seed: 13, flat: 0.15 });
  // moss round the rocks' feet
  for (const [x, z, r] of [[-1.3, -8.25, 1.1], [2.1, -9.6, 0.7]]) near.blob([x, G - 0.05, z], [r, 0.12, r * 0.75], outdoor(moss), { rows: 6, segments: 18, rough: 0.2, seed: x * 3, flat: 0 });
  // the water basin (tsukubai): a round stone with dark water, a bamboo spout
  const bxz = [4.6, -6.9];
  near.lathe([bxz[0], G - 0.02, bxz[1]], [[0, 0], [0.32, 0], [0.36, 0.12], [0.34, 0.36], [0.24, 0.38], [0.22, 0.3], [0, 0.3]], rock("#6e6a62"), { segments: 22 });
  near.lathe([bxz[0], G + 0.3, bxz[1]], [[0, 0], [0.22, 0], [0.22, 0.003], [0, 0.003]], outdoor("#22303a"), { segments: 20 });
  near.tube([bxz[0] + 0.85, G + 0.62, bxz[1] - 0.1], [bxz[0] + 0.2, G + 0.5, bxz[1] - 0.02], 0.03, 0.03, outdoor("#9a9a52"), { segments: 8 });
  near.tube([bxz[0] + 0.85, G, bxz[1] - 0.1], [bxz[0] + 0.85, G + 0.66, bxz[1] - 0.1], 0.035, 0.035, outdoor("#8a8a4a"), { segments: 8 });
  for (const [x, z, r] of [[3.8, -6.5, 0.22], [5.3, -7.4, 0.18], [4.2, -7.6, 0.16]]) near.blob([x, G, z], [r, r * 0.45, r * 0.8], rock("#7d796f"), { rows: 6, segments: 12, rough: 0.2, seed: x + z, flat: 0.2 });
  // a stone lantern (tōrō) beyond it
  const L = [6.6, -9.3];
  const stone = rock("#8a857b");
  near.lathe([L[0], G, L[1]], [[0, 0], [0.26, 0], [0.26, 0.1], [0.09, 0.14], [0.08, 0.7], [0.2, 0.74], [0.2, 0.82], [0, 0.82]], stone, { segments: 6 });
  near.box([L[0] - 0.17, G + 0.82, L[1] - 0.17], [L[0] + 0.17, G + 1.12, L[1] + 0.17], stone, { cell: 0.2 });
  near.box([L[0] - 0.08, G + 0.9, L[1] + 0.165], [L[0] + 0.08, G + 1.05, L[1] + 0.18], outdoor("#3a3229"), { cell: 0.3 });
  near.lathe([L[0], G + 1.12, L[1]], [[0, 0], [0.38, 0], [0.36, 0.05], [0.12, 0.2], [0.05, 0.26], [0.06, 0.3], [0, 0.34]], stone, { segments: 6 });

  // a Japanese maple in its autumn colour, leaning out over the gravel from the west
  const mx = -5.2, mz = -9.8;
  const bark = outdoor((p) => mul(lin("#4a3a30"), 0.8 + 0.25 * noise(p[1] * 5, p[0] * 5)));
  const limbs = [
    [[mx, G, mz], [mx + 0.3, G + 1.4, mz + 0.2], 0.16, 0.12],
    [[mx + 0.3, G + 1.4, mz + 0.2], [mx + 1.4, G + 2.4, mz + 0.6], 0.12, 0.07],
    [[mx + 0.3, G + 1.4, mz + 0.2], [mx - 0.5, G + 2.6, mz - 0.3], 0.1, 0.06],
    [[mx + 1.4, G + 2.4, mz + 0.6], [mx + 2.6, G + 2.9, mz + 1.1], 0.07, 0.035],
    [[mx + 0.3, G + 1.4, mz + 0.2], [mx + 0.6, G + 3.0, mz - 0.6], 0.09, 0.05],
  ];
  for (const [a, b, r0, r1] of limbs) near.tube(a, b, r0, r1, bark, { segments: 10 });
  const leaves = outdoor((p) => {
    const t = fbm(p[0] * 1.6, p[1] * 1.6, p[2] * 1.6);
    return mix(lin("#b8452a"), lin("#d9822f"), smooth(0.35, 0.75, t)).map((v) => v * (0.8 + 0.3 * noise(p[0] * 7, p[1] * 7, p[2] * 7)));
  });
  const crowns = [
    [[mx + 1.6, G + 2.75, mz + 0.7], [1.2, 0.55, 0.9]],
    [[mx + 2.7, G + 2.95, mz + 1.2], [0.9, 0.45, 0.7]],
    [[mx - 0.4, G + 2.9, mz - 0.2], [1.1, 0.6, 0.9]],
    [[mx + 0.6, G + 3.3, mz - 0.5], [1.2, 0.6, 0.9]],
    [[mx + 0.4, G + 2.5, mz + 0.4], [0.9, 0.5, 0.8]],
  ];
  crowns.forEach(([p, r], i) => near.blob(p, r, leaves, { rows: 9, segments: 16, rough: 0.45, seed: 20 + i }));
  // fallen leaves on the moss under it
  for (let k = 0; k < 40; k++) {
    const x = mx + 1.0 + (hash3(k, 4, 4) - 0.5) * 5, z = mz + 0.6 + (hash3(k, 5, 5) - 0.5) * 3.5;
    const y = heightAt(x, z) + 0.012;
    const s = 0.05 + 0.03 * hash3(k, 6, 6);
    const a = hash3(k, 7, 7) * Math.PI;
    const c = Math.cos(a) * s, sn = Math.sin(a) * s;
    near.quad([x - c, y, z - sn], [x - sn, y, z + c], [x + c, y, z + sn], [x + sn, y, z - c], outdoor(hash3(k, 8, 8) < 0.5 ? "#b8452a" : "#cf7a2c"), { n: [0, 1, 0], nu: 1, nv: 1 });
  }

  // the garden wall: earthen plaster under a tiled cap, and its returns
  const wallC = outdoor((p) => mul(lin("#c9b48c"), 0.88 + 0.12 * fbm(p[0] * 0.7, p[1] * 2)));
  const cap = outdoor("#4a4c4e");
  const WZ = -17;
  const WH = 1.25;
  near.box([gx0, G, WZ - 0.25], [gx1, G + WH, WZ], wallC, { cell: 0.6 });
  near.box([gx0 - 0.1, G + WH, WZ - 0.42], [gx1 + 0.1, G + WH + 0.1, WZ + 0.17], cap, { cell: 0.8 });
  near.box([gx0, G + WH + 0.1, WZ - 0.3], [gx1, G + WH + 0.18, WZ + 0.05], cap, { cell: 0.8 });
  for (const x of [gx0, gx1 - 0.25]) {
    near.box([x, G, WZ], [x + 0.25, G + WH, vz], wallC, { cell: 0.6 });
    near.box([x - 0.17, G + WH, WZ], [x + 0.42, G + WH + 0.1, vz], cap, { cell: 0.8 });
  }

  // beyond the wall: a grove of bamboo to the east, dark pines to the west
  for (let k = 0; k < 70; k++) {
    const x = 5 + hash3(k, 1, 9) * 13, z = WZ - 0.8 - hash3(k, 2, 9) * 5;
    const H = 6 + hash3(k, 3, 9) * 4;
    const lean = (hash3(k, 4, 9) - 0.5) * 0.6;
    far.tube([x, G, z], [x + lean, G + H, z], 0.05, 0.03, outdoor("#7f9a4e"), { segments: 5 });
    far.blob([x + lean, G + H - 0.6, z], [0.9, 1.4, 0.9], outdoor((p) => mul(lin("#6f8c3c"), 0.7 + 0.4 * noise(p[0], p[1], p[2]))), { rows: 6, segments: 9, rough: 0.5, seed: k });
  }
  for (let k = 0; k < 9; k++) {
    const x = -17 + k * 1.6 + hash3(k, 1, 7) * 0.8, z = WZ - 1.6 - hash3(k, 2, 7) * 3;
    const H = 6 + hash3(k, 3, 7) * 3;
    far.tube([x, G, z], [x, G + H * 0.6, z], 0.18, 0.12, outdoor("#4e3d33"), { segments: 7 });
    for (let t = 0; t < 4; t++) far.blob([x + (hash3(k, t, 8) - 0.5) * 1.5, G + H * (0.45 + t * 0.16), z], [1.8 - t * 0.3, 0.7, 1.5 - t * 0.25], outdoor((p) => mul(lin("#2f4a35"), 0.75 + 0.4 * noise(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3))), { rows: 6, segments: 12, rough: 0.4, seed: k * 4 + t, flat: 0.4 });
  }

  // the hills: three ridges round the north, each further and paler; the sky behind
  const ridge = (R, base, amp, seed, hex) => {
    const segs = 90;
    const lo = -1.95, hi = 1.95;
    const colour = (p, h) => mix(tone(mul(mix(lin(hex), mul(lin(hex), 1.2), smooth(0, 1, h)), outside(p, [-0.3, 0.6, 0.75]))), HAZE, 1 - Math.exp(-R / 420));
    for (let s = 0; s < segs; s++) {
      const a0 = lo + ((hi - lo) * s) / segs, a1 = lo + ((hi - lo) * (s + 1)) / segs;
      const top = (a) => base + amp * (0.55 * fbm(a * 2.2 + seed, seed) + 0.45 * fbm(a * 6 + seed * 2, seed)) ;
      const at = (a, y) => [Math.sin(a) * R, y, ROOM.z0 - Math.cos(a) * R];
      const t0 = top(a0), t1 = top(a1);
      const b0 = at(a0, G - 2), b1 = at(a1, G - 2), u0 = at(a0, t0), u1 = at(a1, t1);
      const base0 = far.count;
      far.v(b0, [0, 0, 1], colour(b0, 0));
      far.v(b1, [0, 0, 1], colour(b1, 0));
      far.v(u1, [0, 0, 1], colour(u1, 1));
      far.v(u0, [0, 0, 1], colour(u0, 1));
      far.tri(base0, base0 + 1, base0 + 2);
      far.tri(base0, base0 + 2, base0 + 3);
    }
  };
  ridge(70, 3, 14, 1, "#4a6640");
  ridge(130, 6, 26, 5, "#5f7868");
  ridge(220, 10, 45, 9, "#7d93a0");

  // the sky: a dome over the north, warm at the horizon, clearing to blue, brighter toward the low sun
  const sky = Mesh("sky");
  const R = 320;
  const rows = 14, segs = 48;
  const base = sky.count;
  for (let j = 0; j <= rows; j++) {
    const el = -0.05 + (j / rows) * 1.45;
    for (let s = 0; s <= segs; s++) {
      const a = -2.2 + (4.4 * s) / segs;
      const d = [Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)];
      const p = [d[0] * R, d[1] * R, ROOM.z0 + d[2] * R];
      const h = Math.max(0, d[1]);
      let c = mix(lin("#f3e4cc"), lin("#c9d8e6"), smooth(0, 0.25, h));
      c = mix(c, lin("#9fb9d6"), smooth(0.25, 0.9, h));
      const toSun = Math.max(0, dot(d, SUN));
      c = add(c, mul(lin("#ffe0b0"), 0.35 * toSun ** 6));
      sky.v(p, mul(d, -1), c.map((v) => Math.min(1, v)));
    }
  }
  for (let j = 0; j < rows; j++) for (let s = 0; s < segs; s++) {
    const k = base + j * (segs + 1) + s;
    sky.tri(k, k + segs + 1, k + 1);
    sky.tri(k + 1, k + segs + 1, k + segs + 2);
  }
  return [near.out(), far.out(), sky.out()];
}

// ─── chairs (lit by the stage, like the tables they belong to) ──────────────

/** A plain chair of pale ash, its front toward −z (the table), origin on the floor under its seat. */
export function chairMeshes() {
  const m = Mesh("chair", { lit: true });
  const wood = own("#c4a47c");
  const seat = own("#b8976d");
  const S = 0.42, Y = 0.45, L = 0.032;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = x * (S / 2 - L), pz = z * (S / 2 - L);
    const top = z > 0 ? 0.86 : Y;
    m.box([px - L / 2, 0, pz - L / 2], [px + L / 2, top, pz + L / 2], wood, { cell: 1 });
  }
  m.box([-S / 2, Y, -S / 2], [S / 2, Y + 0.03, S / 2], seat, { cell: 1 });
  // the back: two rails between the back legs
  for (const y of [0.64, 0.8]) m.box([-S / 2 + L / 2, y, S / 2 - L], [S / 2 - L / 2, y + 0.05, S / 2 - L / 2 + 0.002], wood, { cell: 1 });
  // stretchers low between the legs
  m.box([-S / 2 + L, 0.14, -0.012], [S / 2 - L, 0.165, 0.012], wood, { cell: 1 });
  return [m.out()];
}

/** The low table (a chabudai) Santorini is played at, kneeling: its top's size and height. */
export const LOW_TABLE = Object.freeze({ w: 1.08, d: 1.02, h: 0.32 });

/** A low table of dark elm on four short legs, origin on the floor under its middle. */
export function lowTableMeshes() {
  const m = Mesh("low-table", { lit: true });
  const { w, d, h } = LOW_TABLE;
  const T = 0.035;
  const top = own("#7a4f33");
  const leg = own("#5e3c27");
  m.box([-w / 2, h - T, -d / 2], [w / 2, h, d / 2], top, { cell: 2 });
  // a thin apron under the top's edge
  m.box([-w / 2 + 0.05, h - T - 0.05, -d / 2 + 0.05], [w / 2 - 0.05, h - T, d / 2 - 0.05], leg, { cell: 2, skip: ["+y"] });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.box([x * (w / 2 - 0.09) - 0.03, 0, z * (d / 2 - 0.09) - 0.03], [x * (w / 2 - 0.09) + 0.03, h - T, z * (d / 2 - 0.09) + 0.03], leg, { cell: 2 });
  return [m.out()];
}

/** A floor cushion (zabuton) of indigo cloth, origin on the floor under its middle. */
export function cushionMeshes() {
  const m = Mesh("cushion", { lit: true });
  const cloth = own("#3f4e6a");
  const S = 0.27;
  // a soft slab, puffed in the middle, a tuft at its centre
  m.box([-S, 0, -S], [S, 0.06, S], cloth, { cell: 2 });
  m.box([-S + 0.025, 0.06, -S + 0.025], [S - 0.025, 0.08, S - 0.025], cloth, { cell: 2, skip: ["-y"] });
  m.lathe([0, 0.08, 0], [[0, 0], [0.012, 0], [0.012, 0.006], [0, 0.006]], own("#2b3447"), { segments: 8 });
  return [m.out()];
}

// ─── what the probe puts in the scene ───────────────────────────────────────

/**
 * The room's pieces, each a GLB file the scene keeps (`key`, under
 * doc.assets) and an object showing it, locked: [{ key, name, meshes }].
 * Draw it after setTables (the floor shadows under the tables set).
 */
export function roomPieces() {
  return [
    { key: "office/floor@1", name: "Floor", meshes: floor },
    { key: "office/tatami@1", name: "Tatami", meshes: tatami },
    { key: "office/walls@1", name: "Walls and ceiling", meshes: shell },
    { key: "office/window@1", name: "Window", meshes: windowFrame },
    { key: "office/shoji@1", name: "Shoji", meshes: shoji },
    { key: "office/doors@1", name: "Doors", meshes: doors },
    { key: "office/lamps@1", name: "Lamps", meshes: lamps },
    { key: "office/alcove@1", name: "Tokonoma", meshes: alcove },
    { key: "office/plants@1", name: "Bamboo and moss", meshes: plants },
    { key: "office/garden@1", name: "Garden", meshes: garden },
  ];
}

/** A piece's GLB bytes and its box. */
export function pieceGLB(meshes) {
  const list = meshes();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of list) for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  return { bytes: encodeGLB({ generator: "patchwork games room", meshes: list }), bounds: { min, max }, vertices: list.reduce((n, m) => n + m.positions.length / 3, 0) };
}
