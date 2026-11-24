/* Blend across allowed part seams and attach fur to the deformed body surface. */
(function (K) {
  const V = K.V;
  function mix(sources) {
    const merged = new Map();
    for (const [influences, gain] of sources) for (const [key, weight] of influences) {
      if (gain > 0 && weight > 0) merged.set(key, (merged.get(key) || 0) + gain * weight);
    }
    const strongest = [...merged].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = strongest.reduce((value, pair) => value + pair[1], 0);
    return strongest.map(([key, w]) => [key, w / sum]);
  }
  function interpolate(weights, anchor) {
    return mix(anchor.indices.map((i, j) => [weights[i], anchor.barycentric[j]]));
  }
  function blend(mesh, weights, zones, passes) {
    if (!Number.isInteger(passes) || passes < 0 || passes > 20) throw new Error('Skin seam passes must be between zero and twenty');
    if (!passes || !zones.length) return weights;
    const { points, faces, partTags: tags } = mesh, graph = points.map(() => new Set()), border = new Set();
    const allowed = (a, b) => {
      if (tags[a] === tags[b]) return true;
      const p = V.lerp(points[a], points[b], 0.5);
      return zones.some(z => ((tags[a] === z.a && tags[b] === z.b) || (tags[a] === z.b && tags[b] === z.a)) &&
        V.dist(p, z.center) <= z.radius * 1.4);
    };
    for (const face of faces) for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      if (!allowed(a, b)) continue;
      graph[a].add(b);
      graph[b].add(a);
      if (tags[a] !== tags[b]) { border.add(a); border.add(b); }
    }
    const queue = [...border], rings = new Map(queue.map(index => [index, 0]));
    for (let i = 0; i < queue.length; i++) {
      const vertex = queue[i], ring = rings.get(vertex);
      if (ring === passes) continue;
      for (const other of graph[vertex]) {
        if (rings.has(other)) continue;
        queue.push(other);
        rings.set(other, ring + 1);
      }
    }
    let result = weights;
    for (let iteration = 0; iteration < passes; iteration++) {
      const next = result.slice();
      for (const i of queue) {
        const peers = [...graph[i]], gain = 0.78 * (1 - rings.get(i) / (passes + 1));
        if (!peers.length) continue;
        next[i] = mix([[result[i], 1 - gain], ...peers.map(j => [result[j], gain / peers.length])]);
      }
      result = next;
    }
    return result;
  }

  K.procedural.geometry.modelSkin = { blend, interpolate };
})(KIT);
