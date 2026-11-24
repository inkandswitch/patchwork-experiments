/* Editable Gray–Scott cultures on sampled and explicitly linked UV charts. */
(function (K) {
  const P = K.procedural, finite = Number.isFinite, ends = ['u0', 'u1', 'v0', 'v1'];
  const names = Object.freeze(['u', 'v', 'feed', 'kill']);
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const unit = n => finite(n) && n >= 0 && n <= 1;
  const clamp = n => Math.max(0, Math.min(1, n));
  const tuple = (value, size, rule = finite) => Array.isArray(value) && value.length === size && Array.from(value).every(rule);
  const record = value => value != null && Object.getPrototypeOf(value) === Object.prototype;
  const nameOK = value => typeof value === 'string' && /^[a-zA-Z][\w-]{0,47}$/.test(value);
  const check = (ok, message) => { if (!ok) throw new RangeError('Reaction–diffusion: ' + message); };
  const format = 'ink-studio/reaction-diffusion';
  const defaultCarrier = Object.freeze({ sample: ([u, v]) => ({ p: [u, 0, v], du: [1, 0, 0], dv: [0, 0, 1] }) });

  function samplePoint(carrier, uv) {
    const value = carrier.sample(uv);
    check(tuple(value?.p, 3), 'carrier must return a finite XYZ point');
    return value;
  }

  function topology(specs, seams) {
    check(Array.isArray(specs) && integer(specs.length, 1, 64) && Array.isArray(seams) && seams.length <= specs.length * 2,
      'expected bounded charts and seams');
    let size = 0;
    const byId = new Map();
    const charts = Array.from(specs, spec => {
      const { id, width, height, carrier = defaultCarrier, mask } = spec ?? {};
      check(nameOK(id) && !byId.has(id) && integer(width, 3, 512) && integer(height, 3, 512) &&
        typeof carrier?.sample === 'function' && (mask === undefined || typeof mask === 'function'), 'invalid or duplicate chart');
      const chart = { id, width, height, carrier, mask, start: size, size: width * height };
      chart.cell = (x, y) => chart.start + y * width + x;
      size += chart.size;
      byId.set(id, chart);
      return chart;
    });
    check(size <= 180000, 'charts exceed the cell budget');
    const cells = new Array(size), active = new Uint8Array(size), mates = new Int32Array(size * 4).fill(-1);
    const links = [], lengths = [];
    const edge = (a, b, weight, length, dirA, dirB) => {
      if (!active[a] || !active[b]) return;
      links.push([a, b, weight]); lengths.push(length);
      if (dirA !== undefined) {
        mates[a * 4 + dirA] = b;
        mates[b * 4 + dirB] = a;
      }
    };
    for (const chart of charts) {
      const { id, width, height, mask, carrier, cell } = chart;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const uv = Object.freeze([(x + .5) / width, (y + .5) / height]), index = cell(x, y);
        const p = Object.freeze(samplePoint(carrier, uv).p.slice());
        const info = Object.freeze({ chart: id, x, y, uv, p, index });
        cells[index] = info;
        active[index] = Number(!mask || Boolean(mask(info)));
      }
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const a = cell(x, y);
        if (x + 1 < width) edge(a, cell(x + 1, y), 4, 1, 1, 0);
        if (y + 1 >= height) continue;
        edge(a, cell(x, y + 1), 4, 1, 3, 2);
        for (const dx of [1, -1]) if (x + dx >= 0 && x + dx < width && active[cell(x + dx, y)] && active[cell(x, y + 1)])
          edge(a, cell(x + dx, y + 1), 1, Math.SQRT2);
      }
    }

    function side(raw) {
      const chart = byId.get(raw?.[0]), dir = ends.indexOf(raw?.[1]);
      check(tuple(raw, 2, v => typeof v === 'string') && chart && dir >= 0, 'seam endpoints need a chart and one of u0, u1, v0, v1');
      const { width, height, cell } = chart;
      return { chart, dir, key: chart.id + ':' + dir, count: dir < 2 ? height : width,
        at(i) { return dir < 2 ? cell(dir === 0 ? 0 : width - 1, i) : cell(i, dir === 2 ? 0 : height - 1); } };
    }
    const used = new Set();
    const joined = Array.from(seams, ({ a, b, reverse = false, weight = 4 } = {}) => {
      const from = side(a), to = side(b);
      check(from.count === to.count && from.key !== to.key && !used.has(from.key) && !used.has(to.key) &&
        (from.chart !== to.chart || (from.dir >> 1) === (to.dir >> 1)) &&
        typeof reverse === 'boolean' && finite(weight) && weight >= .001 && weight <= 1e6,
      'seams need unused edges, matching sample counts and positive weights');
      used.add(from.key); used.add(to.key);
      const n = from.count;
      const other = i => to.at(reverse ? n - i - 1 : i);
      for (let i = 0; i < n; i++) {
        const a = from.at(i), b = other(i);
        edge(a, b, weight, 1, from.dir, to.dir);
        if (i + 1 >= n || !active[a] || !active[b] || !active[from.at(i + 1)] || !active[other(i + 1)]) continue;
        edge(a, other(i + 1), weight / 4, Math.SQRT2);
        edge(from.at(i + 1), b, weight / 4, Math.SQRT2);
      }
      return [from.key, to.key, reverse, weight];
    });
    return { charts, byId, cells, active, mates, links, lengths, joined };
  }

  function create({ charts: specs, seams = [], flow, initial, feed = .0367, kill = .0649, ...options } = {}) {
    check((flow == null || typeof flow === 'function') && (initial === undefined || typeof initial === 'function') &&
      [feed, kill].every(v => unit(v) || typeof v === 'function'), 'expected bounded initial settings and a flow sampler');
    const { charts, byId, cells, active, mates, links, lengths, joined } = topology(specs, seams);
    const n = cells.length;
    const prop = value => typeof value === 'function' ? (_p, i) => value(cells[i]) : value;
    const run = GrayScott.create(cells.map(cell => cell.p), links, {
      ...options, spots: [], feed: prop(feed), kill: prop(kill),
      initial: (_p, i) => active[i] && initial ? initial(cells[i]) : [1, 0]
    }, lengths);
    const { offsets, ids, distances, dt } = run;
    const signature = P.data.hash(JSON.stringify([charts.map(c => [c.id, c.width, c.height]), joined, Array.from(active), dt, run.du, run.dv]), 0);
    const revisionFrames = new Map(), surfaces = new Map(), bases = new Array(n);
    let frameRevision = -1;
    function resolve(id) {
      const chart = byId.get(id);
      check(chart, 'unknown chart ' + id);
      return chart;
    }

    function worldVelocity(i, chart, velocity) {
      const { carrier, width, height } = chart, { uv } = cells[i];
      if (!bases[i]) {
        const sample = samplePoint(carrier, uv);
        const difference = axis => {
          const lo = uv.slice(), hi = uv.slice(), d = .25 / (axis ? height : width);
          lo[axis] -= d; hi[axis] += d;
          return K.V.mul(K.V.sub(samplePoint(carrier, hi).p, samplePoint(carrier, lo).p), 1 / (2 * d));
        };
        bases[i] = [tuple(sample.du, 3) ? sample.du.slice() : difference(0), tuple(sample.dv, 3) ? sample.dv.slice() : difference(1)];
      }
      return SurfaceVelocityProjection(...bases[i], velocity);
    }

    function transport(velocity) {
      const horizontal = new Float64Array(n), vertical = new Float64Array(n);
      const left = new Int32Array(n), top = new Int32Array(n);
      return (u, v, nextU, nextV, tick, dt, spend) => {
        spend(4 * n);
        const time = tick * dt, clock = Object.freeze({ tick, time, dt });
        let greatest = 0;
        for (const chart of charts) for (let i = chart.start; i < chart.start + chart.size; i++) {
          horizontal[i] = vertical[i] = 0;
          if (!active[i]) continue;
          const vector = velocity(cells[i], clock);
          if (vector == null) continue;
          check(tuple(vector, 2) || tuple(vector, 3), 'flow must return finite UV or XYZ vectors');
          const [x, y] = vector.length === 3 ? worldVelocity(i, chart, vector) : vector;
          check(finite(x) && finite(y), 'flow exceeds the finite UV range');
          left[i] = mates[4 * i + (x >= 0 ? 0 : 1)];
          top[i] = mates[4 * i + (y >= 0 ? 2 : 3)];
          horizontal[i] = left[i] < 0 ? 0 : Math.abs(x) * chart.width * dt;
          vertical[i] = top[i] < 0 ? 0 : Math.abs(y) * chart.height * dt;
          greatest = Math.max(greatest, horizontal[i] + vertical[i]);
        }
        if (!greatest) return;
        const steps = Math.ceil(greatest / .9);
        check(integer(steps, 1, 64), 'flow exceeds the advection substep limit');
        spend(2 * n * steps);
        for (let j = 0; j < steps; j++) {
          for (let i = 0; i < n; i++) {
            const a = left[i], b = top[i], dx = horizontal[i] / steps, dy = vertical[i] / steps;
            const cu = u[i], cv = v[i];
            nextU[i] = cu + (dx ? (u[a] - cu) * dx : 0) + (dy ? (u[b] - cu) * dy : 0);
            nextV[i] = cv + (dx ? (v[a] - cv) * dx : 0) + (dy ? (v[b] - cv) * dy : 0);
          }
          u.set(nextU); v.set(nextV);
        }
      };
    }

    function step(count = 1, { flow: velocity = flow } = {}) {
      check(velocity == null || typeof velocity === 'function', 'flow must be a sampler or null');
      return run.advance(count, velocity ? transport(velocity) : undefined);
    }

    function brush({ chart: id, at, radius, values, mode = 'replace', falloff = 'smooth' } = {}) {
      run.available();
      const chart = resolve(id);
      check(tuple(at, 2, unit) && finite(radius) && radius > 0 && radius <= 128 && record(values) &&
        Object.keys(values).length > 0 && ['replace', 'add'].includes(mode) && ['flat', 'smooth'].includes(falloff),
      'brush needs UV coordinates, a radius up to 128 cells and channel writes');
      const writes = Object.entries(values);
      check(writes.every(([name, value]) => names.includes(name) && (mode === 'replace' ? unit(value) : finite(value) && Math.abs(value) <= 1)),
        'unknown brush channel or invalid value');
      const x = Math.min(chart.width - 1, Math.floor(at[0] * chart.width));
      const y = Math.min(chart.height - 1, Math.floor(at[1] * chart.height));
      const first = chart.cell(x, y);
      if (!active[first]) return 0;
      const next = { ...run.channels };
      for (const [name] of writes) next[name] = run.channels[name].slice();
      const heap = new ProceduralHeap((a, b) => a.distance < b.distance || a.distance === b.distance && a.i < b.i);
      const visited = new Map([[first, 0]]);
      heap.push({ i: first, distance: 0 });
      let edited = 0;
      while (heap.size) {
        const { i, distance } = heap.pop();
        if (visited.get(i) !== distance) continue;
        const t = 1 - distance / radius, strength = falloff === 'flat' ? 1 : t * t * (3 - 2 * t);
        if (strength > 0) {
          for (const [name, value] of writes) {
            const original = run.channels[name][i];
            next[name][i] = clamp(original + strength * (mode === 'replace' ? value - original : value));
          }
          edited++;
        }
        for (let j = offsets[i]; j < offsets[i + 1]; j++) {
          const candidate = distance + distances[j], neighbor = ids[j];
          if (candidate > radius || candidate >= (visited.get(neighbor) ?? Infinity)) continue;
          visited.set(neighbor, candidate);
          heap.push({ i: neighbor, distance: candidate });
        }
      }
      run.commit(next);
      return edited;
    }

    function frame(id) {
      const chart = resolve(id);
      if (frameRevision !== run.revision) {
        revisionFrames.clear(); frameRevision = run.revision;
      }
      if (revisionFrames.has(id)) return revisionFrames.get(id);
      const { width, height, cell, start, size } = chart, current = run.channels;
      const xBound = x => Math.max(0, Math.min(width - 1, x)), yBound = y => Math.max(0, Math.min(height - 1, y));
      function read(plane, x, y) {
        const edge = cell(xBound(x), yBound(y));
        const side = x < 0 ? 0 : x >= width ? 1 : y < 0 ? 2 : y >= height ? 3 : -1;
        const target = side < 0 ? -1 : mates[edge * 4 + side];
        return plane[target < 0 ? edge : target];
      }
      const time = run.tick * dt;
      const result = Object.freeze({ chart: id, width, height, tick: run.tick, time,
        active(x, y) { return integer(x, 0, width - 1) && integer(y, 0, height - 1) && Boolean(active[cell(x, y)]); },
        data(name) { return names.includes(name) ? current[name].slice(start, start + size) : undefined; },
        sample(name, u, v) {
          if (!names.includes(name) || !unit(u) || !unit(v)) return 0;
          const x = u * width - .5, y = v * height - .5, a = Math.floor(x), b = Math.floor(y);
          const cx = xBound(Math.floor(u * width)), cy = yBound(Math.floor(v * height));
          const plane = current[name];
          if (!active[cell(cx, cy)]) return plane[cell(cx, cy)];
          const tx = x - a, ty = y - b;
          return (1 - ty) * ((1 - tx) * read(plane, a, b) + tx * read(plane, a + 1, b)) +
            ty * ((1 - tx) * read(plane, a, b + 1) + tx * read(plane, a + 1, b + 1));
        }
      });
      revisionFrames.set(id, result);
      return result;
    }

    function checkpoint() {
      return { format, version: 1, signature, tick: run.tick,
        channels: Object.fromEntries(names.map(name => [name, Array.from(run.channels[name])])) };
    }
    function restore(saved) {
      run.available();
      check(saved?.format === format && saved.version === 1 && saved.signature === signature &&
        integer(saved.tick, 0, Number.MAX_SAFE_INTEGER) && record(saved.channels) &&
        names.every(name => tuple(saved.channels[name], n, unit)), 'malformed or incompatible checkpoint');
      const next = Object.fromEntries(names.map(name => [name, Float64Array.from(saved.channels[name])]));
      for (let i = 0; i < n; i++) check(active[i] || next.u[i] === 1 && next.v[i] === 0, 'checkpoint contains reagent in inactive cells');
      run.commit(next, saved.tick);
      return run.tick;
    }
    return Object.freeze({ charts: Object.freeze(charts.map(({ id, width, height }) => Object.freeze({ id, width, height }))),
      dt, step, brush, frame, checkpoint, restore, reset: run.reset,
      get tick() { return run.tick; }, get revision() { return run.revision; },
      field(id) {
        resolve(id);
        if (!surfaces.has(id)) surfaces.set(id, Object.freeze({ dimensions: 2, channels: names, frame: () => frame(id),
          get revision() { return run.revision; } }));
        return surfaces.get(id);
      }
    });
  }
  P.growth.grayScott = Object.freeze({ create });
})(KIT);
