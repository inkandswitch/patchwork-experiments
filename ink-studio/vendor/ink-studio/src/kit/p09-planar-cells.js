/* Deterministic shared-vertex cells, inset/chamfered and clipped to a planar
   signed mask. Independent of paint, water, architecture and renderer. Clipped
   fragments retain holes; their boundary supports closed prisms and picking. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    EPS = 1e-9,
    compiled = new WeakSet(),
    cross = (a, b) => a[0] * b[1] - a[1] * b[0],
    sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
    mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    key = p => p.map(v => v.toFixed(7)).join('/');
  const area = p => p.reduce((n, a, i) => n + cross(a, p[(i + 1) % p.length]), 0) / 2;
  function parameters(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Planar cells need configuration');
    if (compiled.has(raw)) return raw;
    const input = Object.assign({}, raw);
    delete input.cache;
    const p = Object.assign(
      {
        size: 0.62,
        gap: 0.085,
        jitter: 0.17,
        chamfer: 0.14,
        resolution: 0.05,
        seed: 0,
        maxCells: 4096,
        maxSamples: 250000
      },
      A.data.clone(input)
    );
    if (
      !['size', 'gap', 'jitter', 'chamfer', 'resolution'].every(k => Number.isFinite(p[k])) ||
      p.size < 0.1 ||
      p.size > 8 ||
      p.gap < 0 ||
      p.gap > p.size * 0.4 ||
      p.jitter < 0 ||
      p.jitter > 0.24 ||
      p.chamfer < 0 ||
      p.chamfer > 0.3 ||
      p.resolution < 0.01 ||
      p.resolution > 0.25 ||
      !Number.isSafeInteger(p.seed) ||
      Math.abs(p.seed) > 4294967295 ||
      !Number.isSafeInteger(p.maxCells) ||
      p.maxCells < 1 ||
      p.maxCells > 16384 ||
      !Number.isSafeInteger(p.maxSamples) ||
      p.maxSamples < 1 ||
      p.maxSamples > 1000000
    )
      throw new Error('Invalid planar cell dimensions, seed or budgets');
    delete p.regions;
    A.data.freeze(p);
    compiled.add(p);
    return p;
  }
  function bounds(b) {
    if (
      !b ||
      ![b.min, b.max].every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) ||
      b.min.some((v, i) => v > b.max[i]) ||
      [b.min[0], b.min[2], b.max[0], b.max[2]].some(v => Math.abs(v) > 1e6)
    )
      throw new Error('Planar cells need finite ordered bounds within the coordinate budget');
    return b;
  }
  function clip(poly, distance, root = false) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        da = distance(a),
        db = distance(b);
      if (da <= 0) out.push(a);
      if (da < 0 !== db < 0 && da !== 0 && db !== 0) {
        let t = da / (da - db);
        if (root) {
          let lo = 0,
            hi = 1;
          for (let j = 0; j < 20; j++) {
            const m = (lo + hi) / 2;
            if (distance(mix(a, b, m)) < 0 === da < 0) lo = m;
            else hi = m;
          }
          t = da < 0 ? lo : hi;
        }
        out.push(mix(a, b, t));
      }
    }
    return out.filter((p, i) => !i || Math.hypot(...sub(p, out[i - 1])) > EPS);
  }
  function cell(i, j, raw = {}) {
    const p = parameters(raw);
    if (![i, j].every(Number.isSafeInteger) || Math.max(Math.abs(i), Math.abs(j)) * p.size > 1e6)
      throw new Error('Cell indices exceed the coordinate budget');
    const vertex = (x, z) => [
        (x + (K.hash(x, z, p.seed + 47) - 0.5) * p.jitter * 2) * p.size,
        (z + (K.hash(x, z, p.seed + 83) - 0.5) * p.jitter * 2) * p.size
      ],
      original = [vertex(i, j), vertex(i + 1, j), vertex(i + 1, j + 1), vertex(i, j + 1)];
    let polygon = original.map(q => q.slice());
    for (let k = 0; k < original.length; k++) {
      const a = original[k],
        edge = sub(original[(k + 1) % original.length], a),
        len = Math.hypot(...edge);
      polygon = clip(polygon, q => p.gap / 2 - cross(edge, sub(q, a)) / len);
    }
    if (p.chamfer) {
      const cut = [];
      for (let k = 0; k < polygon.length; k++) {
        const q = polygon[k],
          t = p.chamfer * (0.75 + 0.5 * K.hash(i, j, p.seed + k + 13));
        cut.push(
          mix(q, polygon[(k - 1 + polygon.length) % polygon.length], t),
          mix(q, polygon[(k + 1) % polygon.length], t)
        );
      }
      polygon = cut;
    }
    return { key: i + ':' + j, index: [i, j], polygon };
  }
  function layout(work, mask, raw = {}) {
    bounds(work);
    if (typeof mask !== 'function') throw new Error('Planar cells need a signed mask');
    const p = parameters(raw),
      regions = raw.regions || [work],
      memo = raw.cache;
    if (memo && !['get', 'set'].every(k => typeof memo[k] === 'function'))
      throw new Error('Planar cell caching needs get/set callbacks');
    if (!Array.isArray(regions) || regions.length > 4096)
      throw new Error('Planar cell work regions exceed their budget');
    const candidates = new Map(),
      sampled = new Map();
    let samples = 0;
    const at = q => {
      const k = key(q);
      if (!sampled.has(k)) {
        if (++samples > p.maxSamples) throw new Error('Planar mask exceeds its sample budget');
        const d = mask(q[0], q[1]);
        if (!Number.isFinite(d) && d !== Infinity)
          throw new Error('Planar masks need finite distances or empty Infinity');
        sampled.set(k, d);
      }
      return sampled.get(k);
    };
    for (const region of regions) {
      bounds(region);
      const x0 = Math.max(work.min[0], region.min[0]),
        x1 = Math.min(work.max[0], region.max[0]),
        z0 = Math.max(work.min[2], region.min[2]),
        z1 = Math.min(work.max[2], region.max[2]);
      if (x0 >= x1 || z0 >= z1) continue;
      const a = Math.floor(x0 / p.size) - 1,
        b = Math.floor(x1 / p.size) + 1,
        c = Math.floor(z0 / p.size) - 1,
        d = Math.floor(z1 / p.size) + 1;
      if ((b - a + 1) * (d - c + 1) > p.maxCells * 2) throw new Error('Planar cell region exceeds its cell budget');
      for (let j = c; j <= d; j++)
        for (let i = a; i <= b; i++) {
          candidates.set(i + ':' + j, [i, j]);
          if (candidates.size > p.maxCells) throw new Error('Planar layout exceeds its cell budget');
        }
    }
    const cells = [];
    for (const [i, j] of [...candidates.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
      const base = cell(i, j, p);
      let polygon = base.polygon;
      for (const d of [
        q => work.min[0] - q[0],
        q => q[0] - work.max[0],
        q => work.min[2] - q[1],
        q => q[1] - work.max[2]
      ])
        polygon = clip(polygon, d);
      if (polygon.length < 3 || area(polygon) < EPS) continue;
      const min = [Math.min(...polygon.map(q => q[0])), Math.min(...polygon.map(q => q[1]))],
        max = [Math.max(...polygon.map(q => q[0])), Math.max(...polygon.map(q => q[1]))];
      if (!regions.some(r => r.min[0] <= max[0] && r.max[0] >= min[0] && r.min[2] <= max[1] && r.max[2] >= min[1]))
        continue;
      const request = A.data.freeze({
          key: base.key,
          index: base.index.slice(),
          polygon: polygon.map(q => q.slice()),
          bounds: { min: [min[0], 0, min[1]], max: [max[0], 0, max[1]] }
        }),
        saved = memo?.get(request);
      if (saved !== undefined) {
        if (saved !== null) cells.push(saved);
        continue;
      }
      const nx = Math.max(1, Math.ceil((max[0] - min[0]) / p.resolution)),
        nz = Math.max(1, Math.ceil((max[1] - min[1]) / p.resolution)),
        planes = polygon.map((a, k) => {
          const e = sub(polygon[(k + 1) % polygon.length], a);
          return q => -cross(e, sub(q, a));
        }),
        fragments = [];
      function triangle(tri) {
        let poly = tri;
        for (const plane of planes) {
          poly = clip(poly, plane);
          if (poly.length < 3) return;
        }
        const center = poly.reduce((a, q) => [a[0] + q[0] / poly.length, a[1] + q[1] / poly.length], [0, 0]);
        for (let k = 0; k < poly.length; k++) {
          const part = clip([center, poly[k], poly[(k + 1) % poly.length]], at, true);
          if (part.length >= 3 && area(part) > EPS) fragments.push(part);
        }
      }
      for (let z = 0; z < nz; z++)
        for (let x = 0; x < nx; x++) {
          const a = [min[0] + ((max[0] - min[0]) * x) / nx, min[1] + ((max[1] - min[1]) * z) / nz],
            b = [min[0] + ((max[0] - min[0]) * (x + 1)) / nx, a[1]],
            c = [b[0], min[1] + ((max[1] - min[1]) * (z + 1)) / nz],
            d = [a[0], c[1]];
          triangle([a, b, c]);
          triangle([a, c, d]);
        }
      let total = fragments.reduce((n, f) => n + area(f), 0);
      if (total < EPS) {
        memo?.set(request, null);
        continue;
      }
      if (Math.abs(total - area(polygon)) < 1e-7) {
        fragments.splice(0, fragments.length, polygon);
        total = area(polygon);
      }
      const edges = new Map();
      for (const poly of fragments)
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k],
            b = poly[(k + 1) % poly.length],
            ka = key(a),
            kb = key(b);
          if (ka === kb) continue;
          const id = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          if (edges.has(id)) edges.delete(id);
          else edges.set(id, [a, b]);
        }
      const boundary = [...edges.values()],
        centroid = fragments.reduce(
          (sum, f) => {
            const weight = area(f) / total,
              center = f.reduce((n, q) => [n[0] + q[0] / f.length, n[1] + q[1] / f.length], [0, 0]);
            return [sum[0] + center[0] * weight, sum[1] + center[1] * weight];
          },
          [0, 0]
        );
      function distance(x, z) {
        if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Cell queries need finite coordinates');
        let d = Infinity,
          inside = false;
        for (const [a, b] of boundary) {
          const e = sub(b, a),
            t = Math.max(0, Math.min(1, ((x - a[0]) * e[0] + (z - a[1]) * e[1]) / (e[0] * e[0] + e[1] * e[1])));
          d = Math.min(d, Math.hypot(x - a[0] - e[0] * t, z - a[1] - e[1] * t));
          if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside ? -d : d;
      }
      const result = A.data.freeze({
        key: base.key,
        index: base.index,
        polygon,
        fragments,
        boundary,
        centroid,
        area: total,
        bounds: { min: [min[0], 0, min[1]], max: [max[0], 0, max[1]] },
        distance
      });
      cells.push(result);
      memo?.set(request, result);
    }
    return A.data.freeze({ parameters: p, cells, sampling: { candidates: candidates.size, samples } });
  }
  function prism(cell, raw = {}) {
    const p = Object.assign({ bottom: 0, top: 0.2, owner: '', material: 'default' }, raw);
    if (
      !Number.isFinite(p.bottom) ||
      !Number.isFinite(p.top) ||
      p.bottom >= p.top ||
      !cell?.fragments?.length ||
      typeof cell.distance !== 'function'
    )
      throw new Error('Cell prisms need a clipped cell and ordered finite heights');
    const bounds = {
        min: [cell.bounds.min[0], p.bottom, cell.bounds.min[2]],
        max: [cell.bounds.max[0], p.top, cell.bounds.max[2]]
      },
      meta = { owner: p.owner, material: p.material, surface: 'cell' };
    let mesh = null;
    const point = (q, y) => [q[0], y, q[1]];
    function geometry() {
      if (mesh) return mesh;
      const builder = A.geometry.builder();
      for (const poly of cell.fragments)
        for (let i = 1; i < poly.length - 1; i++) {
          builder.triangle(point(poly[0], p.top), point(poly[i + 1], p.top), point(poly[i], p.top), meta);
          builder.triangle(point(poly[0], p.bottom), point(poly[i], p.bottom), point(poly[i + 1], p.bottom), meta);
        }
      for (const [a, b] of cell.boundary) {
        builder.triangle(point(a, p.top), point(b, p.top), point(b, p.bottom), meta);
        builder.triangle(point(a, p.top), point(b, p.bottom), point(a, p.bottom), meta);
      }
      return (mesh = builder.finish());
    }
    function sample(spacing, emit) {
      if (!Number.isFinite(spacing) || spacing <= 0 || typeof emit !== 'function')
        throw new Error('Cell sampling needs positive spacing and an emitter');
      const nx = Math.max(1, Math.ceil((bounds.max[0] - bounds.min[0]) / spacing)),
        nz = Math.max(1, Math.ceil((bounds.max[2] - bounds.min[2]) / spacing));
      if (nx * nz > 250000) throw new Error('Cell surface exceeds its sample budget');
      let count = 0;
      const seen = new Set(),
        put = (q, n) => {
          const k = q.map(v => v.toFixed(7)).join('/') + '/' + n.map(v => v.toFixed(5)).join('/');
          if (seen.has(k)) return;
          seen.add(k);
          if (++count > 250000) throw new Error('Cell surface exceeds its sample budget');
          emit(q, n);
        };
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const x = bounds.min[0] + ((bounds.max[0] - bounds.min[0]) * (i + 0.5)) / nx,
            z = bounds.min[2] + ((bounds.max[2] - bounds.min[2]) * (j + 0.5)) / nz;
          if (cell.distance(x, z) <= 0) {
            put([x, p.top, z], [0, 1, 0]);
            put([x, p.bottom, z], [0, -1, 0]);
          }
        }
      const rows = Math.max(1, Math.ceil((p.top - p.bottom) / spacing));
      for (const [a, b] of cell.boundary) {
        const e = sub(b, a),
          cols = Math.max(1, Math.ceil(Math.hypot(...e) / spacing)),
          n = V.norm([e[1], 0, -e[0]]);
        for (let col = 0; col <= cols; col++) {
          const q = mix(a, b, col / cols);
          put(point(q, p.top), [0, 1, 0]);
          put(point(q, p.bottom), [0, -1, 0]);
          for (let row = 0; row <= rows; row++) put(point(q, p.bottom + ((p.top - p.bottom) * row) / rows), n);
        }
      }
      return count;
    }
    function raycast(origin, direction, max = 10000) {
      if (
        ![origin, direction].every(q => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite)) ||
        V.len(direction) < EPS ||
        !Number.isFinite(max) ||
        max <= 0
      )
        throw new Error('Cell rays need finite vectors and positive reach');
      const d = V.norm(direction),
        hits = [];
      if (A.spatial.rayBox(bounds, origin, d, max) === null) return null;
      const put = (t, n) => {
        if (t >= 0 && t <= max)
          hits.push({
            p: V.mad(origin, d, t),
            n,
            distance: t,
            surface: 'cell',
            uv: [origin[0] + d[0] * t, origin[2] + d[2] * t]
          });
      };
      if (Math.abs(d[1]) > EPS)
        for (const [y, n] of [
          [p.top, [0, 1, 0]],
          [p.bottom, [0, -1, 0]]
        ]) {
          const t = (y - origin[1]) / d[1],
            q = V.mad(origin, d, t);
          if (cell.distance(q[0], q[2]) <= 1e-7) put(t, n);
        }
      for (const [a, b] of cell.boundary) {
        const e = sub(b, a),
          dir = [d[0], d[2]],
          den = cross(dir, e);
        if (Math.abs(den) < EPS) continue;
        const q = [a[0] - origin[0], a[1] - origin[2]],
          t = cross(q, e) / den,
          u = cross(q, dir) / den,
          y = origin[1] + d[1] * t;
        if (u >= -EPS && u <= 1 + EPS && y >= p.bottom - EPS && y <= p.top + EPS) put(t, V.norm([e[1], 0, -e[0]]));
      }
      hits.sort((a, b) => a.distance - b.distance);
      return hits[0] || null;
    }
    return {
      cell,
      parameters: A.data.freeze(A.data.clone(p)),
      bounds,
      mesh: geometry,
      distance: q => Math.max(cell.distance(q[0], q[2]), p.bottom - q[1], q[1] - p.top),
      sample,
      raycast
    };
  }
  A.planarCells = { parameters, cell, layout, prism };
})(KIT);
