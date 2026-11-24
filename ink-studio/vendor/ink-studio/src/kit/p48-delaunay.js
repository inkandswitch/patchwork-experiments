/* Planar Delaunay and constrained triangulation with exact fallback predicates. */
(function (K) {
  const P = K.procedural || K.authoring,
    validPoint = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6),
    limit = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high,
    edgeKey = (a, b) => a < b ? a + ':' + b : b + ':' + a,
    sign = n => n > 0n ? 1 : n < 0n ? -1 : 0,
    bytes = new DataView(new ArrayBuffer(8));

  function integers(points) {
    const parts = [];
    let minimum = Infinity;
    for (const p of points) {
      for (const scalar of p) {
        bytes.setFloat64(0, scalar);
        const high = bytes.getUint32(0), low = bytes.getUint32(4),
          raw = (high >>> 20) & 2047,
          exponent = (raw || 1) - 1075,
          coefficient = BigInt(high & 0xfffff) * 4294967296n + BigInt(low) + (raw ? 4503599627370496n : 0n),
          value = (high >>> 31) ? -coefficient : coefficient;
        if (value && exponent < minimum) minimum = exponent;
        parts.push([value, exponent]);
      }
    }
    return parts.map(([value, exponent]) => value ? value << BigInt(exponent - minimum) : 0n);
  }
  function orient(a, b, c) {
    const x = (b[0] - a[0]) * (c[1] - a[1]),
      y = (b[1] - a[1]) * (c[0] - a[0]),
      determinant = x - y;
    if (Math.abs(determinant) > 8e-16 * (Math.abs(x) + Math.abs(y))) return Math.sign(determinant);
    const [ax, ay, bx, by, cx, cy] = integers([a, b, c]);
    return sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  }
  function circle(a, b, c, d) {
    const ax = a[0] - d[0], ay = a[1] - d[1],
      bx = b[0] - d[0], by = b[1] - d[1],
      cx = c[0] - d[0], cy = c[1] - d[1],
      aa = ax * ax + ay * ay, bb = bx * bx + by * by, cc = cx * cx + cy * cy,
      p = bx * cy, q = by * cx, r = cx * ay, s = cy * ax, t = ax * by, u = ay * bx,
      determinant = aa * (p - q) + bb * (r - s) + cc * (t - u),
      bound = aa * (Math.abs(p) + Math.abs(q)) + bb * (Math.abs(r) + Math.abs(s)) + cc * (Math.abs(t) + Math.abs(u));
    if (Math.abs(determinant) > 8e-15 * bound) return Math.sign(determinant);
    const [a0, a1, b0, b1, c0, c1, d0, d1] = integers([a, b, c, d]),
      x = a0 - d0, y = a1 - d1, i = b0 - d0, j = b1 - d1, k = c0 - d0, l = c1 - d1;
    return sign((x * x + y * y) * (i * l - j * k) +
      (i * i + j * j) * (k * y - l * x) + (k * k + l * l) * (x * j - y * i));
  }

  function delaunay(input, { constraints = [], maxChecks = 16000000, maxFlips = 30000 } = {}) {
    if (
      !Array.isArray(input) || !limit(input.length, 1, 6000) || !input.every(validPoint) ||
      !Array.isArray(constraints) || constraints.length > 14000 ||
      !constraints.every(link => Array.isArray(link) && link.length === 2 && link[0] !== link[1] &&
        link.every(i => limit(i, 0, input.length - 1))) ||
      !limit(maxChecks, 1, 60000000) || !limit(maxFlips, 1, 200000)
    ) throw new Error('Delaunay needs finite planar points, valid constraint indices and work limits');
    const points = input.map(p => p.slice()),
      ordered = points.map((_, i) => i).sort((a, b) => points[a][0] - points[b][0] || points[a][1] - points[b][1]),
      count = points.length,
      work = { checks: 0, flips: 0 };
    if (ordered.some((i, n) => n > 0 && points[i].every((v, axis) => v === points[ordered[n - 1]][axis])))
      throw new Error('Delaunay needs distinct planar points');
    const test = () => {
      if (++work.checks > maxChecks) throw new Error('Delaunay exceeds its predicate budget');
    };
    function facing(a, b, c) {
      test();
      return orient(points[a], points[b], points[c]);
    }
    function inside(a, b, c, d) {
      test();
      return circle(points[a], points[b], points[c], points[d]);
    }
    function triangle(a, b, c) {
      const direction = facing(a, b, c);
      return direction > 0 ? [a, b, c] : direction < 0 ? [b, a, c] : null;
    }
    function crossings(a, b, c, d) {
      if (a === c || a === d || b === c || b === d) return false;
      return facing(a, b, c) * facing(a, b, d) < 0 && facing(c, d, a) * facing(c, d, b) < 0;
    }
    const chain = new Map();
    for (const [a, b] of constraints) {
      const A = points[a], B = points[b],
        axis = Math.abs(B[0] - A[0]) >= Math.abs(B[1] - A[1]) ? 0 : 1,
        start = Math.min(A[axis], B[axis]), end = Math.max(A[axis], B[axis]),
        interior = ordered.filter(i => points[i][axis] >= start && points[i][axis] <= end && !facing(a, b, i));
      interior.sort((u, v) => points[u][axis] - points[v][axis]);
      for (let i = 1; i < interior.length; i++) {
        const u = Math.min(interior[i - 1], interior[i]), v = Math.max(interior[i - 1], interior[i]);
        chain.set(edgeKey(u, v), [u, v]);
      }
    }
    const fixed = [...chain.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 0; i < fixed.length; i++)
      for (let j = i + 1; j < fixed.length; j++)
        if (crossings(...fixed[i], ...fixed[j])) throw new Error('Delaunay constraint segments cross away from a shared point');

    if (count < 3 || ordered.every(i => !facing(ordered[0], ordered.at(-1), i))) {
      const edges = ordered.slice(1).map((b, i) => [Math.min(ordered[i], b), Math.max(ordered[i], b)]);
      return P.data.freeze({ points, triangles: [], edges, constraints: fixed, work });
    }
    function hullSide(sorted) {
      const side = [];
      for (const i of sorted) {
        while (side.length >= 2 && facing(side.at(-2), side.at(-1), i) <= 0) side.pop();
        side.push(i);
      }
      return side.slice(0, -1);
    }
    const hull = hullSide(ordered).concat(hullSide(ordered.slice().reverse())),
      hullSites = new Set(hull);
    let triangles = [];
    for (let i = 1; i < hull.length - 1; i++) triangles.push([hull[0], hull[i], hull[i + 1]]);
    for (const i of ordered) {
      if (hullSites.has(i)) continue;
      const kept = [], perimeter = new Map();
      for (const tri of triangles) {
        if (tri.some((a, j) => facing(a, tri[(j + 1) % 3], i) < 0)) {
          kept.push(tri);
          continue;
        }
        for (let j = 0; j < 3; j++) {
          const a = tri[j], b = tri[(j + 1) % 3], key = edgeKey(a, b);
          if (perimeter.has(key)) perimeter.delete(key);
          else perimeter.set(key, [a, b]);
        }
      }
      if (!perimeter.size) throw new Error('Delaunay lost a site during insertion');
      for (const [a, b] of perimeter.values()) {
        const tri = triangle(a, b, i);
        if (tri) kept.push(tri);
      }
      triangles = kept;
    }

    const links = new Map(), protectedEdges = new Set();
    function update(i, inserting) {
      const tri = triangles[i];
      for (let j = 0; j < 3; j++) {
        const a = Math.min(tri[j], tri[(j + 1) % 3]), b = Math.max(tri[j], tri[(j + 1) % 3]),
          key = edgeKey(a, b);
        if (inserting) {
          if (!links.has(key)) links.set(key, { a, b, key, owners: new Set() });
          links.get(key).owners.add(i);
        } else {
          const record = links.get(key);
          record.owners.delete(i);
          if (!record.owners.size) links.delete(key);
        }
      }
    }
    triangles.forEach((_, i) => update(i, true));
    function alternative(edge) {
      if (edge.owners.size !== 2 || protectedEdges.has(edge.key)) return null;
      const [i, j] = edge.owners,
        c = triangles[i].find(k => k !== edge.a && k !== edge.b),
        d = triangles[j].find(k => k !== edge.a && k !== edge.b);
      if (links.has(edgeKey(c, d)) || facing(c, d, edge.a) * facing(c, d, edge.b) >= 0) return null;
      return { i, j, c, d };
    }
    function flip(edge, { i, j, c, d }) {
      if (++work.flips > maxFlips) throw new Error('Delaunay exceeds its edge-flip budget');
      update(i, false);
      update(j, false);
      triangles[i] = triangle(c, d, edge.a);
      triangles[j] = triangle(d, c, edge.b);
      update(i, true);
      update(j, true);
      return [edgeKey(c, d), edgeKey(c, edge.a), edgeKey(c, edge.b), edgeKey(d, edge.a), edgeKey(d, edge.b)];
    }
    function ears(chain, reverse) {
      const polygon = reverse ? chain.slice().reverse() : chain.slice(),
        output = [];
      while (polygon.length > 3) {
        let ear = -1;
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[(i + polygon.length - 1) % polygon.length],
            b = polygon[i], c = polygon[(i + 1) % polygon.length];
          if (facing(a, b, c) <= 0) continue;
          if (polygon.some(p => p !== a && p !== b && p !== c &&
            facing(a, b, p) >= 0 && facing(b, c, p) >= 0 && facing(c, a, p) >= 0)) continue;
          output.push([a, b, c]);
          ear = i;
          break;
        }
        if (ear < 0) throw new Error('Delaunay could not triangulate a constraint cavity');
        polygon.splice(ear, 1);
      }
      if (polygon.length === 3) {
        const t = triangle(...polygon);
        if (t) output.push(t);
      }
      return output;
    }
    function recover(a, b) {
      const byTriangle = new Map();
      for (const edge of links.values()) {
        if (!crossings(a, b, edge.a, edge.b)) continue;
        if (protectedEdges.has(edge.key) || edge.owners.size !== 2) throw new Error('Invalid crossing in a Delaunay constraint cavity');
        for (const owner of edge.owners) {
          if (!byTriangle.has(owner)) byTriangle.set(owner, []);
          byTriangle.get(owner).push(edge);
        }
      }
      let current = [...byTriangle.keys()].find(i => triangles[i].includes(a)),
        previous = null;
      if (current === undefined) throw new Error('Delaunay could not enter a constraint cavity');
      const left = [a], right = [a], removed = new Set();
      while (!removed.has(current)) {
        removed.add(current);
        if (triangles[current].includes(b)) break;
        const edge = byTriangle.get(current)?.find(e => e !== previous);
        if (!edge) throw new Error('Delaunay could not cross a constraint cavity');
        const [l, r] = facing(a, b, edge.a) > 0 ? [edge.a, edge.b] : [edge.b, edge.a];
        if (left.at(-1) !== l) left.push(l);
        if (right.at(-1) !== r) right.push(r);
        previous = edge;
        current = [...edge.owners].find(i => i !== current);
      }
      if (!triangles[current].includes(b)) throw new Error('Delaunay constraint walk did not reach its endpoint');
      left.push(b);
      right.push(b);
      const replaced = ears(left, true).concat(ears(right, false));
      if (replaced.length !== removed.size) throw new Error('Delaunay constraint cavity changed its triangle count');
      const indices = [...removed];
      for (const i of indices) update(i, false);
      for (const [i, tri] of replaced.entries()) triangles[indices[i]] = tri;
      for (const i of indices) update(i, true);
      if ([...protectedEdges].some(key => !links.has(key))) throw new Error('Delaunay removed an earlier constraint');
    }
    for (const [a, b] of fixed) {
      const key = edgeKey(a, b);
      if (!links.has(key)) recover(a, b);
      if (!links.has(key)) throw new Error('Delaunay failed to retain a constraint');
      protectedEdges.add(key);
    }
    const agenda = [...links.keys()];
    for (let head = 0; head < agenda.length; head++) {
      const edge = links.get(agenda[head]),
        change = edge && alternative(edge);
      if (change && inside(...triangles[change.i], change.d) > 0) agenda.push(...flip(edge, change));
    }
    const edges = [...links.values()].map(edge => [edge.a, edge.b]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return P.data.freeze({ points, triangles, edges, constraints: fixed, work });
  }

  function triangulatePolygon(rings, options = {}) {
    if (!Array.isArray(rings) || !rings.length || rings.length > 1024) throw new Error('Polygon triangulation needs boundary rings');
    const points = [], constraints = [], loops = [];
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 3 || ring.length > 6001 || !ring.every(validPoint))
        throw new Error('Polygon rings need at least three finite planar points');
      const loop = ring.slice();
      if (loop[0].every((v, axis) => v === loop.at(-1)[axis])) loop.pop();
      if (loop.length < 3 || points.length + loop.length > 6000) throw new Error('Polygon exceeds its point budget');
      const start = points.length;
      points.push(...loop);
      loops.push(loop);
      for (let i = 0; i < loop.length; i++) constraints.push([start + i, start + (i + 1) % loop.length]);
    }
    const result = delaunay(points, { ...options, constraints });
    function interior([x, y]) {
      let odd = false;
      for (const ring of loops) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i], b = ring[j];
          if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) odd = !odd;
        }
      }
      return odd;
    }
    const triangles = result.triangles.filter(tri => {
      const p = tri.map(i => points[i]);
      return interior([(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3]);
    });
    return P.data.freeze({ points: result.points, triangles, constraints: result.constraints, work: result.work });
  }

  P.geometry.delaunay = delaunay;
  P.geometry.triangulatePolygon = triangulatePolygon;
})(KIT);
