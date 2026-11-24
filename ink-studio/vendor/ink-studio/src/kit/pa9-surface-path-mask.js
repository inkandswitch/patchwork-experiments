/* Polygonal path clearances for fitted surfaces and chart-local fields. */
(function (K) {
  const P = K.procedural || K.authoring, EPS = 1e-8;
  const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

  function simplify(points) {
    const result = [];
    for (const p of points) {
      const last = result.at(-1);
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) <= EPS) continue;
      if (result.length > 1) {
        const a = result.at(-2), dx = p[0] - a[0], dy = p[1] - a[1];
        const x = last[0] - a[0], y = last[1] - a[1];
        if (Math.abs(dx * y - dy * x) <= EPS * Math.hypot(dx, dy) &&
            x * (p[0] - last[0]) + y * (p[1] - last[1]) >= 0) result.pop();
      }
      result.push(p);
    }
    return result;
  }

  function pathMask(paths, { facets = 4 } = {}) {
    if (!Array.isArray(paths) || paths.length > 1024 || !Number.isSafeInteger(facets) || facets < 2 || facets > 16)
      throw new Error('Path masks need bounded paths and 2 to 16 facets per cap');
    const records = [];
    let stations = 0;
    for (const { points, radius } of paths) {
      if (!Array.isArray(points) || !points.length || (stations += points.length) > 32768 ||
          !points.every(point) || !Number.isFinite(radius) || radius <= EPS)
        throw new Error('Path masks need finite chart points and positive radii');
      const nodes = simplify(points);
      for (let i = 0; i < Math.max(1, nodes.length - 1); i++) {
        const a = nodes[i], b = nodes[i + 1], polygon = [];
        if (b) {
          const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
          for (const [center, start] of [[b, angle - Math.PI / 2], [a, angle + Math.PI / 2]]) {
            for (let j = 0; j <= facets; j++) {
              const theta = start + j * Math.PI / facets;
              polygon.push([center[0] + radius * Math.cos(theta), center[1] + radius * Math.sin(theta)]);
            }
          }
        } else {
          for (let j = 0; j < facets * 2; j++) {
            const theta = j * Math.PI / facets;
            polygon.push([a[0] + radius * Math.cos(theta), a[1] + radius * Math.sin(theta)]);
          }
        }
        const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
        records.push({
          polygon, signed: P.geometry.profileDistance(polygon),
          min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)]
        });
      }
    }
    const holes = P.data.freeze(records.map(r => r.polygon));
    function distance(x, y) {
      let best = Infinity;
      for (const r of records) {
        const bound = Math.max(r.min[0] - x, x - r.max[0], r.min[1] - y, y - r.max[1]);
        if (bound > 0 && bound >= best) continue;
        best = Math.min(best, r.signed(x, y));
      }
      return best;
    }
    return Object.freeze({ holes, distance });
  }

  P.surfaceCells.pathMask = pathMask;
})(KIT);
