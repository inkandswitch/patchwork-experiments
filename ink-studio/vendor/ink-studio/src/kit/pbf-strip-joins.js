/* Join two equal-width planar strips without extending their end faces into another span. */
(function (K) {
  const P = K.procedural || K.authoring;
  const EPS = 1e-8;
  const vector = p => Array.isArray(p) && p.length === 2 && Array.from(p).every(Number.isFinite);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

  function stripFootprint(start, end, halfWidth, extension = 0) {
    if (![start,end].every(vector) || !Number.isFinite(halfWidth) || halfWidth <= 0 ||
        !Number.isFinite(extension) || extension < 0)
      throw new Error('Strip footprints need finite endpoints, positive width and nonnegative extension');
    const delta = sub(end,start), length = Math.hypot(...delta);
    if (!Number.isFinite(length+extension)) throw new Error('Strip distances must be finite');
    if (length <= EPS) return [];
    const [x,z] = start, [dx,dz] = delta.map(value => value/length);
    const at = (along,side) => [x+along*dx-side*dz,z+along*dz+side*dx];
    const ring = [at(-extension,-halfWidth),at(length+extension,-halfWidth),
      at(length+extension,halfWidth),at(-extension,halfWidth)];
    if (!ring.every(vector)) throw new Error('Strip points must be finite');
    return ring;
  }

  function stripJoin(before, at, after, halfWidth, { maxArcAngle = Math.PI / 8 } = {}) {
    if (![before, at, after].every(vector) || !Number.isFinite(halfWidth) || halfWidth <= 0 ||
        !Number.isFinite(maxArcAngle) || maxArcAngle < Math.PI / 64 || maxArcAngle > Math.PI)
      throw new Error('A strip join needs three finite planar points, positive width and a bounded arc angle');

    const incoming = sub(at, before), outgoing = sub(after, at);
    const a = Math.hypot(...incoming), b = Math.hypot(...outgoing);
    if (!Number.isFinite(a + b)) throw new Error('Strip join distances must be finite');
    if (a <= EPS || b <= EPS) return null;
    const u = incoming.map(x => x / a), v = outgoing.map(x => x / b);
    const cross = u[0] * v[1] - u[1] * v[0], turn = Math.atan2(cross, dot(u, v));
    // Straight and exactly reversed strips have no gap between their ends.
    if (Math.abs(cross) <= EPS) return null;

    const center = at.slice(), bisectorLength = Math.hypot(u[0] + v[0], u[1] + v[1]);
    const normal = u.map((value, i) => (value + v[i]) / bisectorLength);
    const direction = Math.sign(turn), from = Math.atan2(-direction * u[0], direction * u[1]);
    const slices = Math.ceil(Math.abs(turn) / maxArcAngle);
    const exterior = [center.slice()];
    for (let i = 0; i <= slices; i++) {
      const phi = from + turn * i / slices;
      exterior.push([center[0] + halfWidth * Math.cos(phi), center[1] + halfWidth * Math.sin(phi)]);
    }
    if (!exterior.every(vector)) throw new Error('Strip join points must be finite');

    function clip(polygon, side) {
      if ((side !== 'incoming' && side !== 'outgoing') || !Array.isArray(polygon) ||
          polygon.length < 3 || polygon.length > 256 || !Array.from(polygon).every(vector))
        throw new Error('Strip clipping needs a finite polygon and an incoming or outgoing side');
      const sign = side === 'incoming' ? 1 : -1;
      const distances = polygon.map(p => sign * dot(sub(p, center), normal));
      if (distances.every(d => d <= EPS)) return polygon;
      if (distances.every(d => d >= -EPS)) return [];
      const clipped = [];
      for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length, d = distances[i], next = distances[j];
        const p = polygon[i], q = polygon[j];
        if (d <= EPS) clipped.push(p);
        if ((d < -EPS && next > EPS) || (d > EPS && next < -EPS)) {
          const t = d / (d - next);
          clipped.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      return clipped;
    }

    return { exterior, clip };
  }

  Object.assign(P.routes,{stripJoin,stripFootprint});
})(KIT);
