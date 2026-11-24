/* General bounded implicit surfaces and uncapped triangle clipping. Marching
   tetrahedra keeps a consistent cube diagonal; negative fields face outward.
   The budget controls sampling work, without changing the supplied field. */
(function (K) {
  const A = K.procedural,
    V = K.V;
  const corners = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    tets = [
      [0, 5, 1, 6],
      [0, 1, 2, 6],
      [0, 2, 3, 6],
      [0, 3, 7, 6],
      [0, 7, 4, 6],
      [0, 4, 5, 6]
    ],
    partitions = new Array(256);
  function split(d) {
    let mask = 0;
    for (let i = 0; i < 8; i++) if (d[i] < 0) mask |= 1 << i;
    return partitions[mask] ||= tets
      .map(tet => [tet.filter(i => d[i] < 0), tet.filter(i => d[i] >= 0)])
      .filter(([low, high]) => low.length && high.length);
  }
  function march(field, bounds, options, emit) {
    const o = Object.assign({ resolution: 0.12, maxCells: 30000, edgeRefinements: 0 }, options);
    if (
      typeof field !== 'function' ||
      !bounds ||
      !['min', 'max'].every(
        k => Array.isArray(bounds[k]) && bounds[k].length === 3 && bounds[k].every(Number.isFinite)
      ) ||
      bounds.min.some((v, i) => v >= bounds.max[i]) ||
      !Number.isFinite(o.resolution) ||
      o.resolution <= 0 ||
      !Number.isSafeInteger(o.maxCells) ||
      o.maxCells < 8
    )
      throw new Error('Implicit meshes need a finite box, field and sampling budget');
    if (o.prepareColumn !== undefined && typeof o.prepareColumn !== 'function')
      throw new Error('Implicit mesh column preparation needs a callback');
    const size = bounds.max.map((v, i) => v - bounds.min[i]);
    if (!size.every(Number.isFinite) || o.maxCells > 2000000 ||
        !Number.isInteger(o.edgeRefinements) || o.edgeRefinements < 0 || o.edgeRefinements > 12)
      throw new Error('Implicit mesh extent and sampling budget exceed supported limits');
    let step = Math.max(o.resolution, Math.max(...size) / o.maxCells),
      counts = size.map(v => Math.max(1, Math.ceil(v / step)));
    while (counts.reduce((n, v) => n * v, 1) > o.maxCells) {
      step *= 1.15;
      counts = size.map(v => Math.max(1, Math.ceil(v / step)));
    }
    const dimensions = counts.map(n => n + 1),
      stride = dimensions[0] * dimensions[1],
      values = new Float64Array(stride * dimensions[2]),
      at = (x, y, z) => [
        bounds.min[0] + (size[0] * x) / counts[0],
        bounds.min[1] + (size[1] * y) / counts[1],
        bounds.min[2] + (size[2] * z) / counts[2]
      ],
      slot = (x, y, z) => x + dimensions[0] * y + stride * z;
    function write(x, y, z, distance) {
      if (o.allowMissing && distance === null) distance = NaN;
      else if (!Number.isFinite(distance)) throw new Error('Implicit mesh field must return finite values');
      values[slot(x, y, z)] = distance;
    }
    if (o.prepareColumn) {
      for (let z = 0; z < dimensions[2]; z++)
        for (let x = 0; x < dimensions[0]; x++) {
          const [px, , pz] = at(x, 0, z), evaluate = o.prepareColumn(px, pz);
          if (typeof evaluate !== 'function') throw new Error('An implicit mesh column must return a field of y');
          for (let y = 0; y < dimensions[1]; y++)
            write(x, y, z, evaluate(bounds.min[1] + (size[1] * y) / counts[1]));
        }
    } else {
      for (let z = 0; z < dimensions[2]; z++)
        for (let y = 0; y < dimensions[1]; y++)
          for (let x = 0; x < dimensions[0]; x++) write(x, y, z, field(at(x, y, z)));
    }
    const edges = new Array(64);
    const offsets = corners.map(([x, y, z]) => slot(x, y, z));
    const triangle = (a, b, c, inside) => {
      const n = V.cross(V.sub(b, a), V.sub(c, a)),
        mid = V.mul(V.add(V.add(a, b), c), 1 / 3);
      if (V.dot(n, V.sub(mid, inside)) < 0) emit(a, c, b, n, -1);
      else emit(a, b, c, n, 1);
    };
    for (let z = 0; z < counts[2]; z++)
      for (let y = 0; y < counts[1]; y++)
        for (let x = 0; x < counts[0]; x++) {
          const base = slot(x, y, z), inside = values[base] < 0;
          if (o.allowMissing && offsets.some(offset => Number.isNaN(values[base + offset]))) continue;
          // Most cells have one sign. Leave their vertices in the sampled grid.
          let i = 1;
          while (i < offsets.length && (values[base + offsets[i]] < 0) === inside) i++;
          if (i === offsets.length) continue;
          const p = corners.map(c => at(x + c[0], y + c[1], z + c[2])),
            d = offsets.map(offset => values[base + offset]);
          if (!o.edgeRefinements) edges.fill(undefined);
          const edge = (a, b) => {
            if (!o.edgeRefinements)
              return edges[(a << 3) + b] ||= V.mad(p[a], V.sub(p[b], p[a]), d[a] / (d[a] - d[b]));
            if (d[a] >= 0) [a, b] = [b, a];
            const delta = V.sub(p[b], p[a]);
            let low = 0, high = 1;
            for (let i = 0; i < o.edgeRefinements; i++) {
              const mid = (low + high) / 2;
              const value = field(V.mad(p[a], delta, mid));
              if (o.allowMissing && value === null) return V.mad(p[a], delta, d[a] / (d[a] - d[b]));
              if (!Number.isFinite(value)) throw new Error('Implicit mesh field must return finite values');
              if (value < 0) low = mid;
              else high = mid;
            }
            return V.mad(p[a], delta, (low + high) / 2);
          };
          for (const [low, high] of split(d)) {
            const inside = V.mul(
              low.reduce((n, i) => V.add(n, p[i]), [0, 0, 0]),
              1 / low.length
            );
            if (low.length === 1) {
              const a = low[0],
                q = high.map(b => edge(a, b));
              triangle(...q, inside);
            } else if (high.length === 1) {
              const a = high[0],
                q = low.map(b => edge(a, b));
              triangle(...q, inside);
            } else {
              const [a, b] = low,
                [c, e] = high,
                q = [edge(a, c), edge(a, e), edge(b, e), edge(b, c)];
              triangle(q[0], q[1], q[2], inside);
              triangle(q[0], q[2], q[3], inside);
            }
          }
        }
    return A.data.freeze({ cells: counts.reduce((n, v) => n * v, 1), counts, resolution: step });
  }
  A.geometry.implicitSurface = (field, bounds, options) => {
    const builder = A.geometry.builder(), maxTriangles = options?.maxTriangles;
    if (maxTriangles !== undefined && (!Number.isSafeInteger(maxTriangles) || maxTriangles < 1))
      throw new Error('Implicit mesh triangle budget must be a positive integer');
    let triangles = 0;
    const sampling = march(field, bounds, options, (a, b, c) => {
      if (maxTriangles !== undefined && ++triangles > maxTriangles) throw new Error('Implicit mesh exceeds its triangle budget');
      builder.triangle(a, b, c, options?.meta);
    });
    return { ...builder.finish(), sampling };
  };
  A.geometry.implicitTriangles = (field, bounds, options, emit) => {
    if (typeof emit !== 'function') throw Error('Implicit triangles need an output callback');
    return march(field, bounds, options, (a, b, c, n, sign) => {
      const length = V.len(n);
      if (length < 1e-8 * 1e-8) return;
      // Recompute exact zeros only when reversing the face so the streamed
      // normal keeps the mesh builder's signed zeros.
      const oriented = sign < 0 && n.includes(0) ? V.cross(V.sub(b, a), V.sub(c, a)) : null;
      const normal = length > 1e-9 ? n.map((value,i) => Math.fround((oriented ? oriented[i] : sign*value)/length)) : [0, 1, 0];
      emit(a.map(Math.fround), b.map(Math.fround), c.map(Math.fround), normal);
    });
  };
})(KIT);
