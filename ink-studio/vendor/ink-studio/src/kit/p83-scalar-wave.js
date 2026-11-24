/* Fixed-step, cell-centered scalar waves with reflecting faces and damping layers. */
(function (K) {
  const P = K.procedural, M = P.motion, { hash } = P.data;
  const channels = Object.freeze(['pressure', 'velocity', 'energy']);
  const sides = Object.freeze(['xMin', 'xMax', 'zMin', 'zMax']);
  const kinds = ['reflect', 'fixed', 'absorb'];
  const maxValue = 1e12;
  const number = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const vector = (p, count) => Array.isArray(p) && p.length === count && Array.from(p).every(Number.isFinite);
  const record = v => v != null && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const sequence = v => Array.isArray(v) || ArrayBuffer.isView(v) && Number.isInteger(v.length);
  const check = (ok, message) => { if (!ok) throw new RangeError('Scalar wave: ' + message); };
  const stateOK = n => number(n, -maxValue, maxValue);
  const fixedFace = -2, reflectFace = -1;
  const faceKind = type => type === 'reflect' ? reflectFace : fixedFace;

  function create(options = {}) {
    const { speed = 1, damping = 0, boundary = 'reflect', wall = 'reflect', barrier, sponge = {}, initial,
      cfl = .9, maxDt = .05, maxWork = 36000000 } = options;
    check((typeof boundary === 'string' && kinds.includes(boundary) || record(boundary) &&
      Object.entries(boundary).every(([side, kind]) => sides.includes(side) && kinds.includes(kind))) &&
      ['reflect', 'fixed'].includes(wall) && (barrier === undefined || typeof barrier === 'function') &&
      (initial === undefined || typeof initial === 'function') &&
      (typeof speed === 'function' || number(speed, 1e-4, 1e4)) && (typeof damping === 'function' || number(damping, 0, 1e5)) &&
      number(cfl, .05, 1) && number(maxDt, 1e-7, 2) && integer(maxWork, 1, 140000000) && record(sponge),
    'invalid medium, boundary, or integration options');
    const edges = Object.freeze(Object.fromEntries(sides.map(name => [name, typeof boundary === 'string' ? boundary : boundary[name] ?? 'reflect'])));
    const domain = M.gridDomain(options), { width, height, size, dx, dz, bounds, open, center } = domain;
    const { cells = 14, strength } = sponge;
    const hasGeometry = barrier !== undefined || options.mask !== undefined;
    check(integer(cells, 1, 128) && (strength === undefined || number(strength, 0, 1e8)), 'invalid absorbing layer');
    const pressureStart = new Float64Array(size), velocityStart = new Float64Array(size);
    const speeds = new Float64Array(size), damp = new Float64Array(size), drag = new Float64Array(size), gain = new Float64Array(size);
    const cellsX = new Float64Array(size), cellsZ = new Float64Array(size), faces = new Int32Array(size * 4).fill(reflectFace);
    const active = [];
    let fastest = 0;
    for (let i = 0; i < size; i++) {
      if (!open[i]) continue;
      const [x, z] = center(i);
      const c = typeof speed === 'function' ? speed(x, z, i) : speed, d = typeof damping === 'function' ? damping(x, z, i) : damping;
      check(number(c, 1e-4, 1e4) && number(d, 0, 1e5), 'speed and damping must be bounded at every open cell');
      const raw = initial?.(x, z, i), { pressure = 0, velocity = 0 } = typeof raw === 'number' ? { pressure: raw } : raw ?? {};
      check(stateOK(pressure) && stateOK(velocity), 'initial pressure and velocity must be finite and bounded');
      speeds[i] = c; damp[i] = d;
      pressureStart[i] = pressure; velocityStart[i] = velocity;
      cellsX[i] = x; cellsZ[i] = z;
      active.push(i);
      fastest = Math.max(c, fastest);
    }
    check(active.length > 0, 'wave domain needs an open cell');
    const ux = 1 / (dx * dx), uz = 1 / (dz * dz);
    const dt = Math.min(maxDt, cfl / (fastest * Math.sqrt(ux + uz)));
    check(dt >= 1e-9, 'CFL time step is below the supported range');
    const absorption = strength ?? 7 * fastest / (cells * Math.min(dx, dz));
    const wallFace = faceKind(wall);
    function link(a, b, axis) {
      if (!open[a] && !open[b]) return;
      const across = open[a] && open[b] && !barrier?.([cellsX[a], cellsZ[a]], [cellsX[b], cellsZ[b]], axis === 0 ? 'x' : 'z');
      if (open[a]) faces[4 * a + axis * 2 + 1] = across ? b : wallFace;
      if (open[b]) faces[4 * b + axis * 2] = across ? a : wallFace;
    }
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
      const i = z * width + x;
      if (x + 1 < width) link(i, i + 1, 0);
      if (z + 1 < height) link(i, i + width, 1);
      if (!open[i]) continue;
      const distances = [x, width - 1 - x, z, height - 1 - z];
      let layer = 0;
      for (const [j, side] of sides.entries()) {
        const distance = distances[j], kind = edges[side];
        if (distance === 0) faces[i * 4 + j] = faceKind(kind);
        if (kind === 'absorb' && distance < cells) layer = Math.max(layer, (1 - (distance + .5) / cells) ** 2);
      }
      const rate = damp[i] + absorption * layer;
      damp[i] = rate;
      drag[i] = Math.exp(-2 * rate * dt);
      gain[i] = rate ? -Math.expm1(-2 * rate * dt) / (2 * rate) : dt;
    }

    function read(values, target, value) { return target >= 0 ? values[target] : target === fixedFace ? -value : value; }
    function laplace(values, i, value) {
      const offset = i * 4;
      const x = read(values, faces[offset], value) + read(values, faces[offset + 1], value) - 2 * value;
      const z = read(values, faces[offset + 2], value) + read(values, faces[offset + 3], value) - 2 * value;
      return x * ux + z * uz;
    }
    const rateStart = velocityStart.slice();
    for (const i of active) {
      const u = pressureStart[i], v = velocityStart[i];
      rateStart[i] = v - .5 * dt * (speeds[i] ** 2 * laplace(pressureStart, i, u) - 2 * damp[i] * v);
      check(stateOK(rateStart[i]), 'initial staggered velocity exceeds range');
    }
    const starting = { pressure: pressureStart, rate: rateStart, tick: 0 };
    let state = starting, revision = 0, cached, busy = false;
    const signature = hash(JSON.stringify([bounds, width, height, dt, Array.from(faces), Array.from(speeds), Array.from(damp)]));
    function available() { check(!busy, 'cannot edit the wave while its source is being sampled'); }
    function commit(next) { state = next; revision++; cached = undefined; }

    function step(count = 1, { source } = {}) {
      available();
      check(integer(count, 1, 20000) && count * active.length * 8 <= maxWork && state.tick + count <= Number.MAX_SAFE_INTEGER &&
        (source === undefined || typeof source === 'function'), 'step exceeds budget or has an invalid source');
      let u = state.pressure.slice(), v = state.rate.slice(), nextU = new Float64Array(size), nextV = new Float64Array(size);
      busy = true;
      try {
        for (let j = 0; j < count; j++) {
          const time = (state.tick + j) * dt;
          for (const i of active) {
            const value = u[i], force = source ? source(cellsX[i], cellsZ[i], time, i) : 0;
            check(stateOK(force), 'source acceleration must be finite and bounded');
            const rate = drag[i] * v[i] + gain[i] * (speeds[i] ** 2 * laplace(u, i, value) + force);
            const pressure = value + dt * rate;
            check(stateOK(pressure) && stateOK(rate), 'wave state exceeded its finite range');
            nextU[i] = pressure; nextV[i] = rate;
          }
          [u, nextU] = [nextU, u]; [v, nextV] = [nextV, v];
        }
      } finally { busy = false; }
      commit({ pressure: u, rate: v, tick: state.tick + count });
      return state.tick;
    }

    function kick({ at, radius, amount, channel = 'velocity' } = {}) {
      available();
      check(vector(at, 2) && at.every(n => Math.abs(n) <= 1e9) && number(radius, 1e-7, 1e6) && stateOK(amount) &&
        ['pressure', 'velocity'].includes(channel), 'kick needs a point, radius, amount and pressure or velocity channel');
      const name = channel === 'pressure' ? 'pressure' : 'rate', next = state[name].slice();
      let hits = 0;
      for (const i of active) {
        const distance = Math.hypot(cellsX[i] - at[0], cellsZ[i] - at[1]) / radius;
        if (distance >= 1) continue;
        const value = next[i] + amount * (1 - distance * distance) ** 2;
        check(stateOK(value), 'kick exceeded the finite range');
        next[i] = value; hits++;
      }
      if (hits) commit({ ...state, [name]: next });
      return hits;
    }

    function interpolated(values, x, z) {
      if (!hasGeometry) return domain.sample(values, x, z);
      if (!domain.inside(x, z)) return 0;
      const gridX = (x - bounds.min[0]) / dx, gridZ = (z - bounds.min[1]) / dz;
      const col = Math.min(width - 1, Math.floor(gridX)), row = Math.min(height - 1, Math.floor(gridZ));
      const i = row * width + col;
      const a = Math.floor(gridX - .5), b = Math.floor(gridZ - .5), f = gridX - .5 - a, g = gridZ - .5 - b;
      let total = 0, weight = 0;
      for (let v = 0; v <= 1; v++) for (let u = 0; u <= 1; u++) {
        const j = Math.max(0, Math.min(width - 1, a + u)), k = Math.max(0, Math.min(height - 1, b + v));
        const target = k * width + j;
        if (!open[target]) continue;
        const horizontal = j === col ? i : faces[i * 4 + Number(j > col)];
        const vertical = k === row ? i : faces[i * 4 + 2 + Number(k > row)];
        const connected = horizontal === target || vertical === target || j !== col && k !== row &&
          (horizontal >= 0 && faces[horizontal * 4 + 2 + Number(k > row)] === target ||
            vertical >= 0 && faces[vertical * 4 + Number(j > col)] === target);
        if (!connected) continue;
        const w = (u ? f : 1 - f) * (v ? g : 1 - g);
        weight += w; total += w * values[target];
      }
      return weight ? total / weight : values[i];
    }

    function frame() {
      if (cached) return cached;
      const captured = state, { pressure, rate, tick } = captured;
      let power;
      function energy() {
        if (power) return power;
        power = new Float64Array(size);
        for (const i of active) {
          const u = pressure[i], offset = i * 4;
          const a = read(pressure, faces[offset], u) - u, b = read(pressure, faces[offset + 1], u) - u;
          const c = read(pressure, faces[offset + 2], u) - u, d = read(pressure, faces[offset + 3], u) - u;
          power[i] = .5 * rate[i] ** 2 + .25 * speeds[i] ** 2 * ((a * a + b * b) * ux + (c * c + d * d) * uz);
        }
        return power;
      }
      const buffer = name => name === 'pressure' ? pressure : name === 'velocity' ? rate : name === 'energy' ? energy() : undefined;
      function sample(name, x, z) {
        const values = buffer(name);
        return values ? interpolated(values, x, z) : 0;
      }
      function source(name, { bounds: world, project, units = null } = {}) {
        check(channels.includes(name) && (project === undefined || typeof project === 'function') && (!project || world),
          'scalar source needs a known channel and XYZ bounds for a custom projection');
        const box = world ?? { min: [bounds.min[0], 0, bounds.min[1]], max: [bounds.max[0], 0, bounds.max[1]] };
        return K.fieldViews.source({ type: 'number', bounds: box, units, sample(x, y, z) {
          const p = project ? project([x, y, z]) : [x, z];
          return vector(p, 2) && domain.inside(...p) ? sample(name, ...p) : null;
        } });
      }
      cached = Object.freeze({ tick, time: tick * dt, dt, width, height, bounds, channels,
        sample, source, contains: domain.inside, data: name => buffer(name)?.slice(), mask: () => open.slice() });
      return cached;
    }

    return Object.freeze({ width, height, bounds, channels, dimensions: 2, dt, boundary: edges,
      step, kick, frame, get tick() { return state.tick; }, get time() { return state.tick * dt; }, get revision() { return revision; },
      checkpoint() { return { format: 'ink-studio/scalar-wave', version: 1, signature, tick: state.tick,
        pressure: Array.from(state.pressure), velocity: Array.from(state.rate) }; },
      restore(saved) {
        available();
        check(saved?.format === 'ink-studio/scalar-wave' && saved.version === 1 && saved.signature === signature &&
          integer(saved.tick, 0, Number.MAX_SAFE_INTEGER) && [saved.pressure, saved.velocity].every(row =>
            sequence(row) && row.length === size), 'checkpoint is incompatible');
        const read = values => Float64Array.from(values, (n, i) => {
          check(stateOK(n) && (open[i] || n === 0), 'checkpoint has invalid pressure or velocity');
          return n;
        });
        const pressure = read(saved.pressure), rate = read(saved.velocity);
        commit({ pressure, rate, tick: saved.tick });
        return state.tick;
      },
      reset() { available(); commit(starting); }
    });
  }
  M.scalarWave = create;
})(KIT);
