/* Adaptive samples of a bounded parametric patch. Subdivision measures the actual
   world-space surface, so rotation, steepness and affine scale cannot silently
   increase the distance between samples. No triangles or renderer are required. */
(function (K) {
  const A = K.procedural,
    V = K.V;
  A.geometry.samplePatch = (spec, emit) => {
    const {
      u = [0, 1],
      v = [0, 1],
      steps = [1, 1],
      spacing,
      jitter = 0,
      seed = 0,
      curvature = 0,
      sample,
      accept = () => true,
      maxDepth = 24,
      maxSamples = 1000000
    } = spec || {};
    if (
      ![u, v].every(a => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite) && a[0] < a[1]) ||
      !Array.isArray(steps) ||
      steps.length !== 2 ||
      !steps.every(n => Number.isSafeInteger(n) && n > 0 && n <= 4096) ||
      !Number.isFinite(spacing) ||
      spacing <= 0 ||
      !Number.isFinite(jitter) || jitter < 0 || jitter > 1 ||
      !Number.isSafeInteger(seed) ||
      !Number.isFinite(curvature) || curvature < 0 || curvature > 100 ||
      typeof sample !== 'function' ||
      typeof accept !== 'function' ||
      typeof emit !== 'function' ||
      !Number.isSafeInteger(maxDepth) ||
      maxDepth < 1 ||
      maxDepth > 30 ||
      !Number.isSafeInteger(maxSamples) ||
      maxSamples < 1
    )
      throw new Error('Invalid parametric sample patch');
    let count = 0,
      visits = 0;
    const at = (x, y) => {
      const p = sample(x, y);
      if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite))
        throw new Error('Parametric samples must be finite 3D points');
      return p;
    };
    function sagitta(a, b, mid) {
      const line = V.sub(b, a),
        length2 = V.dot(line, line),
        offset = V.sub(mid, a);
      if (length2 < 1e-20) return 0;
      const bend = V.mad(offset, line, -V.dot(line, offset) / length2);
      return 8 * V.len(bend) / length2;
    }
    function patch(x0, x1, y0, y1, a, b, c, d, depth) {
      if (++visits > maxSamples * 8) throw new Error('Parametric sampling work budget exceeded');
      const x = (x0 + x1) / 2,
        y = (y0 + y1) / 2,
        left = at(x0, y),
        right = at(x1, y),
        low = at(x, y0),
        high = at(x, y1),
        mid = at(x, y);
      const du = Math.max(V.dist(a, b), V.dist(d, c), 2 * V.dist(left, mid), 2 * V.dist(mid, right)),
        dv = Math.max(V.dist(a, d), V.dist(b, c), 2 * V.dist(low, mid), 2 * V.dist(mid, high));
      const cu = V.dist(mid, V.mul(V.add(left, right), 0.5)),
        cv = V.dist(mid, V.mul(V.add(low, high), 0.5));
      const bend = curvature ? Math.max(sagitta(left, right, mid), sagitta(low, high, mid)) : 0;
      const target = spacing / Math.min(8, 1 + curvature * spacing * bend),
        splitU = du > target || cu > spacing * 0.12,
        splitV = dv > target || cv > spacing * 0.12;
      if (splitU || splitV) {
        if (depth >= maxDepth || x === x0 || x === x1 || y === y0 || y === y1)
          throw new Error('Parametric sampling cannot meet spacing within its depth budget');
        if (splitU && (!splitV || du + cu >= dv + cv)) {
          patch(x0, x, y0, y1, a, low, high, d, depth + 1);
          patch(x, x1, y0, y1, low, b, c, high, depth + 1);
        } else {
          patch(x0, x1, y0, y, a, b, right, left, depth + 1);
          patch(x0, x1, y, y1, left, right, c, d, depth + 1);
        }
        return;
      }
      let u = x, v = y;
      if (jitter) {
        const rand = K.grow.dice(A.data.hash(JSON.stringify([x0, x1, y0, y1]), seed >>> 0));
        u += (rand() - 0.5) * jitter * (x1 - x0);
        v += (rand() - 0.5) * jitter * (y1 - y0);
      }
      if (accept(u, v)) {
        if (count >= maxSamples) throw new Error('Parametric sample budget exceeded');
        emit(jitter ? at(u, v) : mid, u, v);
        count++;
      }
    }
    for (let i = 0; i < steps[0]; i++)
      for (let j = 0; j < steps[1]; j++) {
        const x0 = u[0] + ((u[1] - u[0]) * i) / steps[0],
          x1 = u[0] + ((u[1] - u[0]) * (i + 1)) / steps[0],
          y0 = v[0] + ((v[1] - v[0]) * j) / steps[1],
          y1 = v[0] + ((v[1] - v[0]) * (j + 1)) / steps[1];
        patch(x0, x1, y0, y1, at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), 0);
      }
    return count;
  };
})(KIT);
