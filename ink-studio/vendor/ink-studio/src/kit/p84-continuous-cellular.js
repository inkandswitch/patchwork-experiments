/* Continuous cellular planes, sampled kernels, and composable local rules. */
const ContinuousCellular = (() => {
  const finite = Number.isFinite, clamp = value => Math.max(0, Math.min(1, value));
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const unit = n => finite(n) && n >= 0 && n <= 1;
  const positive = n => finite(n) && n > 0;
  const nameOK = name => typeof name === 'string' && /^[a-zA-Z][\w-]{0,47}$/.test(name);
  const record = value => !!value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const sequence = value => Array.isArray(value) || ArrayBuffer.isView(value) && Number.isInteger(value.length);
  const tuple = (value, count, test) => Array.isArray(value) && value.length === count && Array.from(value).every(test);
  const check = (ok, message) => { if (!ok) throw new RangeError('Continuous cellular: ' + message); };
  const format = 'ink-studio/continuous-cellular';
  const kernels = new WeakSet();

  function kernel({ taps, radius, weight, samples = 1, normalize = 'sum' } = {}) {
    check(['sum', 'l1', 'none'].includes(normalize), 'unknown kernel normalization');
    if (taps === undefined) {
      check(positive(radius) && radius <= 64 && typeof weight === 'function' && integer(samples, 1, 4),
        'sampled kernels need a radius up to 64, a weight function and 1–4 samples per axis');
      taps = [];
      const extent = Math.ceil(radius), area = samples * samples;
      for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
        let total = 0;
        for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
          const dx = x + (sx + .5) / samples - .5, dy = y + (sy + .5) / samples - .5;
          const distance = Math.hypot(dx, dy);
          if (distance > radius) continue;
          const value = weight(dx, dy, distance / radius);
          check(finite(value), 'kernel weights must be finite');
          total += value / area;
        }
        if (total) taps.push([x, y, total]);
      }
    }
    check(Array.isArray(taps) && integer(taps.length, 1, 16641) && Array.from(taps).every(row =>
      tuple(row, 3, finite) && integer(row[0], -64, 64) && integer(row[1], -64, 64)),
    'expected finite [dx, dy, weight] taps with integer offsets in [-64, 64]');
    const norm = taps.reduce((sum, tap) => sum + Math.abs(tap[2]), 0);
    const divisor = normalize === 'sum' ? taps.reduce((sum, tap) => sum + tap[2], 0) : normalize === 'l1' ? norm : 1;
    check(positive(norm) && finite(norm / divisor) && divisor !== 0 && norm / Math.abs(divisor) <= 1e6,
      'kernel has zero mass or exceeds the weight budget');
    const rows = taps.filter(tap => tap[2] !== 0).map(([x, y, value]) => Object.freeze([x, y, value / divisor]));
    const result = Object.freeze({ taps: Object.freeze(rows) });
    kernels.add(result);
    return result;
  }

  function lenia({ channel = 'life', field = 'potential', radius = 13, peaks = [1],
    mu = .15, sigma = .016, dt = .1 } = {}) {
    check(nameOK(channel) && nameOK(field) && channel !== field && unit(mu) && positive(sigma) && sigma <= 1 &&
      positive(dt) && dt <= 1 && Array.isArray(peaks) && integer(peaks.length, 1, 8) &&
      Array.from(peaks).every(unit) && peaks.some(positive), 'invalid Lenia parameters');
    const shell = peaks.slice();
    const ring = kernel({ radius, weight(_x, _y, r) {
      const position = r * shell.length, band = Math.floor(position), p = position - band;
      return p > 0 ? shell[band] * Math.exp(4 - 1 / (p * (1 - p))) : 0;
    } });
    return Object.freeze({ channels: Object.freeze([channel]), dt,
      neighborhoods: Object.freeze({ [field]: Object.freeze({ channel, kernel: ring }) }),
      rule({ state, fields, dt }) {
        const difference = (fields[field] - mu) / sigma;
        return { [channel]: state[channel] + dt * (2 * Math.exp(-.5 * difference ** 2) - 1) };
      }
    });
  }

  function smoothLife({ channel = 'life', inner = 'inside', outer = 'ring', radius = 21, innerRadius = radius / 3,
    birth = [.278, .365], survival = [.267, .445], alphaN = .028, alphaM = .147, mode = 'discrete',
    dt = mode === 'rate' ? .1 : 1 } = {}) {
    check([channel, inner, outer].every(nameOK) && new Set([channel, inner, outer]).size === 3 &&
      positive(innerRadius) && positive(radius) && radius <= 63.5 && innerRadius < radius &&
      [birth, survival].every(range => tuple(range, 2, unit) && range[0] < range[1]) &&
      [alphaN, alphaM, dt].every(n => positive(n) && n <= 1) && ['discrete', 'rate'].includes(mode),
    'invalid SmoothLife parameters');
    const [b0, b1] = birth, [s0, s1] = survival;
    const disc = (limit, distance) => clamp(limit + .5 - distance);
    const sigmoid = (x, edge, width) => 1 / (1 + Math.exp(-4 * ((x - edge) / width)));
    const inside = kernel({ radius: innerRadius + .5, weight: (x, y) => disc(innerRadius, Math.hypot(x, y)) });
    const annulus = kernel({ radius: radius + .5, weight(x, y) {
      const d = Math.hypot(x, y);
      return disc(radius, d) - disc(innerRadius, d);
    } });
    return Object.freeze({ channels: Object.freeze([channel]), dt,
      neighborhoods: Object.freeze({ [inner]: Object.freeze({ channel, kernel: inside }),
        [outer]: Object.freeze({ channel, kernel: annulus }) }),
      rule({ state, fields, dt }) {
        const m = sigmoid(fields[inner], .5, alphaM), n = fields[outer];
        const response = sigmoid(n, b0 + (s0 - b0) * m, alphaN) * (1 - sigmoid(n, b1 + (s1 - b1) * m, alphaN));
        return { [channel]: mode === 'discrete' ? response : state[channel] + dt * (2 * response - 1) };
      }
    });
  }

  function create({ width, height, channels, rule, neighborhoods = {}, dt = 1, boundary = 'wrap',
    bounds = { min: [0, 0], max: [1, 1] }, initial = {}, mask = 1 } = {}) {
    check(integer(width, 1, 512) && integer(height, 1, 512) && Array.isArray(channels) &&
      integer(channels.length, 1, 12) && Array.from(channels).every(nameOK) && new Set(channels).size === channels.length &&
      width * height * channels.length <= 262144, 'invalid grid dimensions or channel budget');
    check(typeof rule === 'function' && positive(dt) && dt <= 1 && ['wrap', 'empty'].includes(boundary),
      'expected a rule, fixed dt in (0, 1] and wrap or empty boundary');
    const names = Object.freeze(channels.slice()), size = width * height, counts = Object.freeze([width, height]);
    const { min, max } = bounds ?? {};
    check(tuple(min, 2, finite) && tuple(max, 2, finite) && min.every((lo, i) =>
      Math.abs(lo) <= 1e6 && Math.abs(max[i]) <= 1e6 && max[i] - lo >= 1e-6), 'expected finite increasing chart bounds');
    const box = Object.freeze({ min: Object.freeze(min.slice()), max: Object.freeze(max.slice()) });
    const spacing = counts.map((n, i) => (max[i] - min[i]) / n);
    const inBounds = (u, v) => finite(u) && finite(v) && u >= box.min[0] && u <= box.max[0] && v >= box.min[1] && v <= box.max[1];
    const periodic = boundary === 'wrap';
    check(record(neighborhoods) && Object.keys(neighborhoods).length <= 16, 'expected at most 16 named neighborhoods');
    const taps = Object.entries(neighborhoods).map(([name, spec]) => {
      check(nameOK(name) && !names.includes(name) && names.includes(spec?.channel) && kernels.has(spec?.kernel),
        'neighborhood needs a distinct name, an input channel and a compiled kernel');
      return { name, channel: spec.channel, taps: spec.kernel.taps };
    });
    const fieldNames = taps.map(tap => tap.name), outputs = Object.freeze([...names, ...fieldNames]);
    const filters = CellularConvolution.create(width, height, taps, periodic);
    check(record(initial) && Object.keys(initial).every(name => names.includes(name)), 'initial values must use known channels');
    const planesFrom = callback => Object.assign(Object.create(null), Object.fromEntries(names.map(name => [name, callback(name)])));
    const center = (x, y) => [box.min[0] + (x + .5) * spacing[0], box.min[1] + (y + .5) * spacing[1]];
    const wrap = (n, length) => (n % length + length) % length;
    function plane(input) {
      if (unit(input)) return new Float32Array(size).fill(input);
      if (typeof input === 'function') return Float32Array.from({ length: size }, (_, i) => {
        const x = i % width, y = Math.floor(i / width), [u, v] = center(x, y), value = input({ x, y, u, v });
        check(unit(value), 'plane values must be in [0, 1]');
        return value;
      });
      check(sequence(input) && input.length === size, 'expected a scalar, sampler or one value per cell');
      return Float32Array.from(input, value => {
        check(unit(value), 'plane values must be in [0, 1]');
        return value;
      });
    }
    function clearVoid(data, coverage) {
      for (const values of Object.values(data)) for (let i = 0; i < size; i++) if (!coverage[i]) values[i] = 0;
      return data;
    }
    const initialMask = plane(mask);
    const initialState = clearVoid(planesFrom(name => plane(Object.hasOwn(initial, name) ? initial[name] : 0)), initialMask);
    const emptyFlags = new Uint8Array(size);
    let tick = 0, revision = 0, state = initialState, coverage = initialMask,
      locked = emptyFlags, blocked = emptyFlags, previous, busy = false;
    function index(x, y) {
      check(integer(x, 0, width - 1) && integer(y, 0, height - 1), 'cell coordinates are out of bounds');
      return y * width + x;
    }
    const available = () => check(!busy, 'cannot edit the grid during a rule or mask callback');
    function commit(next, nextTick, nextMask = coverage, pins = locked, obstacles = blocked) {
      state = next; tick = nextTick; coverage = nextMask; locked = pins; blocked = obstacles;
      revision++; previous = undefined;
    }

    function step(count = 1) {
      available();
      const work = filters.work + size * (names.length + taps.length + 1);
      check(integer(count, 1, 10000) && tick + count <= Number.MAX_SAFE_INTEGER && count * work <= 96000000,
        'step batch exceeds the work or tick budget');
      busy = true;
      try {
        let current = state;
        for (let j = 1; j <= count; j++) {
          const filtered = filters.evaluate(current), next = planesFrom(() => new Float32Array(size));
          const time = (tick + j) * dt;
          for (let i = 0; i < size; i++) {
            if (!coverage[i] || blocked[i]) continue;
            if (locked[i]) {
              for (const name of names) next[name][i] = current[name][i];
              continue;
            }
            const values = readCell(current, names, i), fields = readCell(filtered, fieldNames, i);
            const result = rule({ state: values, fields, x: i % width, y: Math.floor(i / width), tick: tick + j, time, dt });
            check(record(result) && Object.keys(result).every(name => names.includes(name)), 'rule must return named state values');
            for (const name of names) {
              const before = current[name][i], after = Object.hasOwn(result, name) ? result[name] : before;
              check(finite(after), 'rule states must be finite');
              next[name][i] = before + coverage[i] * (clamp(after) - before);
            }
          }
          current = next;
        }
        commit(current, tick + count);
        return tick;
      } finally { busy = false; }
    }

    function readCell(planes, keys, i) {
      const values = Object.create(null);
      for (const name of keys) values[name] = planes[name][i];
      return values;
    }

    function setMask(input) {
      available();
      busy = true;
      try {
        const next = plane(input);
        commit(clearVoid(planesFrom(name => state[name].slice()), next), tick, next);
      } finally { busy = false; }
    }

    function edit(changes) {
      available();
      check(Array.isArray(changes) && changes.length <= size, 'expected a bounded edit list');
      const plan = Array.from(changes, item => {
        const { x, y, values, locked, blocked } = item ?? {};
        check(record(item) && Object.keys(item).every(key => ['x', 'y', 'values', 'locked', 'blocked'].includes(key)) &&
          (values !== undefined || locked !== undefined || blocked !== undefined) &&
          (locked === undefined || typeof locked === 'boolean') && (blocked === undefined || typeof blocked === 'boolean') &&
          (values === undefined || record(values) && Object.keys(values).length > 0 &&
            Object.entries(values).every(([name, value]) => names.includes(name) && unit(value))),
        'each edit needs a valid lock, obstacle or channel values in [0, 1]');
        return { i: index(x, y), values, locked, blocked };
      });
      if (!plan.length) return;
      const next = planesFrom(name => state[name].slice()), pins = locked.slice(), obstacles = blocked.slice();
      for (const row of plan) {
        const { i } = row;
        if (row.locked !== undefined) pins[i] = Number(row.locked);
        if (row.blocked !== undefined) obstacles[i] = Number(row.blocked);
        if (obstacles[i]) for (const name of names) next[name][i] = 0;
        else if (row.values && coverage[i]) for (const [name, value] of Object.entries(row.values)) next[name][i] = value;
      }
      commit(next, tick, coverage, pins, obstacles);
    }

    function inject({ at, radius, values, mode = 'add', falloff = 'smooth' } = {}) {
      available();
      check(tuple(at, 2, finite) && Math.abs(at[0]) <= 1e6 && Math.abs(at[1]) <= 1e6 &&
        positive(radius) && radius <= 512 && record(values) && Object.keys(values).length > 0 &&
        ['add', 'replace'].includes(mode) && ['flat', 'smooth'].includes(falloff), 'invalid local injection');
      const writes = Object.entries(values);
      check(writes.every(([name, value]) => names.includes(name) && (mode === 'replace' ? unit(value) :
        finite(value) && Math.abs(value) <= 1)), 'unknown channel or invalid injection value');
      const next = Object.assign(Object.create(null), state);
      for (const [name] of writes) next[name] = state[name].slice();
      const distance = (delta, n) => periodic ? Math.abs(wrap(delta + n / 2, n) - n / 2) : Math.abs(delta);
      for (let y = 0; y < height; y++) {
        const dy = distance(y - at[1], height);
        if (dy > radius) continue;
        for (let x = 0; x < width; x++) {
          const d = Math.hypot(dy, distance(x - at[0], width)) / radius, i = y * width + x;
          if (d > 1 || !coverage[i] || blocked[i]) continue;
          const amount = coverage[i] * (falloff === 'flat' ? 1 : (1 - d) ** 2 * (1 + 2 * d));
          for (const [name, value] of writes) {
            const before = state[name][i];
            next[name][i] = clamp(before + amount * (mode === 'replace' ? value - before : value));
          }
        }
      }
      commit(next, tick);
    }

    function frame() {
      if (previous) return previous;
      const captured = state, frameTick = tick, pins = locked, obstacles = blocked, mask = coverage;
      let filtered;
      const buffer = name => Object.hasOwn(captured, name) ? captured[name] :
        outputs.includes(name) ? (filtered ??= filters.evaluate(captured))[name] : undefined;
      function sample(name, u, v) {
        if (!inBounds(u, v)) return 0;
        const values = buffer(name);
        if (!values) return 0;
        const x = (u - box.min[0]) / spacing[0] - .5, y = (v - box.min[1]) / spacing[1] - .5;
        const nearest = (n, length) => periodic ? wrap(n, length) : Math.min(length - 1, Math.max(0, n));
        const a = Math.floor(x), b = Math.floor(y), tx = x - a, ty = y - b;
        const x0 = nearest(a, width), x1 = nearest(a + 1, width), y0 = nearest(b, height) * width, y1 = nearest(b + 1, height) * width;
        return (1 - ty) * ((1 - tx) * values[y0 + x0] + tx * values[y0 + x1]) +
          ty * ((1 - tx) * values[y1 + x0] + tx * values[y1 + x1]);
      }
      function source(name, { bounds, project, units = null } = {}) {
        check(outputs.includes(name) && typeof project === 'function', 'field source needs a known channel and a world projection');
        return KIT.fieldViews.source({ type: 'number', bounds, units, sample(x, y, z) {
          const at = project([x, y, z]);
          return tuple(at, 2, finite) && inBounds(...at) ? sample(name, ...at) : null;
        } });
      }
      previous = Object.freeze({ tick: frameTick, time: frameTick * dt, bounds: box, counts, sample, source,
        get: (x, y) => readCell(captured, names, index(x, y)),
        isLocked: (x, y) => Boolean(pins[index(x, y)]),
        isBlocked(x, y) { const i = index(x, y); return Boolean(obstacles[i] || !mask[i]); },
        coverage: (x, y) => mask[index(x, y)],
        data: name => buffer(name)?.slice() });
      return previous;
    }

    function checkpoint() {
      return { format, version: 1, width, height, dt, boundary, bounds: { min: box.min.slice(), max: box.max.slice() },
        channels: names.slice(), tick, mask: Array.from(coverage), state: Object.fromEntries(names.map(name => [name, Array.from(state[name])])),
        ...(locked.includes(1) && { locked: Array.from(locked) }),
        ...(blocked.includes(1) && { blocked: Array.from(blocked) }) };
    }

    function restore(saved) {
      available();
      check(saved?.format === format && saved.version === 1 && saved.width === width && saved.height === height &&
        saved.dt === dt && saved.boundary === boundary && ['min', 'max'].every(key =>
          tuple(saved.bounds?.[key], 2, finite) && box[key].every((value, i) => value === saved.bounds[key][i])) &&
        tuple(saved.channels, names.length, nameOK) && saved.channels.every((name, i) => name === names[i]) &&
        integer(saved.tick, 0, Number.MAX_SAFE_INTEGER) && sequence(saved.mask) && record(saved.state) &&
        Object.keys(saved.state).length === names.length && names.every(name => Object.hasOwn(saved.state, name) && sequence(saved.state[name])),
      'checkpoint is malformed or incompatible');
      const nextMask = plane(saved.mask), next = planesFrom(name => plane(saved.state[name]));
      function flags(values) {
        if (values === undefined) return emptyFlags;
        check(sequence(values) && values.length === size, 'invalid checkpoint flags');
        return Uint8Array.from(values, value => {
          check(value === 0 || value === 1, 'invalid checkpoint flags');
          return value;
        });
      }
      const pins = flags(saved.locked), obstacles = flags(saved.blocked);
      for (const data of Object.values(next)) for (let i = 0; i < size; i++)
        check(nextMask[i] && !obstacles[i] || !data[i], 'checkpoint has activity in a masked-out or blocked cell');
      commit(next, saved.tick, nextMask, pins, obstacles);
      return tick;
    }

    return Object.freeze({ width, height, counts, bounds: box, dimensions: 2, channels: outputs, stateChannels: names,
      dt, boundary, center, frame, step, edit, inject, setMask, checkpoint, restore,
      get tick() { return tick; }, get revision() { return revision; },
      reset() { available(); commit(initialState, 0, initialMask, emptyFlags, emptyFlags); }
    });
  }

  return Object.freeze({ create, kernel, presets: Object.freeze({ lenia, smoothLife }) });
})();
