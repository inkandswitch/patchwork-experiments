/* Fixed-clock trajectories and visit density for continuous flows and discrete maps. */
(function (K) {
  const P = K.procedural, { V, M, clamp } = K,
    integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi,
    finite = (n, max) => Number.isFinite(n) && Math.abs(n) <= max,
    dimensions = Object.freeze({ xy: [0, 1], xz: [0, 2], yz: [1, 2], xyz: [0, 1, 2] }),
    systems = MathFields.systems;
  const rk4 = MathFields.rk4;

  function trace({ family = 'lorenz', parameters = {}, start, steps, burnIn, dt, stride = 1,
    escape = 1e5, pose } = {}) {
    if (typeof family !== 'string' || !Object.hasOwn(systems, family)) throw new RangeError('Unknown attractor family');
    const recipe = systems[family], flow = recipe.dt !== undefined, dimension = flow ? 3 : 2;
    steps ??= flow ? 4000 : 60000;
    burnIn ??= flow ? 1000 : 100;
    dt ??= recipe.dt ?? 1;
    start ??= recipe.start;
    if (!integer(steps, 1, 300000) || !integer(burnIn, 0, 25000) || !integer(stride, 1, steps) ||
      (flow ? !finite(dt, .25) || dt < 1e-6 : dt !== 1) || !finite(escape, 1e7) || escape <= 0 ||
      !Array.isArray(start) || start.length !== dimension || !Array.from(start).every(v => finite(v, escape)))
      throw new RangeError('Invalid attractor start, step, stride, escape limit or sample budget');
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) ||
      Object.entries(parameters).some(([key, value]) => !Object.hasOwn(recipe.parameters, key) || !finite(value, 1e3)))
      throw new RangeError('Attractor parameters must be recognized finite coefficients');

    const field = recipe.field({ ...recipe.parameters, ...parameters }),
      advance = flow ? p => rk4(field, p, dt) : p => field(...p),
      transform = pose === undefined ? null : P.transforms.local(pose),
      points = [], times = [], speeds = [], distances = [];
    let p = [start[0], start[1], start[2] ?? 0], warmed = 0, completed = 0, status = 'complete';
    function next() {
      const q = advance(p);
      if (!q.every(v => finite(v, escape))) { status = 'escaped'; return false; }
      p = q;
      return true;
    }
    function record() {
      const position = transform ? V.add(M.app(transform.R, p), transform.t) : p.slice(),
        dp = flow ? field(...p) : V.sub(field(...p), p),
        speed = V.len(transform ? M.app(transform.R, dp) : dp);
      if (!position.every(v => finite(v, 1e7)) || !Number.isFinite(speed))
        throw new RangeError('Attractor pose moved the orbit outside finite scene coordinates');
      const previous = points.at(-1);
      points.push(position);
      speeds.push(speed);
      times.push(completed * dt);
      distances.push(previous ? distances.at(-1) + V.dist(previous, position) : 0);
    }

    while (warmed < burnIn && next()) warmed++;
    if (status === 'complete') {
      record();
      while (completed < steps && next()) {
        completed++;
        if (completed % stride === 0) record();
      }
      if (times.at(-1) !== completed * dt) record();
    }

    const duration = completed * dt, length = distances.at(-1) ?? 0,
      bounds = points.length ? P.spatial.boxOf(points) : null;

    function segment(time) {
      let lo = 0, hi = times.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= time) lo = mid;
        else hi = mid;
      }
      return lo;
    }

    function at(time) {
      if (!Number.isFinite(time)) throw new RangeError('Orbit sample time must be finite');
      if (!points.length) return null;
      const t = clamp(time, 0, duration);
      if (points.length === 1) return { p: points[0].slice(), tan: [0, 0, 0], speed: speeds[0], distance: 0, time: t };
      const lo = segment(t), hi = lo + 1;
      const q = (t - times[lo]) / (times[hi] - times[lo]),
        delta = V.sub(points[hi], points[lo]), d = V.len(delta);
      return { p: V.lerp(points[lo], points[hi], q), tan: d ? V.mul(delta, 1 / d) : [0, 0, 0],
        time: t, speed: K.mix(speeds[lo], speeds[hi], q), distance: K.mix(distances[lo], distances[hi], q) };
    }

    function path({ from = 0, to = duration, maxPoints = 4097, up } = {}) {
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from || to > duration ||
        !integer(maxPoints, 2, 4097)) throw new RangeError('Invalid orbit path range or point limit');
      if (from === to) return null;
      const first = segment(from) + 1, last = segment(to),
        end = last + Number(times[last] < to), count = end - first + 2;
      const rows = count <= maxPoints ? [at(from).p, ...points.slice(first, end), at(to).p] :
        Array.from({ length: maxPoints }, (_, i) => at(i === maxPoints - 1 ? to : K.mix(from, to, i / (maxPoints - 1))).p);
      return rows.some(p => V.dist(rows[0], p) > 1e-12) ? K.curve.path(rows, { closed: false, up }) : null;
    }

    function density({ projection = flow ? 'xyz' : 'xy', bounds: extent, resolution, exposure } = {}) {
      if (typeof projection !== 'string' || !Object.hasOwn(dimensions, projection))
        throw new RangeError('Orbit density projection must be xyz, xy, xz, or yz');
      const axes = dimensions[projection], [a, b, c] = axes;
      if (extent === undefined && bounds) {
        const pad = Math.max(.001, ...axes.map(i => (bounds.max[i] - bounds.min[i]) * .025));
        extent = { min: axes.map(i => bounds.min[i] - pad), max: axes.map(i => bounds.max[i] + pad) };
      }
      return DensityHistogram.build({ dimension: axes.length, bounds: extent, resolution, exposure, channel: 'speed' }, emit => {
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          emit(p[a], p[b], c === undefined ? 0 : p[c], speeds[i]);
        }
      });
    }

    return P.data.freeze({ family, kind: flow ? 'flow' : 'map', dimension, status, dt, stride,
      warmed, completed, length, duration, bounds, points, times, speeds, distances, at, path, density });
  }

  P.attractors = Object.freeze({ trace, families: Object.freeze(Object.keys(systems)) });
})(KIT);
