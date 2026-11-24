/* Unit charts with lifted frames across periodic and orientation-reversing joins. */
const SurfaceChartTopologies = new WeakSet();

(function (K) {
  const P = K.procedural, S = P.surface, V = K.V, TAU = 2 * Math.PI;
  const number = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const vector = (v, n, limit) => Array.isArray(v) && v.length === n && Array.from(v).every(x => number(x, -limit, limit));
  const unit = v => number(v, 0, 1);
  const fraction = v => v - Math.floor(v);
  const check = (valid, message) => { if (!valid) throw new RangeError('Surface chart: ' + message); };

  function topology({ u = 'open', v = 'open' } = {}) {
    check(['open', 'periodic', 'flip-v'].includes(u) && ['open', 'periodic'].includes(v), 'invalid unit chart joins');
    const periodicU = u !== 'open', periodicV = v === 'periodic', twistedU = u === 'flip-v';
    const contains = at => vector(at, 2, 1e7) && (periodicU || unit(at[0])) && (periodicV || unit(at[1]));
    const orientationAt = lap => twistedU && Math.abs(lap % 2) === 1 ? -1 : 1;
    const reverseV = value => periodicV ? -value : 1 - value;

    function canonical(at) {
      check(contains(at), 'coordinates must be finite and within the open chart axes');
      const [a, b] = at, orientation = orientationAt(Math.floor(a));
      const cross = orientation === 1 ? b : reverseV(b);
      return { uv: [periodicU ? fraction(a) : a, periodicV ? fraction(cross) : cross], orientation };
    }
    function liftNear(at, reference, size = [1, 1]) {
      check(contains(reference) && vector(size, 2, 5e5) && size.every(n => n > 0), 'invalid lift reference or chart size');
      const { uv: [a, b] } = canonical(at), [x, y] = reference;
      const lap = periodicU ? Math.round(x - a) : 0;
      const images = periodicU ? [lap, lap - 1, lap + 1] : [0];
      let best, distance = Infinity;
      for (const k of images) {
        let cross = orientationAt(k) === 1 ? b : reverseV(b);
        if (periodicV) cross += Math.round(y - cross);
        const score = Math.hypot((a + k - x) * size[0], (cross - y) * size[1]);
        if (score < distance) {
          best = [a + k, cross];
          distance = score;
        }
      }
      return best;
    }
    const result = Object.freeze({ u, v, periodicU, periodicV, twistedU, canonical, contains, liftNear, orientationAt });
    SurfaceChartTopologies.add(result);
    return result;
  }

  const twistedStrip = topology({ u: 'flip-v' });
  const twistedTube = topology({ u: 'flip-v', v: 'periodic' });
  const openPatch = topology();
  const closedTube = topology({ u: 'periodic' });

  function chart(kind, options, joins, extent, shape) {
    const { origin = [0, 0, 0], id = kind } = options;
    check(typeof id === 'string' && id.length > 0 && vector(origin, 3, 1e6) &&
      extent.every((n, i) => number(n, 0, 1e6 - Math.abs(origin[i]))), 'invalid id, origin, or spatial extent');
    const center = origin.slice(), bounds = P.data.freeze({
      min: center.map((n, i) => n - extent[i]),
      max: center.map((n, i) => n + extent[i])
    });
    function sample(at) {
      const { uv, orientation } = joins.canonical(at), { p, du, dv: across } = shape(...uv);
      const dv = orientation === 1 ? across : V.mul(across, -1);
      const tangent = V.norm(du), n = V.norm(V.cross(tangent, V.norm(dv)));
      return { p: V.add(center, p), n, tangent, bitangent: V.cross(n, tangent), du, dv, uv, orientation };
    }
    function samplePointNormal(at) {
      const { p, n } = sample(at);
      return { p, n };
    }
    return Object.freeze({ id, kind, topology: joins, periodicU: joins.periodicU, periodicV: joins.periodicV,
      data: P.data.freeze({ ...options, id, origin: center }), bounds, sample, samplePointNormal,
      mesh: (settings = {}) => TexturedSurface.grid({ segments: [96, 32], ...settings, point: (u, v) => sample([u, v]).p }) });
  }

  function mobius({ origin, id, radius = 1.5, halfWidth = .45, halfTwists = 1 } = {}) {
    check(number(radius, 1e-4, 1e5) && number(halfWidth, 1e-5, radius * .95) &&
      Number.isInteger(halfTwists) && Math.abs(halfTwists) <= 9 && Math.abs(halfTwists) % 2 === 1,
      'Möbius needs positive radius, a smaller half-width, and an odd number of half-twists');
    const rim = radius + halfWidth;
    return chart('mobius', { origin, id, radius, halfWidth, halfTwists }, twistedStrip, [rim, halfWidth, rim], (u, v) => {
      const a = TAU * u, t = a * halfTwists / 2, c = Math.cos(a), s = Math.sin(a);
      const w = (2 * v - 1) * halfWidth, x = Math.cos(t), y = Math.sin(t), r = radius + w * x;
      const d = -Math.PI * halfTwists * w * y;
      return { p: [r * c, w * y, r * s],
        du: [d * c - TAU * r * s, Math.PI * halfTwists * w * x, d * s + TAU * r * c],
        dv: [2 * halfWidth * x * c, 2 * halfWidth * y, 2 * halfWidth * x * s] };
    });
  }

  function kleinBottle({ origin, id, radius = 1.45, tube = .55 } = {}) {
    check(number(radius, 1e-4, 1e5) && number(tube, 1e-5, .67 * radius),
      'Klein immersion needs a positive radius and a smaller tube scale');
    const extent = Math.SQRT2 * tube, rim = radius + extent;
    return chart('klein', { origin, id, radius, tube }, twistedTube, [rim, extent, rim], (u, v) => {
      const a = TAU * u, b = TAU * v, c = Math.cos(a), s = Math.sin(a);
      const ct = Math.cos(a / 2), st = Math.sin(a / 2), x = tube * Math.sin(b), y = tube * Math.sin(2 * b);
      const radial = ct * x - st * y, lift = st * x + ct * y, r = radius + radial;
      const dx = TAU * tube * Math.cos(b), dy = 2 * TAU * tube * Math.cos(2 * b);
      const dr = ct * dx - st * dy, dh = st * dx + ct * dy;
      return { p: [r * c, lift, r * s], du: [-Math.PI * lift * c - TAU * r * s,
        Math.PI * radial, -Math.PI * lift * s + TAU * r * c], dv: [dr * c, dh, dr * s] };
    });
  }

  function helicoid({ origin, id, radius = 1.65, pitch = 1.5, turns = 2 } = {}) {
    check(number(radius, 1e-5, 1e5) && Number.isFinite(pitch) && number(Math.abs(pitch), 1e-5, 1e5) && number(turns, .01, 48),
      'helicoid needs a positive radius and turn count and a nonzero signed pitch');
    const span = TAU * turns, height = pitch * turns;
    return chart('helicoid', { origin, id, radius, pitch, turns }, openPatch, [radius, Math.abs(height) / 2, radius], (u, v) => {
      const a = (u - .5) * span, r = (2 * v - 1) * radius, c = Math.cos(a), s = Math.sin(a);
      return { p: [r * c, (u - .5) * height, r * s],
        du: [-span * r * s, height, span * r * c], dv: [2 * radius * c, 0, 2 * radius * s] };
    });
  }

  function catenoid({ origin, id, radius = .9, height = 2.7 } = {}) {
    check(number(radius, 1e-5, 1e5) && number(height, 1e-5, 2e5), 'catenoid needs positive waist radius and height');
    const rim = radius * Math.cosh(height / (2 * radius));
    return chart('catenoid', { origin, id, radius, height }, closedTube, [rim, height / 2, rim], (u, v) => {
      const a = TAU * u, h = (v - .5) * height, r = radius * Math.cosh(h / radius), dr = height * Math.sinh(h / radius);
      const c = Math.cos(a), s = Math.sin(a);
      return { p: [r * c, h, r * s], du: [-TAU * r * s, 0, TAU * r * c], dv: [dr * c, height, dr * s] };
    });
  }

  Object.assign(S, { topology, mobius, kleinBottle, helicoid, catenoid });
})(KIT);
