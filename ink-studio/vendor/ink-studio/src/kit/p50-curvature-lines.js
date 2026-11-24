/* Principal curvature and projected midpoint integration on smooth surfaces. */
(function (K) {
  const P = K.procedural, V = K.V;
  const vector = (v, n) => (Array.isArray(v) || ArrayBuffer.isView(v)) &&
    v.length === n && Array.from(v).every(Number.isFinite);
  const positive = n => Number.isFinite(n) && n > 0;
  const tangentTo = (v, n) => V.mad(v, n, -V.dot(v, n));
  const offset = (p, axis, amount) => p.map((x, i) => x + (i === axis ? amount : 0));

  function tolerances(detail, absoluteGap, relativeGap) {
    if (!positive(detail) || !Number.isFinite(absoluteGap) || absoluteGap < 0 ||
        !Number.isFinite(relativeGap) || relativeGap < 0)
      throw new RangeError('Curvature needs a positive difference interval and nonnegative gap tolerances');
    return { absoluteGap, relativeGap };
  }

  // Eigenvalues of dN in an orthonormal basis. The outward sphere is positive.
  function principal(at, u, v, a, b, c, { absoluteGap, relativeGap }) {
    if (![a, b, c].every(Number.isFinite)) return null;
    const mean = a / 2 + c / 2, radius = Math.hypot((a - c) / 2, b);
    const min = mean - radius, max = mean + radius, gap = 2 * radius;
    let directions = null;
    if (gap > absoluteGap + relativeGap * Math.max(Math.abs(min), Math.abs(max))) {
      const angle = Math.atan2(2 * b, a - c) / 2;
      const x = Math.cos(angle), y = Math.sin(angle);
      directions = { max: V.add(V.mul(u, x), V.mul(v, y)), min: V.add(V.mul(u, -y), V.mul(v, x)) };
    }
    return { ...at, min, max, mean, gaussian: min * max, gap, directions };
  }

  function tracer(locate, advance) {
    const sample = seed => P.data.freeze(locate(seed));

    function trace(seed, { family = 'max', direction = 'both', heading, step = .05, length = 4,
      maxSteps = 4096, mask = () => true, closeDistance = 0 } = {}) {
      if (!['max', 'min'].includes(family) || !['both', 'forward', 'backward'].includes(direction) ||
          (heading !== undefined && (!vector(heading, 3) || !positive(V.len(heading)))) ||
          !positive(step) || !positive(length) || !Number.isSafeInteger(maxSteps) || maxSteps < 1 ||
          typeof mask !== 'function' || !Number.isFinite(closeDistance) || closeDistance < 0 || closeDistance > step)
        throw new RangeError('Curvature trace needs a family, direction, positive step, length and step budget');

      const root = sample(seed);
      let samples = [], closed = false, start = null, end = null;
      const includes = hit => mask(hit.point, hit);
      if (!root || !includes(root)) {
        start = end = root ? 'mask' : 'surface';
      } else if (!root.directions) {
        start = end = 'umbilic';
      } else {
        const reference = root.directions[family];
        const first = heading && V.dot(heading, reference) < 0 ? V.mul(reference, -1) : reference;
        function axis(hit, tangent, last) {
          // Lifted chart normals can reverse relative to canonical UVs. Their
          // signed curvature ordering stays continuous in the lifted frame.
          const line = hit.directions[family];
          const transported = P.surfaceGrowth.transport(tangent, last.normal, hit.normal);
          const alignment = V.dot(line, transported);
          if (Math.abs(alignment) < .7) return null;
          return alignment < 0 ? V.mul(line, -1) : line;
        }

        function walk(initial) {
          let at = root, tangent = initial, remaining = length, reason = 'steps';
          const rows = [{ ...root, tangent }];
          for (let i = 0; i < maxSteps && remaining > step * 1e-5; i++) {
            let accepted = false;
            for (let h = Math.min(step, remaining); h >= Math.min(step, remaining) / 128; h *= .5) {
              const middle = advance(at, at, tangent, h / 2);
              if (!middle || !includes(middle)) { reason = middle ? 'mask' : 'surface'; continue; }
              if (!middle.directions) { reason = 'umbilic'; continue; }
              const midTangent = axis(middle, tangent, at);
              if (!midTangent) { reason = 'step'; continue; }
              const next = advance(at, middle, midTangent, h);
              if (!next || !includes(next)) { reason = next ? 'mask' : 'surface'; continue; }
              if (!next.directions) { reason = 'umbilic'; continue; }
              const delta = V.sub(next.point, at.point), travel = V.len(delta);
              if (travel < h * .25 || travel > h * 1.25 || V.dot(delta, tangent) < h * .45) {
                reason = 'step';
                continue;
              }
              const nextTangent = axis(next, midTangent, middle);
              if (!nextTangent) { reason = 'step'; continue; }
              if (closeDistance && length - remaining > 4 * step &&
                  V.dot(initial, nextTangent) > .96 && V.dot(root.normal, next.normal) > .96 &&
                  V.dist(next.point, root.point) <= closeDistance) {
                const join = V.dist(at.point, root.point) <= 1.5 * h ? at : next;
                if (join === next) rows.push({ ...next, tangent: nextTangent });
                return { rows, reason: 'closed' };
              }
              rows.push({ ...next, tangent: nextTangent });
              at = next;
              tangent = nextTangent;
              remaining -= h;
              accepted = true;
              break;
            }
            if (!accepted) return { rows, reason };
            reason = 'steps';
          }
          return { rows, reason: remaining <= step * 1e-5 ? 'length' : reason };
        }

        const forward = direction === 'backward' ? null : walk(first);
        const backward = direction === 'forward' || forward?.reason === 'closed' ? null : walk(V.mul(first, -1));
        closed = forward?.reason === 'closed' || backward?.reason === 'closed';
        if (forward?.reason === 'closed') {
          samples = forward.rows;
          end = forward.reason;
        } else if (backward?.reason === 'closed') {
          samples = backward.rows;
          end = backward.reason;
        } else if (direction === 'both') {
          samples = backward.rows.slice(1).reverse().map(row => ({ ...row, tangent: V.mul(row.tangent, -1) }))
            .concat(forward.rows);
          start = backward.reason;
          end = forward.reason;
        } else {
          const arm = forward ?? backward;
          samples = arm.rows;
          end = arm.reason;
        }
      }

      let distance = 0;
      samples = samples.map((row, i) => {
        if (i) distance += V.dist(samples[i - 1].point, row.point);
        return { ...row, distance, side: V.cross(row.normal, row.tangent) };
      });
      const path = samples.length > 1
        ? K.curve.path(samples.map(row => row.point), { closed, up: samples[0].normal }) : null;
      function frame(d) {
        if (!Number.isFinite(d)) throw new RangeError('Curvature frame distance must be finite');
        if (!samples.length) return null;
        let station = 0;
        if (path) station = closed
          ? ((d % path.length) + path.length) % path.length
          : Math.max(0, Math.min(path.length, d));
        let lo = 0, hi = samples.length;
        while (hi - lo > 1) {
          const mid = (lo + hi) >>> 1;
          if (samples[mid].distance <= station) lo = mid;
          else hi = mid;
        }
        const a = samples[lo], b = samples[hi] ?? (closed ? samples[0] : a);
        const span = b === samples[0] && closed ? path.length - a.distance : b.distance - a.distance;
        const t = span > 0 ? (station - a.distance) / span : 0;
        const point = V.lerp(a.point, b.point, t), normal = V.norm(V.lerp(a.normal, b.normal, t));
        const tangent = V.norm(tangentTo(V.lerp(a.tangent, b.tangent, t), normal));
        return { point, normal, tangent, side: V.cross(normal, tangent), distance: station };
      }

      return P.data.freeze({ samples, path, frame, closed, start, end });
    }

    return Object.freeze({ sample, trace });
  }

  function chart(carrier, { interval = 1e-4, absoluteGap = 1e-5, relativeGap = 1e-3 } = {}) {
    const gap = tolerances(interval, absoluteGap, relativeGap);
    if (!carrier || typeof carrier.sample !== 'function' || interval > .25)
      throw new RangeError('Curvature chart needs a normalized surface sampler and a UV interval at most 0.25');
    const topology = carrier.topology || P.surface.topology({
      u: carrier.periodicU ? 'periodic' : 'open', v: carrier.periodicV ? 'periodic' : 'open'
    });
    if (typeof topology.contains !== 'function' || typeof topology.canonical !== 'function')
      throw new RangeError('Curvature chart topology needs contains and canonical queries');

    function read(lift) {
      // Native topologies implement the lifted frame themselves. Ordinary
      // periodic samplers which only accept unit coordinates receive a wrap.
      const source = carrier.sample(carrier.topology ? lift : topology.canonical(lift).uv);
      if (!source || !vector(source.p, 3) || !vector(source.n, 3) || !positive(V.len(source.n))) return null;
      return { point: Array.from(source.p), normal: V.mul(source.n, 1 / V.len(source.n)), du: source.du, dv: source.dv };
    }

    function derivative(lift, axis, center) {
      const minus = offset(lift, axis, -interval), plus = offset(lift, axis, interval);
      if (topology.contains(minus) && topology.contains(plus)) {
        const a = read(minus), b = read(plus);
        return a && b && ['point', 'normal'].map(key => V.mul(V.sub(b[key], a[key]), 1 / (2 * interval)));
      }
      const signed = topology.contains(plus) ? interval : -interval;
      const a = read(offset(lift, axis, signed)), b = read(offset(lift, axis, signed * 2));
      return a && b && ['point', 'normal'].map(key =>
        V.mul(V.sub(V.mul(V.sub(a[key], center[key]), 4), V.sub(b[key], center[key])), 1 / (2 * signed)));
    }

    function locate(seed) {
      if (!vector(seed, 2)) throw new RangeError('Curvature chart seeds need finite UV coordinates');
      const lift = Array.from(seed);
      if (!topology.contains(lift)) return null;
      const hit = read(lift);
      if (!hit) return null;
      const u = derivative(lift, 0, hit), v = derivative(lift, 1, hit);
      if (!u || !v) return null;
      const { uv, orientation } = topology.canonical(lift), { point, normal } = hit;
      const du = vector(hit.du, 3) ? Array.from(hit.du) : u[0];
      const dv = vector(hit.dv, 3) ? Array.from(hit.dv) : v[0];
      const across = tangentTo(du, normal), d = V.len(across), e = V.len(dv);
      if (!positive(d) || !positive(e)) return null;
      const e1 = V.mul(across, 1 / d), e2 = V.cross(normal, e1);
      const span = V.dot(dv, e2);
      if (Math.abs(span) <= 1e-5 * e) return null;
      const dN1 = V.mul(u[1], 1 / d);
      const dN2 = V.mul(V.mad(v[1], dN1, -V.dot(dv, e1)), 1 / span);
      const a = V.dot(e1, dN1), b = (V.dot(e2, dN1) + V.dot(e1, dN2)) / 2, c = V.dot(e2, dN2);
      return principal({ point, normal, du, dv, uv, lift, orientation }, e1, e2, a, b, c, gap);
    }

    const advance = (at, frame, heading, h) => {
      const velocity = SurfaceVelocityProjection(frame.du, frame.dv, heading);
      return locate(at.lift.map((p, i) => p + h * velocity[i]));
    };
    return tracer(locate, advance);
  }

  function implicit(field, { interval = .001, absoluteGap = 1e-5, relativeGap = 1e-3,
    maxProjection = .5, projectionIterations = 12, projectionTolerance = 1e-7, bounds } = {}) {
    const gap = tolerances(interval, absoluteGap, relativeGap);
    if (typeof field !== 'function' || !positive(maxProjection) || !positive(projectionTolerance) ||
        !Number.isSafeInteger(projectionIterations) || projectionIterations < 1 ||
        bounds !== undefined && (!vector(bounds?.min, 3) || !vector(bounds?.max, 3) ||
        !Array.from(bounds.min).every((p, i) => p < bounds.max[i])))
      throw new RangeError('Implicit curvature needs a scalar field, positive projection settings and valid optional bounds');
    const limits = bounds && { min: Array.from(bounds.min), max: Array.from(bounds.max) };
    const within = p => !limits || p.every((x, i) => x >= limits.min[i] && x <= limits.max[i]);

    function gradient(p) {
      const low = p.map((_x, i) => field(...offset(p, i, -interval)));
      const high = p.map((_x, i) => field(...offset(p, i, interval)));
      const g = high.map((x, i) => (x - low[i]) / (2 * interval)), norm = V.len(g);
      return positive(norm) ? { g, norm, low, high } : null;
    }

    function locate(seed, limit = maxProjection) {
      if (!vector(seed, 3)) throw new RangeError('Implicit curvature seeds need finite XYZ coordinates');
      let point = Array.from(seed), travel = 0;
      for (let i = 0; i <= projectionIterations; i++) {
        const f = field(...point), deriv = gradient(point);
        if (!Number.isFinite(f) || !deriv) return null;
        const { g, norm, low, high } = deriv, distance = f / norm, normal = V.mul(g, 1 / norm);
        if (Math.abs(distance) <= projectionTolerance) {
          if (!within(point)) return null;
          const hessian = low.map((x, j) => {
            const row = [0, 0, 0];
            row[j] = (high[j] - f + (x - f)) / interval ** 2;
            return row;
          });
          for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
            const p = offset(point, a, interval), m = offset(point, a, -interval);
            const cross = (field(...offset(p, b, interval)) - field(...offset(p, b, -interval)) -
              (field(...offset(m, b, interval)) - field(...offset(m, b, -interval)))) / (4 * interval ** 2);
            hessian[a][b] = hessian[b][a] = cross;
          }
          const up = Math.abs(normal[1]) > .9 ? [1, 0, 0] : [0, 1, 0];
          const u = V.norm(V.cross(up, normal)), v = V.cross(normal, u);
          const shape = (a, b) => V.dot(a, hessian.map(row => V.dot(row, b))) / norm;
          return principal({ point, normal }, u, v, shape(u, u), shape(u, v), shape(v, v), gap);
        }
        travel += Math.abs(distance);
        if (travel > limit) return null;
        point = V.mad(point, normal, -distance);
        if (!vector(point, 3)) return null;
      }
      return null;
    }

    return tracer(locate, (at, _frame, heading, h) =>
      locate(V.mad(at.point, heading, h), Math.min(maxProjection, h * .75)));
  }

  P.surface.curvature = Object.freeze({ chart, implicit });
})(KIT);
