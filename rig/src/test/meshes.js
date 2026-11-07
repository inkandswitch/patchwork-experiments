// Test meshes with known answers. Triangles, 9 numbers each, wound outward.

/** A closed box: x in [x0, x0 + L], y in [−B/2, B/2], z in [z0, z0 + D]. Centred on x = 0 by default. */
export function boxMesh(L, B, D, { x0 = -L / 2, z0 = 0 } = {}) {
  const v = (i) => [i & 1 ? x0 + L : x0, i & 2 ? B / 2 : -B / 2, i & 4 ? z0 + D : z0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const out = [];
  for (const q of quads)
    for (const [a, b, c] of [
      [q[0], q[1], q[2]],
      [q[0], q[2], q[3]],
    ])
      out.push(...v(a), ...v(b), ...v(c));
  return Float64Array.from(out);
}

/** A closed prism along x with a regular n-gon section of circumradius R centred at (y, z) = (0, zc). */
export function cylinderMesh(L, R, n = 128, zc = 0) {
  const ring = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [R * Math.cos(a), zc + R * Math.sin(a)];
  });
  const out = [];
  const x0 = -L / 2, x1 = L / 2;
  for (let i = 0; i < n; i++) {
    const [y0, z0] = ring[i];
    const [y1, z1] = ring[(i + 1) % n];
    out.push(x0, y0, z0, x0, y1, z1, x1, y1, z1);
    out.push(x0, y0, z0, x1, y1, z1, x1, y0, z0);
    out.push(x1, 0, zc, x1, y0, z0, x1, y1, z1);
    out.push(x0, 0, zc, x0, y1, z1, x0, y0, z0);
  }
  return Float64Array.from(out);
}

/** Reverse every triangle's winding. */
export function flip(t) {
  const o = Float64Array.from(t);
  for (let i = 0; i < o.length; i += 9)
    for (let c = 0; c < 3; c++) {
      const b = o[i + 3 + c];
      o[i + 3 + c] = o[i + 6 + c];
      o[i + 6 + c] = b;
    }
  return o;
}

/** Drop the triangles whose every vertex has z ≥ zTop (an open top). */
export function withoutTop(t, zTop) {
  const out = [];
  for (let i = 0; i < t.length; i += 9) if (!(t[i + 2] >= zTop && t[i + 5] >= zTop && t[i + 8] >= zTop)) out.push(...t.slice(i, i + 9));
  return Float64Array.from(out);
}

/** Add [dx, dy, dz] to every vertex. */
export function shift(t, [dx, dy, dz]) {
  const o = Float64Array.from(t);
  for (let i = 0; i < o.length; i += 3) {
    o[i] += dx;
    o[i + 1] += dy;
    o[i + 2] += dz;
  }
  return o;
}
