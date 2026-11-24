/* Retained phase transfers, surface finishes, and conversion-driven emissions on an XZ grid. */
(function (K) {
  const P = K.procedural, M = P.motion;
  const finite = Number.isFinite;
  const number = (v, lo, hi) => finite(v) && v >= lo && v <= hi;
  const integer = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
  const record = v => v != null && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const vector = (v, n) => Array.isArray(v) && v.length === n && Array.from(v).every(finite);
  const nameOK = v => typeof v === 'string' && /^[a-z][\w-]{0,47}$/i.test(v);
  const check = (ok, why) => { if (!ok) throw new RangeError('Phase change: ' + why); };
  const finishNames = ['color', 'roughness', 'relief'];
  const clamp = (n, hi) => Math.max(0, Math.min(hi, n));
  const empty = Object.freeze({});

  function phaseChange(options = {}) {
    const { width, height, size, dx, dz, bounds, open, center, inside, distribute } = M.gridDomain(options);
    const { channels: config, rules, finish, initial, dt = .05, maxWork = 24000000, maxEvents = 24000 } = options;
    check(record(config) && Array.isArray(rules) && rules.length >= 1 && rules.length <= 24 &&
      Array.from(rules).every(record) && [initial, finish].every(fn => fn === undefined || typeof fn === 'function') &&
      number(dt, 1e-5, 1) && integer(maxWork, 1, 120000000) && integer(maxEvents, 1, 100000),
      'expected bounded channels, rules, timestep, and work limits');
    const names = Object.keys(config), indices = new Map(names.map((name, i) => [name, i]));
    check(names.length >= 1 && names.length <= 12 && names.length * size <= 1000000 &&
      names.every(name => nameOK(name) && !finishNames.includes(name)), 'invalid state channel names or grid budget');
    const specs = names.map(name => {
      check(record(config[name]), 'expected settings for ' + name);
      const { capacity = 1, diffusion = 0, initial = 0 } = config[name];
      check(number(capacity, 1e-6, 1e6) && number(diffusion, 0, 1e4) && number(initial, 0, capacity),
        'invalid capacity, diffusion, or initial value for ' + name);
      return { capacity, diffusion, initial };
    });

    function recipe(map) {
      check(record(map), 'rules need consume and produce maps');
      return Object.entries(map).map(([name, coefficient]) => {
        check(indices.has(name) && number(coefficient, 1e-6, 1e4), 'invalid rule coefficient for ' + name);
        return [indices.get(name), coefficient];
      });
    }
    const ruleIds = new Set(), recipes = rules.map(({ id, consume = {}, produce = {}, rate, emitEvery }, slot) => {
      const debit = recipe(consume), credit = recipe(produce), read = new Set(debit.map(([i]) => i));
      check(nameOK(id) && !ruleIds.has(id) && debit.length + credit.length > 0 && credit.every(([i]) => !read.has(i)) &&
        (typeof rate === 'function' || number(rate, 0, 1e8)) &&
        (emitEvery === undefined || number(emitEvery, 1e-8, 1e8)), 'invalid reaction, rate, or emission interval');
      ruleIds.add(id);
      return { id, debit, credit, rate, emitEvery, slot };
    });
    check(size * recipes.filter(rule => rule.emitEvery).length <= 1000000, 'emission grid exceeds its budget');

    const sites = [];
    for (let i = 0; i < size; i++) {
      if (!open[i]) continue;
      const c = i % width, r = Math.floor(i / width);
      const east = c + 1 < width && open[i + 1] ? i + 1 : -1;
      const south = r + 1 < height && open[i + width] ? i + width : -1;
      const neighbors = [east, south, c && open[i - 1] ? i - 1 : -1, r && open[i - width] ? i - width : -1]
        .filter(j => j >= 0);
      sites.push({ i, at: Object.freeze(center(i)), east, south, neighbors });
    }
    check(sites.length, 'the mask needs at least one open cell');
    const channels = Object.freeze(finish ? [...names, ...finishNames] : names.slice());
    const times = specs.map(({ diffusion }) => Math.ceil(dt * 2 * diffusion * (1 / dx ** 2 + 1 / dz ** 2) / .9));
    const diffusionWork = times.reduce((a, b) => a + b, 0) * size;
    let state = names.map(() => new Float64Array(size)),
      carries = recipes.map(rule => rule.emitEvery ? new Float64Array(size) : null);
    let tick = 0, serial = 0, stepping = false;
    const saved = new WeakMap();
    for (const { i, at } of sites) {
      const values = initial?.(...at, i) ?? empty;
      check(record(values) && Object.keys(values).every(name => indices.has(name)), 'initial values need known channels');
      specs.forEach(({ capacity, initial: start }, c) => {
        const value = Object.hasOwn(values, names[c]) ? values[names[c]] : start;
        check(number(value, 0, capacity), 'initial value exceeds capacity for ' + names[c]);
        state[c][i] = value;
      });
    }

    function diffuse(values, steps, coefficient) {
      if (!steps) return values;
      const xWeight = coefficient * dt / (steps * dx ** 2), zWeight = coefficient * dt / (steps * dz ** 2);
      let current = values;
      for (let k = 0; k < steps; k++) {
        const next = current.slice();
        for (const { i, east, south } of sites) {
          if (east >= 0) {
            const moved = (current[i] - current[east]) * xWeight;
            next[i] -= moved;
            next[east] += moved;
          }
          if (south >= 0) {
            const moved = (current[i] - current[south]) * zWeight;
            next[i] -= moved;
            next[south] += moved;
          }
        }
        current = next;
      }
      return current;
    }

    function context(values, { i, at, neighbors }, time) {
      const fields = Object.create(null), nearby = Object.create(null);
      for (let c = 0; c < names.length; c++) {
        const data = values[c];
        fields[names[c]] = data[i];
        nearby[names[c]] = neighbors.length ? neighbors.reduce((sum, j) => sum + data[j], 0) / neighbors.length : data[i];
      }
      return Object.freeze({ cell: i, at, time, fields: Object.freeze(fields), nearby: Object.freeze(nearby) });
    }

    function frame(events = Object.freeze([])) {
      const data = state, time = tick * dt;
      let surface;
      function finishes() {
        if (surface) return surface;
        const color = new Float64Array(3 * size), roughness = new Float64Array(size), relief = new Float64Array(size);
        for (const site of sites) {
          const result = finish(context(data, site, time));
          check(record(result) && vector(result.color, 3) && result.color.every(v => number(v, 0, 1)) &&
            number(result.roughness, 0, 1) && number(result.relief, -1e6, 1e6), 'finish needs normalized RGB, roughness, and finite relief');
          color.set(result.color, 3 * site.i);
          roughness[site.i] = result.roughness;
          relief[site.i] = result.relief;
        }
        return surface = { color, roughness, relief };
      }
      function buffer(name) {
        check(channels.includes(name), 'unknown phase channel ' + name);
        return indices.has(name) ? data[indices.get(name)] : finishes()[name];
      }
      function sample(name, x, z) {
        const values = buffer(name);
        if (!inside(x, z)) return null;
        if (name === 'color') {
          const rgb = [0, 0, 0];
          distribute(x, z, (i, w) => {
            for (let c = 0; c < 3; c++) rgb[c] += w * values[3 * i + c];
          });
          return rgb.map(value => clamp(value, 1));
        }
        let result = 0;
        distribute(x, z, (i, w) => { result += w * values[i]; });
        return result;
      }
      function source(name, { bounds: box, project, units = null } = {}) {
        check(channels.includes(name) && (project === undefined || typeof project === 'function' && box),
          'invalid phase field channel or projection');
        const world = box ?? { min: [bounds.min[0], 0, bounds.min[1]], max: [bounds.max[0], 0, bounds.max[1]] };
        return K.fieldViews.source({ type: name === 'color' ? 'vec3' : 'number', bounds: world, units, sample(x, y, z) {
          const local = project ? project([x, y, z]) : [x, z];
          return vector(local, 2) ? sample(name, ...local) : null;
        } });
      }
      function outputs() {
        const descriptors = Object.fromEntries(names.map((name, i) => [name, { range: [0, specs[i].capacity] }]));
        if (finish) Object.assign(descriptors, { color: { type: 'rgb' }, roughness: { range: [0, 1] }, relief: {} });
        return K.fieldOutputs.create({ bounds, channels: descriptors, sampleChannel: sample });
      }
      return Object.freeze({ tick, time, events, sample, source, outputs, data: name => buffer(name).slice() });
    }

    const available = () => check(!stepping, 'cannot change the simulation during a step');
    function step(count = 1, { drive } = {}) {
      available();
      check(integer(count, 0, 300) && tick + count <= 1e8 && (drive === undefined || typeof drive === 'function'),
        'invalid timestep count or driver');
      if (!count) return frame();
      const work = count * (diffusionWork + size * (names.length * 6 + recipes.length * (2 + names.length)));
      check(work <= maxWork, 'step exceeds its diffusion or reaction budget');

      let current = state, nextSerial = serial;
      const carry = carries.map(data => data?.slice()), emitted = [];
      stepping = true;
      try {
        for (let k = 0; k < count; k++) {
          const clock = (tick + k) * dt, outputTime = (tick + k + 1) * dt;
          const before = current.map((values, c) => diffuse(values, times[c], specs[c].diffusion));
          const next = before.map(data => data.slice());
          for (const site of sites) {
            const { i, at } = site, local = context(before, site, clock), driving = drive?.(local) ?? empty;
            check(record(driving), 'drive must return inputs and sources');
            const { inputs = empty, sources = empty } = driving;
            check(record(inputs) && record(sources) && Object.entries(inputs).every(([key, v]) => nameOK(key) && number(v, -1e8, 1e8)),
              'invalid driver inputs or sources');
            for (const [name, rate] of Object.entries(sources)) {
              const c = indices.get(name);
              check(c !== undefined && number(rate, -1e8, 1e8), 'invalid source rate for ' + name);
              next[c][i] = clamp(next[c][i] + rate * dt, specs[c].capacity);
            }
            const sensed = Object.freeze({ ...local, inputs: Object.freeze({ ...inputs }) });
            for (const { id, debit, credit, rate, emitEvery, slot } of recipes) {
              const value = typeof rate === 'function' ? rate(sensed) : rate;
              check(number(value, 0, 1e8), 'reaction rate must be finite and nonnegative for ' + id);
              let made = value * dt;
              for (const [c, factor] of debit) made = Math.min(made, next[c][i] / factor);
              for (const [c, factor] of credit) made = Math.min(made, (specs[c].capacity - next[c][i]) / factor);
              if (!(made > 0)) continue;
              for (const [c, factor] of debit) next[c][i] = clamp(next[c][i] - made * factor, specs[c].capacity);
              for (const [c, factor] of credit) next[c][i] = clamp(next[c][i] + made * factor, specs[c].capacity);
              if (!emitEvery) continue;
              const amount = carry[slot][i] + made, n = Math.floor(amount / emitEvery);
              check(emitted.length + n <= maxEvents && nextSerial + n <= Number.MAX_SAFE_INTEGER, 'emission budget exceeded');
              carry[slot][i] = Math.max(0, amount - n * emitEvery);
              for (let event = 0; event < n; event++)
                emitted.push({ id: nextSerial++, rule: id, cell: i, at, time: outputTime, amount: emitEvery });
            }
          }
          current = next;
        }
      } finally { stepping = false; }
      state = current;
      carries = carry;
      serial = nextSerial;
      tick += count;
      return frame(P.data.freeze(emitted));
    }

    function checkpoint() {
      available();
      const token = Object.freeze({ tick });
      saved.set(token, { state, carries, tick, serial });
      return token;
    }
    function restore(token) {
      available();
      const prior = saved.get(token);
      check(prior, 'checkpoint must belong to this simulation');
      ({ state, carries, tick, serial } = prior);
      return frame();
    }
    const start = checkpoint();
    return Object.freeze({ width, height, bounds, channels, dt, step, frame, checkpoint, restore, reset: () => restore(start),
      mask: () => open.slice() });
  }

  M.phaseChange = phaseChange;
})(KIT);
