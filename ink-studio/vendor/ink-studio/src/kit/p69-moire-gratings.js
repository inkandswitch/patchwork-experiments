/* Compose grating harmonics before filtering so resolved beats survive minification. */
(function (K) {
  const materials = K.procedural.materials;
  const TAU = 2 * Math.PI, FILTER = .5 * (.4 * TAU) ** 2;
  const MAX_COORD = 1e7, MAX_CONTROL = 1e5, MAX_TERMS = 4096;
  const clamp = n => Math.max(0, Math.min(1, n));
  const bounded = (n, limit) => Number.isFinite(n) && Math.abs(n) <= limit;
  const pair = (v, limit) => Array.isArray(v) && v.length === 2 && bounded(v[0], limit) && bounded(v[1], limit);
  const required = (valid, message) => { if (!valid) throw new RangeError('Gratings: ' + message); };
  const chartPair = value => typeof value === 'number' ? [value, value] : value;

  // cos^(2n)(π phase), with coefficients from the binomial expansion.
  function profile(order) {
    const terms = [];
    let coefficient = 4 ** -order;
    for (let h = -order; h <= order; h++) {
      terms.push({ h, coefficient });
      coefficient *= (order - h) / (order + h + 1);
    }
    return terms;
  }

  function compileLayer(layer, axes) {
    const { kind = 'line', frequency = kind === 'polar' && layer.spokes ? 0 : 1,
      spokes = 0, origin = [0, 0], drift = [0, 0], angle = 0, spin = 0,
      phase = 0, rate = 0, sharpness = 1, opacity = 1 } = layer;
    const dots = kind === 'dot', polar = kind === 'polar';
    required(['line', 'dot', 'polar'].includes(kind) && pair(origin, MAX_COORD) && pair(drift, MAX_CONTROL) &&
      [angle, spin].every(n => bounded(n, MAX_CONTROL)) &&
      Number.isInteger(sharpness) && sharpness >= 1 && sharpness <= 4 && opacity >= 0 && opacity <= 1 &&
      Number.isFinite(opacity) && Number.isInteger(spokes) && Math.abs(spokes) <= 1024 && (polar || spokes === 0),
    'invalid layer shape, transform, sharpness or opacity');
    const frequencies = dots ? chartPair(frequency) : [frequency];
    const phases = dots ? chartPair(phase) : [phase], rates = dots ? chartPair(rate) : [rate];
    required((!dots || pair(frequencies, MAX_CONTROL) && pair(phases, MAX_CONTROL) && pair(rates, MAX_CONTROL)) &&
      frequencies.every(n => bounded(n, MAX_CONTROL) && (n > 0 || polar && n === 0 && spokes !== 0)) &&
      [...phases, ...rates].every(n => bounded(n, MAX_CONTROL)), 'invalid frequency, phase or rate');
    const first = axes.length;
    if (opacity === 0) return null;
    for (const [i, f] of frequencies.entries()) {
      axes.push({ polar, frequency: f, spokes, origin: origin.slice(), drift: drift.slice(),
        angle: angle + i * Math.PI / 2, spin, phase: phases[i], rate: rates[i] });
    }
    const one = profile(sharpness);
    const harmonics = dots ? one.flatMap(a => one.map(b => ({ indices: [a.h, b.h], weight: a.coefficient * b.coefficient })))
      : one.map(a => ({ indices: [a.h], weight: a.coefficient }));
    return { first, harmonics, opacity };
  }

  function spectrum(layers, mode) {
    const signed = mode === 'ink' ? -1 : 1;
    let terms = [{ indices: [], weight: 1 }];
    for (const { first, harmonics, opacity } of layers) {
      required(terms.length * harmonics.length <= MAX_TERMS, 'combined harmonic budget exceeded');
      terms = terms.flatMap(prior => harmonics.map(({ indices, weight }) => {
        const dc = indices.every(h => h === 0);
        const base = dc ? mode === 'ink' ? 1 : 1 - opacity : 0;
        const factors = indices.flatMap((h, i) => h ? [[first + i, h]] : []);
        return { indices: prior.indices.concat(factors), weight: prior.weight * (base + signed * opacity * weight) };
      }));
    }
    // Real terms occur in conjugate pairs. Evaluate each pair using one cosine.
    return terms.filter(term => !term.indices.length || term.indices[0][1] > 0).map(({ indices, weight }) => ({
      indices, weight: weight * (indices.length ? 2 : 1)
    }));
  }

  function pose(axis, time) {
    const { polar, frequency, spokes, origin, drift, spin } = axis;
    const x = origin[0] + time * drift[0], y = origin[1] + time * drift[1];
    const angle = axis.angle + time * spin, phase = axis.phase + time * axis.rate;
    if (polar) return { x, y, frequency, spokes, phase: phase - spokes * angle / TAU };
    const kx = frequency * Math.cos(angle), ky = frequency * Math.sin(angle);
    return { kx, ky, phase: phase - kx * x - ky * y };
  }

  function footprintOf(value) {
    if (value == null) return [0, 0, 0, 0];
    if (typeof value === 'number') {
      required(bounded(value, MAX_COORD) && value >= 0, 'footprint size must be nonnegative and finite');
      return [value, 0, 0, value];
    }
    if (pair(value, MAX_COORD) && value[0] >= 0 && value[1] >= 0) return [value[0], 0, 0, value[1]];
    required(Array.isArray(value) && value.length === 2 && pair(value[0], MAX_COORD) && pair(value[1], MAX_COORD),
      'footprint needs a width, two axis widths, or two chart-space pixel edges');
    return [value[0][0], value[0][1], value[1][0], value[1][1]];
  }

  function compileFrame(axes, terms, time, mode, defaultDetail) {
    const posed = axes.map(axis => pose(axis, time)), polar = posed.filter(axis => axis.kx === undefined);
    const harmonics = terms.map(({ indices, weight }) => {
      let x = 0, y = 0, phase = 0;
      const curved = [];
      for (const [axis, h] of indices) {
        const p = posed[axis];
        phase += h * p.phase;
        if (p.kx === undefined) curved.push([polar.indexOf(p), h]);
        else { x += h * p.kx; y += h * p.ky; }
      }
      return { x, y, phase, weight, curved };
    });

    let lastPixel, affineTerms;
    function attenuation(x, y, ax, ay, bx, by, detail) {
      if (detail === 1 || !ax && !ay && !bx && !by) return 1;
      const a = x * ax + y * ay, b = x * bx + y * by;
      return detail + (1 - detail) * Math.exp(-FILTER * (a * a + b * b));
    }
    function affine(u, v, ax, ay, bx, by, detail) {
      if (!lastPixel || lastPixel[0] !== ax || lastPixel[1] !== ay || lastPixel[2] !== bx ||
        lastPixel[3] !== by || lastPixel[4] !== detail) {
        lastPixel = [ax, ay, bx, by, detail];
        affineTerms = harmonics.flatMap(({ x, y, phase, weight }) => {
          const gain = attenuation(x, y, ax, ay, bx, by, detail);
          return gain > 1e-12 ? [{ x, y, phase, weight: weight * gain }] : [];
        });
      }
      let value = 0;
      for (const { x, y, phase, weight } of affineTerms) value += weight * Math.cos(TAU * ((phase + x * u + y * v) % 1));
      return mode === 'ink' ? 1 - value : value;
    }
    function curvedSample(u, v, ax, ay, bx, by, detail) {
      const gradients = polar.map(({ x, y, frequency, spokes }) => {
        const dx = u - x, dy = v - y, r = Math.hypot(dx, dy);
        const turns = spokes / TAU, radius = Math.max(1e-12, r);
        const phase = frequency * r + turns * Math.atan2(dy, dx);
        const kx = r ? frequency * (dx / r) - turns * (dy / r) / radius : 0;
        const ky = r ? frequency * (dy / r) + turns * (dx / r) / radius : 0;
        return { phase, kx, ky };
      });
      let value = 0;
      for (const term of harmonics) {
        let { x, y } = term, phase = term.phase + x * u + y * v;
        for (const [id, h] of term.curved) {
          const g = gradients[id];
          phase += h * g.phase; x += h * g.kx; y += h * g.ky;
        }
        const gain = attenuation(x, y, ax, ay, bx, by, detail);
        if (gain > 1e-12) value += term.weight * gain * Math.cos(TAU * (phase % 1));
      }
      return mode === 'ink' ? 1 - value : value;
    }

    function sample(u, v, { footprint, detail = defaultDetail } = {}) {
      required(bounded(u, MAX_COORD) && bounded(v, MAX_COORD) && Number.isFinite(detail) && detail >= 0 && detail <= 1,
        'sample needs finite chart coordinates and detail from zero to one');
      const [ax, ay, bx, by] = footprintOf(footprint);
      if (!polar.length) return clamp(affine(u, v, ax, ay, bx, by, detail));
      const span = detail < 1 ? Math.hypot(ax, ay) + Math.hypot(bx, by) : 0;
      if (!span || !polar.some(p => Math.hypot(u - p.x, v - p.y) < span)) {
        return clamp(curvedSample(u, v, ax, ay, bx, by, detail));
      }
      // A first derivative at the polar origin cannot represent a whole pixel.
      // Stratify the filtered portion and keep intentionally unfiltered detail at the center.
      let filtered = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const a = (i + .5) / 4 - .5, b = (j + .5) / 4 - .5;
        filtered += curvedSample(u + a * ax + b * bx, v + a * ay + b * by, ax / 4, ay / 4, bx / 4, by / 4, 0);
      }
      return clamp((1 - detail) * filtered / 16 + (detail ? detail * curvedSample(u, v, 0, 0, 0, 0, 1) : 0));
    }
    return Object.freeze({ time, sample });
  }

  function gratings({ layers, mode = 'ink', detail = 0 } = {}) {
    required((mode === 'ink' || mode === 'product') && Number.isFinite(detail) && detail >= 0 && detail <= 1 &&
      Array.isArray(layers) && layers.length > 0 && layers.length <= 8 && Array.from(layers).every(
        layer => layer && typeof layer === 'object' && !Array.isArray(layer)), 'provide one to eight layers, ink or product mode, and valid detail');
    const axes = [], terms = spectrum(layers.map(layer => compileLayer(layer, axes)).filter(Boolean), mode);
    let last;
    function frame(time = 0) {
      required(bounded(time, MAX_COORD), 'frame time must be finite and bounded');
      if (!last || last.time !== time) last = compileFrame(axes, terms, time, mode, detail);
      return last;
    }
    return Object.freeze({ frame, sample(u, v, { time = 0, ...options } = {}) { return frame(time).sample(u, v, options); } });
  }

  materials.gratings = gratings;
})(KIT);
