// Geometry for TTS objects, built in the object's own TTS frame (unscaled
// local units, Y up), then baked into the scene's frame. Pure.
//
// A part is { name, slot, positions, normals, uvs?, indices } where `slot`
// names the material it gets ("top", "bottom", "side", "body", …). Builders
// give every triangle the winding that makes its normal point outward when the
// coordinates are read right-handed; bake() then mirrors z (convert.js), which
// reverses each triangle so they stay outward in the scene's right-handed frame.
//
// Texture orientation, worked out from real mods (players sit at -Z; cards,
// tiles and boards lie at rotY = 180 to be read from there): at rotation 0 an
// image on the top face has its top edge at -Z and its left edge at +X. The
// bottom face is the same image turned over about the object's length (Z), as
// a card is: top edge at -Z, left edge at -X.

import { IcosahedronGeometry, DodecahedronGeometry, OctahedronGeometry, TetrahedronGeometry } from "three";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A growable part. */
function part(name, slot) {
  const p = { name, slot, positions: [], normals: [], uvs: [], indices: [] };
  p.vertex = (pos, normal, uv) => {
    p.positions.push(...pos);
    p.normals.push(...normal);
    p.uvs.push(...(uv ?? [0, 0]));
    return p.positions.length / 3 - 1;
  };
  /** A triangle of vertex indices, wound so its normal points along `out`. */
  p.tri = (a, b, c, out) => {
    const P = (i) => p.positions.slice(i * 3, i * 3 + 3);
    const n = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    if (dot(n, out) >= 0) p.indices.push(a, b, c);
    else p.indices.push(a, c, b);
  };
  return p;
}

const done = (p) => ({ name: p.name, slot: p.slot, positions: p.positions, normals: p.normals, uvs: p.uvs, indices: p.indices });

// ─── outlines in the xz plane ─────────────────────────────────────────────────

export const rectOutline = (hx, hz) => [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]];

export function roundedOutline(hx, hz, r, seg = 6) {
  const rr = Math.min(r, hx, hz);
  const pts = [];
  const corners = [[hx - rr, hz - rr, 0], [-hx + rr, hz - rr, 90], [-hx + rr, -hz + rr, 180], [hx - rr, -hz + rr, 270]];
  for (const [cx, cz, a0] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      pts.push([cx + rr * Math.cos(a), cz + rr * Math.sin(a)]);
    }
  return pts;
}

export function ellipseOutline(hx, hz, seg = 48) {
  return Array.from({ length: seg }, (_, i) => {
    const a = (2 * Math.PI * i) / seg;
    return [hx * Math.cos(a), hz * Math.sin(a)];
  });
}

/** A hexagon with corners at ±x, filling the box ±hx × ±hz. */
export function hexOutline(hx, hz) {
  return [[hx, 0], [hx / 2, hz], [-hx / 2, hz], [-hx, 0], [-hx / 2, -hz], [hx / 2, -hz]];
}

/** Image uv on the top face (see the file comment), for a box of half extents hx, hz. */
export const topUV = (hx, hz) => (x, z) => [(hx - x) / (2 * hx), (z + hz) / (2 * hz)];
/** …and on the bottom face. */
export const bottomUV = (hx, hz) => (x, z) => [(x + hx) / (2 * hx), (z + hz) / (2 * hz)];

/**
 * A flat piece: a convex outline extruded from y = -t/2 to +t/2 — cards,
 * tiles, tokens, boards. Top and bottom carry uvs over the outline's box
 * (hx, hz); sides are flat-shaded, or smooth when `smoothSides` (circles).
 * Returns parts with slots "top", "bottom" and (unless sides: false) "side".
 */
export function slab(outline, thickness, { hx, hz, sides = true, smoothSides = false } = {}) {
  const t = thickness / 2;
  if (hx == null) hx = Math.max(...outline.map((p) => Math.abs(p[0])));
  if (hz == null) hz = Math.max(...outline.map((p) => Math.abs(p[1])));
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  const parts = [];
  for (const [slot, y, uvf, up] of [["top", t, topUV(hx, hz), 1], ["bottom", -t, bottomUV(hx, hz), -1]]) {
    const p = part(slot, slot);
    const c = p.vertex([cx, y, cz], [0, up, 0], uvf(cx, cz));
    const ring = outline.map(([x, z]) => p.vertex([x, y, z], [0, up, 0], uvf(x, z)));
    for (let i = 0; i < ring.length; i++) p.tri(c, ring[i], ring[(i + 1) % ring.length], [0, up, 0]);
    parts.push(done(p));
  }
  if (sides && thickness > 0) {
    const p = part("side", "side");
    const total = outline.reduce((s, a, i) => s + Math.hypot(...[0, 1].map((k) => outline[(i + 1) % outline.length][k] - a[k])), 0);
    let run = 0;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const flat = norm([b[1] - a[1], 0, -(b[0] - a[0])]);
      const mid = [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz];
      const out = dot(flat, mid) >= 0 ? flat : flat.map((v) => -v);
      const na = smoothSides ? norm([a[0] - cx, 0, a[1] - cz]) : out;
      const nb = smoothSides ? norm([b[0] - cx, 0, b[1] - cz]) : out;
      const u0 = run / total, u1 = (run + len) / total;
      run += len;
      const i0 = p.vertex([a[0], -t, a[1]], na, [u0, 1]);
      const i1 = p.vertex([b[0], -t, b[1]], nb, [u1, 1]);
      const i2 = p.vertex([b[0], t, b[1]], nb, [u1, 0]);
      const i3 = p.vertex([a[0], t, a[1]], na, [u0, 0]);
      p.tri(i0, i1, i2, out);
      p.tri(i0, i2, i3, out);
    }
    parts.push(done(p));
  }
  return parts;
}

/**
 * A box centred on the origin. `faceUV(face)` may give a uv rect
 * { x, y, w, h } (top-left origin) per face ("+x", "-x", "+y", "-y", "+z",
 * "-z") and `faceTurn(face)` a quarter-turn count for it, so one image can
 * texture all six (dice). Slot "body".
 */
export function box(sx, sy, sz, { faceUV = null, faceTurn = null, slot = "body", name = "box" } = {}) {
  const p = part(name, slot);
  const h = [sx / 2, sy / 2, sz / 2];
  const faces = {
    "+x": { n: [1, 0, 0], u: [0, 0, -1], v: [0, -1, 0] },
    "-x": { n: [-1, 0, 0], u: [0, 0, 1], v: [0, -1, 0] },
    "+y": { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1] },
    "-y": { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    "+z": { n: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
    "-z": { n: [0, 0, -1], u: [-1, 0, 0], v: [0, -1, 0] },
  };
  for (const [key, f] of Object.entries(faces)) {
    const rect = faceUV?.(key) ?? { x: 0, y: 0, w: 1, h: 1 };
    const turns = ((faceTurn?.(key) ?? 0) % 4 + 4) % 4;
    const corner = (su, sv) => {
      const pos = [0, 1, 2].map((k) => (f.n[k] + f.u[k] * su + f.v[k] * sv) * h[k]);
      // (su, sv) ∈ {-1, 1}²: image left→right along u, top→bottom along v, turned
      let [a, b] = [(su + 1) / 2, (sv + 1) / 2];
      for (let i = 0; i < turns; i++) [a, b] = [1 - b, a];
      return p.vertex(pos, f.n, [rect.x + a * rect.w, rect.y + b * rect.h]);
    };
    const i0 = corner(-1, -1), i1 = corner(1, -1), i2 = corner(1, 1), i3 = corner(-1, 1);
    p.tri(i0, i1, i2, f.n);
    p.tri(i0, i2, i3, f.n);
  }
  return [done(p)];
}

/** A solid of revolution about +Y: profile [[r, y], …] from the bottom centre up and back to the axis. Slot "body". */
export function lathe(profile, { segments = 24, slot = "body", name = "lathe" } = {}) {
  const p = part(name, slot);
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    const slope = norm([y1 - y0, -(r1 - r0), 0]); // outward normal of the profile segment, in (r, y, ·)
    for (let s = 0; s < segments; s++) {
      const a0 = (2 * Math.PI * s) / segments, a1 = (2 * Math.PI * (s + 1)) / segments;
      const P = (r, y, a) => [r * Math.cos(a), y, r * Math.sin(a)];
      const N = (a) => norm([slope[0] * Math.cos(a), -slope[1], slope[0] * Math.sin(a)]);
      const am = (a0 + a1) / 2;
      const out = N(am);
      const q = [p.vertex(P(r0, y0, a0), N(a0)), p.vertex(P(r0, y0, a1), N(a1)), p.vertex(P(r1, y1, a1), N(a1)), p.vertex(P(r1, y1, a0), N(a0))];
      const outward = Math.abs(dot(out, out)) > 0 ? out : [0, y1 > y0 ? 1 : -1, 0];
      p.tri(q[0], q[1], q[2], outward);
      p.tri(q[0], q[2], q[3], outward);
    }
  }
  return [done(p)];
}

const POLYHEDRA = { 4: TetrahedronGeometry, 8: OctahedronGeometry, 12: DodecahedronGeometry, 20: IcosahedronGeometry };

/** A die of `sides` faces with circumradius r (d10 drawn as a pentagonal trapezohedron, others as platonic solids). Slot "body". */
export function polyhedron(sides, r, { name = `d${sides}` } = {}) {
  if (sides === 6) return box(r * 1.1547, r * 1.1547, r * 1.1547, { name });
  if (sides === 10) return trapezohedron(r, name);
  const G = POLYHEDRA[sides] ?? IcosahedronGeometry;
  const g = new G(r, 0);
  const pos = g.getAttribute("position").array;
  const p = part(name, "body");
  for (let i = 0; i < pos.length; i += 9) {
    const a = [pos[i], pos[i + 1], pos[i + 2]], b = [pos[i + 3], pos[i + 4], pos[i + 5]], c = [pos[i + 6], pos[i + 7], pos[i + 8]];
    const n = norm(cross(sub(b, a), sub(c, a)));
    const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const out = dot(n, centre) >= 0 ? n : n.map((v) => -v);
    p.tri(p.vertex(a, out), p.vertex(b, out), p.vertex(c, out), out);
  }
  g.dispose?.();
  return [done(p)];
}

function trapezohedron(r, name) {
  const p = part(name, "body");
  const h = r * 0.12;
  const top = [0, r, 0], bottom = [0, -r, 0];
  const ring = (k, y) => {
    const a = (Math.PI / 5) * k;
    return [r * 0.95 * Math.cos(a), y, r * 0.95 * Math.sin(a)];
  };
  const upper = Array.from({ length: 5 }, (_, i) => ring(2 * i, h));
  const lower = Array.from({ length: 5 }, (_, i) => ring(2 * i + 1, -h));
  const face = (pts) => {
    const c = pts.reduce((s, q) => s.map((v, k) => v + q[k] / pts.length), [0, 0, 0]);
    const n0 = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const out = dot(n0, c) >= 0 ? n0 : n0.map((v) => -v);
    const ids = pts.map((q) => p.vertex(q, out));
    for (let i = 1; i + 1 < ids.length; i++) p.tri(ids[0], ids[i], ids[i + 1], out);
  };
  for (let i = 0; i < 5; i++) {
    face([top, upper[i], lower[i], upper[(i + 1) % 5]]);
    face([bottom, lower[i], upper[(i + 1) % 5], lower[(i + 1) % 5]]);
  }
  return [done(p)];
}

/** Every part's bounds in its own frame. */
export function partsBounds(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < p.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p.positions[i + k]);
        max[k] = Math.max(max[k], p.positions[i + k]);
      }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/** Move parts by an offset (in place-free copy). */
export function translateParts(parts, [dx, dy, dz]) {
  return parts.map((p) => ({ ...p, positions: p.positions.map((v, i) => v + [dx, dy, dz][i % 3]) }));
}

/**
 * Parts in the TTS frame → the scene's frame: scale by the object's TTS scale,
 * mirror z, × metres per unit; triangles re-wound, normals carried through the
 * inverse-transpose (then renormalised). Returns new parts with typed arrays.
 */
export function bake(parts, scale = [1, 1, 1], unit = 0.0254) {
  const [sx, sy, sz] = scale.map((v) => (Number.isFinite(v) && v !== 0 ? v : 1));
  // a negative scale mirrors too: count mirrors to know whether to re-wind
  const mirrors = 1 + (sx < 0) + (sy < 0) + (sz < 0);
  return parts.map((p) => {
    const n = p.positions.length / 3;
    const positions = new Float32Array(n * 3);
    const normals = p.normals?.length ? new Float32Array(n * 3) : null;
    for (let i = 0; i < n; i++) {
      positions[i * 3] = p.positions[i * 3] * sx * unit;
      positions[i * 3 + 1] = p.positions[i * 3 + 1] * sy * unit;
      positions[i * 3 + 2] = -p.positions[i * 3 + 2] * sz * unit;
      if (normals) {
        const nx = p.normals[i * 3] / sx, ny = p.normals[i * 3 + 1] / sy, nz = -p.normals[i * 3 + 2] / sz;
        const l = Math.hypot(nx, ny, nz) || 1;
        normals[i * 3] = nx / l;
        normals[i * 3 + 1] = ny / l;
        normals[i * 3 + 2] = nz / l;
      }
    }
    const indices = Uint32Array.from(p.indices);
    if (mirrors % 2 === 1) for (let i = 0; i + 2 < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    return { name: p.name, slot: p.slot, positions, normals, uvs: p.uvs?.length ? Float32Array.from(p.uvs) : null, indices };
  });
}
