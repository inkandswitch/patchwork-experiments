/* Chronological first-claim growth on a masked, cell-centered XZ grid. */
(function (K) {
  const P = K.procedural;
  const number = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const pair = p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const record = v => v != null && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const list = (v, max) => Array.isArray(v) && v.length >= 1 && v.length <= max && Array.from(v).every(record);
  const check = (ok, message) => { if (!ok) throw new RangeError('Competitive growth: ' + message); };
  const timeOK = t => t === Infinity || Number.isFinite(t) && t >= 0;
  const channels = Object.freeze(['arrival', 'age', 'material', 'seed']);

  function competitive(options = {}) {
    const { materials, seeds, pace, neighbors = 8 } = options;
    check(list(materials, 64) && list(seeds, 1024) &&
      (pace === undefined || typeof pace === 'function') && [4, 8].includes(neighbors),
      'expected bounded material and seed lists, a pace function, and 4 or 8 neighbors');
    const { width, height, size, dx, dz, ox, oz, bounds, open, center, inside } = P.motion.gridDomain(options);
    function index(x, z) {
      return inside(x, z) ? Math.min(width - 1, Math.floor((x - ox) / dx)) +
        width * Math.min(height - 1, Math.floor((z - oz) / dz)) : -1;
    }

    const offsets = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    if (neighbors === 8) offsets.push([1, 1], [-1, 1], [-1, -1], [1, -1]);
    const names = new Map();
    const settings = materials.map(({ id, speed = 1, angle = 0, stretch = 1, drift = 0 }, i) => {
      check(typeof id === 'string' && id.length > 0 && !names.has(id) &&
        number(speed, .0001, 1000) && number(angle, -1e6, 1e6) && number(stretch, 1, 12) && number(drift, -.85, .85),
        'materials need unique IDs and bounded speed and directional controls');
      names.set(id, i);
      return { id, speed, angle, stretch, drift };
    });
    const costs = settings.map(({ speed, angle, stretch, drift }) => {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      return offsets.map(([c, r]) => {
        const x = c * dx, z = r * dz, length = Math.hypot(x, z);
        const along = x * cos + z * sin, across = z * cos - x * sin;
        return Math.hypot(along / stretch, across) / (speed * (1 + drift * along / length));
      });
    });
    const starts = seeds.map(({ at, material, time = 0 }) => {
      check(pair(at) && names.has(material) && number(time, 0, 1e6), 'seeds need an XZ point, material ID and bounded start time');
      const i = index(...at);
      check(i >= 0, 'seed must lie in an open cell');
      return { at: at.slice(), cell: i, material, time };
    });
    const slowness = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      if (!open[i]) continue;
      const value = pace ? pace(...center(i), i) : 1;
      check(number(value, .02, 16), 'pace must return a speed multiplier between .02 and 16');
      slowness[i] = 1 / value;
    }

    const arrival = new Float64Array(size).fill(Infinity), owner = new Int32Array(size).fill(-1);
    const root = new Int32Array(size).fill(-1);
    const seedMaterial = starts.map(s => names.get(s.material));
    const queue = new ProceduralHeap((a, b) => a.time < b.time ||
      a.time === b.time && (a.seed < b.seed || a.seed === b.seed && a.i < b.i));

    function offer(i, time, seed) {
      if (owner[i] >= 0 || time > arrival[i] || time === arrival[i] && seed >= root[i]) return;
      arrival[i] = time;
      root[i] = seed;
      queue.push({ i, time, seed });
    }
    starts.forEach(({ cell, time }, seed) => offer(cell, time, seed));
    let endTime = 0;
    while (queue.size) {
      const { i, time, seed } = queue.pop();
      if (owner[i] >= 0 || time !== arrival[i] || seed !== root[i]) continue;
      const material = seedMaterial[seed], c = i % width, r = Math.floor(i / width);
      owner[i] = material;
      endTime = time;
      for (let k = 0; k < offsets.length; k++) {
        const [u, v] = offsets[k], col = c + u, row = r + v;
        if (col < 0 || col >= width || row < 0 || row >= height) continue;
        const j = row * width + col;
        if (!open[j] || owner[j] >= 0 || u && v && (!open[i + u] || !open[i + v * width])) continue;
        const travel = costs[material][k] * (slowness[i] + slowness[j]) / 2;
        // Keep even the smallest hop chronological when a source has a large launch time.
        offer(j, time + Math.max(travel, Number.EPSILON * time), seed);
      }
    }

    const seamCache = new Map();
    function seams(by) {
      if (seamCache.has(by)) return seamCache.get(by);
      const labels = by === 'seed' ? root : owner;
      const segments = [];
      function add(i, j, c, r, vertical) {
        if (labels[j] < 0 || labels[j] === labels[i]) return;
        const a = [ox + c * dx, oz + r * dz];
        const b = [ox + (c + Number(!vertical)) * dx, oz + (r + Number(vertical)) * dz];
        segments.push({ a, b, cells: [i, j], materials: [settings[owner[i]].id, settings[owner[j]].id],
          seeds: [root[i], root[j]], time: Math.max(arrival[i], arrival[j]) });
      }
      for (let i = 0; i < size; i++) {
        if (labels[i] < 0) continue;
        const c = i % width, r = Math.floor(i / width);
        if (c + 1 < width) add(i, i + 1, c + 1, r, true);
        if (r + 1 < height) add(i, i + width, c, r + 1, false);
      }
      const output = P.data.freeze(segments);
      seamCache.set(by, output);
      return output;
    }

    function frame(time = endTime) {
      check(timeOK(time), 'frame time must be nonnegative');
      const clock = time === Infinity ? endTime : time;
      const claimed = i => owner[i] >= 0 && arrival[i] <= clock;
      function values(channel) {
        check(channels.includes(channel), 'unknown growth channel');
        if (channel === 'material') return owner;
        if (channel === 'seed') return root;
        return arrival;
      }
      function data(channel = 'material') {
        const buffer = values(channel);
        const age = channel === 'age', missing = buffer === arrival ? Infinity : -1;
        return buffer.map((value, i) => {
          if (!claimed(i)) return missing;
          return age ? clock - value : value;
        });
      }
      function sample(channel, x, z) {
        const buffer = values(channel), i = index(x, z);
        if (!claimed(i)) return null;
        return channel === 'age' ? clock - arrival[i] : buffer[i];
      }
      function source(channel = 'arrival', { bounds: box, project, units = null } = {}) {
        values(channel);
        check(project === undefined || typeof project === 'function' && box, 'a custom projection requires world bounds');
        const world = box ?? { min: [bounds.min[0], 0, bounds.min[1]], max: [bounds.max[0], 0, bounds.max[1]] };
        return K.fieldViews.source({ type: 'number', bounds: world, units, sample(x, y, z) {
          const at = project ? project([x, y, z]) : [x, z];
          return pair(at) ? sample(channel, ...at) : null;
        } });
      }
      function contacts({ by = 'material' } = {}) {
        check(by === 'material' || by === 'seed', 'select material or seed seams');
        const segments = seams(by);
        return clock >= endTime ? segments : Object.freeze(segments.filter(segment => segment.time <= clock));
      }
      function outputs() {
        return K.fieldOutputs.create({ bounds, sampleChannel: sample,
          channels: { arrival: {}, age: {}, material: { type: 'category' }, seed: { type: 'category' } } });
      }
      return Object.freeze({ time: clock, data, sample, source, seams: contacts, outputs });
    }

    return Object.freeze({ width, height, bounds, endTime, materials: P.data.freeze(settings), seeds: P.data.freeze(starts),
      center, mask: () => open.slice(), frame });
  }

  P.growth.competitive = competitive;
})(KIT);
