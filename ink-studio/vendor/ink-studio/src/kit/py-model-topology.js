/* Insert shared cross-section edges in an authored joint region before simplification. */
(function (K) {
  const V = K.V;
  function guideTopology(input, guides) {
    const points = input.points.slice(), fixed = new Set();
    let faces = input.faces;
    for (const guide of guides) {
      const { center, radius } = guide;
      if (!guide.axis) {
        for (const [i, p] of points.entries()) if (V.dist(p, center) < radius) fixed.add(i);
        continue;
      }
      const normal = V.norm(guide.axis), dots = points.map(p => V.dot(V.sub(p, center), normal));
      const cuts = new Map(), next = [];
      function cut(a, b) {
        const d0 = dots[a], d1 = dots[b];
        if ((d0 < 0) === (d1 < 0)) return;
        const t = d0 / (d0 - d1), point = V.lerp(points[a], points[b], t);
        if (V.dist(point, center) >= radius) return;
        if (t < 0.015 || t > 0.985) {
          fixed.add(t < 0.5 ? a : b);
          return;
        }
        const id = a < b ? a + '/' + b : b + '/' + a;
        if (!cuts.has(id)) {
          fixed.add(points.length);
          cuts.set(id, points.push(point) - 1);
        }
        return cuts.get(id);
      }
      for (const face of faces) {
        const pieces = [face];
        for (let e = 0; e < 3; e++) {
          const a = face[e], b = face[(e + 1) % 3], c = cut(a, b);
          if (c === undefined) continue;
          const index = pieces.findIndex(tri => tri.includes(a) && tri.includes(b));
          const tri = pieces[index], other = tri.find(i => i !== a && i !== b);
          pieces.splice(index, 1, [a, c, other], [c, b, other]);
        }
        next.push(...pieces);
      }
      faces = next;
    }
    return { points, faces, locked: [...fixed] };
  }

  K.procedural.geometry.guideModelTopology = guideTopology;
})(KIT);
