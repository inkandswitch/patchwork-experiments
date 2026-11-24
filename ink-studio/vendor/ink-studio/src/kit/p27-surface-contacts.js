/* Intersect surface meshes and trim polylines against indexed closed solids. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    EPS = 1e-5,
    indexes = new WeakSet();
  const containmentDirections = [
    [1, 0.371391, 0.217173], [0.431319, 1, -0.273547],
    [-0.293153, 0.387431, 1], [-1, -0.515173, 0.673193]
  ].map(V.norm);
  const finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const pointKey = p => p.map(v => Math.round(v / EPS)).join(',');
  const lerp = (a, b, t) => V.mad(a, V.sub(b, a), t);
  const box = ps => A.spatial.boxOf(ps),
    overlap = A.spatial.overlap;
  function triangleRay(t, origin, dir, tolerance, edgeInfo) {
    const e1 = V.sub(t.p[1], t.p[0]),
      e2 = V.sub(t.p[2], t.p[0]),
      cross = V.cross(dir, e2),
      det = V.dot(e1, cross);
    if (Math.abs(det) < 1e-12) return null;
    const d = V.sub(origin, t.p[0]),
      u = V.dot(d, cross) / det;
    if (u < -1e-8 || u > 1 + 1e-8) return null;
    const q = V.cross(d, e1),
      v = V.dot(dir, q) / det;
    if (v < -1e-8 || u + v > 1 + 1e-8) return null;
    const along = V.dot(e2, q) / det;
    if (!(along >= -tolerance && along <= 1 + tolerance)) return null;
    if (edgeInfo && Math.min(u, v, 1 - u - v) <= 1e-8) edgeInfo.grazing = true;
    return Math.max(0, Math.min(1, along));
  }
  function index(mesh, { surfaces: filter, maxTriangles = 100000 } = {}) {
    if (
      (filter !== undefined && (!Array.isArray(filter) || !filter.every(name => typeof name === 'string'))) ||
      !Number.isSafeInteger(maxTriangles) ||
      maxTriangles < 1 ||
      maxTriangles > 500000
    ) {
      throw new Error('Invalid contact index filter or triangle budget');
    }
    const triangles = [];
    let considered = 0;
    if (
      !mesh ||
      !mesh.positions ||
      mesh.positions.length % 9 ||
      !mesh.positions.every(Number.isFinite) ||
      !Array.isArray(mesh.groups)
    )
      throw new Error('Contact mesh needs finite triangle positions and groups');
    for (const g of mesh.groups) {
      if (
        !Number.isSafeInteger(g.start) ||
        !Number.isSafeInteger(g.count) ||
        g.start < 0 ||
        g.count < 0 ||
        g.start % 3 ||
        g.count % 3 ||
        g.start + g.count > mesh.positions.length / 3
      )
        throw new Error('Contact mesh has an invalid triangle group');
      if (filter && !filter.includes(g.surface)) continue;
      considered += g.count / 3;
      if (considered > maxTriangles) throw new Error('Contact index exceeds its triangle budget');
      for (let i = g.start; i < g.start + g.count; i += 3) {
        const p = [0, 1, 2].map(j => Array.from(mesh.positions.slice((i + j) * 3, (i + j + 1) * 3))),
          cross = V.cross(V.sub(p[1], p[0]), V.sub(p[2], p[0]));
        if (V.len(cross) < 1e-12) continue;
        triangles.push({ p, n: V.norm(cross), bounds: box(p), surface: g.surface, owner: g.owner });
      }
    }
    function build(items) {
      if (!items.length) return null;
      const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const t of items)
        for (let i = 0; i < 3; i++) {
          b.min[i] = Math.min(b.min[i], t.bounds.min[i]);
          b.max[i] = Math.max(b.max[i], t.bounds.max[i]);
        }
      if (items.length <= 8) return { bounds: b, items };
      const sizes = b.max.map((v, i) => v - b.min[i]),
        axis = sizes.indexOf(Math.max(...sizes));
      items.sort((a, c) => a.bounds.min[axis] + a.bounds.max[axis] - c.bounds.min[axis] - c.bounds.max[axis]);
      const mid = Math.floor(items.length / 2);
      return { bounds: b, left: build(items.slice(0, mid)), right: build(items.slice(mid)) };
    }
    A.data.freeze(triangles);
    const root = build(triangles.slice());
    function query(b) {
      const out = [];
      function visit(node) {
        if (!node || !overlap(node.bounds, b)) return;
        if (node.items) {
          for (const t of node.items) if (overlap(t.bounds, b)) out.push(t);
        } else {
          visit(node.left);
          visit(node.right);
        }
      }
      visit(root);
      return out;
    }
    function castSegment(a, b, edgeInfo) {
      const dir = V.sub(b, a), length = V.len(dir);
      if (length < EPS) return [];
      const tolerance = EPS / length, hits = [];
      for (const triangle of query(A.spatial.expand(box([a, b]), EPS))) {
        const at = triangleRay(triangle, a, dir, tolerance, edgeInfo);
        if (at !== null) hits.push(at);
      }
      hits.sort((x, y) => x - y);
      return hits.filter((t, i) => !i || (t - hits[i - 1]) * length > EPS);
    }
    function crossings(a, b) {
      if (!finitePoint(a) || !finitePoint(b)) throw new Error('Crossings need finite endpoints');
      return castSegment(a, b);
    }
    function raycast(origin, direction, max) {
      if (!finitePoint(origin) || !finitePoint(direction) || !Number.isFinite(max) || max < 0)
        throw new Error('Contact rays need finite points and nonnegative reach');
      const length = V.len(direction);
      if (max < EPS || length < EPS || !root) return null;
      const ray = V.mul(direction, max / length), end = V.add(origin, ray);
      let nearest = Infinity, picked;
      for (const triangle of query(A.spatial.expand(box([origin, end]), EPS))) {
        const at = triangleRay(triangle, origin, ray, EPS / max);
        if (at !== null && at < nearest) {
          nearest = at;
          picked = triangle;
        }
      }
      return picked ? { p: V.mad(origin, ray, nearest), n: picked.n.slice(), distance: nearest * max,
        owner: picked.owner, surface: picked.surface } : null;
    }
    function onSurface(p) {
      if (!finitePoint(p)) throw new Error('Contact queries need a finite point');
      return query(A.spatial.expand({ min: p, max: p }, EPS)).some(t => {
        const d = V.dot(V.sub(p, t.p[0]), t.n);
        if (Math.abs(d) > EPS) return false;
        const projected = V.mad(p, t.n, -d);
        return t.p.every((a, i) => V.dot(V.cross(V.sub(t.p[(i + 1) % 3], a), V.sub(projected, a)), t.n) >= -EPS * EPS);
      });
    }
    function contains(p, boundaryInside) {
      if (!finitePoint(p)) throw new Error('Contact queries need a finite point');
      if (!root || !A.spatial.contains(A.spatial.expand(root.bounds, EPS), p)) return false;
      if (onSurface(p)) return boundaryInside === undefined ? true : boundaryInside;
      const extent = V.dist(root.bounds.min, root.bounds.max) * 4 + 1;
      const edgeInfo = { grazing: false };
      let firstParity;
      // Touching a triangle edge can leave an outside ray with a single reported hit.
      for (const direction of containmentDirections) {
        edgeInfo.grazing = false;
        const inside = castSegment(p, V.mad(p, direction, extent), edgeInfo).length % 2 === 1;
        if (!edgeInfo.grazing) return inside;
        firstParity ??= inside;
      }
      return firstParity;
    }
    const result = Object.freeze({
      triangles,
      bounds: root && A.data.freeze(root.bounds),
      query: b => query(A.spatial.bounds(b)),
      crossings,
      raycast,
      contains,
      onSurface
    });
    indexes.add(result);
    return result;
  }
  function planeSection(t, other) {
    const ds = t.p.map(p => V.dot(V.sub(p, other.p[0]), other.n)),
      out = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (Math.abs(ds[i]) <= EPS * 0.01) out.push(t.p[i]);
      if (ds[i] * ds[j] < 0) out.push(lerp(t.p[i], t.p[j], ds[i] / (ds[i] - ds[j])));
    }
    return out.filter((p, i) => out.findIndex(q => V.dist(p, q) < EPS * 0.01) === i);
  }
  function triangleContact(a, b) {
    const axis = V.cross(a.n, b.n);
    if (V.len(axis) < 1e-7) return null;
    const dir = V.norm(axis),
      ap = planeSection(a, b),
      bp = planeSection(b, a);
    if (ap.length < 2 || bp.length < 2) return null;
    const ta = ap.map(p => V.dot(p, dir)),
      tb = bp.map(p => V.dot(p, dir)),
      lo = Math.max(Math.min(...ta), Math.min(...tb)),
      hi = Math.min(Math.max(...ta), Math.max(...tb));
    if (hi - lo < EPS) return null;
    const origin = V.mad(ap[0], dir, -ta[0]);
    return {
      a: V.mad(origin, dir, lo),
      b: V.mad(origin, dir, hi),
      surfaceA: a.surface,
      surfaceB: b.surface,
      normalA: a.n,
      normalB: b.n
    };
  }
  function stitch(segments) {
    const nodes = new Map(),
      edges = [],
      unique = new Set();
    function node(p) {
      const key = pointKey(p);
      if (!nodes.has(key)) nodes.set(key, { p, edges: [] });
      return key;
    }
    for (const s of segments) {
      const a = node(s.a),
        b = node(s.b),
        key = [a, b].sort().join('|');
      if (a === b || unique.has(key)) continue;
      unique.add(key);
      const edge = { a, b, used: false };
      nodes.get(a).edges.push(edge);
      nodes.get(b).edges.push(edge);
      edges.push(edge);
    }
    const paths = [];
    function walk(start, edge) {
      const points = [nodes.get(start).p];
      let key = start;
      while (edge && !edge.used) {
        edge.used = true;
        key = edge.a === key ? edge.b : edge.a;
        points.push(nodes.get(key).p);
        const next = nodes.get(key);
        if (next.edges.length !== 2) break;
        edge = next.edges.find(e => !e.used);
      }
      if (points.length > 1) paths.push(points);
    }
    for (const [key, n] of [...nodes].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
      if (n.edges.length !== 2) for (const edge of n.edges) if (!edge.used) walk(key, edge);
    for (const edge of edges) if (!edge.used) walk(edge.a, edge);
    return paths;
  }
  function intersections(a, b, { maxPairs = 1000000 } = {}) {
    if (!indexes.has(a) || !indexes.has(b) || !Number.isSafeInteger(maxPairs) || maxPairs < 1 || maxPairs > 10000000) {
      throw new Error('Contact intersections need mesh indices and a valid pair budget');
    }
    let considered = 0;
    const groups = new Map();
    if (!a.bounds || !b.bounds || !overlap(a.bounds, b.bounds)) return [];
    const search = A.spatial.expand(b.bounds, EPS);
    for (const t of a.triangles) {
      if (!overlap(t.bounds, search)) continue;
      for (const other of b.query(A.spatial.expand(t.bounds, EPS))) {
        if (++considered > maxPairs) throw new Error('Contact intersections exceed their pair budget');
        const hit = triangleContact(t, other);
        if (!hit) continue;
        const key = JSON.stringify([hit.surfaceA, hit.surfaceB]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(hit);
      }
    }
    const out = [];
    for (const [key, segments] of groups) {
      const [surfaceA, surfaceB] = JSON.parse(key);
      for (const points of stitch(segments)) out.push({ surfaceA, surfaceB, points });
    }
    return out;
  }
  function clipCurve(points, solids) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 4097 || !points.every(finitePoint))
      throw new Error('Contact curve needs finite 3D points');
    if (
      !Array.isArray(solids) ||
      solids.length > 4096 ||
      !solids.every(s => indexes.has(s?.index) && typeof s.id === 'string' && s.id)
    ) {
      throw new Error('Curve clipping needs a bounded list of indexed solids with ids');
    }
    const out = [];
    let active = null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        length = V.dist(a, b);
      if (length < EPS) continue;
      const candidates = solids.filter(
        s => s.index.bounds && overlap(A.spatial.expand(box([a, b]), EPS), s.index.bounds)
      );
      const cuts = [0, 1, ...candidates.flatMap(s => s.index.crossings(a, b))]
        .sort((x, y) => x - y)
        .filter((t, j, all) => !j || (t - all[j - 1]) * length > EPS);
      for (let j = 0; j < cuts.length - 1; j++) {
        const lo = cuts[j],
          hi = cuts[j + 1],
          mid = lerp(a, b, (lo + hi) / 2),
          blockers = candidates
            .filter(s => s.index.contains(mid, s.boundaryInside))
            .map(s => s.id)
            .sort();
        if (blockers.length) {
          if (active) {
            active.after = blockers;
            active = null;
          }
          continue;
        }
        const pa = lerp(a, b, lo),
          pb = lerp(a, b, hi);
        if (!active || V.dist(active.points[active.points.length - 1], pa) > EPS * 2) {
          active = { points: [pa], start: [i, lo], end: [i, hi], after: [] };
          out.push(active);
        }
        if (V.dist(active.points[active.points.length - 1], pb) > EPS) active.points.push(pb);
        active.end = [i, hi];
      }
    }
    return out.filter(run => run.points.length > 1);
  }
  A.contacts = { index, intersections, clipCurve };
})(KIT);
