/* Rotations, sections and perspective projection in Euclidean four-space. */
(function (K) {
  const P = K.procedural, V = K.V, { freeze } = P.data;
  const turns = new WeakSet(), frames = new WeakSet(), solids = new WeakSet();
  const names = 'xyzw';
  const unit = Array.from({ length: 4 }, (_, i) => Array.from(names, (_n, j) => Number(i === j)));
  const vector = (p, n) => (Array.isArray(p) || ArrayBuffer.isView(p)) && p.length === n &&
    Array.from(p).every(Number.isFinite);
  const dot = (p, q) => p.reduce((sum, v, i) => sum + v * q[i], 0);
  const sub = (p, q) => p.map((v, i) => v - q[i]);
  const mad = (p, q, s) => p.map((v, i) => v + q[i] * s);
  const len = p => Math.hypot(...p);
  const scale = (p, s) => p.map(v => v * s);
  const check = (valid, message) => {
    if (!valid) throw new RangeError('4D geometry: ' + message);
  };
  const vId = i => 'v:' + i, eId = i => 'e:' + i, cId = i => 'c:' + i;
  const edgeKey = (a, b) => a < b ? a + '/' + b : b + '/' + a;

  function residual(p, axes) {
    return axes.reduce((v, axis) => mad(v, axis, -dot(v, axis)), p);
  }
  function span(points, epsilon) {
    const axes = [];
    for (const p of points) {
      const v = residual(sub(p, points[0]), axes), length = len(v);
      if (length > epsilon) axes.push(scale(v, 1 / length));
      if (axes.length === p.length) break;
    }
    return axes;
  }

  function rotation(planes = []) {
    check(Array.isArray(planes) && planes.length <= 64, 'rotation needs an array of planar turns');
    const data = Array.from(planes, row => {
      check(Array.isArray(row) && row.length === 2 && /^(xy|xz|xw|yz|yw|zw)$/.test(row[0]) &&
        Number.isFinite(row[1]), 'a turn needs one coordinate plane and an angle in radians');
      return [names.indexOf(row[0][0]), names.indexOf(row[0][1]), Math.cos(row[1]), Math.sin(row[1])];
    });
    function apply(input, sequence, sign) {
      check(vector(input, 4), 'expected a finite XYZW vector');
      const p = Array.from(input);
      for (const [i, j, c, s] of sequence) {
        const a = p[i], b = p[j];
        p[i] = c * a - sign * s * b;
        p[j] = sign * s * a + c * b;
      }
      return p;
    }
    const reversed = data.slice().reverse();
    const out = Object.freeze({
      apply: p => apply(p, data, 1),
      inverse: p => apply(p, reversed, -1)
    });
    turns.add(out);
    return out;
  }

  function frame({ normal = [0, 0, 0, 1], offset = 0, axes: supplied } = {}) {
    check(vector(normal, 4) && len(normal) > 1e-12 && Number.isFinite(len(normal)) && Number.isFinite(offset),
      'a frame needs a nonzero normal and finite offset');
    const n = scale(Array.from(normal), 1 / len(normal)), axes = [];
    if (supplied !== undefined) {
      check(Array.isArray(supplied) && supplied.length === 3 && Array.from(supplied).every(p => vector(p, 4)),
        'frame axes need three independent in-plane directions');
    }
    for (const p of supplied ?? unit) {
      const v = residual(Array.from(p), [n, ...axes]), length = len(v);
      if (length > 1e-9) axes.push(scale(v, 1 / length));
      if (axes.length === 3) break;
    }
    check(axes.length === 3, 'frame axes must span the plane');
    const depth = p => {
      check(vector(p, 4), 'depth needs a finite XYZW point');
      return dot(p, n) - offset;
    };
    const to3 = p => {
      check(vector(p, 4), 'projection needs a finite XYZW point');
      return axes.map(axis => dot(p, axis));
    };
    const to4 = (p, d = 0) => {
      check(vector(p, 3) && Number.isFinite(d) && Number.isFinite(offset + d),
        'embedding needs finite XYZ coordinates and depth');
      return axes.reduce((v, axis, i) => mad(v, axis, p[i]), scale(n, offset + d));
    };
    const out = freeze({ normal: n, offset, axes, depth, to3, to4 });
    frames.add(out);
    return out;
  }
  const identity = rotation(), defaultFrame = frame();
  function settings(rotate, plane) {
    check(turns.has(rotate) && frames.has(plane), 'use a rotation and frame from fourD');
  }

  function polytope({ vertices, edges, cells, tolerance } = {}) {
    check(Array.isArray(vertices) && vertices.length >= 5 && vertices.length <= 512 &&
      Array.from(vertices).every(p => vector(p, 4)) && Array.isArray(edges) && edges.length <= 4096 &&
      Array.isArray(cells) && cells.length >= 5 && cells.length <= 512,
      'a bounded convex polytope needs XYZW vertices, edges, and 3D cells');
    const points = vertices.map(p => Array.from(p));
    const center = points.reduce((a, p) => mad(a, p, 1 / points.length), [0, 0, 0, 0]);
    const extent = Math.max(...points.map(p => len(sub(p, center))));
    const epsilon = tolerance ?? extent * 1e-9;
    check(Number.isFinite(epsilon) && epsilon > 0 && span(points, epsilon).length === 4,
      'polytope vertices must span four dimensions at the supplied tolerance');
    const indices = new Set(points.map(p => p.join(',')));
    check(indices.size === points.length, 'polytope vertices must be distinct');
    const index = i => Number.isSafeInteger(i) && i >= 0 && i < points.length;
    const keys = new Set();
    const links = Array.from(edges, raw => {
      check((Array.isArray(raw) || ArrayBuffer.isView(raw)) && raw.length === 2 &&
        Array.from(raw).every(index) && raw[0] !== raw[1], 'edges need two distinct vertex indices');
      const [a, b] = raw, key = edgeKey(a, b);
      check(!keys.has(key), 'edges must be unique');
      keys.add(key);
      return a < b ? [a, b] : [b, a];
    });
    const cellKeys = new Set();
    const sides = Array.from(cells, (raw, i) => {
      check(Array.isArray(raw) && raw.length >= 4 && Array.from(raw).every(index) &&
        new Set(raw).size === raw.length, 'cells need distinct vertex indices');
      const ids = raw.slice().sort((a, b) => a - b), key = ids.join(',');
      check(!cellKeys.has(key), 'cells must be unique');
      cellKeys.add(key);
      const axes = span(ids.map(j => points[j]), epsilon);
      check(axes.length === 3, 'each cell must span a 3D supporting hyperplane');
      const perpendicular = unit.map(u => residual(u, axes)).sort((a, b) => len(b) - len(a))[0];
      let normal = scale(perpendicular, 1 / len(perpendicular));
      const origin = points[ids[0]];
      if (dot(sub(center, origin), normal) > 0) normal = scale(normal, -1);
      const members = new Set(ids);
      for (let j = 0; j < points.length; j++) {
        const distance = dot(sub(points[j], origin), normal);
        check(members.has(j) ? Math.abs(distance) <= epsilon : distance < -epsilon,
          'a cell must list all vertices on its convex supporting plane');
      }
      const edges = links.flatMap(([a, b], j) => members.has(a) && members.has(b) ? [j] : []);
      return { id: cId(i), vertices: ids, edges, normal, origin };
    });
    const incident = new Uint16Array(points.length);
    for (const side of sides) for (const j of side.vertices) incident[j]++;
    const edgeUses = new Uint16Array(links.length);
    for (const side of sides) for (const j of side.edges) edgeUses[j]++;
    check(incident.every(n => n >= 4) && links.length > 0 && edgeUses.every(n => n >= 3),
      'vertices and edges must belong to the boundary cells');
    const field = (...p) => {
      check(vector(p, 4), 'a polytope field needs finite XYZW coordinates');
      let distance = -Infinity;
      for (const { origin, normal } of sides) distance = Math.max(distance, dot(sub(p, origin), normal));
      return distance;
    };
    const out = freeze({ vertices: points, edges: links, cells: sides, radius: extent, field });
    solids.add(out);
    return out;
  }

  const signs = mask => unit.map((_axis, j) => mask & (1 << j) ? 1 : -1);
  function regular(points, planes, radius, nativeRadius, distanceSquared) {
    check(Number.isFinite(radius) && radius > 0, 'radius must be positive and finite');
    const edges = [];
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const d = sub(points[i], points[j]);
      if (dot(d, d) === distanceSquared) edges.push([i, j]);
    }
    const cells = planes.map(([axis, depth]) => points.flatMap((p, i) => dot(p, axis) === depth ? [i] : []));
    return polytope({ vertices: points.map(p => scale(p, radius / nativeRadius)), edges, cells });
  }
  const coordinatePlanes = unit.flatMap(a => [[a, 1], [scale(a, -1), 1]]);
  function tesseract({ radius = 1 } = {}) {
    return regular(Array.from({ length: 16 }, (_, i) => signs(i)), coordinatePlanes, radius, 2, 4);
  }
  function cell24({ radius = 1 } = {}) {
    const points = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      for (const a of [-1, 1]) for (const b of [-1, 1]) points.push(mad(scale(unit[i], a), unit[j], b));
    }
    const diagonal = Array.from({ length: 16 }, (_, i) => [signs(i), 2]);
    return regular(points, [...coordinatePlanes, ...diagonal], radius, Math.SQRT2, 2);
  }

  function project(solid, { rotation: rotate = identity, frame: plane = defaultFrame, perspective, near = .05 } = {}) {
    settings(rotate, plane);
    check(solids.has(solid) && Number.isFinite(near) && near > 0 &&
      (perspective === undefined || Number.isFinite(perspective) && perspective > near),
      'projection needs a polytope and a perspective distance beyond the near clip');
    const points = [], vertexIds = [], depths = [], edges = [], edgeIds = [];
    const world = solid.vertices.map(rotate.apply), distance = world.map(plane.depth);
    const maxDepth = perspective === undefined ? Infinity : perspective - near;
    const add = (p, depth, id) => {
      const k = perspective === undefined ? 1 : perspective / Math.max(near, perspective - depth);
      const xyz = V.mul(plane.to3(p), k);
      check(xyz.every(Number.isFinite), 'projection exceeds finite coordinates');
      points.push(xyz);
      vertexIds.push(id);
      depths.push(depth);
      return points.length - 1;
    };
    const indices = world.map((p, i) => distance[i] <= maxDepth ? add(p, distance[i], vId(i)) : -1);
    solid.edges.forEach(([a, b], i) => {
      let u = indices[a], v = indices[b];
      if (u < 0 && v < 0) return;
      if (u < 0 || v < 0) {
        const t = (maxDepth - distance[a]) / (distance[b] - distance[a]);
        // An edge with only its endpoint on the near plane contributes no line.
        if (t <= 0 || t >= 1) return;
        const clipped = add(mad(world[a], sub(world[b], world[a]), t), maxDepth, eId(i) + ':clip');
        if (u < 0) u = clipped;
        else v = clipped;
      }
      edges.push([u, v]);
      edgeIds.push(eId(i));
    });
    return freeze({ points, vertexIds, depths, edges, edgeIds });
  }

  function hull(indices, points, normal, epsilon) {
    const u = V.perp(normal), v = V.cross(normal, u), origin = points[indices[0]];
    const xy = indices.map(i => {
      const p = V.sub(points[i], origin);
      return { i, x: V.dot(p, u), y: V.dot(p, v) };
    }).sort((a, b) => a.x - b.x || a.y - b.y || a.i - b.i);
    function chain(order) {
      const out = [];
      for (const p of order) {
        while (out.length > 1) {
          const a = out.at(-2), b = out.at(-1);
          const turn = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
          if (turn > epsilon * Math.hypot(b.x - a.x, b.y - a.y)) break;
          out.pop();
        }
        out.push(p);
      }
      return out.slice(0, -1);
    }
    return [...chain(xy), ...chain(xy.reverse())].map(p => p.i);
  }

  function slice(solid, { rotation: rotate = identity, frame: plane = defaultFrame, epsilon } = {}) {
    settings(rotate, plane);
    check(solids.has(solid), 'slicing needs a polytope');
    const eps = epsilon ?? solid.radius * 1e-8;
    check(Number.isFinite(eps) && eps > 0, 'slice epsilon must be positive and finite');
    const world = solid.vertices.map(rotate.apply), d = world.map(plane.depth);
    const points = [], ids = [];
    const add = (p, id) => {
      ids.push(id);
      return points.push(plane.to3(p)) - 1;
    };
    const atVertex = world.map((p, i) => Math.abs(d[i]) <= eps ? add(p, vId(i)) : -1);
    const atEdge = solid.edges.map(([a, b], i) => {
      if (atVertex[a] >= 0 || atVertex[b] >= 0 || (d[a] < 0) === (d[b] < 0)) return -1;
      const t = d[a] / (d[a] - d[b]);
      return add(mad(world[a], sub(world[b], world[a]), t), eId(i));
    });
    const axes = span(points, eps), dimension = points.length ? axes.length : -1;
    const polygons = [], faceKeys = new Set(), segments = new Map(), used = new Set();
    const segment = (a, b) => {
      segments.set(edgeKey(a, b), [a, b]);
      used.add(a);
      used.add(b);
    };
    function polygon(id, candidates, normal) {
      const vertices = hull(candidates, points, normal, eps);
      if (vertices.length < 3) return;
      const key = vertices.slice().sort((a, b) => a - b).join(',');
      if (faceKeys.has(key)) return;
      faceKeys.add(key);
      polygons.push({ id, vertices, normal });
      vertices.forEach((a, i) => segment(a, vertices[(i + 1) % vertices.length]));
    }
    const all = points.map((_p, i) => i);
    if (dimension === 3) {
      for (const side of solid.cells) {
        const n = plane.to3(rotate.apply(side.normal)), length = V.len(n);
        if (length <= 1e-10) continue;
        const candidates = side.vertices.map(j => atVertex[j]).concat(side.edges.map(j => atEdge[j])).filter(j => j >= 0);
        if (candidates.length >= 3) polygon(side.id, candidates, V.mul(n, 1 / length));
      }
    } else if (dimension === 2) {
      polygon('tangent', all, V.cross(...axes));
    } else if (dimension === 1) {
      const order = all.sort((a, b) => V.dot(points[a], axes[0]) - V.dot(points[b], axes[0]));
      segment(order[0], order.at(-1));
    } else if (dimension === 0) used.add(0);

    const indices = all.filter(i => used.has(i)).sort((a, b) => a - b);
    const remap = new Map(indices.map((a, i) => [a, i]));
    const faces = polygons.map(({ id, vertices, normal }) => ({ id, vertices: vertices.map(i => remap.get(i)), normal }));
    const edges = [...segments.values()].map(link => link.map(i => remap.get(i)));
    const edgeIds = [...segments.values()].map(link => link.map(i => ids[i]).sort().join('/'));
    const xyz = indices.map(i => points[i]);
    const vertexIds = indices.map(i => ids[i]);
    function mesh() {
      const builder = P.geometry.builder();
      for (const { id, vertices, normal } of faces) {
        for (let i = 1; i + 1 < vertices.length; i++) {
          builder.triangle(xyz[vertices[0]], xyz[vertices[i]], xyz[vertices[i + 1]],
            { surface: id }, undefined, [normal, normal, normal]);
        }
      }
      return builder.finish();
    }
    return freeze({ dimension, points: xyz, vertexIds, edges, edgeIds, faces, mesh });
  }

  function fieldSampler(field, rotate, plane) {
    settings(rotate, plane);
    check(typeof field === 'function', 'expected a scalar field of XYZW');
    return (p, depth) => {
      const f = field(...rotate.inverse(plane.to4(p, depth)));
      check(Number.isFinite(f), 'a scalar field must return a finite value');
      return f;
    };
  }
  function sliceField(field, { rotation: rotate = identity, frame: plane = defaultFrame } = {}) {
    const sample = fieldSampler(field, rotate, plane);
    return (x, y, z) => sample([x, y, z], 0);
  }
  function projectField(field, { rotation: rotate = identity, frame: plane = defaultFrame,
    depth = [-1, 1], samples = 33, reduce = 'min' } = {}) {
    const sample = fieldSampler(field, rotate, plane);
    check(vector(depth, 2) && depth[0] < depth[1] && Number.isFinite(depth[1] - depth[0]) &&
      Number.isSafeInteger(samples) && samples > 1 && samples <= 1024 && ['min', 'max', 'mean'].includes(reduce),
      'field projection needs increasing depth bounds, a sample count and a reducer');
    const distances = Array.from({ length: samples }, (_, i) => depth[0] + (depth[1] - depth[0]) * i / (samples - 1));
    return (x, y, z) => {
      let result = reduce === 'min' ? Infinity : reduce === 'max' ? -Infinity : 0;
      const p = [x, y, z];
      for (const d of distances) {
        const value = sample(p, d);
        if (reduce === 'min') result = Math.min(result, value);
        else if (reduce === 'max') result = Math.max(result, value);
        else result += value / samples;
      }
      return result;
    };
  }

  P.geometry.fourD = Object.freeze({ rotation, frame, polytope, tesseract, cell24, project, slice, sliceField, projectField });
})(KIT);
