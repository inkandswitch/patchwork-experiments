/* Seekable scalar deposits in surface charts and world volumes. */
(function (K) {
  const finite = Number.isFinite;
  const MAX_TIME = 1e6;
  const MAX_SAMPLES = 1 << 20;
  const SUPPORT = 4;
  const record = value => value != null && Object.getPrototypeOf(value) === Object.prototype;
  const vector = (value, length) => Array.isArray(value) && value.length === length && Array.from(value).every(finite);
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const number = (value, min, max) => finite(value) && value >= min && value <= max;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const check = (ok, message) => { if (!ok) throw new RangeError('Deposition: ' + message); };

  function create({ bounds, counts, channels, stamps = [], strokes = [],
    maxDeposits = 16384, maxWork = 32000000 } = {}) {
    const dimensions = counts?.length;
    check([2, 3].includes(dimensions) && vector(counts, dimensions) &&
      counts.every(count => integer(count, 1, 1024)), 'expected two or three grid counts');
    counts = Object.freeze(counts.slice());
    const { min, max } = bounds ?? {};
    check(vector(min, dimensions) && vector(max, dimensions) && min.every((lo, axis) =>
      Math.abs(lo) <= 1e6 && Math.abs(max[axis]) <= 1e6 && max[axis] - lo >= 1e-6),
    'grid bounds need finite increasing coordinates');
    const box = Object.freeze({ min: Object.freeze(min.slice()), max: Object.freeze(max.slice()) });
    const spacing = counts.map((n, axis) => (box.max[axis] - box.min[axis]) / n);
    const minimumSigma = Math.max(...spacing) / 4;
    const [width, height, depth = 1] = counts;
    const stride = width * height;
    const size = stride * depth;

    check(record(channels) && integer(Object.keys(channels).length, 1, 12), 'expected 1–12 named channels');
    const entries = Object.entries(channels);
    const settings = entries.map(([name, spec]) => {
      check(/^[\w-]+$/.test(name) && record(spec) && Object.keys(spec).every(key => ['decay', 'diffusion'].includes(key)),
        'channels need a name and decay or diffusion settings');
      const { decay = 0, diffusion = 0 } = spec;
      check(number(decay, 0, 1000) && number(diffusion, 0, 1e6), 'decay and diffusion must be nonnegative and bounded');
      return { decay, diffusion };
    });
    const names = Object.freeze(entries.map(([name]) => name));
    const indices = new Map(names.map((name, i) => [name, i]));
    check(size * names.length <= MAX_SAMPLES && integer(maxDeposits, 1, 65536) &&
      integer(maxWork, 1, 128000000), 'grid or work budget is out of range');

    let events = [], revision = 0, previous, retainedFrom = -MAX_TIME;
    const inside = point => vector(point, dimensions) &&
      point.every((value, axis) => value >= box.min[axis] && value <= box.max[axis]);
    const validPoint = point => vector(point, dimensions) && point.every(value => Math.abs(value) <= 1e6);
    const validTime = time => number(time, retainedFrom, MAX_TIME);
    const center = (cell, axis) => box.min[axis] + (cell + .5) * spacing[axis];

    function brush({ sigma = Math.max(.1, minimumSigma), lifetime = Infinity, values } = {}) {
      check(number(sigma, minimumSigma, 2e6), 'sigma must be at least one quarter of the largest cell spacing');
      check(lifetime === Infinity || number(lifetime, 1e-6, 2 * MAX_TIME), 'lifetime must be positive');
      check(record(values) && Object.keys(values).length > 0, 'a brush needs channel values');
      const writes = Object.entries(values).map(([name, value]) => {
        const index = indices.get(name);
        check(index !== undefined && number(value, -1e6, 1e6), 'unknown channel or invalid value: ' + name);
        return [index, value];
      });
      return { sigma, lifetime, writes };
    }

    function invalidate() {
      revision++;
      previous = undefined;
    }

    function append(pending) {
      check(events.length + pending.length <= maxDeposits, 'deposit budget exceeded');
      for (const event of pending) events.push(event);
      invalidate();
    }

    function stamp({ at, time = 0, ...options } = {}) {
      check(validPoint(at) && validTime(time), 'stamp needs finite coordinates and an available time');
      append([{ at: at.slice(), time, ...brush(options), duration: 1 }]);
    }

    function stroke({ keys, interval = .05, ...options } = {}) {
      const paint = brush(options);
      check(number(interval, .001, 1e4) && Array.isArray(keys) && integer(keys.length, 2, maxDeposits + 1) &&
        Array.from(keys).every((key, i) => Array.isArray(key) && validTime(key[0]) &&
          validPoint(key.slice(1)) && (!i || key[0] > keys[i - 1][0])),
      'stroke needs increasing [time, ...coordinates] keys and a positive interval');

      const pending = [];
      for (let i = 1; i < keys.length; i++) {
        const [start, ...from] = keys[i - 1], [end, ...to] = keys[i];
        const delta = to.map((value, axis) => value - from[axis]);
        const span = end - start;
        const count = Math.max(Math.ceil(span / interval), Math.ceil(Math.hypot(...delta) / paint.sigma));
        const duration = span / count;
        check(events.length + pending.length + count <= maxDeposits, 'deposit budget exceeded by stroke');
        for (let j = 0; j < count; j++) {
          const f = (j + .5) / count;
          pending.push({ ...paint, time: start + f * span, at: from.map((value, axis) =>
            value + delta[axis] * f), duration });
        }
      }
      append(pending);
    }

    function axisRange(axis, coordinate, sigma) {
      const lo = Math.max(0, Math.ceil((coordinate - SUPPORT * sigma - box.min[axis]) / spacing[axis] - .5));
      const hi = Math.min(counts[axis] - 1, Math.floor((coordinate + SUPPORT * sigma - box.min[axis]) / spacing[axis] - .5));
      return { lo, length: Math.max(0, hi - lo + 1) };
    }

    function axisKernel({ lo, length }, axis, event, sigma) {
      const weights = new Float64Array(length);
      const coordinate = event.at[axis];
      for (let i = 0; i < length; i++) {
        const delta = (center(lo + i, axis) - coordinate) / sigma;
        weights[i] = Math.exp(-.5 * delta * delta);
      }
      return { lo, weights };
    }

    function read(data, point) {
      const coords = point.map((value, axis) =>
        clamp((value - box.min[axis]) / spacing[axis] - .5, 0, counts[axis] - 1));
      const [u, v, w = 0] = coords;
      const x = Math.floor(u), y = Math.floor(v), z = Math.floor(w);
      const xNext = Math.min(x + 1, width - 1), yNext = Math.min(y + 1, height - 1);
      function plane(layer) {
        const row = layer * stride + y * width, next = layer * stride + yNext * width;
        return K.mix(K.mix(data[row + x], data[row + xNext], u - x),
          K.mix(data[next + x], data[next + xNext], u - x), v - y);
      }
      const low = plane(z);
      return w === z ? low : K.mix(low, plane(z + 1), w - z);
    }

    function capture(time) {
      const buffers = names.map(() => new Float32Array(size));
      const flatAxis = { lo: 0, weights: [1] };
      let work = 0;
      for (const event of events) {
        const age = time - event.time;
        if (age < 0 || time >= event.time + event.lifetime) continue;
        for (const [channel, amount] of event.writes) {
          if (!amount) continue;
          const { decay, diffusion } = settings[channel];
          // Heat diffusion widens a Gaussian and lowers its peak by the same volume factor.
          const sigma = Math.hypot(event.sigma, Math.sqrt(2 * diffusion * age));
          const gain = event.duration * amount * Math.exp(-decay * age) * (event.sigma / sigma) ** dimensions;
          if (Math.abs(gain) < 1e-35) continue;
          const axes = event.at.map((coordinate, axis) => axisRange(axis, coordinate, sigma));
          const affected = axes.reduce((count, axis) => count * axis.length, 1);
          if (!affected) continue;
          work += affected;
          check(work <= maxWork, 'frame work budget exceeded');
          const [x, y, z = flatAxis] = axes.map((range, axis) => axisKernel(range, axis, event, sigma));
          const data = buffers[channel];
          for (let k = 0; k < z.weights.length; k++) {
            const layer = (k + z.lo) * stride;
            const peak = gain * z.weights[k];
            for (let j = 0; j < y.weights.length; j++) {
              const row = layer + (j + y.lo) * width + x.lo;
              const weight = peak * y.weights[j];
              for (let i = 0; i < x.weights.length; i++) data[row + i] += weight * x.weights[i];
            }
          }
        }
      }
      return buffers;
    }

    function frame(time) {
      check(validTime(time), 'requested time is unavailable');
      if (previous?.time === time) return previous;
      const buffers = capture(time), pickTables = new Map();
      function sample(name, ...point) {
        const index = indices.get(name);
        return index === undefined || !inside(point) ? 0 : read(buffers[index], point);
      }

      function source(name, { bounds: worldBounds, project, units = null } = {}) {
        const channel = indices.get(name);
        check(channel !== undefined && (dimensions === 3 ?
          project === undefined && worldBounds === undefined : worldBounds && typeof project === 'function'),
        'a chart source needs XYZ bounds and a projection; a volume already has XYZ bounds');
        return K.fieldViews.source({ type: 'number', units, bounds: worldBounds ?? box, sample(x, y, z) {
          const point = project ? project([x, y, z]) : [x, y, z];
          return inside(point) ? read(buffers[channel], point) : null;
        } });
      }

      function pick(name, random, { threshold = 0 } = {}) {
        const channel = indices.get(name);
        check(channel !== undefined && typeof random === 'function' && finite(threshold) && threshold >= 0,
          'pick needs a known channel, random function and nonnegative threshold');
        const data = buffers[channel];
        let table = pickTables.get(channel);
        if (table?.threshold !== threshold) {
          const cumulative = new Float64Array(size);
          let total = 0;
          for (let i = 0; i < size; i++) {
            total += Math.max(0, data[i] - threshold);
            cumulative[i] = total;
          }
          table = { threshold, cumulative, total };
          pickTables.set(channel, table);
        }
        if (!table.total) return null;
        const fraction = random();
        check(number(fraction, 0, 1) && fraction < 1, 'random values need to be in [0, 1)');
        const target = Math.min(fraction * table.total, table.total * (1 - Number.EPSILON));
        let lo = 0, hi = size - 1;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (table.cumulative[mid] > target) hi = mid;
          else lo = mid + 1;
        }
        const cells = [lo % width, Math.floor(lo / width) % height, Math.floor(lo / stride)];
        return { at: cells.slice(0, dimensions).map(center), value: data[lo] };
      }

      previous = Object.freeze({ time, bounds: box, counts, sample, source, pick,
        data: name => buffers[indices.get(name)]?.slice()
      });
      return previous;
    }

    function prune(time) {
      check(validTime(time), 'retention cutoff must advance within the supported time range');
      if (time === retainedFrom) return 0;
      const count = events.length;
      retainedFrom = time;
      events = events.filter(event => event.time + event.lifetime > time);
      invalidate();
      return count - events.length;
    }

    check(Array.isArray(stamps) && Array.isArray(strokes) && stamps.length + strokes.length <= maxDeposits,
      'expected bounded lists of stamps and strokes');
    for (const item of stamps) stamp(item);
    for (const item of strokes) stroke(item);

    return Object.freeze({ dimensions, bounds: box, counts, channels: names, stamp, stroke, frame, prune,
      get revision() { return revision; },
      get depositCount() { return events.length; },
      clear() {
        events = [];
        retainedFrom = -MAX_TIME;
        invalidate();
      }
    });
  }

  K.deposition = Object.freeze({ create });
})(KIT);
