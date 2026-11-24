/* Signed planar profiles, rounded offsets and mesh-free extrusions. */
(function (K) {
  const P = K.procedural, EPS = 1e-8,
    point = p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6),
    close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPS;
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  function hits(a, b, c, d) {
    const between = (p, a, b) => p.every((v, i) => v >= Math.min(a[i], b[i]) - EPS && v <= Math.max(a[i], b[i]) + EPS),
      u = cross(a, b, c), v = cross(a, b, d), s = cross(c, d, a), t = cross(c, d, b);
    return (u * v < 0 && s * t < 0) ||
      (Math.abs(u) <= EPS * Math.hypot(b[0] - a[0], b[1] - a[1]) && between(c, a, b)) ||
      (Math.abs(v) <= EPS * Math.hypot(b[0] - a[0], b[1] - a[1]) && between(d, a, b)) ||
      (Math.abs(s) <= EPS * Math.hypot(d[0] - c[0], d[1] - c[1]) && between(a, c, d)) ||
      (Math.abs(t) <= EPS * Math.hypot(d[0] - c[0], d[1] - c[1]) && between(b, c, d));
  }

  function profile(rings) {
    if (!Array.isArray(rings) || !rings.length || rings.length > 128) throw new Error('A profile needs an exterior ring');
    const edges = [], points = [], parts = [];
    for (const [i, raw] of rings.entries()) {
      if (!Array.isArray(raw) || raw.length < 3 || raw.length > 1201 || !raw.every(point))
        throw new Error('Profile rings need finite planar coordinates');
      const vertices = raw.map(p => p.slice());
      if (close(vertices[0], vertices.at(-1))) vertices.pop();
      if (vertices.length < 3 || points.length + vertices.length > 1200) throw new Error('Profile exceeds its vertex budget');
      const area = vertices.reduce((sum, a, j) => sum + cross(vertices[0], a, vertices[(j + 1) % vertices.length]), 0) * 0.5;
      if (Math.abs(area) <= EPS * EPS) throw new Error('Profile rings need nonzero area');
      const reverse = (i === 0) !== (area > 0),
        oriented = reverse ? vertices.slice().reverse() : vertices,
        field = P.geometry.profileDistance(oriented), n = oriented.length;
      for (const [j, a] of oriented.entries()) {
        const b = oriented[(j + 1) % n], c = oriented[(j + 2) % n];
        if (close(a,b) || (Math.abs(cross(a,b,c)) < EPS * EPS &&
          (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0))
          throw new Error('Profile edges must be distinct and cannot turn back on themselves');
        edges.push({ a, b, ring: i, ordinal: j, count: n, source: reverse ? (n * 2 - j - 2) % n : j });
      }
      if (i && parts[0].field(...oriented[0]) >= 0) throw new Error('Profile holes must lie inside the exterior ring');
      if (i && parts.slice(1).some(p => p.field(...oriented[0]) <= 0 || field(...p.ring[0]) <= 0))
        throw new Error('Profile holes must have disjoint interiors');
      parts.push({ ring: oriented, field });
      points.push(...oriented);
    }
    for (const [i, a] of edges.entries()) for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j], same = a.ring === b.ring, span = Math.abs(a.ordinal - b.ordinal);
      if (same && (span === 1 || span === a.count - 1)) continue;
      if (hits(a.a, a.b, b.a, b.b)) throw new Error('Profile boundaries cannot cross or touch');
    }
    const bounds = { min: [Infinity,Infinity], max: [-Infinity,-Infinity] };
    for (const p of points) for (let i = 0; i < 2; i++) {
      bounds.min[i] = Math.min(p[i], bounds.min[i]);
      bounds.max[i] = Math.max(p[i], bounds.max[i]);
    }
    const sd = (x, z) => {
      let d = parts[0].field(x,z);
      for (let i = 1; i < parts.length; i++) d = Math.max(d, -parts[i].field(x,z));
      return d;
    };
    return P.data.freeze({ rings: parts.map(p => p.ring), edges, bounds, sd, cost: edges.length });
  }
  function domain(raw) {
    if (Array.isArray(raw)) return profile(raw);
    if (typeof raw?.sd !== 'function' || !point(raw.bounds?.min) || !point(raw.bounds?.max) ||
      raw.bounds.min.some((v, i) => v >= raw.bounds.max[i])) throw new Error('Expected a compiled planar profile');
    const { sd, bounds, cost = 1 } = raw;
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > 80000) throw new Error('Invalid planar profile cost');
    return { sd, bounds: { min: bounds.min.slice(), max: bounds.max.slice() }, cost };
  }
  function offset(raw, distance) {
    const base = domain(raw);
    if (!Number.isFinite(distance) || Math.abs(distance) > 1e5) throw new Error('Invalid profile offset');
    const pad = Math.max(0, distance), bounds = {
      min: base.bounds.min.map(v => v - pad), max: base.bounds.max.map(v => v + pad)
    }, sd = (x, z) => base.sd(x, z) - distance;
    return P.data.freeze({ bounds, sd, cost: base.cost,
      contours({ cell = 0.06, maxCells } = {}) {
        return P.contours.march(sd, { cell, maxCells, bounds: {
          min: bounds.min.map(v => v - cell * 1.63),
          max: bounds.max.map(v => v + cell * 1.63)
        } });
      }
    });
  }
  function extrude(raw, { low = 0, high = 1 } = {}) {
    if (![low, high].every(v => Number.isFinite(v) && Math.abs(v) <= 1e6) || high - low <= EPS)
      throw new Error('Extrusion needs finite increasing elevations');
    const base = domain(raw), { min, max } = base.bounds;
    return P.data.freeze({ bounds: { min: [min[0],low,min[1]], max: [max[0],high,max[1]] }, cost: base.cost,
      sd(x, y, z) {
        const a = base.sd(x,z), b = Math.max(low - y, y - high);
        return Math.min(Math.max(a,b), 0) + Math.hypot(Math.max(0,a), Math.max(0,b));
      }
    });
  }
  Object.assign(P.construct, { profile, offset, extrude });
})(KIT);
