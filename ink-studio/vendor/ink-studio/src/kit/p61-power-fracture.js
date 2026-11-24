/* Weighted anisotropic power cells for native implicit fracture. */
(function (K) {
  const P = K.procedural, V = K.V, M = K.M, T = P.transforms,
    EPS = 1e-8,
    finite = n => Number.isFinite(n) && Math.abs(n) <= 1e7,
    positive = n => finite(n) && n > EPS,
    vector = p => Array.isArray(p) && p.length === 3 && p.every(finite),
    idOK = id => typeof id === 'string' && id.length > 0 && id.length <= 128;

  function boxFaces({ min, max }) {
    const corners = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]]
      .map(bits => bits.map((bit, i) => bit ? max[i] : min[i]));
    return [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
      .map(face => ({ points: face.map(i => corners[i]) }));
  }
  function inBox(bounds, x, y, z) {
    return x >= bounds.min[0] && x <= bounds.max[0] && y >= bounds.min[1] && y <= bounds.max[1] &&
      z >= bounds.min[2] && z <= bounds.max[2];
  }

  function power({
    host, bounds: rawBounds = host?.bounds, seeds, stretch = [1, 1, 1], rotation = [0, 0, 0],
    gap = 0, cell, bond, maxWork = 30000000
  } = {}) {
    const sd = typeof host === 'function' ? host : host?.sd, bounds = P.spatial.bounds(rawBounds);
    if (
      typeof sd !== 'function' || !Array.isArray(seeds) || seeds.length < 2 || seeds.length > 96 ||
      !vector(stretch) || stretch.some(v => v < 0.02 || v > 50) || !vector(rotation) ||
      !finite(gap) || gap < 0 || (cell !== undefined && !positive(cell)) ||
      (bond !== undefined && typeof bond !== 'function') || !Number.isSafeInteger(maxWork) || maxWork <= 0 || maxWork > 1e8 ||
      !vector(bounds.min) || !vector(bounds.max) || bounds.min.some((v, i) => bounds.max[i] - v <= EPS)
    ) throw new Error('Power fracture needs a bounded host, sites, metric and work limits');
    const ids = new Set(), sites = seeds.map((seed, index) => {
      const { id = String(index), point, weight = 0 } = seed ?? {};
      if (!idOK(id) || ids.has(id) || !vector(point) || !finite(weight) || !P.spatial.contains(bounds, point))
        throw new Error('Power sites need distinct IDs, finite weights and positions in bounds');
      ids.add(id);
      return { id, point: point.slice(), weight };
    });
    const scale = stretch.map(v => 1 / v), turn = T.local({ rotation }).R,
      metric = M.mul(turn, M.mul([scale[0] ** 2,0,0,0,scale[1] ** 2,0,0,0,scale[2] ** 2], M.tr(turn))),
      planes = sites.map(() => []), pair = new Map();
    for (const [a, seed] of sites.entries()) for (let b = a + 1; b < sites.length; b++) {
      const other = sites[b], d = V.sub(other.point, seed.point), n = M.app(metric, d), length = V.len(n);
      if (V.len(d) <= EPS || !Number.isFinite(length)) throw new Error('Power sites need distinct positions');
      const normal = V.mul(n, 1 / length), middle = V.mad(seed.point, d, 0.5),
        offset = V.dot(normal, middle) + (seed.weight - other.weight) / (2 * length);
      planes[a].push({ normal, offset: offset - gap * 0.5, tag: b });
      planes[b].push({ normal: V.mul(normal, -1), offset: -offset - gap * 0.5, tag: a });
      pair.set(a * sites.length + b, { normal, offset });
    }
    const side = bounds.max.map((v, i) => v - bounds.min[i]), spacing = cell ?? Math.max(...side) / 32,
      dims = side.map(v => Math.max(1, Math.ceil(v / spacing))), count = dims.reduce((a, b) => a * b, 1);
    if (!Number.isSafeInteger(count) || count > 1500000 || count * sites.length > maxWork)
      throw new Error('Power fracture exceeds its voxel sampling budget');
    const steps = side.map((v, i) => v / dims[i]), voxelVolume = steps[0] * steps[1] * steps[2],
      center = bounds.min.map((v, i) => v + side[i] * 0.5),
      at = (x, y, z) => [x, y, z].map((v, i) => bounds.min[i] + (v + 0.5) * steps[i]),
      grid = new Int16Array(count).fill(-1), volumes = new Uint32Array(sites.length),
      centroids = sites.map(() => [0, 0, 0]),
      quad = sites.map(({ point, weight }) => {
        const p = V.sub(point, center), v = M.app(metric, p);
        return { c: V.dot(p, v) - weight, v: V.mul(v, -2) };
      });
    function winner(x, y, z) {
      let value = Infinity, index = 0;
      const dx = x - center[0], dy = y - center[1], dz = z - center[2];
      for (const [i, { c, v }] of quad.entries()) {
        const q = c + v[0] * dx + v[1] * dy + v[2] * dz;
        if (q < value) { value = q; index = i; }
      }
      return index;
    }
    const contacts = new Map(), stride = [1, dims[0], dims[0] * dims[1]];
    for (let z = 0, i = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++, i++) {
      const p = at(x, y, z), d = sd(...p);
      if (!Number.isFinite(d)) throw new Error('Power fracture host returned a nonfinite distance');
      if (d >= 0) continue;
      const index = winner(...p);
      grid[i] = index;
      volumes[index]++;
      for (let k = 0; k < 3; k++) centroids[index][k] += p[k];
      for (const [axis, value] of [x, y, z].entries()) {
        if (!value) continue;
        const neighbor = grid[i - stride[axis]];
        if (neighbor < 0 || neighbor === index) continue;
        const a = Math.min(index, neighbor), b = Math.max(index, neighbor), key = a * sites.length + b,
          face = pair.get(key), projected = p.slice();
        if (Math.abs(face.normal[axis]) < EPS) continue;
        const t = (V.dot(face.normal, p) - face.offset) / face.normal[axis];
        if (t < -EPS || t > steps[axis] + EPS) continue;
        projected[axis] -= t;
        // Count only interfaces where these two cells meet. A third cell may lie between two voxel centers.
        let sharesFace = true;
        for (const plane of planes[a]) if (plane.tag !== b &&
          V.dot(plane.normal, projected) - plane.offset > gap * 0.5 + EPS) {
          sharesFace = false;
          break;
        }
        if (!sharesFace || sd(...projected) >= 0) continue;
        const area = voxelVolume / steps[axis], acc = contacts.get(key) ?? { area: 0, p: [0, 0, 0] };
        acc.area += area;
        for (let k = 0; k < 3; k++) acc.p[k] += area * projected[k];
        contacts.set(key, acc);
      }
    }
    const shell = boxFaces(bounds),
      cells = sites.flatMap((site, i) => {
        const poly = P.geometry.clipConvexFaces(shell, planes[i]), points = poly.flatMap(f => f.points);
        if (!points.length) return [];
        const box = P.spatial.boxOf(points), uses = planes[i].filter(p => poly.some(f => f.tag === p.tag));
        // A clipping plane may coincide with a box face. Keep the source box in the field as well.
        const field = (x, y, z) => {
          let d = Math.max(sd(x, y, z),
            bounds.min[0] - x, x - bounds.max[0], bounds.min[1] - y, y - bounds.max[1], bounds.min[2] - z, z - bounds.max[2]);
          for (const p of uses)
            d = Math.max(d, p.normal[0] * x + p.normal[1] * y + p.normal[2] * z - p.offset);
          return d;
        };
        const volume = volumes[i] * voxelVolume;
        return [{ id: site.id, index: i, point: site.point, weight: site.weight, volume, planes: uses,
          center: volume ? V.mul(centroids[i], 1 / volumes[i]) : V.mul(V.add(box.min, box.max), 0.5),
          form: { bounds: box, sd: field, cost: (host.cost ?? 1) + uses.length }
        }];
      }),
      extant = new Set(cells.map(c => c.index)), bonds = [];
    for (const [key, { area: projectedArea, p }] of contacts) {
      const a = Math.floor(key / sites.length), b = key % sites.length;
      if (!extant.has(a) || !extant.has(b)) continue;
      const { normal } = pair.get(key), area = projectedArea / normal.reduce((sum, v) => sum + Math.abs(v), 0),
        point = V.mul(p, 1 / projectedArea), ends = [sites[a].id, sites[b].id].sort(),
        record = { id: JSON.stringify(ends), a: ends[0], b: ends[1],
          normal: ends[0] === sites[a].id ? normal : V.mul(normal, -1), point, area };
      const capacity = bond ? bond(P.data.freeze(record)) : area;
      if (!finite(capacity) || capacity < 0) throw new Error('Fracture bond capacity must be finite and nonnegative');
      bonds.push({ ...record, capacity });
    }
    bonds.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return Object.freeze({ cells: P.data.freeze(cells), bonds: P.data.freeze(bonds), grid, bounds: P.data.freeze(bounds),
      dimensions: Object.freeze(dims), work: Object.freeze({ voxels: count, comparisons: count * sites.length }),
      owner(x, y, z) {
        if (!inBox(bounds, x, y, z) || sd(x, y, z) >= 0) return null;
        const i = winner(x, y, z);
        return extant.has(i) ? sites[i].id : null;
      }
    });
  }

  function separate(graph, { loads = {}, previous } = {}) {
    if (!Array.isArray(graph?.cells) || !Array.isArray(graph?.bonds) || !loads || typeof loads !== 'object' ||
      (previous !== undefined && (!previous.remaining || typeof previous.remaining !== 'object')))
      throw new Error('Separation needs a fracture bond graph and per-bond loads');
    const adjacency = new Map(graph.cells.map(c => [c.id, []])), broken = [], remaining = {};
    for (const { id, a, b, capacity } of graph.bonds) {
      const load = Object.hasOwn(loads, id) ? loads[id] : 0,
        available = previous && Object.hasOwn(previous.remaining, id) ? previous.remaining[id] : capacity;
      if (!idOK(a) || !idOK(b) || typeof id !== 'string' || !adjacency.has(a) || !adjacency.has(b) || a === b ||
        !finite(capacity) || capacity < 0 || !finite(available) || available < 0 || available > capacity ||
        !finite(load) || load < 0 || Object.hasOwn(remaining, id)) throw new Error('Invalid fracture bond or load');
      Object.defineProperty(remaining, id, { value: Math.max(0, available - load), enumerable: true });
      if (remaining[id] <= 0) {
        broken.push(id);
        continue;
      }
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
    const seen = new Set(), components = [];
    for (const id of adjacency.keys()) {
      if (seen.has(id)) continue;
      const group = [id];
      seen.add(id);
      for (let i = 0; i < group.length; i++) for (const other of adjacency.get(group[i])) {
        if (seen.has(other)) continue;
        seen.add(other);
        group.push(other);
      }
      components.push(group);
    }
    return P.data.freeze({ remaining, broken, components });
  }

  P.fracture = { power, separate };
})(KIT);
