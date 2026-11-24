/* Retained inference for data-only neural cellular update rules. */
const LearnedCellular = (() => {
  const { hash } = KIT.procedural.data;
  const finite = Number.isFinite, integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const number = (n, lo, hi) => finite(n) && n >= lo && n <= hi;
  const sequence = v => Array.isArray(v) || ArrayBuffer.isView(v) && Number.isSafeInteger(v.length);
  const tuple = (v, n) => Array.isArray(v) && v.length === n && Array.from(v).every(finite);
  const nameOK = name => typeof name === 'string' && /^[a-zA-Z][\w-]{0,47}$/.test(name);
  const record = v => v != null && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const check = (ok, message) => { if (!ok) throw new RangeError('Learned cellular: ' + message); };
  const modelType = 'ink-studio/neural-cellular', checkpointType = 'ink-studio/neural-cellular-checkpoint';
  const features = {
    identity: [[4, 1]],
    sobelX: [[0, -.125], [2, .125], [3, -.25], [5, .25], [6, -.125], [8, .125]],
    sobelY: [[0, -.125], [1, -.25], [2, -.125], [6, .125], [7, .25], [8, .125]],
    laplacian: [[1, .25], [3, .25], [4, -1], [5, .25], [7, .25]]
  };
  const models = new WeakMap(), maxMagnitude = 64, maxWork = 200000000;
  const stateOK = value => number(value, -maxMagnitude, maxMagnitude);
  const wrap = (value, n) => (value % n + n) % n;

  function packed(input, size, test, message) {
    check(sequence(input) && input.length === size, message);
    return Float32Array.from(input, value => { check(test(value), message); return value; });
  }

  function compile(model) {
    if (models.has(model)) return model;
    check(record(model) && model.format === modelType && model.version === 1, 'expected a version-1 neural cellular model');
    const { channels, perception, alpha, aliveThreshold = .1, updateRate = .5, seedState, hidden, delta } = model;
    check(Array.isArray(channels) && integer(channels.length, 1, 16) && Array.from(channels).every(nameOK) &&
      new Set(channels).size === channels.length && channels.includes(alpha), 'model needs 1–16 unique channels and an alpha channel');
    check(Array.isArray(perception) && integer(perception.length, 1, 4) && Array.from(perception).every(name =>
      typeof name === 'string' && Object.hasOwn(features, name)) && new Set(perception).size === perception.length,
    'model needs distinct supported perception filters');
    check(number(aliveThreshold, 0, 1) && number(updateRate, 0, 1) && updateRate > 0 &&
      record(hidden) && record(delta) && sequence(hidden.bias) && integer(hidden.bias.length, 1, 128),
    'invalid model controls or hidden width');
    const count = channels.length, inputSize = count * perception.length, hiddenSize = hidden.bias.length;
    const weight = value => number(value, -128, 128);
    const loadLayer = (layer, inputs, outputs) => ({
      bias: packed(layer.bias, outputs, weight, 'layer bias has an invalid shape or coefficient'),
      weights: packed(layer.weights, inputs * outputs, weight, 'layer weights have an invalid shape or coefficient')
    });
    const first = loadLayer(hidden, inputSize, hiddenSize), second = loadLayer(delta, hiddenSize, count);
    const alphaIndex = channels.indexOf(alpha), seed = packed(seedState, count, stateOK, 'invalid model seed state');
    check(seed[alphaIndex] > aliveThreshold, 'model seed must be alive');
    const filterTaps = perception.map(name => features[name]);
    const signature = hash(JSON.stringify([channels, perception, alpha, aliveThreshold, updateRate, Array.from(seed),
      Array.from(first.bias), Array.from(first.weights), Array.from(second.bias), Array.from(second.weights)]));
    const rule = Object.freeze({ format: modelType, version: 1, channels: Object.freeze(channels.slice()),
      perception: Object.freeze(perception.slice()), alpha, aliveThreshold, updateRate, hiddenSize,
      seedState: Object.freeze(Array.from(seed)) });
    models.set(rule, { signature, count, alphaIndex, filterTaps, first, second, inputSize, seed });
    return rule;
  }

  function dense({ bias, weights }, inputs, output, relu) {
    for (let i = 0, w = 0; i < output.length; i++) {
      let sum = bias[i];
      for (let j = 0; j < inputs.length; j++) sum += inputs[j] * weights[w++];
      output[i] = relu ? Math.max(0, sum) : sum;
    }
  }

  function chance(bits) {
    bits = Math.imul(bits ^ (bits >>> 16), 0x7feb352d);
    bits = Math.imul(bits ^ (bits >>> 15), 0x846ca68b);
    return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
  }

  function create({ model, width, height, seed = 0, boundary = 'empty', initial,
    bounds = { min: [0, 0], max: [1, 1] } } = {}) {
    const rule = compile(model), { channels, hiddenSize, aliveThreshold, updateRate } = rule;
    const { signature, count, alphaIndex, filterTaps, first, second, inputSize, seed: seedValues } = models.get(rule);
    check(integer(width, 1, 256) && integer(height, 1, 256) && Number.isSafeInteger(seed) &&
      ['empty', 'wrap'].includes(boundary), 'expected bounded 2D grid dimensions, seed and boundary');
    const { min, max } = bounds ?? {};
    check(tuple(min, 2) && tuple(max, 2) && min.every((lo, i) => Math.abs(lo) <= 1e6 && Math.abs(max[i]) <= 1e6 &&
      max[i] - lo >= 1e-6), 'chart bounds must be finite and increasing');
    const box = Object.freeze({ min: Object.freeze(min.slice()), max: Object.freeze(max.slice()) });
    const counts = Object.freeze([width, height]), size = width * height, values = size * count;
    const spacing = counts.map((n, i) => (max[i] - min[i]) / n);
    const indices = new Map(channels.map((name, i) => [name, i]));
    const at = (x, y) => integer(x, 0, width - 1) && integer(y, 0, height - 1);
    const index = (x, y) => y * width + x;
    const periodic = boundary === 'wrap';
    const layout = hash(JSON.stringify([width, height, boundary, seed, box]), signature);
    const links = new Int32Array(9 * size).fill(-1);
    for (let i = 0; i < size; i++) for (let j = 0; j < 9; j++) {
      let x = i % width + j % 3 - 1, y = Math.floor(i / width) + Math.floor(j / 3) - 1;
      if (periodic) { x = wrap(x, width); y = wrap(y, height); }
      if (at(x, y)) links[i * 9 + j] = index(x, y) * count;
    }
    let original;
    if (typeof initial === 'function') {
      original = new Float32Array(values);
      for (let i = 0; i < size; i++) original.set(packed(initial({ x: i % width, y: Math.floor(i / width) }), count,
        stateOK, 'initial cell must contain one bounded value per channel'), i * count);
    } else original = initial === undefined ? new Float32Array(values) : packed(initial, values, stateOK,
      'initial state must contain one bounded value per cell and channel');
    let grid = original, tick = 0, revision = 0, cached;
    function commit(state, time = tick) { grid = state; tick = time; revision++; cached = undefined; }
    const cell = (x, y) => { check(at(x, y), 'cell coordinates are outside the grid'); return index(x, y) * count; };

    function alive(state, start) {
      for (let j = start; j < start + 9; j++) {
        const offset = links[j];
        if (offset >= 0 && state[offset + alphaIndex] > aliveThreshold) return true;
      }
      return false;
    }

    const perCell = inputSize * hiddenSize + count * hiddenSize + count * filterTaps.reduce((n, taps) => n + taps.length, 0) + 27;
    function step(steps = 1) {
      check(integer(steps, 1, 10000) && tick + steps <= Number.MAX_SAFE_INTEGER && steps * size * perCell <= maxWork,
        'step batch exceeds the inference budget');
      const sensed = new Float32Array(inputSize), activated = new Float32Array(hiddenSize), delta = new Float32Array(count);
      const before = new Uint8Array(size), after = new Uint8Array(size);
      let current = grid, next = new Float32Array(values);
      const spare = steps > 1 ? new Float32Array(values) : null;
      for (let s = 0; s < steps; s++) {
        const scope = hash('neural-cellular/' + (tick + s + 1), seed);
        for (let i = 0; i < size; i++) {
          const start = i * 9, offset = i * count;
          before[i] = Number(alive(current, start));
          if (!before[i]) { next.fill(0, offset, offset + count); continue; }
          if (updateRate < 1 && chance(scope ^ Math.imul(i + 1, 0x9e3779b1)) >= updateRate) {
            for (let c = 0; c < count; c++) next[offset + c] = current[offset + c];
            continue;
          }
          let k = 0;
          for (let c = 0; c < count; c++) for (const taps of filterTaps) {
            let value = 0;
            for (const [j, weight] of taps) {
              const from = links[start + j];
              if (from >= 0) value += current[from + c] * weight;
            }
            sensed[k++] = value;
          }
          dense(first, sensed, activated, true);
          dense(second, activated, delta, false);
          for (let c = 0; c < count; c++) {
            const value = current[offset + c] + delta[c];
            check(stateOK(value), 'model left the bounded state range');
            next[offset + c] = value;
          }
        }
        for (let i = 0; i < size; i++) after[i] = Number(before[i] && alive(next, i * 9));
        for (let i = 0; i < size; i++) if (!after[i]) next.fill(0, i * count, (i + 1) * count);
        const old = current;
        current = next;
        next = s === 0 ? spare : old;
      }
      commit(current, tick + steps);
      return tick;
    }

    function edit(changes) {
      check(Array.isArray(changes) && changes.length <= size, 'expected a bounded cell edit list');
      if (!changes.length) return;
      const next = grid.slice();
      for (const change of changes) {
        const { x, y, state } = change ?? {};
        const offset = cell(x, y);
        next.set(packed(state, count, stateOK, 'edit must contain one bounded value per channel'), offset);
      }
      commit(next);
    }
    function seedAt(x, y) { edit([{ x, y, state: seedValues }]); }

    function erase({ at: point, radius } = {}) {
      check(tuple(point, 2) && point.every(n => Math.abs(n) <= 1e6) && number(radius, 0, 512),
        'erase needs a finite cell-space center and radius');
      const next = grid.slice(), distance = (delta, n) => periodic ? wrap(delta + n / 2, n) - n / 2 : delta;
      let touched = 0;
      for (let y = 0; y < height; y++) {
        const dy = distance(y - point[1], height);
        if (Math.abs(dy) > radius) continue;
        for (let x = 0; x < width; x++) {
          const dx = distance(x - point[0], width);
          if (dx * dx + dy * dy > radius * radius) continue;
          const start = index(x, y) * count;
          next.fill(0, start, start + count); touched++;
        }
      }
      if (touched) commit(next);
      return touched;
    }

    function frame() {
      if (cached) return cached;
      const snapshot = grid, time = tick;
      const inside = (u, v) => number(u, box.min[0], box.max[0]) && number(v, box.min[1], box.max[1]);
      const nearest = (n, length) => periodic ? wrap(n, length) : Math.max(0, Math.min(length - 1, n));
      function sample(name, u, v) {
        const c = indices.get(name);
        if (c === undefined || !inside(u, v)) return 0;
        const x = (u - box.min[0]) / spacing[0] - .5, y = (v - box.min[1]) / spacing[1] - .5;
        const a = Math.floor(x), b = Math.floor(y), fx = x - a, fy = y - b;
        const x0 = nearest(a, width), x1 = nearest(a + 1, width), y0 = nearest(b, height), y1 = nearest(b + 1, height);
        const read = (x, y) => snapshot[index(x, y) * count + c];
        return (1 - fy) * ((1 - fx) * read(x0, y0) + fx * read(x1, y0)) +
          fy * ((1 - fx) * read(x0, y1) + fx * read(x1, y1));
      }
      cached = Object.freeze({ width, height, counts, bounds: box, tick: time, time,
        data(name) {
          const c = indices.get(name);
          if (c === undefined) return undefined;
          return Float32Array.from({ length: size }, (_, i) => snapshot[i * count + c]);
        },
        get(x, y) { const start = cell(x, y); return snapshot.slice(start, start + count); }, sample,
        source(name, { bounds, project, units = null } = {}) {
          check(indices.has(name) && typeof project === 'function', 'field source needs a known channel and a world projection');
          return KIT.fieldViews.source({ type: 'number', bounds, units, sample(x, y, z) {
            const point = project([x, y, z]);
            return tuple(point, 2) && inside(...point) ? sample(name, ...point) : null;
          } });
        }
      });
      return cached;
    }

    return Object.freeze({ model: rule, channels, dimensions: 2, width, height, counts, bounds: box, step, seedAt, edit, erase, frame,
      get tick() { return tick; }, get revision() { return revision; },
      checkpoint() { return { format: checkpointType, version: 1, signature: layout, tick, cells: Array.from(grid) }; },
      restore(saved) {
        check(saved?.format === checkpointType && saved.version === 1 && saved.signature === layout &&
          integer(saved.tick, 0, Number.MAX_SAFE_INTEGER), 'checkpoint is incompatible');
        const cells = packed(saved.cells, values, stateOK, 'invalid checkpoint state');
        commit(cells, saved.tick);
        return tick;
      },
      reset() { commit(original, 0); }
    });
  }
  return Object.freeze({ compile, create });
})();
