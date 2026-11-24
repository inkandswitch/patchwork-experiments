// The plain parts of a look → triangles, in metres, Y up, standing on y = 0.
// Pure, no three.js. (Slabs and models are look/slab.js's and look/look.js's;
// look.js places every part at its `at`, turned by its `rotation`.)
//
//   { shape: "box", size: [w, h, d], at?, color }
//   { shape: "frustum", bottom: [w, d], top: [w, d], height, at?, color }   a box that tapers
//   { shape: "lathe", profile: [[r, y], …], segments?, at?, color }         turned, like a pawn
//
// `at` is where the part's base centre goes ([0, 0, 0] if absent). A lathe
// profile runs from the axis at the bottom, up the outside, back to the axis
// at the top; corners sharper than SMOOTH_DEG stay sharp, gentler ones are
// shaded smooth (a dome looks round, a cylinder's rim stays crisp).

const SMOOTH_DEG = 35;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const vec = (a, n, d = 0) => Array.from({ length: n }, (_, i) => num(a?.[i], d));

/** Flat-shaded triangle soup → { positions, normals }. */
function soup(tris) {
  const positions = [];
  const normals = [];
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    for (const p of [a, b, c]) {
      positions.push(...p);
      normals.push(n[0] / l, n[1] / l, n[2] / l);
    }
  }
  return { positions, normals };
}

/** Eight corners → twelve outward-facing triangles. Bottom face z-order: 0 (-x,-z), 1 (+x,-z), 2 (+x,+z), 3 (-x,+z); top 4..7 likewise. */
function hexahedron(c) {
  const q = (a, b, cc, d) => [
    [c[a], c[b], c[cc]],
    [c[a], c[cc], c[d]],
  ];
  return soup([
    ...q(0, 1, 2, 3), // bottom, facing down
    ...q(4, 7, 6, 5), // top, facing up
    ...q(0, 4, 5, 1), // -z
    ...q(1, 5, 6, 2), // +x
    ...q(2, 6, 7, 3), // +z
    ...q(3, 7, 4, 0), // -x
  ]);
}

function frustum(bottom, top, height, at) {
  const [bw, bd] = bottom.map((v) => v / 2);
  const [tw, td] = top.map((v) => v / 2);
  const [x, y, z] = at;
  return hexahedron([
    [x - bw, y, z - bd],
    [x + bw, y, z - bd],
    [x + bw, y, z + bd],
    [x - bw, y, z + bd],
    [x - tw, y + height, z - td],
    [x + tw, y + height, z - td],
    [x + tw, y + height, z + td],
    [x - tw, y + height, z + td],
  ]);
}

function lathe(profile, segments, at) {
  const pts = profile.map((p) => [Math.max(0, num(p?.[0])), num(p?.[1])]);
  if (pts.length < 2) return { positions: [], normals: [] };
  // each profile segment's outward normal in (r, y)
  const segN = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dr = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dr, dy) || 1;
    segN.push([dy / l, -dr / l]);
  }
  const cosSmooth = Math.cos((SMOOTH_DEG * Math.PI) / 180);
  const smoothAt = (i, own, other) => {
    const a = segN[own];
    const b = segN[other];
    if (!b || a[0] * b[0] + a[1] * b[1] < cosSmooth) return a;
    const n = [a[0] + b[0], a[1] + b[1]];
    const l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l];
  };
  const positions = [];
  const normals = [];
  const indices = [];
  const [ax, ay, az] = at;
  for (let s = 0; s < segN.length; s++) {
    const ends = [
      { p: pts[s], n: smoothAt(s, s, s - 1) },
      { p: pts[s + 1], n: smoothAt(s + 1, s, s + 1) },
    ];
    const base = positions.length / 3;
    for (let k = 0; k <= segments; k++) {
      const t = (k / segments) * Math.PI * 2;
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      for (const { p, n } of ends) {
        positions.push(ax + p[0] * cos, ay + p[1], az + p[0] * sin);
        normals.push(n[0] * cos, n[1], n[0] * sin);
      }
    }
    for (let k = 0; k < segments; k++) {
      const a = base + k * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, d, a, d, c);
    }
  }
  return { positions, normals, indices };
}

/** One part → { positions, normals, indices? } (empty arrays for an unknown shape). */
export function partGeometry(part) {
  const at = vec(part?.at, 3);
  switch (part?.shape) {
    case "box": {
      const [w, h, d] = vec(part.size, 3);
      return frustum([w, d], [w, d], h, at);
    }
    case "frustum":
      return frustum(vec(part.bottom, 2), vec(part.top, 2), num(part.height), at);
    case "lathe":
      return lathe(Array.isArray(part.profile) ? part.profile : [], Math.max(3, Math.round(num(part.segments, 32))), at);
    default:
      return { positions: [], normals: [] };
  }
}
