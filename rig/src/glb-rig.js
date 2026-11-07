// The rig GLB, drawn from the contract (contract.js), so the scene shows
// exactly what extras.rig states. Pure: no DOM, no THREE; runs in the
// worker. The GLB is in the hull's own glTF coordinates (the inverse of
// the contract's frame.glbToFrame), so a rig object attached to its hull at
// the identity transform stands on her real stem, sheer and transom. For a
// hull the GLB's frame calls Y-up (camber's, and the default), that is the
// scene's Y-up convention; a hull modelled Z-up gets a Z-up rig to match.
//
// Nodes (names are part of the contract, §8; no spaces, so three.js keeps
// them as they are): "Rig" (the root) holding "Mast", "Boom", "Spreaders",
// "Rigging" (the standing rigging, as lines), "Sail" (the main, its origin
// at the gooseneck so scaling its Y lowers it to the boom), "Jib" (origin
// at its tack), "Staysail", "Keel", "Bulb", "Rudder", "Stock" (the rudder
// stock), and, only when no hull is linked, "SyntheticHull". The scene's
// extras carry `rig` (the contract) and `sail` (sailing's lumped plan).
//
// The drawing is not a scantling: the mast and boom are round tubes of a
// stated diameter, the foils NACA 00xx sections lofted root to tip, the
// rigging lines. Foil roots are carried up into the hull to the canoe
// body's underside at their leading and trailing edges, so no gap shows.

import { encodeGLB, MODE, computeBounds } from "./glb.js";
import { mastSection } from "./contract.js";

const COLORS = {
  spar: "#b9bdc3",
  rigging: "#3a3f45",
  sail: "#f3efe6",
  jib: "#ece7da",
  foil: "#3c4047",
  stock: "#9aa0a6",
  hull: "#e7e3da",
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The contract frame → the GLB's coordinates, from frame.glbToFrame (column-major; rotation + translation). */
export function frameToGlb(m) {
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j * 4 + i]));
  const t = [m[12], m[13], m[14]];
  const point = (p) => {
    const q = sub(p, t);
    return [0, 1, 2].map((j) => A[0][j] * q[0] + A[1][j] * q[1] + A[2][j] * q[2]);
  };
  const dir = (v) => [0, 1, 2].map((j) => A[0][j] * v[0] + A[1][j] * v[1] + A[2][j] * v[2]);
  return { point, dir };
}

/** A builder of one primitive in frame coordinates (positions, normals, indices), mapped on output. */
function prim() {
  const pos = [], nrm = [], idx = [];
  return {
    pos,
    nrm,
    idx,
    vert(p, n) {
      pos.push(p);
      nrm.push(n ?? [0, 0, 1]);
      return pos.length - 1;
    },
    tri(a, b, c) {
      idx.push(a, b, c);
    },
  };
}

/** Emit a primitive, its positions relative to `origin` (frame coords), in GLB coordinates. */
function emit(p, X, { origin = null, color, mode = MODE.TRIANGLES, metallic = 0, roughness = 0.8, normals = true } = {}) {
  const o = origin ? X.point(origin) : [0, 0, 0];
  const positions = new Float32Array(p.pos.length * 3);
  p.pos.forEach((v, i) => {
    const g = X.point(v);
    positions[i * 3] = g[0] - o[0];
    positions[i * 3 + 1] = g[1] - o[1];
    positions[i * 3 + 2] = g[2] - o[2];
  });
  const out = { positions, mode, color, metallic, roughness };
  if (normals && mode === MODE.TRIANGLES) {
    const n = new Float32Array(p.nrm.length * 3);
    p.nrm.forEach((v, i) => {
      const g = norm(X.dir(v));
      n[i * 3] = g[0];
      n[i * 3 + 1] = g[1];
      n[i * 3 + 2] = g[2];
    });
    out.normals = n;
  }
  if (p.idx.length) out.indices = Uint32Array.from(p.idx);
  return out;
}

/** Two unit vectors perpendicular to d. */
function basis(d) {
  const a = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(d, a));
  return [u, cross(d, u)];
}

/** A closed tube of radius r from a to b. */
export function tube(p, a, b, r, sides = 10) {
  const d = norm(sub(b, a));
  const [u, v] = basis(d);
  const ring = (c) =>
    Array.from({ length: sides }, (_, k) => {
      const t = (2 * Math.PI * k) / sides;
      const n = add(mul(u, Math.cos(t)), mul(v, Math.sin(t)));
      return p.vert(add(c, mul(n, r)), n);
    });
  const r0 = ring(a), r1 = ring(b);
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    p.tri(r0[k], r0[k1], r1[k1]);
    p.tri(r0[k], r1[k1], r1[k]);
  }
  for (const [c, n, ring0, flip] of [[a, mul(d, -1), r0, true], [b, d, r1, false]]) {
    const ci = p.vert(c, n);
    const rim = ring0.map((i) => p.vert(p.pos[i], n));
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      if (flip) p.tri(ci, rim[k1], rim[k]);
      else p.tri(ci, rim[k], rim[k1]);
    }
  }
}

/** NACA 00xx half-thickness (closed trailing edge), as a fraction of the chord. */
export const nacaHalf = (tc, xi) => 5 * tc * (0.2969 * Math.sqrt(xi) - 0.126 * xi - 0.3516 * xi ** 2 + 0.2843 * xi ** 3 - 0.1036 * xi ** 4);

/**
 * A foil lofted between NACA sections. Each section: [leX, z, chord]; the
 * foil lies in the centreplane, chord along −x.
 */
export function foilSolid(p, sections, tc, n = 14) {
  const xi = Array.from({ length: n + 1 }, (_, i) => 0.5 * (1 - Math.cos((Math.PI * i) / n)));
  // a ring per section: upper (port) LE → TE, then lower (starboard) TE → LE, without repeating the ends
  const rings = sections.map(([le, z, c]) => {
    const pts = [];
    for (const s of xi) pts.push([le - s * c, nacaHalf(tc, s) * c, z]);
    for (let i = n - 1; i >= 1; i--) pts.push([le - xi[i] * c, -nacaHalf(tc, xi[i]) * c, z]);
    return pts;
  });
  const m = rings[0].length;
  const ids = rings.map((ring, k) =>
    ring.map((q, i) => {
      // the normal: across the section, outward (flat-ish; good enough for a drawing)
      const prev = ring[(i - 1 + m) % m], next = ring[(i + 1) % m];
      const t = sub(next, prev);
      return p.vert(q, norm([t[1], -t[0], 0]));
    }),
  );
  for (let k = 0; k + 1 < ids.length; k++)
    for (let i = 0; i < m; i++) {
      const i1 = (i + 1) % m;
      p.tri(ids[k][i], ids[k][i1], ids[k + 1][i1]);
      p.tri(ids[k][i], ids[k + 1][i1], ids[k + 1][i]);
    }
  // caps: fans about the section's mid-chord
  for (const [k, up] of [[0, true], [rings.length - 1, false]]) {
    const ring = rings[k];
    const nz = up ? [0, 0, 1] : [0, 0, -1];
    const c = [(ring[0][0] + ring[n][0]) / 2, 0, ring[0][2]];
    const ci = p.vert(c, nz);
    const rim = ring.map((q) => p.vert(q, nz));
    for (let i = 0; i < m; i++) {
      const i1 = (i + 1) % m;
      if (up) p.tri(ci, rim[i1], rim[i]);
      else p.tri(ci, rim[i], rim[i1]);
    }
  }
}

/** A prolate spheroid along x. */
export function spheroid(p, centre, L, D, seg = 18, rings = 10) {
  const a = L / 2, b = D / 2;
  const grid = [];
  for (let i = 0; i <= rings; i++) {
    const th = (Math.PI * i) / rings;
    const row = [];
    for (let j = 0; j < seg; j++) {
      const ph = (2 * Math.PI * j) / seg;
      const q = [a * Math.cos(th), b * Math.sin(th) * Math.cos(ph), b * Math.sin(th) * Math.sin(ph)];
      const nrm = norm([q[0] / (a * a), q[1] / (b * b), q[2] / (b * b)]);
      row.push(p.vert(add(centre, q), nrm));
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      p.tri(grid[i][j], grid[i + 1][j], grid[i + 1][j1]);
      p.tri(grid[i][j], grid[i + 1][j1], grid[i][j1]);
    }
}

/** A flat polygon in the centreplane, fanned from its first point, both faces. */
export function sheet(p, poly) {
  const n = [0, 1, 0];
  const ids = poly.map((q) => p.vert(q, n));
  for (let i = 1; i + 1 < ids.length; i++) p.tri(ids[0], ids[i], ids[i + 1]);
}

/**
 * The rig GLB.
 * @param {object} contract buildContract's
 * @param {{ hullTriangles?: Float64Array|null, sails?: boolean, bottomAt?: (x: number) => number|null }} [o]
 *   hullTriangles: the synthetic hull in the contract frame, drawn as "SyntheticHull"; bottomAt: the canoe body's underside, for foil roots
 * @returns {{ glb: Uint8Array, bounds: { min: number[], max: number[] } | null, extras: object }}
 */
export function buildRigGlb(contract, { hullTriangles = null, sails = true, bottomAt = null } = {}) {
  const X = frameToGlb(contract.frame.glbToFrame);
  const meshes = [];
  const nodes = [{ name: "Rig", children: [] }];
  const add_ = (name, primitives, extra = {}) => {
    const prims = primitives.filter((q) => q && q.positions.length);
    if (!prims.length) return;
    meshes.push({ name, primitives: prims });
    nodes.push({ name, mesh: meshes.length - 1, ...extra });
    nodes[0].children.push(nodes.length - 1);
  };
  const rig = contract.rig;
  const mast = rig.mast;

  // spars
  const rM = mastSection(mast.lengthM) / 2;
  const mp = prim();
  // the mast's front is at the partners: its axis is a radius aft
  const back = [-rM, 0, 0];
  tube(mp, add(mast.stepM, back), add(mast.headM, back), rM);
  add_("Mast", [emit(mp, X, { color: COLORS.spar, metallic: 0.5, roughness: 0.4 })]);
  if (rig.boom) {
    const bp = prim();
    tube(bp, add(rig.boom.gooseneckM, back), rig.boom.endM, 0.7 * rM);
    add_("Boom", [emit(bp, X, { color: COLORS.spar, metallic: 0.5, roughness: 0.4 })]);
  }
  if (rig.spreaders.length) {
    const sp = prim();
    for (const s of rig.spreaders) for (const tip of s.tipsM) tube(sp, add(s.rootM, back), tip, 0.35 * rM, 6);
    add_("Spreaders", [emit(sp, X, { color: COLORS.spar, metallic: 0.5, roughness: 0.4 })]);
  }
  if (rig.standing.length) {
    const lp = prim();
    for (const s of rig.standing) {
      const pts = [s.fromM, ...s.viaM, s.toM];
      for (let i = 0; i + 1 < pts.length; i++) {
        lp.pos.push(pts[i], pts[i + 1]);
        lp.nrm.push([0, 0, 1], [0, 0, 1]);
      }
    }
    add_("Rigging", [emit(lp, X, { color: COLORS.rigging, mode: MODE.LINES, normals: false })]);
  }

  // sails: each node's origin at its tack (the main's at the gooseneck), so scaling Y lowers it to there
  if (sails)
    for (const s of contract.sails) {
      const sp = prim();
      sheet(sp, s.polygonM);
      const name = s.id === "main" ? "Sail" : s.id === "jib" ? "Jib" : "Staysail";
      add_(name, [emit(sp, X, { origin: s.tackM, color: s.id === "main" ? COLORS.sail : COLORS.jib })], { translation: X.point(s.tackM) });
    }

  // foils
  for (const f of contract.appendages) {
    const c = f.cornersM;
    const root = [c.rootLE[0], c.rootLE[2], f.rootChordM];
    const tip = [c.tipLE[0], c.tipLE[2], f.tipChordM];
    const sections = [tip, root];
    // carry the root up to the hull's underside at its LE and TE (only where the hull is its end plate)
    if (f.endPlateFactor === 2 && bottomAt) {
      const zs = [bottomAt(c.rootLE[0]), bottomAt(c.rootTE[0])].filter(Number.isFinite);
      const top = zs.length ? Math.max(...zs) + 0.02 : c.rootLE[2];
      if (top > c.rootLE[2] + 1e-4) sections.push([c.rootLE[0], top, f.rootChordM]);
    }
    const fp = prim();
    foilSolid(fp, sections, f.tc);
    add_(f.id === "keel" ? "Keel" : "Rudder", [emit(fp, X, { color: COLORS.foil, roughness: 0.6 })]);
    if (f.bulb) {
      const bp = prim();
      spheroid(bp, f.bulb.centreM, f.bulb.lengthM, f.bulb.diameterM);
      add_("Bulb", [emit(bp, X, { color: COLORS.foil, roughness: 0.6 })]);
    }
    if (f.stock) {
      const st = prim();
      const [a, b] = f.stock.axisM;
      // from mid-blade up to the deck, a little proud of it
      const mid = add(a, mul(sub(f.stock.bearingM, a), 0.5));
      const top = add(b, mul(norm(sub(b, a)), 0.08));
      tube(st, mid, top, Math.max(0.012, 0.05 * f.rootChordM), 10);
      add_("Stock", [emit(st, X, { color: COLORS.stock, metallic: 0.6, roughness: 0.35 })]);
    }
  }

  // the synthetic hull, when no hull is linked (a linked hull is its own object in the scene)
  if (hullTriangles && hullTriangles.length) {
    const hp = prim();
    for (let i = 0; i < hullTriangles.length; i += 9) {
      const a = [hullTriangles[i], hullTriangles[i + 1], hullTriangles[i + 2]];
      const b = [hullTriangles[i + 3], hullTriangles[i + 4], hullTriangles[i + 5]];
      const c = [hullTriangles[i + 6], hullTriangles[i + 7], hullTriangles[i + 8]];
      const n = norm(cross(sub(b, a), sub(c, a)));
      const k = hp.pos.length;
      hp.vert(a, n);
      hp.vert(b, n);
      hp.vert(c, n);
      hp.tri(k, k + 1, k + 2);
    }
    add_("SyntheticHull", [emit(hp, X, { color: COLORS.hull, roughness: 0.7 })]);
  }

  const ls = contract.lumpedSail;
  const extras = {
    rig: contract,
    // sailing's lumped plan (sailing/src/sim.js sailOf), in this GLB's own coordinates
    sail: ls ? { plan: { tack: X.point(ls.tackM), luff: ls.luffM, foot: ls.footM, area: ls.areaM2 } } : null,
  };
  if (!extras.sail) delete extras.sail;
  const glb = encodeGLB({ meshes, nodes, extras, generator: contract.source.generator });
  let bounds = null;
  for (const m of meshes)
    for (const q of m.primitives) {
      const b = computeBounds(q.positions);
      if (!b) continue;
      const node = nodes.find((nd) => nd.mesh === meshes.indexOf(m));
      const t = node?.translation ?? [0, 0, 0];
      const lo = add(b.min, t), hi = add(b.max, t);
      bounds = bounds ? { min: bounds.min.map((v, i) => Math.min(v, lo[i])), max: bounds.max.map((v, i) => Math.max(v, hi[i])) } : { min: lo, max: hi };
    }
  return { glb, bounds, extras };
}
