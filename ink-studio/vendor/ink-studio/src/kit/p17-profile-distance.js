/* Compile a planar ring once for repeated signed-distance queries. */
(function (K) {
  const P = K.procedural || K.authoring;

  function profileDistance(points) {
    if (!Array.isArray(points) || points.length < 3 || points.length > 4096 ||
        !points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
      throw new Error('A profile needs 3 to 4096 finite planar points');
    }
    const stride = 6;
    const edges = new Float64Array(points.length * stride);
    let size = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length2 = dx * dx + dy * dy;
      if (!Number.isFinite(length2)) throw new Error('Profile edges must have a finite length');
      if (!length2) continue;
      edges.set([a[0], a[1], b[1], dx, dy, length2], size);
      size += stride;
    }
    if (size < 3 * stride) throw new Error('A profile needs at least three nonzero edges');

    return function distance(x, y) {
      let inside = false, best = Infinity, bx = 0, by = 0, overflow = Infinity;
      for (let i = 0; i < size; i += stride) {
        const ax = edges[i], ay = edges[i + 1], dx = edges[i + 3], dy = edges[i + 4];
        const u = x - ax, v = y - ay;
        const t = Math.max(0, Math.min(1, (u * dx + v * dy) / edges[i + 5]));
        const qx = u - t * dx, qy = v - t * dy;
        const squared = qx * qx + qy * qy;
        if (squared < best) {
          best = squared;
          bx = qx;
          by = qy;
        } else if (squared === Infinity) {
          overflow = Math.min(overflow, Math.hypot(qx, qy));
        }
        if ((ay > y) !== (edges[i + 2] > y) && x < dx * v / dy + ax) inside = !inside;
      }
      const value = best === Infinity ? overflow : Math.hypot(bx, by);
      return inside ? -value : value;
    };
  }

  P.geometry.profileDistance = profileDistance;
})(KIT);
