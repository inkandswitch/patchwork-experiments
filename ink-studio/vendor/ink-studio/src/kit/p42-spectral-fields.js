/* Analytic spectral fields, membrane modes and bounded spectral measurement. */
(function (K) {
  const P = K.procedural, { freeze } = P.data, TAU = Math.PI * 2;
  const names = Object.freeze(['signed', 'quadrature', 'magnitude', 'phase', 'energy']);
  const finite = Number.isFinite, number = (n, lo, hi) => finite(n) && n >= lo && n <= hi;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const tuple = (p, count, valid = finite) => Array.isArray(p) && p.length === count && Array.from(p).every(valid);
  const record = v => v != null && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const sequence = v => Array.isArray(v) || ArrayBuffer.isView(v) && Number.isInteger(v.length);
  const idOK = id => typeof id === 'string' && /^[\w.-]{1,64}$/.test(id);
  const check = (ok, message) => { if (!ok) throw new RangeError('Spectral field: ' + message); };
  const coordinate = n => number(n, -1e6, 1e6);
  const vector = n => n.map(() => 0);
  const timePhase = (time, hz, phase) => TAU * ((time * hz) % 1) + phase % TAU;

  function domain(raw, dimensions) {
    const { min, max } = raw ?? {};
    check(tuple(min, dimensions, coordinate) && tuple(max, dimensions, coordinate) &&
      min.every((lo, i) => max[i] - lo >= 1e-5), 'expected finite increasing chart bounds');
    return freeze({ min: min.slice(), max: max.slice() });
  }

  function controls(raw, i, defaults = {}) {
    check(record(raw), 'each mode needs a record');
    const { id = 'mode-' + (i + 1), amplitude = 1, phase = 0, frequency = defaults.frequency ?? 0 } = raw;
    check(idOK(id) && number(amplitude, -1e6, 1e6) && coordinate(phase) && coordinate(frequency),
      'mode needs a valid ID and bounded amplitude, frequency and phase');
    return { id, frequency, amplitude, phase };
  }

  const quadrature = Array.from({ length: 128 }, (_, i) => [TAU * i / 128, Math.sin(TAU * i / 128)]);
  const roots = new Map();
  function bessel(order, x) {
    if (x <= 1) {
      let initial = 1;
      for (let i = 1; i <= order; i++) initial *= x / (2 * i);
      let sum = initial;
      for (let i = 1, term = initial; i <= 12; i++) {
        term *= -x * x / (4 * i * (order + i));
        sum += term;
      }
      return sum;
    }
    let sum = 0;
    for (const [angle, sine] of quadrature) sum += Math.cos(order * angle - x * sine);
    return sum / quadrature.length;
  }
  function root(order, radial) {
    const key = order + ':' + radial;
    if (roots.has(key)) return roots.get(key);
    let left = order, a = bessel(order, left), count = 0;
    for (let right = left + Math.PI / 8; right <= 64; right += Math.PI / 8) {
      const value = bessel(order, right);
      if ((a > 0) !== (value > 0)) {
        count++;
        let lo = left, hi = right;
        for (let i = 0; i < 45; i++) {
          const mid = (lo + hi) / 2;
          if ((a > 0) === (bessel(order, mid) > 0)) lo = mid;
          else hi = mid;
        }
        roots.set(order + ':' + count, (lo + hi) / 2);
        if (count === radial) return roots.get(key);
      }
      left = right; a = value;
    }
    throw new RangeError('Spectral field: Bessel root exceeds the supported band');
  }

  const radialTables = new Map();
  function radialFunction(m, zero) {
    const key = m + ':' + zero;
    if (radialTables.has(key)) return radialTables.get(key);
    const steps = 512, values = new Float64Array(steps + 1), slopes = new Float64Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      const x = zero * i / steps;
      values[i] = i === steps ? 0 : bessel(m, x);
      const derivative = m ? (bessel(m - 1, x) - bessel(m + 1, x)) * .5 : -bessel(1, x);
      slopes[i] = derivative * zero / steps;
    }
    function evaluate(radius, diff) {
      const x = Math.min(steps, radius * steps), i = Math.min(steps - 1, Math.floor(x)), t = x - i;
      const p = values[i], q = values[i + 1], a = slopes[i], b = slopes[i + 1];
      const u = a + b + 2 * (p - q), v = 3 * (q - p) - 2 * a - b;
      return diff ? ((3 * u * t + 2 * v) * t + a) * steps : ((u * t + v) * t + a) * t + p;
    }
    radialTables.set(key, evaluate);
    return evaluate;
  }

  function fourier({ bounds: box, terms } = {}) {
    const dimensions = box?.min?.length ?? 2;
    check([2, 3].includes(dimensions), 'Fourier fields need two or three chart dimensions');
    const bounds = domain(box ?? { min: [0, 0], max: [1, 1] }, dimensions);
    const span = bounds.max.map((n, j) => n - bounds.min[j]);
    const modes = readModes(terms, (term, index) => {
      const info = controls(term, index), { cycles, spatialPhase = 0, kind = 'traveling' } = term;
      check(tuple(cycles, dimensions, n => number(n, -128, 128)) && coordinate(spatialPhase) &&
        ['traveling', 'standing'].includes(kind), 'Fourier terms need bounded chart cycles and a traveling or standing kind');
      const wavenumbers = cycles.map((k, i) => TAU * k / span[i]);
      const angle = point => wavenumbers.reduce((sum, k, i) => sum + k * (point[i] - bounds.min[i]), spatialPhase % TAU);
      return { info: { ...info, cycles: cycles.slice(), spatialPhase, kind }, traveling: kind === 'traveling',
        angle, wavenumbers, shape: (p, diff) => {
          const t = angle(p);
          return diff ? wavenumbers.map(k => -Math.sin(t) * k) : Math.cos(t);
        } };
    });
    return field(bounds, modes);
  }

  function readModes(input, build) {
    check(Array.isArray(input) && integer(input.length, 1, 24), 'expected between 1 and 24 modes');
    const modes = Array.from(input, build);
    check(new Set(modes.map(({ info }) => info.id)).size === modes.length, 'mode IDs must be unique');
    return modes;
  }

  function membrane({ shape = 'rectangle', bounds: box, center = [0, 0], radius = 1,
    edge = 'fixed', speed = 1, modes: input } = {}) {
    check(['rectangle', 'disk'].includes(shape) && ['fixed', 'free'].includes(edge) && number(speed, 1e-5, 1e5),
      'invalid membrane shape, edge or wave speed');
    if (shape === 'disk') {
      check(edge === 'fixed' && tuple(center, 2, coordinate) && number(radius, 1e-4, 1e5) && box === undefined,
        'disk membranes need a center and radius and a fixed edge');
      const c = center.slice();
      const bounds = domain({ min: c.map(x => x - radius), max: c.map(x => x + radius) }, 2);
      const modes = readModes(input, (raw, index) => {
        const { m, n, angle = 0 } = raw ?? {};
        check(integer(m, 0, 12) && integer(n, 1, 8) && coordinate(angle), 'disk mode needs bounded angular and radial indices');
        const zero = root(m, n), radial = radialFunction(m, zero);
        const naturalFrequency = speed * zero / (TAU * radius);
        const info = controls(raw, index, { frequency: naturalFrequency });
        function basis(p, diff) {
          const x = (p[0] - c[0]) / radius, y = (p[1] - c[1]) / radius, r = Math.hypot(x, y);
          if (!r) {
            if (!diff) return Number(m === 0);
            return m === 1 ? [Math.cos(angle) * zero / (2 * radius), Math.sin(angle) * zero / (2 * radius)] : [0, 0];
          }
          const t = m * (Math.atan2(y, x) - angle), v = radial(r, false), cos = Math.cos(t);
          if (!diff) return v * cos;
          const dr = cos * radial(r, true) / (radius * r), da = -m * v * Math.sin(t) / (radius * r * r);
          return [dr * x - da * y, dr * y + da * x];
        }
        return { info: { ...info, m, n, angle, root: zero, naturalFrequency, kind: 'standing' }, shape: basis };
      });
      const distance = p => Math.hypot(p[0] - c[0], p[1] - c[1]);
      return field(bounds, modes, p => distance(p) <= radius * (1 + 1e-13), p => distance(p) < radius * (1 - 1e-10));
    }
    const bounds = domain(box ?? { min: [0, 0], max: [1, 1] }, 2);
    const span = bounds.max.map((n, i) => n - bounds.min[i]);
    const fixed = edge === 'fixed', bias = fixed ? 0 : Math.PI / 2, minMode = Number(fixed);
    const modes = readModes(input, (raw, index) => {
      const { m, n } = raw ?? {};
      check(integer(m, minMode, 64) && integer(n, minMode, 64), 'rectangle mode needs valid half-wave indices');
      const coefficients = [Math.PI * m / span[0], Math.PI * n / span[1]];
      const naturalFrequency = speed * Math.hypot(...coefficients) / TAU;
      const info = controls(raw, index, { frequency: naturalFrequency });
      function basis(p, diff) {
        const x = coefficients[0] * (p[0] - bounds.min[0]) + bias;
        const y = coefficients[1] * (p[1] - bounds.min[1]) + bias;
        if (diff) return [coefficients[0] * Math.cos(x) * Math.sin(y), coefficients[1] * Math.sin(x) * Math.cos(y)];
        if (fixed && p.some((n, i) => n === bounds.min[i] || n === bounds.max[i])) return 0;
        return Math.sin(x) * Math.sin(y);
      }
      return { info: { ...info, m, n, naturalFrequency, kind: 'standing' }, shape: basis };
    });
    return field(bounds, modes, undefined, fixed ? p => p.every((n, i) => n > bounds.min[i] && n < bounds.max[i]) : undefined);
  }

  function field(bounds, modes, mask = () => true, interior = mask) {
    const dimensions = bounds.min.length, metadata = freeze(modes.map(row => row.info));
    const modeIds = new Set(metadata.map(({ id }) => id));
    const inside = p => p.length === dimensions && p.every((v, i) => number(v, bounds.min[i], bounds.max[i])) && mask(p);
    let previous;
    function frame(time = 0, { drive } = {}) {
      check(number(time, -1e6, 1e6) && (drive === undefined || record(drive) && Object.keys(drive).every(id => modeIds.has(id))),
        'expected bounded time and known mode IDs in drive');
      if (drive === undefined && previous?.time === time) return previous;
      const components = modes.map(mode => {
        const { amplitude, phase, id, frequency } = mode.info, input = drive && Object.hasOwn(drive, id) ? drive[id] : 1;
        const { gain = 1, phase: shift = 0 } = typeof input === 'number' ? { gain: input } : input ?? {};
        check((typeof input === 'number' || record(input)) && number(gain, -1e6, 1e6) && coordinate(shift),
          'mode drive needs finite gain and optional phase');
        const angle = timePhase(time, frequency, phase + shift), value = amplitude * gain;
        return { mode, angle, value, real: value * Math.cos(angle), imag: value * Math.sin(angle) };
      }).filter(component => component.value !== 0);
      const bound = channel => components.reduce((n, part) => n + Math.abs(part.mode.traveling ? part.value : part[channel]), 0);
      const scale = { signed: bound('real'), quadrature: bound('imag') };
      const tolerance = components.reduce((n, part) => n + Math.abs(part.value), 0) * 1e-12;
      function complex(p, diff) {
        let real = 0, imag = 0;
        const dx = diff ? vector(p) : null, dy = diff ? vector(p) : null;
        for (const { mode, angle, value, real: a, imag: b } of components) {
          if (mode.traveling) {
            const theta = mode.angle(p) + angle, c = value * Math.cos(theta), s = value * Math.sin(theta);
            real += c; imag += s;
            if (diff) for (let i = 0; i < dimensions; i++) { dx[i] -= s * mode.wavenumbers[i]; dy[i] += c * mode.wavenumbers[i]; }
          } else {
            const amplitude = mode.shape(p, false);
            real += a * amplitude; imag += b * amplitude;
            if (diff) {
              const d = mode.shape(p, true);
              for (let i = 0; i < dimensions; i++) { dx[i] += a * d[i]; dy[i] += b * d[i]; }
            }
          }
        }
        return { real, imag, dx, dy };
      }
      function details(...p) {
        if (!inside(p)) return null;
        const { real, imag } = complex(p, false), magnitude = Math.hypot(real, imag), phaseDefined = magnitude > tolerance;
        return { signed: real, quadrature: imag, magnitude, phase: phaseDefined ? Math.atan2(imag, real) : 0,
          energy: magnitude * magnitude, phaseDefined };
      }
      function sample(name, ...p) {
        if (!names.includes(name) || !inside(p)) return null;
        if (name === 'signed' || name === 'quadrature') {
          const { real, imag } = complex(p, false);
          return name === 'signed' ? real : imag;
        }
        return details(...p)[name];
      }
      function gradient(name, ...p) {
        if (!names.includes(name) || !inside(p)) return null;
        const { real, imag, dx, dy } = complex(p, true);
        if (name === 'signed') return dx;
        if (name === 'quadrature') return dy;
        const magnitude = Math.hypot(real, imag);
        if (magnitude <= tolerance) return name === 'phase' ? null : vector(p);
        if (name === 'phase') return dx.map((n, i) => (real * dy[i] - imag * n) / (magnitude * magnitude));
        const gain = name === 'energy' ? 2 : 1 / magnitude;
        return dx.map((n, i) => gain * (real * n + imag * dy[i]));
      }
      function towardNodes(point, { channel = 'signed', limit = .1 } = {}) {
        check(tuple(point, dimensions) && ['signed', 'quadrature'].includes(channel) && number(limit, 1e-8, 1e6),
          'node attraction needs a point, scalar phase component and positive limit');
        if (!inside(point)) return null;
        const { real, imag, dx, dy } = complex(point, true);
        const [value, slope] = channel === 'signed' ? [real, dx] : [imag, dy], norm = Math.hypot(...slope);
        if (norm <= tolerance) return vector(point);
        const factor = Math.max(-limit, Math.min(limit, -value / norm)) / norm;
        return slope.map(n => factor * n);
      }
      function nodalLines({ channel = 'signed', cell, maxCells = 120000 } = {}) {
        check(dimensions === 2 && ['signed', 'quadrature'].includes(channel), 'nodal lines need a 2D signed or quadrature field');
        const spacing = cell ?? Math.max(...bounds.max.map((n, i) => n - bounds.min[i])) / 96;
        check(finite(spacing) && spacing >= 1e-6 && integer(maxCells, 1, 500000), 'invalid nodal spacing or work budget');
        if (scale[channel] <= tolerance) return Object.freeze([]);
        const key = channel === 'signed' ? 'real' : 'imag';
        return P.contours.march((x, y) => {
          const p = [x, y];
          if (!interior(p)) return null;
          const value = complex(p, false)[key];
          return Math.abs(value) < scale[channel] * 1e-12 ? 0 : value;
        }, { bounds, cell: spacing, maxCells });
      }
      function source(name, { bounds: world, project, units = null } = {}) {
        check(names.includes(name) && (dimensions === 3 ? project === undefined && world === undefined :
          world && typeof project === 'function'), 'a chart source needs XYZ bounds and a projection');
        return K.fieldViews.source({ type: 'number', bounds: world ?? bounds, units, sample(x, y, z) {
          const point = project ? project([x, y, z]) : [x, y, z];
          return tuple(point, dimensions) ? sample(name, ...point) : null;
        } });
      }
      function outputs() {
        const channels = Object.fromEntries(names.map(name =>
          [name, name === 'phase' ? { units: 'rad', range: [-Math.PI, Math.PI] } : {}]));
        return K.fieldOutputs.create({ bounds, channels, sample: details, sampleChannel: sample });
      }
      const row = Object.freeze({ time, dimensions, bounds, channels: names, details, sample, gradient, towardNodes, nodalLines, source, outputs });
      if (drive === undefined) previous = row;
      return row;
    }
    return Object.freeze({ dimensions, bounds, modes: metadata, channels: names, frame });
  }

  function analyze(samples, { sampleRate, frequencies, window = 'hann' } = {}) {
    check(sequence(samples) && integer(samples.length, 2, 65536) && number(sampleRate, 1, 384000) &&
      Array.isArray(frequencies) && integer(frequencies.length, 1, 256) &&
      Array.from(frequencies).every(hz => number(hz, 0, sampleRate / 2)) && samples.length * frequencies.length <= 4000000 &&
      ['hann', 'rect'].includes(window), 'invalid PCM window, sample rate, frequency bins or work budget');
    const size = samples.length, signal = new Float64Array(size);
    let normal = 0;
    for (let i = 0; i < size; i++) {
      check(number(samples[i], -1e6, 1e6), 'PCM values must be bounded and finite');
      const weight = window === 'hann' ? .5 - .5 * Math.cos(TAU * i / size) : 1;
      normal += weight;
      signal[i] = samples[i] * weight;
    }
    return Object.freeze(frequencies.map(frequency => {
      const angle = TAU * frequency / sampleRate, c = Math.cos(angle), s = Math.sin(angle);
      let cos = 1, sin = 0, a = 0, b = 0;
      for (const value of signal) {
        a += value * cos; b -= value * sin;
        const next = cos * c - sin * s;
        sin = sin * c + cos * s;
        cos = next;
      }
      const factor = (frequency === 0 || frequency === sampleRate / 2 ? 1 : 2) / normal;
      const real = a * factor, quadrature = b * factor, amplitude = Math.hypot(real, quadrature);
      return Object.freeze({ frequency, real, quadrature, amplitude, phase: amplitude > 1e-12 ? Math.atan2(quadrature, real) : 0 });
    }));
  }

  P.fields.spectral = Object.freeze({ fourier, membrane, analyze });
})(KIT);
