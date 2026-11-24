/* Curvature-driven river migration, neck cutoffs and elevation-aware bank fields. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-8,
    positive = x => Number.isFinite(x) && x > 0,
    nonnegative = x => Number.isFinite(x) && x >= 0,
    limit = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high,
    clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    length = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);
  function valid(route) {
    return route && positive(route.length) && typeof route.sample === 'function';
  }

  function meander(route, {
    spacing = 0.3, iterations = 7, curvatureGain = 0.05, smoothing = 0.12,
    amplitude = 0, wavelength = 4, maxShift = 1.25, seed = 0,
    cutoffDistance = 0, minLoop = 1.5, maxChecks = 600000, allow
  } = {}) {
    if (
      !valid(route) || ![spacing, wavelength, maxShift, minLoop].every(positive) ||
      ![curvatureGain, amplitude, smoothing, cutoffDistance].every(nonnegative) || smoothing > 1 ||
      !limit(iterations, 0, 128) || !limit(maxChecks, 1, 10000000) || !Number.isSafeInteger(seed) ||
      (allow !== undefined && typeof allow !== 'function')
    ) throw new Error('River meanders need a route, migration controls and bounded work');
    const n = Math.max(2, Math.ceil(route.length / spacing));
    if (n > 4096) throw new Error('River meanders exceed their sample budget');
    const phase = 2 * Math.PI * P.data.hash('river-meander', seed) / 4294967296,
      source = Array.from({ length: n + 1 }, (_, i) => route.sample(i / n).point),
      work = { checked: 0, iterations },
      allowed = p => !allow || allow(...p);
    function displaced(i, x, z, base) {
      const [ox, y, oz] = source[i], d = Math.hypot(x - ox, z - oz),
        fraction = d > maxShift ? maxShift / d : 1,
        p = [ox + (x - ox) * fraction, y, oz + (z - oz) * fraction];
      return allowed(p) ? p : base;
    }
    let points = source.map((p, i) => {
      if (!amplitude || i === 0 || i === n) return p;
      const a = source[i - 1], b = source[i + 1], run = length(a, b);
      if (run <= EPS) return p;
      const t = i / n,
        displacement = amplitude * Math.sin(Math.PI * t) * Math.sin(phase + 2 * Math.PI * route.length * t / wavelength);
      return displaced(i, p[0] - displacement * (b[2] - a[2]) / run, p[2] + displacement * (b[0] - a[0]) / run, p);
    });
    for (let pass = 0; pass < iterations; pass++) {
      points = points.map((p, i) => {
        if (i === 0 || i === n) return p;
        const a = points[i - 1], b = points[i + 1],
          u = length(a, p), v = length(p, b), chord = length(a, b);
        if (Math.min(u, v, chord) <= EPS) return p;
        const ax = (p[0] - a[0]) / u, az = (p[2] - a[2]) / u,
          bx = (b[0] - p[0]) / v, bz = (b[2] - p[2]) / v,
          bend = Math.atan2(ax * bz - az * bx, ax * bx + az * bz) * 2 / (u + v),
          change = clamp(-curvatureGain * bend, -spacing * 0.45, spacing * 0.45),
          mx = ((a[0] + b[0]) / 2 - p[0]) * smoothing,
          mz = ((a[2] + b[2]) / 2 - p[2]) * smoothing;
        return displaced(i, p[0] - change * (b[2] - a[2]) / chord + mx, p[2] + change * (b[0] - a[0]) / chord + mz, p);
      });
    }
    function distinct(list) {
      const out = [];
      list.forEach((point, i) => {
        if (!out.length || K.V.dist(out.at(-1), point) > EPS) out.push(point);
        else if (i === list.length - 1) out[out.length - 1] = point;
      });
      return out;
    }
    points = distinct(points);
    const cutoffs = [];
    if (cutoffDistance) {
      for (;;) {
        let best = cutoffDistance, cut;
        const threshold = Math.max(3, Math.ceil(minLoop / spacing));
        for (let i = 0; i < points.length - threshold; i++) {
          for (let j = i + threshold; j < points.length; j++) {
            if (++work.checked > maxChecks) throw new Error('River cutoffs exceed their comparison budget');
            const distance = length(points[i], points[j]);
            if (distance >= best || !allowed(K.V.mul(K.V.add(points[i], points[j]), 0.5))) continue;
            best = distance;
            cut = [i, j];
          }
        }
        if (!cut) break;
        const [i, j] = cut;
        cutoffs.push(P.routes.polyline(points.slice(i, j + 1)));
        points = distinct(points.slice(0, i + 1).concat(points.slice(j)));
      }
    }
    if (points.length < 2) throw new Error('A migrated river must have distinct endpoints');
    return Object.freeze({ route: P.routes.polyline(points), cutoffs: Object.freeze(cutoffs), work: Object.freeze(work) });
  }

  function corridor(routes, height, {
    channelWidth = 0.4, floodWidth = 1.5, maxRise = 0.45, maxSlope = 0.4,
    leveeWidth = 0.42, leveeHeight = 0.16, step = 0.05, waterLevel
  } = {}) {
    if (
      !Array.isArray(routes) || routes.length > 16000 || !routes.every(valid) || typeof height !== 'function' ||
      ![channelWidth, floodWidth, maxRise, maxSlope, leveeWidth, step].every(positive) || floodWidth <= channelWidth ||
      !nonnegative(leveeHeight) || (waterLevel !== undefined && typeof waterLevel !== 'function')
    ) throw new Error('River corridors need routes, a height field and valid bank settings');
    const byId = new Map(),
      lines = [];
    for (const [i, route] of routes.entries()) {
      if (!Array.isArray(route.points) || route.points.length < 2)
        throw new Error('River corridors need polylines with world points');
      const id = String(i);
      byId.set(id, route);
      lines.push({ id, points: route.points.map(([x, , z]) => [x, 0, z]) });
    }
    const index = P.contacts.field(lines),
      fade = u => {
        u = clamp(u, 0, 1);
        return u * u * (3 - 2 * u);
      };
    function sample(x, z) {
      const hit = index.nearest([x, 0, z], Math.max(floodWidth, channelWidth + leveeWidth));
      if (!hit) return { floodplain: 0, levee: 0, river: null };
      const line = byId.get(hit.id),
        a = line.points[hit.segment], b = line.points[hit.segment + 1],
        along = length(a, hit.point) / length(a, b),
        base = a[1] + (b[1] - a[1]) * along,
        river = waterLevel ? waterLevel(base, hit, line) : base,
        ground = height(x, z),
        rising = ground - river,
        yx = (height(x + step, z) - height(x - step, z)) / (2 * step),
        yz = (height(x, z + step) - height(x, z - step)) / (2 * step),
        grade = Math.hypot(yx, yz);
      if (![river, rising, grade].every(Number.isFinite)) throw new Error('River corridor height inputs must be finite');
      const usable = fade(1 - grade / maxSlope) * fade(1 - Math.max(0, rising) / maxRise),
        floodplain = usable * fade((floodWidth - hit.distance) / (floodWidth - channelWidth)),
        embankment = (hit.distance - channelWidth) / leveeWidth,
        levee = embankment > 0 && embankment < 1 ? leveeHeight * usable * Math.sin(Math.PI * embankment) ** 2 : 0;
      return { floodplain, levee, river, distance: hit.distance, slope: grade };
    }
    return Object.freeze({
      sample,
      floodplain: (x, z) => sample(x, z).floodplain,
      levee: (x, z) => sample(x, z).levee,
      height: (x, z) => height(x, z) + sample(x, z).levee
    });
  }

  Object.assign(P.hydrology, { meander, corridor });
})(KIT);
