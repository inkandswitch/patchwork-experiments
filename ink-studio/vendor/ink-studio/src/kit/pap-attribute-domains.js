/* Sample authored attributes in world space and carry them across geometry domains. */
(function (K) {
  const P = K.procedural, V = K.V;
  const domains = ['vertex', 'face', 'point', 'curve', 'instance', 'splat'];
  const point = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const position = value => Array.isArray(value) ? value : value?.point || value?.at || value?.position;

  function table(domain, entities, specifications = {}) {
    if (!domains.includes(domain) || !Array.isArray(entities) || entities.length > 250000 || !entities.every(e => point(position(e))))
      throw new TypeError('Attribute tables need a recognized domain with finite positions');
    const channels = new Map();
    for (const [name, spec] of Object.entries(specifications)) {
      const { type = 'label', values } = spec;
      const size = type === 'number' || type === 'label' ? 1 : type === 'vec2' ? 2 : type === 'vec3' ? 3 : 0;
      if (!name || !size || (!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== entities.length * size)
        throw new RangeError('Invalid attribute channel ' + name);
      const validate = type === 'label' ? v => v === null || typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v) : Number.isFinite;
      if (!Array.from(values).every(validate)) throw new RangeError('Invalid values for attribute channel ' + name);
      channels.set(name, { type, size, values: Array.from(values) });
    }
    const points = entities.map(value => position(value).slice());
    function read(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= points.length) throw new RangeError('Unknown attribute sample');
      return Object.fromEntries([...channels].map(([name, item]) => [name,
        item.size === 1 ? item.values[index] : item.values.slice(index * item.size, (index + 1) * item.size)]));
    }
    return { domain, entities: entities.slice(), points, channels, read };
  }

  function nearestRows(source) {
    if (!source || !Array.isArray(source.points) || typeof source.read !== 'function')
      throw new TypeError('Expected a captured attribute table');
    const { points } = source;
    function build(ids, depth = 0) {
      if (!ids.length) return null;
      const axis = depth % 3;
      ids.sort((a, b) => points[a][axis] - points[b][axis] || a - b);
      const middle = ids.length >> 1;
      return { axis, index: ids[middle], lower: build(ids.slice(0, middle), depth + 1),
        upper: build(ids.slice(middle + 1), depth + 1) };
    }
    const root = build(points.map((_, i) => i));
    return { sample(p, accept) {
      if (!point(p)) throw new TypeError('Attribute queries need a finite XYZ point');
      let distance = Infinity, index = -1;
      function visit(node) {
        if (!node) return;
        const at = points[node.index], candidate = V.dist(at, p), split = p[node.axis] - at[node.axis];
        if ((candidate < distance || (candidate === distance && node.index < index)) && (!accept || accept(node.index))) {
          index = node.index;
          distance = candidate;
        }
        if (split <= 0) {
          visit(node.lower);
          if (-split <= distance) visit(node.upper);
        } else {
          visit(node.upper);
          if (split <= distance) visit(node.lower);
        }
      }
      visit(root);
      return index < 0 ? null : { point: points[index].slice(), distance,
        sourceId: source.entities[index]?.id ?? index, values: source.read(index) };
    } };
  }

  function meshSampler(mesh, { vertex, face, maxDistance = Infinity } = {}) {
    const { points, faces } = P.geometry.topology(mesh);
    if (!(maxDistance >= 0)) throw new RangeError('Invalid mesh sampling distance');
    const centroids = faces.map(indices => [0, 1, 2].map(axis => indices.reduce((n, i) => n + points[i][axis], 0) / indices.length));
    const vertices = table('vertex', points, vertex), facesData = table('face', centroids, face);
    const triangles = [];
    for (let f = 0; f < faces.length; f++) {
      const indices = faces[f];
      for (let i = 1; i + 1 < indices.length; i++) {
        const corners = [indices[0], indices[i], indices[i + 1]];
        const [a, b, c] = corners.map(index => points[index]);
        const u = V.sub(b, a), v = V.sub(c, a), cross = V.cross(u, v), norm = V.len(cross);
        if (norm < 1e-10) continue;
        const min = a.map((x, axis) => Math.min(x, b[axis], c[axis]));
        const max = a.map((x, axis) => Math.max(x, b[axis], c[axis]));
        triangles.push({ f, corners, a, b, c, u, v, min, max, normal: V.mul(cross, 1 / norm) });
      }
    }
    function tree(items) {
      if (!items.length) return null;
      const first = items[0], min = first.min.slice(), max = first.max.slice();
      for (const p of items) for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p.min[a]);
        max[a] = Math.max(max[a], p.max[a]);
      }
      if (items.length <= 8) return { min, max, items };
      const extents = min.map((v, i) => max[i] - v), axis = extents.indexOf(Math.max(...extents));
      items.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
      const mid = items.length >> 1;
      return { min, max, left: tree(items.slice(0, mid)), right: tree(items.slice(mid)) };
    }
    const root = tree(triangles);
    const boxDistance = (p, node) => node ? p.reduce((sum, n, i) =>
      sum + Math.max(node.min[i] - n, n - node.max[i], 0) ** 2, 0) : Infinity;
    function closest(p, t) {
      const dx = V.sub(p, t.a);
      const uu = V.dot(t.u, t.u), uv = V.dot(t.u, t.v), vv = V.dot(t.v, t.v);
      const pu = V.dot(t.u, dx), pv = V.dot(t.v, dx), det = uu * vv - uv * uv;
      const a = (pu * vv - pv * uv) / det, b = (pv * uu - pu * uv) / det;
      if (a >= 0 && b >= 0 && a + b <= 1) return { at: V.mad(V.mad(t.a, t.u, a), t.v, b), weights: [1 - a - b, a, b] };
      const triangle = [t.a, t.b, t.c];
      let score = Infinity, best;
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3, from = triangle[i], delta = V.sub(triangle[j], from);
        const k = Math.max(0, Math.min(1, V.dot(delta, V.sub(p, from)) / V.dot(delta, delta)));
        const at = V.mad(from, delta, k), distance = V.dist(p, at);
        if (distance >= score) continue;
        score = distance;
        const weights = [0, 0, 0];
        weights[i] = 1 - k;
        weights[j] = k;
        best = { at, weights };
      }
      return best;
    }
    function sample(p) {
      if (!point(p)) throw new TypeError('Attribute queries need a finite XYZ point');
      let best = maxDistance ** 2, hit;
      function visit(node, lower) {
        if (!node || lower > best) return;
        if (node.items) for (const triangle of node.items) {
          const result = closest(p, triangle), d = V.dist(p, result.at) ** 2;
          if (d < best || (d === best && (!hit || triangle.f < hit.triangle.f))) {
            best = d;
            hit = { triangle, ...result };
          }
        }
        else {
          const l = boxDistance(p, node.left), r = boxDistance(p, node.right);
          if (l <= r) { visit(node.left, l); visit(node.right, r); }
          else { visit(node.right, r); visit(node.left, l); }
        }
      }
      visit(root, boxDistance(p, root));
      if (!hit) return null;
      const { triangle: t, weights, at } = hit;
      const atVertex = weights.indexOf(Math.max(...weights));
      const values = {};
      for (const [name, { type, size, values: data }] of vertices.channels) {
        if (type === 'label') values[name] = data[t.corners[atVertex]];
        else {
          const components = Array.from({ length: size }, (_, j) =>
            t.corners.reduce((sum, i, k) => sum + data[i * size + j] * weights[k], 0));
          values[name] = size === 1 ? components[0] : components;
        }
      }
      return { point: at, normal: t.normal.slice(), sourceId: t.f, distance: Math.sqrt(best),
        weights, values: { ...values, ...facesData.read(t.f) } };
    }
    return { sample };
  }

  function sdfSampler(field, channels, { interval = .012, steps = 6, reach = 2 } = {}) {
    const sdf = typeof field === 'function' ? field : field?.sdf?.bind(field) || field?.sd?.bind(field);
    if (typeof sdf !== 'function' || !Number.isFinite(interval) || interval <= 0 || !Number.isFinite(reach) || reach < 0 ||
        !Number.isSafeInteger(steps) || steps < 1 || steps > 32 || (channels !== undefined && typeof channels !== 'function'))
      throw new TypeError('Invalid SDF attribute sampler');
    return {
      sample(query) {
        if (!point(query)) throw new TypeError('Attribute queries need a finite XYZ point');
        let at = query.slice(), normal = [0, 0, 0];
        for (let i = 0; i < steps; i++) {
          const distance = sdf(...at);
          if (!Number.isFinite(distance) || V.dist(at, query) > reach) return null;
          const derivative = at.map((_, axis) => {
            const a = at.slice(), b = at.slice();
            a[axis] += interval;
            b[axis] -= interval;
            return (sdf(...a) - sdf(...b)) / (2 * interval);
          });
          const length = V.len(derivative);
          if (!length || !Number.isFinite(length)) return null;
          normal = V.mul(derivative, 1 / length);
          if (Math.abs(distance) < interval * .1) break;
          at = V.mad(at, normal, -distance / length);
        }
        const distance = V.dist(at, query);
        if (distance > reach || Math.abs(sdf(...at)) > interval) return null;
        return { point: at, normal, distance, values: channels?.(at, normal, field) || {} };
      }
    };
  }

  function carrierSampler(carrier, channels) {
    if (typeof carrier?.closest !== 'function' || (channels !== undefined && typeof channels !== 'function'))
      throw new TypeError('Expected a sampled carrier and optional attribute function');
    return { sample(p) {
      if (!point(p)) throw new TypeError('Attribute queries need a finite XYZ point');
      const hit = carrier.closest(p), at = position(hit) || hit?.p;
      if (!point(at)) return null;
      return { point: at, normal: hit.normal || hit.n, distance: V.dist(p, at), sourceId: hit.id || carrier.id,
        values: channels?.(hit, carrier) || {} };
    } };
  }

  function transfer(source, domain, entities, { maxDistance = Infinity, fallback = {} } = {}) {
    if (typeof source?.sample !== 'function' || !domains.includes(domain) || !Array.isArray(entities) ||
        entities.length > 250000 || !(maxDistance >= 0))
      throw new TypeError('Attribute transfer needs a source sampler and a bounded target domain');
    return entities.map((entity, index) => {
      const at = position(entity);
      if (!point(at)) throw new TypeError('Target position must be finite');
      const hit = source.sample(at);
      const match = hit && hit.distance <= maxDistance;
      return { domain, id: entity.id ?? index, point: at.slice(), sourceId: match ? hit.sourceId ?? null : null,
        attributes: match ? { ...fallback, ...hit.values } : { ...fallback } };
    });
  }

  function paths(source, curves, options) {
    if (!Array.isArray(curves) || curves.length > 10000) throw new RangeError('Expected a bounded list of paths');
    let nodes = 0;
    return curves.map((curve, index) => {
      const id = curve.id ?? index, points = Array.isArray(curve) ? curve : curve.points;
      if (!Array.isArray(points) || (nodes += points.length) > 250000) throw new RangeError('Path attribute budget exceeded');
      const samples = transfer(source, 'curve', points.map((p, i) => ({ point: position(p), id: String(id) + '/' + i })), options);
      return { id, points: samples.map(sample => sample.point), samples };
    });
  }

  function splats(world, source, options) {
    const entities = Array.from({ length: world.count }, (_, i) => ({
      id: i + 1, at: Array.from(world.data.subarray(i * 16, i * 16 + 3))
    }));
    return transfer(source, 'splat', entities, options);
  }

  P.attributes = Object.freeze({ table, nearest: nearestRows, mesh: meshSampler, sdf: sdfSampler, carrier: carrierSampler, transfer, paths, splats });
})(KIT);
