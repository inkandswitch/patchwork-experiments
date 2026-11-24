/* Spatial bounds, parametric carrier surfaces and affine transforms. */
(function (K) {
  const A = K.procedural,
    { clone, freeze } = A.data,
    V = K.V,
    M = K.M;
  const EPS = 1e-8,
    TAU = Math.PI * 2;
  const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const name = v => typeof v === 'string' && v.length > 0;
  function bounds(raw) {
    if (!raw || !vector(raw.min) || !vector(raw.max) || raw.min.some((x, i) => x > raw.max[i]))
      throw new Error('Expected finite ordered spatial bounds');
    return { min: raw.min.slice(), max: raw.max.slice() };
  }
  const overlap = (a, b) => a.min.every((x, i) => x <= b.max[i] && a.max[i] >= b.min[i]);
  const contains = ({ min, max }, p) => p.length === 3
    ? p[0] >= min[0] && p[0] <= max[0] &&
      p[1] >= min[1] && p[1] <= max[1] &&
      p[2] >= min[2] && p[2] <= max[2]
    : p.every((v, i) => v >= min[i] && v <= max[i]);
  const expand = (b, r) => ({ min: b.min.map(x => x - r), max: b.max.map(x => x + r) });
  function boxOf(points) {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const point of points) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    return { min, max };
  }
  function rayBox(b, origin, dir, max) {
    let near = 0,
      far = max;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dir[i]) < EPS) {
        if (origin[i] < b.min[i] || origin[i] > b.max[i]) return null;
      } else {
        const a = (b.min[i] - origin[i]) / dir[i],
          c = (b.max[i] - origin[i]) / dir[i];
        near = Math.max(near, Math.min(a, c));
        far = Math.min(far, Math.max(a, c));
        if (far < near) return null;
      }
    }
    return near;
  }
  // Snapshot the bounds. Leaves still test each bound exactly after pruning.
  function pointIndex(records) {
    function build(rows) {
      if (!rows.length) return null;
      const extent = boxOf(rows.flatMap(row => [row.box.min, row.box.max]));
      if (rows.length <= 8) return { extent, rows };
      const centres = boxOf(rows.map(row => row.centre));
      let axis = 0;
      for (let i = 1; i < 3; i++)
        if (centres.max[i] - centres.min[i] > centres.max[axis] - centres.min[axis]) axis = i;
      rows.sort((a, b) => a.centre[axis] - b.centre[axis] || a.index - b.index);
      const middle = Math.floor(rows.length / 2);
      return { extent, left: build(rows.slice(0, middle)), right: build(rows.slice(middle)) };
    }
    const tree = build(records.map((record, index) => {
      const box = bounds(record.bounds);
      return { box, centre: box.min.map((v, i) => v / 2 + box.max[i] / 2), record, index };
    }));
    function visit(node, point, match) {
      if (!node || !contains(node.extent, point)) return;
      if (node.rows) {
        for (const row of node.rows)
          if (contains(row.box, point)) match(row.record);
        return;
      }
      visit(node.left, point, match);
      visit(node.right, point, match);
    }
    return (point, match) => visit(tree, point, match);
  }
  A.spatial = { bounds, overlap, contains, expand, boxOf, rayBox, pointIndex };
  function plane(raw) {
    const d = clone(raw);
    if (!d || !name(d.id) || !vector(d.origin) || !vector(d.u) || !vector(d.v))
      throw new Error('A plane needs id, origin and two extent vectors');
    const uu = V.dot(d.u, d.u),
      vv = V.dot(d.v, d.v),
      uv = V.dot(d.u, d.v),
      det = uu * vv - uv * uv;
    if (det < EPS * EPS) throw new Error('Plane extent vectors must be independent');
    const normal = V.norm(V.cross(d.u, d.v)),
      tangent = V.norm(d.u),
      bitangent = V.norm(d.v);
    function planePoint(at) {
      if (!Array.isArray(at) || at.length !== 2 || !at.every(Number.isFinite))
        throw new Error('Surface coordinates must be two finite numbers');
      return V.add(d.origin, V.add(V.mul(d.u, at[0]), V.mul(d.v, at[1])));
    }
    const samplePointNormal = at => ({ p: planePoint(at), n: normal.slice() });
    function sample(at) {
      return {
        p: planePoint(at),
        n: normal.slice(),
        tangent: tangent.slice(),
        bitangent: bitangent.slice(),
        uv: at.slice()
      };
    }
    function project(p) {
      const v = V.sub(p, d.origin),
        a = V.dot(v, d.u),
        b = V.dot(v, d.v);
      return [(a * vv - b * uv) / det, (b * uu - a * uv) / det];
    }
    function closest(p) {
      const at = project(p);
      if (at.every(v => v >= 0 && v <= 1)) return sample(at);
      let best = null,
        distance = Infinity;
      for (const [a, b] of [
        [
          [0, 0],
          [1, 0]
        ],
        [
          [1, 0],
          [1, 1]
        ],
        [
          [1, 1],
          [0, 1]
        ],
        [
          [0, 1],
          [0, 0]
        ]
      ]) {
        const start = sample(a).p,
          end = sample(b).p,
          delta = V.sub(end, start);
        const t = Math.max(0, Math.min(1, V.dot(V.sub(p, start), delta) / V.dot(delta, delta)));
        const hit = sample([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]),
          d2 = V.dist(p, hit.p);
        if (d2 < distance) {
          distance = d2;
          best = hit;
        }
      }
      return best;
    }
    function raycast(origin, dir, max) {
      const den = V.dot(normal, dir);
      if (Math.abs(den) < EPS) return null;
      const distance = V.dot(normal, V.sub(d.origin, origin)) / den;
      if (distance < 0 || distance > max) return null;
      const p = V.mad(origin, dir, distance),
        at = project(p);
      if (at.some(v => v < -EPS || v > 1 + EPS)) return null;
      return Object.assign(sample(at), { distance });
    }
    const b = boxOf(
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1]
      ].map(v => sample(v).p)
    );
    return Object.freeze({
      id: d.id,
      kind: 'plane',
      data: freeze(d),
      bounds: freeze(b),
      sample,
      samplePointNormal,
      planePoint,
      project,
      closest,
      raycast
    });
  }
  function cylinder(raw) {
    const d = clone(raw);
    if (!d || !name(d.id) || !vector(d.origin) || !Number.isFinite(d.height) || d.height <= 0)
      throw new Error('A cylinder needs id, origin and positive height');
    const r = d.radii || [d.radius, d.radius],
      axis = d.axis || [0, 1, 0],
      ref = d.reference || [1, 0, 0];
    if (
      !Array.isArray(r) ||
      r.length !== 2 ||
      !r.every(x => Number.isFinite(x) && x > 0) ||
      !vector(axis) ||
      !vector(ref) ||
      V.len(axis) < EPS
    )
      throw new Error('Invalid cylinder axes or radii');
    const Y = V.norm(axis),
      X0 = V.sub(ref, V.mul(Y, V.dot(ref, Y)));
    if (V.len(X0) < EPS) throw new Error('Cylinder reference must differ from its axis');
    const X = V.norm(X0),
      Z = V.norm(V.cross(X, Y)),
      start = d.startAngle ?? 0,
      sweep = d.sweep === undefined ? TAU : d.sweep;
    if (!Number.isFinite(start) || !Number.isFinite(sweep) || sweep <= 0 || sweep > TAU + EPS)
      throw new Error('Invalid cylinder angular range');
    const closed = Math.abs(sweep - TAU) < EPS;
    function readSurface(at, frame) {
      if (!Array.isArray(at) || at.length !== 2 || !at.every(Number.isFinite))
        throw new Error('Surface coordinates must be two finite numbers');
      const angle = start + at[0] * sweep, c = Math.cos(angle), s = Math.sin(angle);
      const p = V.add(d.origin, V.add(V.mul(Y, d.height * at[1]), V.add(V.mul(X, r[0] * c), V.mul(Z, r[1] * s))));
      const n = V.norm(V.add(V.mul(X, c / r[0]), V.mul(Z, s / r[1])));
      if (!frame) return { p, n };
      const tangent = V.norm(V.add(V.mul(X, -r[0] * s), V.mul(Z, r[1] * c)));
      return { p, n, tangent, bitangent: Y.slice(), uv: at.slice() };
    }
    const sample = at => readSurface(at, true);
    const samplePointNormal = at => readSurface(at, false);
    function project(p) {
      const q = V.sub(p, d.origin),
        angle = Math.atan2(V.dot(q, Z) / r[1], V.dot(q, X) / r[0]);
      const offset = (((angle - start) % TAU) + TAU) % TAU;
      return [offset / sweep, V.dot(q, Y) / d.height];
    }
    function closest(p) {
      const at = project(p),
        y = Math.max(0, Math.min(1, at[1]));
      if (closed && Math.abs(r[0] - r[1]) < EPS) return sample([at[0], y]);
      const score = u => V.dist(p, sample([u, y]).p);
      let best = 0,
        distance = Infinity;
      for (let i = 0; i <= 32; i++) {
        const u = i / 32,
          value = score(u);
        if (value < distance) {
          distance = value;
          best = u;
        }
      }
      let lo = best - 1 / 32,
        hi = best + 1 / 32;
      if (!closed) {
        lo = Math.max(0, lo);
        hi = Math.min(1, hi);
      }
      for (let i = 0; i < 32; i++) {
        const a = lo + (hi - lo) / 3,
          b = hi - (hi - lo) / 3;
        if (score(a) < score(b)) hi = b;
        else lo = a;
      }
      for (const u of [lo, (lo + hi) / 2, hi, 0, 1])
        if (score(u) < distance) {
          distance = score(u);
          best = u;
        }
      return sample([closed ? ((best % 1) + 1) % 1 : best, y]);
    }
    function raycast(origin, dir, max) {
      const p = V.sub(origin, d.origin),
        x = V.dot(p, X) / r[0],
        z = V.dot(p, Z) / r[1],
        dx = V.dot(dir, X) / r[0],
        dz = V.dot(dir, Z) / r[1];
      const a = dx * dx + dz * dz,
        b = 2 * (x * dx + z * dz),
        c = x * x + z * z - 1,
        disc = b * b - 4 * a * c;
      if (a < EPS * EPS || disc < 0) return null;
      const roots = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)];
      for (const distance of roots)
        if (distance >= 0 && distance <= max) {
          const at = project(V.mad(origin, dir, distance));
          if (at[1] >= -EPS && at[1] <= 1 + EPS && (closed || at[0] <= 1 + EPS))
            return Object.assign(sample(at), { distance });
        }
      return null;
    }
    const lo = [],
      hi = [];
    for (let i = 0; i < 3; i++) {
      const extent = Math.hypot(X[i] * r[0], Z[i] * r[1]);
      lo[i] = d.origin[i] - extent + Math.min(0, Y[i] * d.height);
      hi[i] = d.origin[i] + extent + Math.max(0, Y[i] * d.height);
    }
    return Object.freeze({
      id: d.id,
      kind: 'cylinder',
      periodicU: closed,
      data: freeze(d),
      bounds: freeze({ min: lo, max: hi }),
      sample,
      samplePointNormal,
      project,
      closest,
      raycast
    });
  }
  A.surface = { plane, cylinder };
  function local(raw) {
    const p = raw || {},
      t = p.position || [0, 0, 0],
      r = p.rotation === undefined ? [0, 0, 0] : typeof p.rotation === 'number' ? [0, p.rotation, 0] : p.rotation;
    const s = p.scale === undefined ? [1, 1, 1] : typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale;
    if (!vector(t) || !vector(r) || !vector(s) || s.some(v => Math.abs(v) < EPS))
      throw new Error('Transforms need finite position/rotation and nonzero scale');
    const R = M.mul(M.rot([0, 0, 1], r[2]), M.mul(M.rot([0, 1, 0], r[1]), M.rot([1, 0, 0], r[0])));
    return { R: M.mul(R, [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]]), t: t.slice() };
  }
  const point = (pose, p) => V.add(M.app(pose.R, p), pose.t);
  const normal = (pose, n) => V.norm(M.app(M.tr(M.inv(pose.R)), n));
  const inversePoint = (pose, p) => M.app(M.inv(pose.R), V.sub(p, pose.t));
  const combine = (a, b) => ({ R: M.mul(a.R, b.R), t: point(a, b.t) });
  function transformBounds(pose, b) {
    const points = [];
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) points.push(point(pose, [x, y, z]));
    return A.spatial.boxOf(points);
  }
  function distanceScale(pose) {
    if (!pose?.R || pose.R.length !== 9 || !Array.from(pose.R).every(Number.isFinite))
      throw new Error('Distance scaling needs a finite affine matrix');
    const determinant = M.det(pose.R);
    if (!Number.isFinite(determinant) || determinant === 0)
      throw new Error('Distance scaling needs an invertible matrix');
    const a = M.inv(pose.R);
    if (!a.every(Number.isFinite)) throw new Error('Distance scaling needs an invertible matrix');
    const g00 = a[0] ** 2 + a[1] ** 2 + a[2] ** 2,
      g11 = a[3] ** 2 + a[4] ** 2 + a[5] ** 2,
      g22 = a[6] ** 2 + a[7] ** 2 + a[8] ** 2,
      g01 = Math.abs(a[0] * a[3] + a[1] * a[4] + a[2] * a[5]),
      g02 = Math.abs(a[0] * a[6] + a[1] * a[7] + a[2] * a[8]),
      g12 = Math.abs(a[3] * a[6] + a[4] * a[7] + a[5] * a[8]),
      bound = Math.max(g00 + g01 + g02, g11 + g01 + g12, g22 + g02 + g12);
    if (!Number.isFinite(bound) || bound <= 0) throw new Error('Distance scaling needs a finite nonzero bound');
    return 1 / Math.sqrt(bound * (1 + Number.EPSILON * 16));
  }
  A.transforms = { local, point, normal, inversePoint, combine, distanceScale, bounds: transformBounds };
  A.surface.transform = (surface, pose) => {
    const inverse = M.inv(pose.R), normalMatrix = M.tr(inverse);
    const worldNormal = n => V.norm(M.app(normalMatrix, n));
    const unpoint = p => M.app(inverse, V.sub(p, pose.t));
    const planePoint = surface.planePoint && (at => point(pose, surface.planePoint(at)));
    const planeNormal = planePoint && worldNormal(surface.sample([0, 0]).n);
    function sample(at) {
      const s = surface.sample(at);
      if (surface.topology && s.du && s.dv) {
        const du = M.app(pose.R, s.du), dv = M.app(pose.R, s.dv);
        const axis = v => V.mul(v, 1 / V.len(v));
        const tangent = axis(du), n = axis(V.cross(tangent, axis(dv)));
        return { ...s, p: point(pose, s.p), n, tangent, bitangent: V.cross(n, tangent), du, dv };
      }
      return {
        p: point(pose, s.p),
        n: worldNormal(s.n),
        tangent: V.norm(M.app(pose.R, s.tangent)),
        bitangent: V.norm(M.app(pose.R, s.bitangent)),
        uv: s.uv.slice()
      };
    }
    function samplePointNormal(at) {
      if (planePoint) return { p: planePoint(at), n: planeNormal.slice() };
      if (surface.topology) {
        const { p, n } = sample(at);
        return { p, n };
      }
      const s = surface.samplePointNormal ? surface.samplePointNormal(at) : surface.sample(at);
      return { p: point(pose, s.p), n: worldNormal(s.n) };
    }
    function project(p) {
      return surface.project(unpoint(p));
    }
    const planeData =
      surface.kind === 'plane' ? surface.data : surface.kind === 'trimmed-plane' ? surface.data.base : null;
    const plane = planeData
      ? A.surface.plane({
          id: surface.id,
          origin: point(pose, planeData.origin),
          u: M.app(pose.R, planeData.u),
          v: M.app(pose.R, planeData.v)
        })
      : null;
    function closest(p) {
      if (plane) {
        const candidate = plane.closest(p);
        if (!surface.contains || surface.contains(candidate.uv)) return sample(candidate.uv);
        const domain = surface.data.domain;
        let best = null,
          distance = Infinity;
        for (let i = 0; i < domain.length; i++) {
          const a = domain[i],
            b = domain[(i + 1) % domain.length],
            pa = sample(a).p,
            pb = sample(b).p,
            delta = V.sub(pb, pa);
          const t = Math.max(0, Math.min(1, V.dot(V.sub(p, pa), delta) / V.dot(delta, delta)));
          const s = sample([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]),
            d = V.dist(p, s.p);
          if (d < distance) {
            distance = d;
            best = s;
          }
        }
        return best;
      }
      if (surface.kind === 'cylinder') {
        function at(u) {
          const a = sample([u, 0]),
            b = sample([u, 1]),
            d = V.sub(b.p, a.p);
          return sample([u, Math.max(0, Math.min(1, V.dot(V.sub(p, a.p), d) / V.dot(d, d)))]);
        }
        const closed = surface.data.sweep === undefined || Math.abs(surface.data.sweep - Math.PI * 2) < EPS;
        let best = at(0),
          distance = V.dist(best.p, p),
          u0 = 0;
        for (let i = 1; i <= 32; i++) {
          const s = at(i / 32),
            d = V.dist(s.p, p);
          if (d < distance) {
            best = s;
            distance = d;
            u0 = i / 32;
          }
        }
        let lo = u0 - 1 / 32,
          hi = u0 + 1 / 32;
        if (!closed) {
          lo = Math.max(0, lo);
          hi = Math.min(1, hi);
        }
        for (let i = 0; i < 30; i++) {
          const a = lo + (hi - lo) / 3,
            b = hi - (hi - lo) / 3;
          if (V.dist(at(a).p, p) < V.dist(at(b).p, p)) hi = b;
          else lo = a;
        }
        const s = at((lo + hi) / 2);
        if (V.dist(s.p, p) < distance) best = s;
        if (closed) best.uv[0] = ((best.uv[0] % 1) + 1) % 1;
        return best;
      }
      return sample(surface.closest(unpoint(p)).uv);
    }
    function raycast(origin, dir, max) {
      const hit = surface.raycast(unpoint(origin), M.app(inverse, dir), max);
      return hit ? Object.assign(sample(hit.uv), { distance: hit.distance }) : null;
    }
    return Object.freeze({
      id: surface.id,
      kind: 'transformed',
      periodicU: surface.periodicU,
      ...(surface.periodicV !== undefined && { periodicV: surface.periodicV }),
      ...(surface.topology && { topology: surface.topology }),
      ...(surface.topology && typeof surface.mesh === 'function' && { mesh: (settings = {}) =>
        TexturedSurface.grid({ segments: [96, 32], ...settings, point: (u, v) => sample([u, v]).p }) }),
      data: freeze({ local: clone(surface.data || {}), transform: clone(pose) }),
      bounds: freeze(transformBounds(pose, surface.bounds)),
      sample,
      samplePointNormal,
      ...(planePoint ? { planePoint } : {}),
      ...(surface.project && { project }),
      ...(surface.closest && { closest }),
      ...(surface.raycast && { raycast })
    });
  };
})(KIT);
