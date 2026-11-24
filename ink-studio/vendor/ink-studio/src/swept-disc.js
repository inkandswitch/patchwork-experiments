/* Exact nearest segment queries for planar tapered swept discs. */
const SweptDisc = (() => {
  const leafSize = 8, indexThreshold = 32, maxIndexedCoordinate = 1e8;
  const clamp = t => Math.max(0, Math.min(1, t));

  function hierarchy(points, radii, first, end) {
    if (end - first > leafSize) {
      const middle = (first + end) >>> 1;
      const left = hierarchy(points, radii, first, middle), right = hierarchy(points, radii, middle, end);
      return {
        left, right,
        minX: Math.min(left.minX, right.minX), minY: Math.min(left.minY, right.minY),
        maxX: Math.max(left.maxX, right.maxX), maxY: Math.max(left.maxY, right.maxY),
        radius: Math.max(left.radius, right.radius)
      };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, radius = 0;
    for (let i = first; i <= end; i++) {
      const [x, y] = points[i];
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      radius = Math.max(radius, radii[i]);
    }
    return { first, end, minX, minY, maxX, maxY, radius };
  }

  function visit(node, lower, bound, sample, best) {
    if (lower > best()) return;
    if (!node.left) {
      sample(node.first, node.end);
      return;
    }
    const left = bound(node.left), right = bound(node.right);
    if (left <= right) {
      visit(node.left, left, bound, sample, best);
      visit(node.right, right, bound, sample, best);
    } else {
      visit(node.right, right, bound, sample, best);
      visit(node.left, left, bound, sample, best);
    }
  }

  function compile(points, radii) {
    const segments = [];
    let extent = 0, uniform = true;
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      extent = Math.max(extent, Math.abs(x), Math.abs(y));
      if (!i) continue;
      const a = points[i - 1], dx = x - a[0], dy = y - a[1];
      const length = Math.hypot(dx, dy), ra = radii[i - 1], rb = radii[i], delta = rb - ra, k = delta / length;
      const end = length < 1e-9 ? (rb >= ra ? 1 : 0) : Math.abs(delta) >= length ? (delta > 0 ? 1 : 0) : null;
      segments.push({ a, ra, dx, dy, length, delta, k, root: end === null ? Math.sqrt(1 - k * k) : 1, end });
      uniform &&= rb === radii[0];
    }
    const tree = segments.length >= indexThreshold && extent <= maxIndexedCoordinate
      ? hierarchy(points, radii, 0, segments.length)
      : null;
    let x, y, margin, distance, radius, winner, squared, bx, by, overflow;
    function sampleUniform(first, end) {
      const px = x, py = y;
      let nearest = squared, nextX = bx, nextY = by, nextIndex = winner, unscaled = overflow;
      for (let i = first; i < end; i++) {
        const s = segments[i], u = px - s.a[0], v = py - s.a[1];
        const t = s.end === null ? clamp((u * s.dx + v * s.dy) / s.length / s.length) : s.end;
        const qx = u - t * s.dx, qy = v - t * s.dy, d = qx * qx + qy * qy;
        if (d === Infinity) unscaled = Math.min(unscaled, Math.hypot(qx, qy));
        else if (d < nearest || (d === nearest && i < nextIndex)) {
          nearest = d; nextX = qx; nextY = qy; nextIndex = i;
        }
      }
      squared = nearest; bx = nextX; by = nextY; winner = nextIndex; overflow = unscaled;
    }
    function sampleTapered(first, end) {
      const px = x, py = y;
      let nearest = distance, nextRadius = radius, nextIndex = winner;
      for (let i = first; i < end; i++) {
        const s = segments[i], u = px - s.a[0], v = py - s.a[1];
        let t = s.end;
        if (t === null) {
          const along = (u * s.dx + v * s.dy) / s.length;
          const across = Math.abs(u * s.dy - v * s.dx) / s.length;
          t = clamp((along + s.k * across / s.root) / s.length);
        }
        const r = s.ra + t * s.delta;
        const d = Math.hypot(u - t * s.dx, v - t * s.dy) - r;
        if (d < nearest || (d === nearest && d !== Infinity && i < nextIndex)) {
          nearest = d; nextRadius = r; nextIndex = i;
        }
      }
      distance = nearest; radius = nextRadius; winner = nextIndex;
    }
    // The box encloses the centers in a run. A conservative arithmetic margin
    // keeps a neighboring run eligible when its lower bound nearly ties.
    const box = node => Math.max(node.minX - x, x - node.maxX, node.minY - y, y - node.maxY) - margin;
    const bound = uniform ? node => Math.max(0, box(node)) ** 2 : node => box(node) - node.radius;
    const best = uniform ? () => squared : () => distance;
    const sample = uniform ? sampleUniform : sampleTapered;

    return function evaluate(queryX, queryY, wantRadius = false) {
      if (queryX === x && queryY === y) return wantRadius ? radius : distance;
      x = queryX; y = queryY;
      radius = radii[0];
      if (!segments.length) {
        distance = Math.hypot(x - points[0][0], y - points[0][1]) - radius;
      } else {
        squared = overflow = distance = winner = Infinity;
        const reach = tree ? Math.max(Math.abs(x), Math.abs(y), extent) : Infinity;
        if (reach <= maxIndexedCoordinate) {
          margin = (1 + reach) * 1e-12;
          visit(tree, bound(tree), bound, sample, best);
        } else sample(0, segments.length);
        if (uniform) distance = (squared === Infinity ? overflow : Math.hypot(bx, by)) - radius;
      }
      return wantRadius ? radius : distance;
    };
  }
  return Object.freeze({ compile });
})();
if (typeof module !== 'undefined') module.exports = SweptDisc;
