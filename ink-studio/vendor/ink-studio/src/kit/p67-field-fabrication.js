/* Closed slab geometry from sampled fields on orientable charts. */
(function (K) {
  const P = K.procedural, V = K.V;
  const names = ['outer', 'inner', 'wall'];
  const check = (condition, message) => {
    if (!condition) throw new RangeError('Field fabrication: ' + message);
  };
  const vector = (p, n) => (Array.isArray(p) || ArrayBuffer.isView(p)) && p.length === n &&
    Array.from(p).every(Number.isFinite);
  const positive = n => Number.isFinite(n) && n > 0;
  const interval = p => vector(p, 2) && p[1] > p[0];
  const size = p => vector(p, 2) && Array.from(p).every(n => Number.isSafeInteger(n) && n > 0 && n <= 512);
  const clamp = t => Math.max(0, Math.min(1, t));
  const edgeKey = (a, b) => a < b ? a + '/' + b : b + '/' + a;
  const area = (a, b, c) => V.cross(V.sub(b, a), V.sub(c, a));
  const point = p => Array.from(p, Math.fround);

  function shell({ carrier, field = () => 0, thickness = .1, cut, ribs = [], segments = [64, 32] } = {}) {
    check(typeof carrier?.sample === 'function' && typeof field === 'function' &&
      (positive(thickness) || typeof thickness === 'function') && size(segments) &&
      segments[0] * segments[1] <= 120000, 'expected a carrier, a field, positive thickness and a bounded chart grid');
    const [nx, ny] = segments;
    const topology = carrier.topology;
    const wrapU = Boolean(topology?.periodicU ?? carrier.periodicU), wrapV = Boolean(topology?.periodicV ?? carrier.periodicV);
    check(!topology?.twistedU && (!wrapU || nx >= 3) && (!wrapV || ny >= 3),
      'periodic charts need an orientable seam and at least three cells around it');
    check(cut === undefined || (Number.isFinite(cut?.level) && ['above', 'below'].includes(cut.keep ?? 'below')),
      'a cut needs a finite level and an above or below keep side');
    check(Array.isArray(ribs) && ribs.length <= 64 && Array.from(ribs).every(r =>
      Number.isFinite(r?.level) && positive(r.width) && positive(r.height)), 'ribs need finite levels and positive widths and heights');
    const side = cut?.keep === 'above' ? -1 : 1;
    const columns = nx + Number(!wrapU), rows = ny + Number(!wrapV);
    const nodes = [], crossings = new Map(), cap = [], boundary = new Map();
    const index = (x, y) => (y % rows) * columns + x % columns;

    function sample([u, v]) {
      const hit = carrier.sample([u, v]), length = hit && vector(hit.n, 3) ? V.len(hit.n) : 0;
      check(hit && vector(hit.p, 3) && positive(length), 'carrier samples need finite points and nonzero normals');
      return { p: Array.from(hit.p), n: V.mul(hit.n, 1 / length) };
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const u = x / nx, v = y / ny, { p, n } = sample([u, v]), value = field(u, v);
      check(Number.isFinite(value), 'field samples must be finite');
      const t = typeof thickness === 'function' ? thickness(value, u, v) : thickness;
      check(positive(t), 'thickness samples must be positive and finite');
      const lift = ribs.reduce((height, rib) => {
        const f = clamp(1 - Math.abs(value - rib.level) / rib.width);
        return height + rib.height * f * f * (3 - 2 * f);
      }, 0);
      const g = cut ? side * (value - cut.level) : -1;
      check(Number.isFinite(g), 'cut levels exceed the finite numeric range');
      nodes.push({ p, n, g, outer: V.mad(p, n, .5 * t + lift), inner: V.mad(p, n, -.5 * t) });
    }
    function seam(a, b) {
      const { p, n } = nodes[a], other = sample(b);
      check(V.dist(p, other.p) <= 1e-6 * Math.max(1, V.len(p)) && V.dot(n, other.n) > .99999,
        'periodic carrier positions and normals must agree at the seam');
    }
    if (wrapU) for (let y = 0; y < rows; y++) seam(index(0, y), [1, y / ny]);
    if (wrapV) for (let x = 0; x < columns; x++) seam(index(x, 0), [x / nx, 1]);
    if (wrapU && wrapV) seam(0, [1, 1]);

    function cross(a, b) {
      const left = nodes[a.i], right = nodes[b.i];
      const key = edgeKey(a.i, b.i);
      // Keep exact-level corners on the cut side. Give crossings a small
      // distance from either grid vertex to keep point contacts separated.
      const t = Math.max(.0001, Math.min(.9999, 1 / (1 + Math.abs(right.g / left.g))));
      let i = crossings.get(key);
      if (i === undefined) {
        i = nodes.length;
        crossings.set(key, i);
        nodes.push({
          outer: V.lerp(left.outer, right.outer, t), inner: V.lerp(left.inner, right.inner, t)
        });
      }
      return { i, uv: a.uv.map((v, k) => v + (b.uv[k] - v) * t) };
    }

    let winding = 0;
    function clip(corners) {
      const source = corners.map(({ i }) => nodes[i]);
      const direction = V.dot(area(...source.map(n => n.p)), source[0].n);
      const sign = Math.sign(direction);
      check(sign && (!winding || winding === sign), 'carrier is degenerate or folds across its chart grid');
      winding = sign;
      if (winding < 0) corners.reverse();
      const polygon = [];
      for (let k = 0; k < 3; k++) {
        const a = corners[k], b = corners[(k + 1) % 3];
        const inside = nodes[a.i].g < 0, next = nodes[b.i].g < 0;
        if (inside) polygon.push(a);
        if (inside !== next) polygon.push(cross(a, b));
      }
      if (polygon.length < 3) return;
      const normal = source[0].n;
      for (let j = 1; j + 1 < polygon.length; j++)
        cap.push({ corners: [polygon[0], polygon[j], polygon[j + 1]], normal });

      for (const [j, a] of polygon.entries()) {
        const b = polygon[(j + 1) % polygon.length], key = edgeKey(a.i, b.i);
        if (boundary.has(key)) boundary.delete(key);
        else boundary.set(key, [a, b]);
      }
    }

    const corner = (x, y) => ({ i: index(x, y), uv: [x / nx, y / ny] });
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const a = corner(x, y), b = corner(x + 1, y), c = corner(x, y + 1), d = corner(x + 1, y + 1);
      clip([a, b, c]);
      clip([c, b, d]);
    }
    const outgoing = new Set(), incoming = new Set();
    for (const [a, b] of boundary.values()) {
      check(!outgoing.has(a.i) && !incoming.has(b.i), 'cut leaves a non-manifold chart boundary');
      outgoing.add(a.i);
      incoming.add(b.i);
    }

    const points = [], faces = [], uv = [], ranges = {}, remap = new Map();
    const xyz = i => points[i];
    function id({ i }, inside) {
      let first = remap.get(i);
      if (first === undefined) {
        first = points.length;
        remap.set(i, first);
        const p = nodes[i];
        points.push(point(p.outer), point(p.inner));
      }
      return first + Number(inside);
    }
    function triangle(ids, uvs, normal) {
      const p = ids.map(xyz), winding = area(...p), length = V.len(winding);
      check(positive(length) && (normal === undefined || V.dot(winding, normal) > 0),
        'surface normals or relief fold the offset geometry at this resolution');
      faces.push(ids);
      uv.push(uvs);
    }
    function part(name, build) {
      const first = faces.length;
      build();
      ranges[name] = Object.freeze({ first, count: faces.length - first });
    }
    part('outer', () => {
      for (const { corners, normal } of cap)
        triangle(corners.map(p => id(p, false)), corners.map(p => p.uv), normal);
    });
    part('inner', () => {
      for (const { corners, normal } of cap) {
        const [a, b, c] = corners, order = [a, c, b];
        triangle(order.map(p => id(p, true)), order.map(p => p.uv), V.mul(normal, -1));
      }
    });
    part('wall', () => {
      for (const [a, b] of boundary.values()) {
        const ao = id(a, false), bo = id(b, false), ai = id(a, true), bi = id(b, true);
        triangle([bo, ao, ai], [[1, 0], [0, 0], [0, 1]]);
        triangle([bo, ai, bi], [[1, 0], [0, 1], [1, 1]]);
      }
    });

    const bounds = points.length ? P.data.freeze(P.spatial.boxOf(points)) : null;
    function indexed() {
      return { points: Float32Array.from(points.flat()), triangles: Uint32Array.from(faces.flat()) };
    }
    function mesh(colors = {}) {
      const { points, triangles } = indexed();
      const materials = names.map(name => ({ name, rgb: colors[name] ?? [.65, .65, .65] }));
      check(materials.every(({ rgb }) => vector(rgb, 3) && Array.from(rgb).every(n => n >= 0 && n <= 1)),
        'mesh colors need RGB triples in [0,1]');
      const material = new Uint16Array(faces.length);
      for (const [i, name] of names.entries()) {
        const { first, count } = ranges[name];
        material.fill(i, first, first + count);
      }
      return K.mesh.make(points, triangles, null, material, materials);
    }
    function surface(name) {
      check(names.includes(name), 'surface must be outer, inner or wall');
      const { first, count } = ranges[name], p = new Float32Array(9 * count), coords = new Float32Array(6 * count);
      const triangles = new Uint32Array(3 * count);
      for (let i = 0; i < count; i++) for (let j = 0; j < 3; j++) {
        const vertex = 3 * i + j;
        p.set(points[faces[first + i][j]], vertex * 3);
        coords.set(uv[first + i][j], vertex * 2);
        triangles[vertex] = vertex;
      }
      return { points: p, uvs: coords, triangles };
    }
    return Object.freeze({ bounds, parts: Object.freeze(ranges), indexed, mesh, surface });
  }

  function stack({ bounds, field = () => 0, layers, segments = [64, 64] } = {}) {
    check(vector(bounds?.min, 2) && vector(bounds?.max, 2) &&
      Array.from(bounds.min).every((v, i) => bounds.max[i] > v) && typeof field === 'function' &&
      Array.isArray(layers) && layers.length > 0 && layers.length <= 64 && size(segments) &&
      layers.length * segments[0] * segments[1] <= 120000, 'expected ordered XZ bounds, layers and a bounded grid');
    const [xmin, zmin] = bounds.min, [xmax, zmax] = bounds.max, ids = new Set();
    const xAt = u => xmin + (xmax - xmin) * u, zAt = v => zmin + (zmax - zmin) * v;
    let prior = -Infinity;
    return Object.freeze(Array.from(layers, (layer, i) => {
      const { id = String(i), low, high, cut, field: sample = field } = layer ?? {};
      check(typeof id === 'string' && id.length > 0 && !ids.has(id) && interval([low, high]) &&
        low >= prior && typeof sample === 'function', 'layers need unique IDs and ascending non-overlapping extents');
      ids.add(id);
      prior = high;
      const carrier = { sample: ([u, v]) => ({ p: [xAt(u), low + (high - low) * .5, zAt(v)], n: [0, 1, 0] }) };
      const part = shell({ carrier, segments, field: (u, v) => sample(xAt(u), zAt(v)), thickness: high - low, cut });
      return Object.freeze({ ...part, id, low, high });
    }));
  }

  P.fabrication = Object.freeze({ shell, stack });
})(KIT);
