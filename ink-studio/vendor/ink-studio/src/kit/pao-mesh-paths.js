/* Weighted paths between vertices on imported or native indexed meshes. */
(function (K) {
  const P = K.procedural;
  const point = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

  function topology(mesh) {
    const indices = mesh?.tri ?? mesh?.indices ?? mesh?.triangles;
    const positions = mesh?.pos ?? mesh?.positions ?? (indices && mesh?.points);
    const triples = (values, limit) => values && values.length % 3 === 0 && values.length <= limit * 3 &&
      Array.from({ length: values.length / 3 }, (_, i) => Array.from(values.slice(i * 3, i * 3 + 3)));
    const vertices = Array.isArray(mesh?.points?.[0]) ? mesh.points : triples(positions, 250000);
    const faces = mesh?.faces ?? triples(indices, 500000);
    if (!Array.isArray(vertices) || !vertices.length || vertices.length > 250000 || !vertices.every(point) ||
        !Array.isArray(faces) || faces.length > 500000 || !faces.every(face => (Array.isArray(face) || ArrayBuffer.isView(face)) && face.length >= 3 &&
          face.length <= 64 && new Set(face).size === face.length && face.every(i => Number.isSafeInteger(i) && i >= 0 && i < vertices.length)))
      throw new RangeError('Expected a bounded indexed mesh');
    return { points: vertices, faces };
  }

  function meshPaths(mesh, { sources, edgeCost, maxCost = Infinity, maxEdges = 1e6 } = {}) {
    const { points, faces } = topology(mesh), count = points.length;
    const vertex = i => Number.isSafeInteger(i) && i >= 0 && i < count;
    if (!Array.isArray(sources) || !sources.length || !sources.every(vertex) ||
        (edgeCost !== undefined && typeof edgeCost !== 'function') ||
        !(maxCost >= 0) || !Number.isSafeInteger(maxEdges) || maxEdges < 1)
      throw new RangeError('Mesh paths need source vertices and bounded edge costs');
    const adjacency = Array.from({ length: count }, () => []);
    const edges = new Map();
    for (let faceId = 0; faceId < faces.length; faceId++) {
      const indices = faces[faceId];
      for (let k = 0; k < indices.length; k++) {
        const x = indices[k], y = indices[(k + 1) % indices.length];
        const a = Math.min(x, y), b = Math.max(x, y), key = a * count + b;
        if (!edges.has(key)) {
          if (edges.size >= maxEdges) throw new RangeError('Mesh paths exceed the edge budget');
          edges.set(key, { a, b, faces: [] });
        }
        edges.get(key).faces.push(faceId);
      }
    }
    for (const { a, b, faces: memberships } of edges.values()) {
      const pa = points[a], pb = points[b], length = K.V.dist(pa, pb);
      const cost = edgeCost ? edgeCost({ from: pa, to: pb, a, b, length, faces: memberships.slice() }) : length;
      if (!(cost >= 0)) throw new RangeError('Edge costs must be nonnegative or infinity');
      if (cost === Infinity) continue;
      adjacency[a].push([b, cost]);
      adjacency[b].push([a, cost]);
    }
    const distances = new Float64Array(count).fill(Infinity);
    const predecessor = new Int32Array(count).fill(-1);
    const origin = new Int32Array(count).fill(-1);
    const heap = [];
    const earlier = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    function push(item) {
      let i = heap.length;
      heap.push(item);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!earlier(item, heap[p])) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = item;
    }
    function pop() {
      const first = heap[0], item = heap.pop();
      if (!heap.length) return first;
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let j = i * 2 + 1;
        if (heap[j + 1] && earlier(heap[j + 1], heap[j])) j++;
        if (!earlier(heap[j], item)) break;
        heap[i] = heap[j];
        i = j;
      }
      heap[i] = item;
      return first;
    }
    for (const i of new Set(sources)) {
      distances[i] = 0;
      origin[i] = i;
      push([0, i]);
    }
    while (heap.length) {
      const [distance, i] = pop();
      if (distance !== distances[i]) continue;
      for (const [next, cost] of adjacency[i]) {
        const candidate = distance + cost;
        if (candidate >= distances[next] || candidate > maxCost) continue;
        distances[next] = candidate;
        predecessor[next] = i;
        origin[next] = origin[i];
        push([candidate, next]);
      }
    }
    function path(target) {
      if (!vertex(target)) throw new RangeError('Unknown mesh vertex');
      if (origin[target] < 0) return null;
      const indices = [];
      for (let i = target; i >= 0; i = predecessor[i]) indices.push(i);
      indices.reverse();
      return { indices, points: indices.map(i => points[i].slice()), distances: indices.map(i => distances[i]),
        cost: distances[target], source: origin[target] };
    }
    let field;
    function distanceAt(point) {
      if (!field) field = P.attributes.mesh(mesh, { vertex: {
        reachable: { type: 'number', values: Float64Array.from(distances, value => Number.isFinite(value) ? 1 : 0) },
        distance: { type: 'number', values: Float64Array.from(distances, value => Number.isFinite(value) ? value : 0) }
      } });
      const hit = field.sample(point);
      return hit && hit.values.reachable >= 1 - 1e-8 ? hit.values.distance : Infinity;
    }
    return { distances, predecessor, origin, path, distanceAt,
      curves: targets => targets.map(path).filter(Boolean) };
  }

  Object.assign(P.geometry, { topology, meshPaths });
})(KIT);
