/* Intersect two bounded convex plans, keeping a counterclockwise ring. */
(function (K) {
  const P = K.procedural || K.authoring, eps = 1e-9;
  const cross = (ax, az, bx, bz) => ax * bz - az * bx;
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;

  function compact(points) {
    const out = points.filter((point, i) => !i || !near(point, points[i - 1]));
    if (out.length > 1 && near(out[0], out.at(-1))) out.pop();
    return out;
  }

  function area(points) {
    let signed = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const [a, b, c] = [points[0], points[i], points[i + 1]];
      signed += cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
    }
    return signed;
  }

  function sideOf(a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    return q => cross(dx, dz, q[0] - a[0], q[1] - a[1]) / length;
  }

  function normalized(raw) {
    if (!Array.isArray(raw) || raw.length > 256 ||
        !Array.from(raw).every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
      throw TypeError('Convex plans need finite XZ coordinates');
    const points = compact(raw.map(point => point.slice())), signed = area(points);
    if (!Number.isFinite(signed) || Math.abs(signed) <= eps ** 2)
      throw RangeError('Convex plans need a nonzero area');
    if (signed < 0) points.reverse();
    for (let i = 0; i < points.length; i++) {
      const side = sideOf(points[i], points[(i + 1) % points.length]);
      if (points.some(p => side(p) < -eps))
        throw RangeError('Plans must be convex');
    }
    return points;
  }

  function intersectConvexPlans(subject, boundary) {
    const domain = normalized(boundary);
    let points = normalized(subject);
    for (let j = 0; j < domain.length && points.length >= 3; j++) {
      const side = sideOf(domain[j], domain[(j + 1) % domain.length]), out = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const da = side(a), db = side(b), inside = da >= -eps;
        if (inside) out.push(a);
        if (inside !== (db >= -eps)) {
          const t = Math.max(0, Math.min(1, da / (da - db)));
          out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
      }
      points = compact(out);
    }
    return points.length >= 3 && area(points) > eps ** 2 ? points : [];
  }

  P.geometry.intersectConvexPlans = intersectConvexPlans;
})(KIT);
