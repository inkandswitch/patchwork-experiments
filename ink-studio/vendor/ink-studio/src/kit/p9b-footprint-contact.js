/* Seat an upright object on a sampled support without tilting its frame.
   A footprint can reject a wet patch, a void, a step or an occupied column. */
(function (K) {
  const P = K.procedural || K.authoring, { V, M } = K;
  const columnHeights = [.07, .5, .97];
  const vec = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);

  function footprintFromBounds(bounds, pose) {
    const { min, max } = bounds || {}, { R, t } = pose || {};
    if (![min, max, t].every(vec) || min.some((v, i) => v > max[i]) ||
        !Array.isArray(R) || R.length !== 9 || !Array.from(R).every(Number.isFinite))
      throw Error('A footprint needs ordered local bounds and a finite affine pose');
    const x = [R[0], 0, R[6]], z = [R[2], 0, R[8]];
    const along = V.len(x) > 1e-8 ? x : z;
    if (V.len(along) <= 1e-8) throw Error('A footprint needs a horizontal pose axis');
    const tangent = V.norm(along), up = [0, 1, 0], side = [-tangent[2], 0, tangent[0]];
    const projection = M.mul(M.tr(M.cols(tangent, up, side)), R);
    const low = [0, 0, 0], high = [0, 0, 0];
    for (let a = 0; a < 3; a++) for (let i = 0; i < 3; i++) {
      const first = projection[a * 3 + i] * min[i], last = projection[a * 3 + i] * max[i];
      low[a] += Math.min(first, last);
      high[a] += Math.max(first, last);
    }
    const point = V.add(t, V.add([0, low[1], 0],
      V.add(V.mul(tangent, (low[0] + high[0]) / 2), V.mul(side, (low[2] + high[2]) / 2))));
    return { point, tangent, size: high.map((v, i) => Math.max(.001, v - low[i])) };
  }

  function fitFootprintContact({
    center, tangent, size, height, blocked, maxSpread = .09, samples = 3,
    interval = [-Infinity, Infinity], includePoints = true
  } = {}) {
    if (
      ![center, tangent, size].every(vec) || size.some(v => v <= 0) ||
      typeof height !== 'function' || (blocked !== undefined && typeof blocked !== 'function') ||
      !Number.isFinite(maxSpread) || maxSpread < 0 || !Number.isSafeInteger(samples) || samples < 2 || samples > 17 ||
      typeof includePoints !== 'boolean' || !Array.isArray(interval) || interval.length !== 2 || !interval.every(v => typeof v === 'number') ||
      !(interval[0] >= -Infinity && interval[0] <= interval[1] && interval[1] <= Infinity)
    ) throw new Error('Footprint contact needs finite axes, positive dimensions and bounded sampling');
    const length = Math.hypot(tangent[0], tangent[2]);
    if (length < 1e-8) throw new Error('A footprint needs a horizontal tangent');
    const u = [tangent[0] / length, 0, tangent[2] / length], v = [-u[2], 0, u[0]];
    const points = includePoints ? [] : null;
    function scan(visit) {
      for (let i = 0; i < samples; i++) for (let j = 0; j < samples; j++) {
        const a = size[0] * (i / (samples - 1) - .5), b = size[2] * (j / (samples - 1) - .5);
        const x = center[0] + u[0] * a + v[0] * b, z = center[2] + u[2] * a + v[2] * b;
        if (!visit(x, z)) return false;
      }
      return true;
    }

    let low = Infinity, high = -Infinity;
    if (!scan((x, z) => {
      const y = height(x, z);
      if (y == null) return false;
      if (!Number.isFinite(y)) throw new Error('Footprint contact heights must be finite');
      if (y < interval[0] || y > interval[1]) return false;
      low = Math.min(low, y);
      high = Math.max(high, y);
      if (high - low > maxSpread + 1e-9) return false;
      if (points) points.push([x, z]);
      return true;
    })) return null;
    if (blocked) {
      const clear = (x, z) => !columnHeights.some(f => blocked([x, high + size[1] * f, z]));
      if (!(points ? points.every(([x, z]) => clear(x, z)) : scan(clear))) return null;
    }
    const fit = { point: [center[0], high, center[2]], tangent: u, normal: [0, 1, 0], range: [low, high] };
    if (points) fit.points = points;
    return P.data.freeze(fit);
  }

  P.footprintFromBounds = footprintFromBounds;
  P.fitFootprintContact = fitFootprintContact;
})(KIT);
