/* Compile a clamped, piecewise-linear scalar profile for geometric queries. */
(function (K) {
  const P = K.procedural || K.authoring;

  function compile(points) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 4096)
      throw new Error('A linear profile needs two or more ordered points');
    const knots = [];
    let slopeBound = 0;
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))
        throw new Error('Linear profile points must be finite coordinate pairs');
      const previous = knots.at(-1);
      if (previous) {
        const width = point[0] - previous[0], slope = Math.abs((point[1] - previous[1]) / width);
        if (width <= 0 || !Number.isFinite(width) || !Number.isFinite(slope))
          throw new Error('Linear profile coordinates must increase with finite slopes');
        slopeBound = Math.max(slopeBound, slope);
      }
      knots.push(Object.freeze(point.slice()));
    }
    Object.freeze(knots);

    function at(x) {
      if (!Number.isFinite(x)) throw new Error('Linear profile coordinates must be finite');
      let lo = 0, hi = knots.length - 1;
      if (x <= knots[lo][0]) return knots[lo][1];
      if (x >= knots[hi][0]) return knots[hi][1];
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (knots[mid][0] >= x) hi = mid;
        else lo = mid;
      }
      const a = knots[lo], b = knots[hi];
      if (x === b[0]) return b[1];
      const t = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }

    return Object.freeze({knots, slopeBound, at});
  }

  P.linearProfile = Object.freeze({compile});
})(KIT);
