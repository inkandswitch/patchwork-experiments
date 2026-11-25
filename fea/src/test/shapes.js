// Parts with known answers, as triangle soup (9 numbers a triangle, wound
// outward), in metres. For the tests and the probes.

const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);

/** A box from the origin to (lx, ly, lz): 12 triangles, 6 faces. */
export function box(lx, ly, lz) {
  const P = [[0, 0, 0], [lx, 0, 0], [lx, ly, 0], [0, ly, 0], [0, 0, lz], [lx, 0, lz], [lx, ly, lz], [0, ly, lz]];
  const out = [];
  for (const [a, b, c, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) quad(out, P[a], P[b], P[c], P[d]);
  return Float64Array.from(out);
}

/**
 * A plate lx × ly × thickness (through z) with a round hole of radius r at
 * its middle, the hole a polygon of `segments` sides.
 */
export function plateWithHole(lx, ly, thickness, r, segments = 32) {
  const cx = lx / 2, cy = ly / 2;
  // two loops round the centre, by angle: the hole, and the rim (where each hole vertex's ray leaves the plate, and the corners)
  const inner = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    inner.push({ a, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  const rim = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const t = Math.min(Math.abs(c) > 1e-12 ? cx / Math.abs(c) : Infinity, Math.abs(s) > 1e-12 ? cy / Math.abs(s) : Infinity);
    return { a, x: cx + t * c, y: cy + t * s };
  };
  const corner = Math.atan2(cy, cx);
  const outer = [...inner.map((p) => rim(p.a)), ...[corner, Math.PI - corner, Math.PI + corner, 2 * Math.PI - corner].filter((a) => !inner.some((p) => Math.abs(p.a - a) < 1e-9)).map(rim)].sort((p, q) => p.a - q.a);
  // snap the rim onto the plate's edges exactly
  for (const p of outer) {
    if (Math.abs(p.x) < 1e-12) p.x = 0;
    if (Math.abs(p.x - lx) < 1e-12) p.x = lx;
    if (Math.abs(p.y) < 1e-12) p.y = 0;
    if (Math.abs(p.y - ly) < 1e-12) p.y = ly;
  }
  const out = [];
  const at = (p, z) => [p.x, p.y, z];
  // zip the two loops: always advance the one whose next point comes first by angle
  const zip = (z, up) => {
    let i = 0, j = 0;
    const n = inner.length, m = outer.length;
    while (i < n || j < m) {
      const ai = i < n ? inner[(i + 1) % n].a + (i + 1 === n ? 2 * Math.PI : 0) : Infinity;
      const aj = j < m ? outer[(j + 1) % m].a + (j + 1 === m ? 2 * Math.PI : 0) : Infinity;
      const A = at(inner[i % n], z), B = at(outer[j % m], z);
      if (aj <= ai) {
        const C = at(outer[(j + 1) % m], z);
        out.push(...(up ? [...A, ...B, ...C] : [...A, ...C, ...B]));
        j++;
      } else {
        const C = at(inner[(i + 1) % n], z);
        out.push(...(up ? [...A, ...B, ...C] : [...A, ...C, ...B]));
        i++;
      }
    }
  };
  zip(thickness, true);
  zip(0, false);
  for (let i = 0; i < inner.length; i++) {
    const p = inner[i], q = inner[(i + 1) % inner.length];
    quad(out, at(p, 0), at(p, thickness), at(q, thickness), at(q, 0)); // the hole's wall faces its axis
  }
  for (let j = 0; j < outer.length; j++) {
    const p = outer[j], q = outer[(j + 1) % outer.length];
    quad(out, at(p, 0), at(q, 0), at(q, thickness), at(p, thickness));
  }
  return Float64Array.from(out);
}

/** A cylinder of radius r along z from 0 to h, its round side `segments` flat strips. */
export function cylinder(r, h, segments = 32) {
  const out = [];
  const p = (i, z) => [r * Math.cos((2 * Math.PI * i) / segments), r * Math.sin((2 * Math.PI * i) / segments), z];
  for (let i = 0; i < segments; i++) {
    quad(out, p(i, 0), p(i + 1, 0), p(i + 1, h), p(i, h));
    out.push(0, 0, h, ...p(i, h), ...p(i + 1, h));
    out.push(0, 0, 0, ...p(i + 1, 0), ...p(i, 0));
  }
  return Float64Array.from(out);
}

/** A ball of radius r: no edge anywhere, so one face that closes on itself. */
export function ball(r, segments = 16) {
  const out = [];
  const p = (i, j) => {
    const th = (Math.PI * j) / segments, ph = (2 * Math.PI * i) / (2 * segments);
    return [r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)];
  };
  for (let j = 0; j < segments; j++)
    for (let i = 0; i < 2 * segments; i++) {
      const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
      if (j > 0) out.push(...a, ...b, ...c);
      if (j < segments - 1) out.push(...a, ...c, ...d);
    }
  return Float64Array.from(out);
}

/** A box with one long edge rounded: a flat top running smoothly into a fillet (`steps` strips) and on into a flat side. */
export function filleted(lx, ly, lz, radius, steps = 6) {
  // the profile in x–y (anticlockwise), swept along z
  const profile = [[0, 0], [lx, 0]];
  for (let k = 0; k <= steps; k++) {
    const a = (Math.PI / 2) * (k / steps);
    profile.push([lx - radius + radius * Math.cos(a), ly - radius + radius * Math.sin(a)]);
  }
  profile.push([0, ly]);
  const out = [];
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = profile[i], [x1, y1] = profile[(i + 1) % n];
    quad(out, [x0, y0, 0], [x1, y1, 0], [x1, y1, lz], [x0, y0, lz]);
  }
  for (let i = 1; i + 1 < n; i++) {
    out.push(profile[0][0], profile[0][1], lz, profile[i][0], profile[i][1], lz, profile[i + 1][0], profile[i + 1][1], lz);
    out.push(profile[0][0], profile[0][1], 0, profile[i + 1][0], profile[i + 1][1], 0, profile[i][0], profile[i][1], 0);
  }
  return Float64Array.from(out);
}

/** The same triangles turned about an axis (unit) by an angle and moved. */
export function placed(triangles, { axis = [0, 0, 1], angle = 0, move = [0, 0, 0] } = {}) {
  const [x, y, z] = axis, c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const R = [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  const out = new Float64Array(triangles.length);
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i], b = triangles[i + 1], d = triangles[i + 2];
    out[i] = R[0] * a + R[1] * b + R[2] * d + move[0];
    out[i + 1] = R[3] * a + R[4] * b + R[5] * d + move[1];
    out[i + 2] = R[6] * a + R[7] * b + R[8] * d + move[2];
  }
  return out;
}

/** A direction through the same turn. */
export function turned(v, { axis = [0, 0, 1], angle = 0 } = {}) {
  return Array.from(placed(Float64Array.from([...v, 0, 0, 0, 0, 0, 0]), { axis, angle }).slice(0, 3));
}
