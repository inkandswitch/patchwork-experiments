/* Gravity-plane spans independent of construction, ownership or renderer.
   Sag is the vertical distance below the endpoint chord at horizontal midpoint. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    finite = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
    clamp = t => Math.max(0, Math.min(1, t));
  function catenary(start, end, options = {}) {
    if (!finite(start) || !finite(end) || !Number.isFinite(V.dist(start, end)) || V.dist(start, end) < 1e-7)
      throw new Error('Flexible spans need distinct finite endpoints');
    const gravity = options.gravity || [0, -1, 0],
      sag = options.sag ?? 0;
    if (
      !finite(gravity) ||
      !Number.isFinite(V.len(gravity)) ||
      V.len(gravity) < 1e-7 ||
      !Number.isFinite(sag) ||
      sag < 0
    )
      throw new Error('Flexible spans need nonnegative sag and a finite gravity direction');
    const a0 = start.slice(),
      b0 = end.slice(),
      up = V.mul(V.norm(gravity), -1),
      delta = V.sub(b0, a0),
      rise = V.dot(delta, up),
      horizontal = V.sub(delta, V.mul(up, rise)),
      run = V.len(horizontal),
      chord = V.len(delta),
      axis =
        run > 1e-7 ? V.mul(horizontal, 1 / run) : V.norm(V.cross(Math.abs(up[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1], up)),
      side = V.norm(V.cross(up, axis));
    if (sag > chord * 2) throw new Error('Flexible span sag exceeds twice its chord');
    let q = 0,
      a = 0,
      m = 0,
      x0 = 0,
      s0 = 0,
      arc = chord;
    const straight = sag < 1e-7 || run < 1e-7;
    if (!straight) {
      const drop = q => {
        const w = 2 * Math.sinh(q / 2) ** 2;
        return Math.hypot((run * w) / (2 * q), (rise * w) / (2 * Math.sinh(q)));
      };
      let lo = 0,
        hi = 1;
      while (drop(hi) < sag && hi < 32) hi *= 2;
      for (let i = 0; i < 64; i++) {
        const mid = (lo + hi) / 2;
        if (drop(mid) < sag) lo = mid;
        else hi = mid;
      }
      q = (lo + hi) / 2;
      a = run / (2 * q);
      m = Math.asinh(rise / (2 * a * Math.sinh(q)));
      x0 = run / 2 - a * m;
      s0 = Math.sinh(-x0 / a);
      arc = 2 * a * Math.cosh(m) * Math.sinh(q);
    }
    function sample(value) {
      if (!Number.isFinite(value)) throw new Error('Flexible span sampling needs a finite arc coordinate');
      const t = clamp(value);
      let point, tangent;
      if (straight) {
        point = V.mad(a0, delta, t);
        tangent = V.mul(delta, 1 / chord);
      } else {
        const x = x0 + a * Math.asinh(s0 + (t * arc) / a),
          u = (x - x0) / a,
          v = -x0 / a,
          y = 2 * a * Math.sinh((u + v) / 2) * Math.sinh((u - v) / 2);
        point = V.add(a0, V.add(V.mul(axis, x), V.mul(up, y)));
        tangent = V.norm(V.add(axis, V.mul(up, Math.sinh(u))));
      }
      if (t === 0) point = a0.slice();
      if (t === 1) point = b0.slice();
      return { point, tangent, side: side.slice(), normal: V.norm(V.cross(side, tangent)), t };
    }
    function closest(point) {
      if (!finite(point)) throw new Error('Flexible span projection needs a finite point');
      let best = 0,
        distance = Infinity;
      for (let i = 0; i <= 32; i++) {
        const d = V.dist(sample(i / 32).point, point);
        if (d < distance) {
          best = i;
          distance = d;
        }
      }
      let lo = Math.max(0, (best - 1) / 32),
        hi = Math.min(1, (best + 1) / 32);
      for (let i = 0; i < 40; i++) {
        const a = lo + (hi - lo) / 3,
          b = hi - (hi - lo) / 3;
        if (V.dist(sample(a).point, point) < V.dist(sample(b).point, point)) hi = b;
        else lo = a;
      }
      const at = sample((lo + hi) / 2);
      return Object.assign(at, { distance: V.dist(at.point, point) });
    }
    const extrema = [a0, b0];
    if (!straight)
      for (let i = 0; i < 3; i++)
        if (Math.abs(up[i]) > 1e-12) {
          const x = x0 + a * Math.asinh(-axis[i] / up[i]);
          if (x > 0 && x < run) extrema.push(sample((a * (Math.sinh((x - x0) / a) - s0)) / arc).point);
        }
    return Object.freeze({
      length: arc,
      run,
      rise,
      sag: straight ? 0 : sag,
      straight,
      sample,
      closest,
      bounds: A.spatial.boxOf(extrema)
    });
  }
  A.spans = { catenary };
})(KIT);
