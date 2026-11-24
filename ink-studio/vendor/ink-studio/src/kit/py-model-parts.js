/* Parametric details keep their own resolution even on a coarse body mesh. */
(function (K) {
  const V = K.V, tau = 2 * Math.PI, axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  function analytic(solid, sample) {
    const { analytic: shape, mat, tag, res, model } = solid;
    const { center, frame = axes } = shape;
    const points = [], faces = [], uvs = [];
    const world = p => p.reduce((out, v, i) => V.mad(out, frame[i], v), center.slice());
    const reverse = V.dot(V.cross(frame[0], frame[1]), frame[2]) < 0;
    const size = shape.kind === 'torus' ? shape.major + shape.minor : Math.max(...shape.radii);
    const ring = Math.max(12, Math.min(64, Math.ceil(tau * size / (2 * res))));
    function face(indices, uv) {
      faces.push(reverse ? indices.slice().reverse() : indices);
      uvs.push(reverse ? uv.slice().reverse() : uv);
    }
    if (shape.kind === 'torus') {
      const tube = Math.max(8, Math.min(16, Math.ceil(tau * shape.minor / (1.6 * res))));
      for (let i = 0; i < ring; i++) for (let j = 0; j < tube; j++) {
        const a = i * tau / ring, b = j * tau / tube, radius = shape.major + shape.minor * Math.cos(b);
        points.push(world([radius * Math.cos(a), shape.minor * Math.sin(b), radius * Math.sin(a)]));
      }
      const at = (i, j) => (i % ring) * tube + j % tube;
      for (let i = 0; i < ring; i++) for (let j = 0; j < tube; j++) {
        const a = i / ring, b = (i + 1) / ring, c = j / tube, d = (j + 1) / tube;
        face([at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)], [[a, c], [a, d], [b, d], [b, c]]);
      }
    } else {
      const rows = Math.max(6, Math.min(28, Math.ceil(ring / 2))), r = shape.radii;
      points.push(world([0, r[1], 0]));
      for (let j = 1; j < rows; j++) for (let i = 0; i < ring; i++) {
        const a = i * tau / ring, b = j * Math.PI / rows;
        points.push(world([r[0] * Math.sin(b) * Math.cos(a), r[1] * Math.cos(b), r[2] * Math.sin(b) * Math.sin(a)]));
      }
      const last = points.length;
      points.push(world([0, -r[1], 0]));
      const at = (i, j) => 1 + ring * (j - 1) + i % ring;
      for (let i = 0; i < ring; i++) {
        const a = i / ring, b = (i + 1) / ring, mid = (a + b) / 2;
        face([0, at(i + 1, 1), at(i, 1)], [[mid, 0], [b, 1 / rows], [a, 1 / rows]]);
        for (let j = 1; j < rows - 1; j++) {
          const c = j / rows, d = (j + 1) / rows;
          face([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], [[a, c], [b, c], [b, d], [a, d]]);
        }
        face([at(i, rows - 1), at(i + 1, rows - 1), last], [[a, (rows - 1) / rows], [b, (rows - 1) / rows], [mid, 1]]);
      }
    }
    return { name: model?.name || [tag, shape.kind].filter(Boolean).join(' '),
      points, faces, uvs, closed: true, rigidPart: model?.blend !== true, bakeUVs: model?.bake === true, textureSize: model?.textureSize, materials: [sample(mat, center, [0, 1, 0])],
      sampleSurface: (p, n) => sample(mat, p, n),
      partTags: points.map(() => tag)
    };
  }

  K.procedural.geometry.analyticModelPart = analytic;
})(KIT);
