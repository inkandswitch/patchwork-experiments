/* Frontage strips for blocks and the sampled medial graph of a planar boundary. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-8,
    valid = p => Array.isArray(p) && p.length === 2 && p.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6),
    positive = x => Number.isFinite(x) && x > EPS,
    integer = (x, a, b) => Number.isSafeInteger(x) && x >= a && x <= b,
    sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
    cross = (a, b) => a[0] * b[1] - a[1] * b[0],
    dot = (a, b) => a[0] * b[0] + a[1] * b[1],
    mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    keyOf = (a, b) => a < b ? a + ':' + b : b + ':' + a,
    area = ps => ps.reduce((sum, p, i) => sum + cross(sub(p, ps[0]), sub(ps[(i + 1) % ps.length], ps[0])), 0) * 0.5;

  function clip(points, axis, border, direction) {
    const out = [];
    for (const [i, a] of points.entries()) {
      const b = points[(i + 1) % points.length], va = direction * (a[axis] - border), vb = direction * (b[axis] - border);
      if (va >= -EPS) out.push(a);
      if ((va > EPS && vb < -EPS) || (va < -EPS && vb > EPS)) out.push(mix(a, b, va / (va - vb)));
    }
    return out;
  }

  function parcels(outline, {
    edge = 0, pitch = 2, depth = 4, gap = 0, minArea = 0.25, maxChecks = 2000000
  } = {}) {
    if (
      !Array.isArray(outline) || !integer(outline.length, 3, 4096) || !outline.every(valid) ||
      !integer(edge, 0, outline.length - 1) || ![pitch, depth].every(positive) ||
      ![gap, minArea].every(n => Number.isFinite(n) && n >= 0) || !integer(maxChecks, 1, 30000000)
    ) throw new Error('Parcels need a block outline, frontage edge, and bounded lot dimensions');
    const a = outline[edge], b = outline[(edge + 1) % outline.length],
      direction = sub(b, a),
      distance = Math.hypot(...direction),
      side = Math.sign(area(outline));
    if (!positive(distance) || !side) throw new Error('Parcel frontage needs an edge and finite block area');
    const forward = direction.map(x => x / distance),
      inward = [-side * forward[1], side * forward[0]],
      local = p => [dot(sub(p, a), forward), dot(sub(p, a), inward)],
      world = p => [
        a[0] + p[0] * forward[0] + p[1] * inward[0],
        a[1] + p[0] * forward[1] + p[1] * inward[1]
      ];
    const { points, triangles } = P.geometry.triangulatePolygon([outline]),
      trianglesInChart = triangles.map(tri => tri.map(i => local(points[i]))),
      { cells } = P.fittedCourses({ width: distance, height: 1, unit: [pitch, 1] }),
      work = { checks: 0 }, lots = [];
    if (triangles.length * cells.length > maxChecks) throw new Error('Parcel subdivision exceeds its comparison budget');
    function segmentKey(p, q) {
      const a = p.map(v => Math.round(v / EPS)).join(','),
        b = q.map(v => Math.round(v / EPS)).join(',');
      return a === b ? null : keyOf(a, b);
    }
    for (const [number, cell] of cells.entries()) {
      const first = cell.bounds.min[0] + (number > 0 ? gap * 0.5 : 0),
        last = cell.bounds.max[0] - (number < cells.length - 1 ? gap * 0.5 : 0),
        fragments = [];
      if (last - first <= EPS) throw new Error('Parcel joint consumes its frontage');
      for (const triangle of trianglesInChart) {
        work.checks++;
        const vertices = clip(clip(clip(clip(triangle, 0, first, 1), 0, last, -1), 1, 0, 1), 1, depth, -1);
        const size = vertices.length >= 3 ? Math.abs(area(vertices)) : 0;
        if (size > EPS) fragments.push({ vertices, size });
      }
      // Keep only pieces connected by shared edges to the road-facing boundary.
      const frontier = [], used = new Set(), adjacency = new Map(), keys = [];
      for (const [index, { vertices }] of fragments.entries()) {
        const ids = [];
        for (let i = 0; i < vertices.length; i++) {
          const p = vertices[i], q = vertices[(i + 1) % vertices.length],
            id = segmentKey(p, q);
          if (!id) continue;
          if (!adjacency.has(id)) adjacency.set(id, []);
          adjacency.get(id).push(index);
          ids.push(id);
          if (Math.abs(p[1]) <= EPS && Math.abs(q[1]) <= EPS && !used.has(index)) {
            used.add(index);
            frontier.push(index);
          }
        }
        keys.push(ids);
      }
      for (let i = 0; i < frontier.length; i++) {
        for (const id of keys[frontier[i]]) for (const j of adjacency.get(id)) {
          if (used.has(j)) continue;
          used.add(j);
          frontier.push(j);
        }
      }
      const buildable = [...used].map(i => fragments[i]),
        buildableArea = buildable.reduce((sum, f) => sum + f.size, 0);
      if (buildableArea < minArea || !buildable.length) continue;
      lots.push({
        id: 'frontage:' + edge + ':' + number,
        frontage: [world([first, 0]), world([last, 0])],
        area: buildableArea, fragments: buildable.map(({ vertices }) => vertices.map(world))
      });
    }
    return P.data.freeze({ lots, work });
  }

  function medial(rings, { spacing = 0.4, minRadius = 0.08, height = () => 0, maxSites = 1800 } = {}) {
    if (
      !Array.isArray(rings) || !integer(rings.length, 1, 200) || !rings.every(r => Array.isArray(r) && integer(r.length, 3, 4096) && r.every(valid)) ||
      !positive(spacing) || !Number.isFinite(minRadius) || minRadius < 0 ||
      typeof height !== 'function' || !integer(maxSites, 3, 6000)
    ) throw new Error('Medial paths need bounded rings, sample spacing and a valid height field');
    const sampled = [], closed = [];
    let count = 0;
    for (const ring of rings) {
      const points = [],
        original = Math.hypot(...sub(ring[0], ring.at(-1))) <= EPS ? ring.slice(0, -1) : ring;
      for (const [i, a] of original.entries()) {
        const b = original[(i + 1) % original.length], segments = Math.max(1, Math.ceil(Math.hypot(...sub(b, a)) / spacing));
        if (count + segments > maxSites) throw new Error('Medial routes exceed their site budget');
        count += segments;
        for (let j = 0; j < segments; j++) points.push(mix(a, b, j / segments));
      }
      sampled.push(points);
      closed.push(original.concat([original[0]]).map(([x, z]) => [x, 0, z]));
    }
    const surface = P.geometry.triangulatePolygon(sampled),
      boundary = P.contacts.field(closed),
      centers = [], nodes = [], byPoint = new Map(), links = new Map(), edges = [];
    function inside(p) {
      let odd = false;
      for (const ring of rings) for (const [i, a] of ring.entries()) {
        const b = ring[(i + 1) % ring.length];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) odd = !odd;
      }
      return odd;
    }
    function center([i, j, k]) {
      const a = surface.points[i], u = sub(surface.points[j], a), v = sub(surface.points[k], a),
        determinant = 2 * cross(u, v);
      if (Math.abs(determinant) <= 1e-16) return null;
      const uu = dot(u, u), vv = dot(v, v),
        p = [a[0] + (uu * v[1] - vv * u[1]) / determinant, a[1] + (vv * u[0] - uu * v[0]) / determinant];
      if (!inside(p)) return null;
      const radius = boundary.distance(p[0], 0, p[1]);
      if (radius < minRadius) return null;
      const key = p.map(x => Math.round(x / EPS)).join(':');
      if (!byPoint.has(key)) {
        const y = height(...p);
        if (!Number.isFinite(y)) throw new Error('Medial path elevations must be finite');
        byPoint.set(key, nodes.length);
        nodes.push({ point: [p[0], y, p[1]], radius });
      }
      return byPoint.get(key);
    }
    const connections = new Set();
    for (const [i, triangle] of surface.triangles.entries()) {
      centers.push(center(triangle));
      for (const [j, a] of triangle.entries()) {
        const id = keyOf(a, triangle[(j + 1) % 3]);
        if (!links.has(id)) {
          links.set(id, i);
          continue;
        }
        const u = centers[i], v = centers[links.get(id)];
        if (u === null || v === null || u === v || connections.has(keyOf(u, v))) continue;
        const [x, , z] = nodes[u].point, [p, , q] = nodes[v].point,
          n = Math.max(2, Math.ceil(Math.hypot(p - x, q - z) / (spacing * 0.5)));
        if (n > 10000) throw new Error('Medial paths exceed their segment budget');
        let clear = true;
        for (let k = 1; k < n && clear; k++) clear = inside(mix([x, z], [p, q], k / n));
        if (!clear) continue;
        connections.add(keyOf(u, v));
        edges.push(Object.freeze({ a: u, b: v, route: P.routes.polyline([nodes[u].point, nodes[v].point]) }));
      }
    }
    return Object.freeze({ nodes: P.data.freeze(nodes), edges: Object.freeze(edges) });
  }

  Object.assign(P.routes, { parcels, medial });
})(KIT);
