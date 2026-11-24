/* Addressed authoring randomness. Names, object keys and draw slots never share cursors. */
const Randomness = (() => {
  const algorithm = 'ink/counter-random/1',
    TWO32 = 4294967296,
    TWO52 = 4503599627370496;
  const plain = v => v && Object.getPrototypeOf(v) === Object.prototype;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    prepared = new WeakMap(),
    handles = new WeakMap();
  function record(v, keys, name) {
    if (!plain(v) || Object.keys(v).some(k => !keys.includes(k))) throw new TypeError('Randomness: invalid ' + name);
  }
  function number(v, lo = -1e9, hi = 1e9, name = 'number') {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError('Randomness: invalid ' + name);
    return v;
  }
  function integer(v, lo, hi, name) {
    number(v, lo, hi, name);
    if (!Number.isSafeInteger(v)) throw new RangeError('Randomness: ' + name + ' must be an integer');
    return v;
  }
  function atom(v) {
    if (typeof v === 'string' && v.length > 0 && v.length <= 256) return v;
    if (Number.isSafeInteger(v)) return Object.is(v, -0) ? 0 : v;
    throw new TypeError('Randomness: names and keys need nonempty strings or safe integers');
  }
  function path(v) {
    const values = Array.isArray(v) ? v : [v];
    if (!values.length || values.length > 32) throw new RangeError('Randomness: paths need 1 to 32 components');
    return Array.from(values, atom);
  }
  function freeze(v) {
    if (v && typeof v === 'object') {
      for (const q of Object.values(v)) freeze(q);
      Object.freeze(v);
    }
    return v;
  }
  function json(value) {
    let nodes = 0;
    const seen = new Set();
    function walk(v, depth) {
      if (++nodes > 8192 || depth > 16) throw new RangeError('Randomness: choice data exceeds its budget');
      if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if ((!Array.isArray(v) && !plain(v)) || seen.has(v))
        throw new TypeError('Randomness: choices need finite acyclic JSON data');
      seen.add(v);
      const out = Array.isArray(v)
        ? Array.from(v, q => walk(q, depth + 1))
        : Object.fromEntries(Object.entries(v).map(([k, q]) => [k, walk(q, depth + 1)]));
      seen.delete(v);
      return out;
    }
    return walk(value, 0);
  }
  function mix(x) {
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }
  function derive(key, tag, values) {
    // Typed JSON and a separate domain tag make ['a/b'] distinct from ['a','b'],
    // and numeric IDs distinct from identically printed string IDs.
    const text = JSON.stringify([tag, values.map(v => [typeof v, v])]),
      out = key.slice();
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      for (let j = 0; j < 4; j++) out[j] = Math.imul(out[j] ^ c ^ (j * 0x9e37), 16777619) >>> 0;
    }
    for (let j = 0; j < 4; j++) out[j] = mix(out[j] ^ key[(j + 1) % 4] ^ text.length);
    return out;
  }
  function word(key, index) {
    const lo = index >>> 0,
      hi = Math.floor(index / TWO32) >>> 0;
    return mix(mix(lo ^ key[0]) ^ mix(hi ^ key[1]) ^ key[2]) ^ key[3];
  }
  function source(key, budget) {
    let used = 0;
    function uint() {
      if (used >= budget) throw new RangeError('Randomness: sample exceeds its word budget');
      return word(key, used++) >>> 0;
    }
    function bits() {
      return (uint() >>> 6) * 67108864 + (uint() >>> 6);
    }
    return { uint, unit: () => bits() / TWO52, open: () => (bits() + 0.5) / TWO52 };
  }
  // Fixed-cost normal CDF (maximum absolute approximation error about 8e-8).
  function cdf(x) {
    const z = Math.abs(x),
      t = 1 / (1 + 0.2316419 * z),
      d = 0.3989422804014327 * Math.exp((-z * z) / 2);
    const tail = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x < 0 ? tail : 1 - tail;
  }
  function normalQuantile(p) {
    p = clamp(p, 1 / (2 * TWO52), 1 - 1 / (2 * TWO52));
    const a = [
        -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924
      ],
      b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857],
      c = [
        -0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497,
        2.93816398269878
      ],
      d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    if (p < 0.02425 || p > 1 - 0.02425) {
      const q = Math.sqrt(-2 * Math.log(p < 0.02425 ? p : 1 - p)),
        v =
          (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      return p < 0.02425 ? v : -v;
    }
    const q = p - 0.5,
      r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const fields = {
    uniform: ['min', 'max'],
    integer: ['min', 'max'],
    normal: ['mean', 'deviation', 'min', 'max', 'bounds'],
    logNormal: ['logMean', 'logDeviation', 'min', 'max'],
    triangular: ['min', 'max', 'mode'],
    exponential: ['mean', 'min', 'max'],
    power: ['min', 'max', 'exponent'],
    bernoulli: ['probability'],
    choice: ['values', 'weights'],
    correlated: ['channels', 'correlation']
  };
  let defaultDistribution;
  function distribution(raw) {
    if (raw === undefined) return (defaultDistribution ??= distribution({ type: 'uniform' }));
    if (prepared.has(raw)) return raw;
    if (!Object.hasOwn(fields, raw?.type)) throw new TypeError('Randomness: unknown distribution');
    const type = raw.type;
    record(raw, ['type', ...fields[type]], type + ' distribution');
    let spec = { type },
      quantile,
      draw,
      cost = 2;
    if (['uniform', 'integer', 'triangular', 'power'].includes(type)) {
      const min = number(raw.min ?? 0, type === 'integer' ? -2147483648 : -1e9, type === 'integer' ? 2147483647 : 1e9),
        max = number(raw.max ?? 1, type === 'integer' ? -2147483648 : -1e9, type === 'integer' ? 2147483647 : 1e9);
      if (min > max) throw new RangeError('Randomness: distribution bounds must be ordered');
      Object.assign(spec, { min, max });
      if (type === 'uniform') quantile = u => min + (max - min) * u;
      if (type === 'integer') {
        integer(min, -2147483648, 2147483647, 'integer minimum');
        integer(max, min, 2147483647, 'integer maximum');
        const width = max - min + 1,
          limit = Math.floor(TWO32 / width) * width;
        cost = 64;
        draw = random => {
          for (let i = 0; i < 64; i++) {
            const v = random.uint();
            if (v < limit) return min + (v % width);
          }
          throw new RangeError('Randomness: integer rejection budget exhausted');
        };
        quantile = u => min + Math.min(width - 1, Math.floor(u * width));
      }
      if (type === 'triangular') {
        const mode = number(raw.mode ?? (min + max) / 2, min, max, 'triangular mode');
        Object.assign(spec, { mode });
        quantile =
          min === max
            ? () => min
            : u =>
                u < (mode - min) / (max - min)
                  ? min + Math.sqrt(u * (max - min) * (mode - min))
                  : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
      }
      if (type === 'power') {
        const exponent = number(raw.exponent ?? 2, 0.01, 100, 'power exponent');
        Object.assign(spec, { exponent });
        quantile = u => min + (max - min) * u ** exponent;
      }
    }
    if (type === 'normal' || type === 'logNormal') {
      const log = type === 'logNormal',
        mean = number(log ? (raw.logMean ?? 0) : (raw.mean ?? 0), log ? -30 : -1e6, log ? 30 : 1e6, 'normal mean'),
        sd = number(log ? (raw.logDeviation ?? 1) : (raw.deviation ?? 1), 1e-8, log ? 8 : 1e6, 'normal deviation');
      const min = raw.min ?? (log ? 0 : undefined),
        max = raw.max ?? (log ? 1e9 : undefined),
        bounds = log ? 'truncate' : (raw.bounds ?? 'truncate');
      if (!['clamp', 'truncate'].includes(bounds))
        throw new TypeError('Randomness: normal bounds need clamp or truncate');
      if (min !== undefined) number(min, log ? 0 : -1e9, 1e9, 'normal minimum');
      if (max !== undefined) number(max, log ? Number.MIN_VALUE : -1e9, 1e9, 'normal maximum');
      if (min !== undefined && max !== undefined && min >= max)
        throw new RangeError('Randomness: normal bounds must have positive width');
      const lo = min === undefined ? -Infinity : log ? (min === 0 ? -Infinity : Math.log(min)) : min,
        hi = max === undefined ? Infinity : log ? Math.log(max) : max;
      const low = lo === -Infinity ? 0 : cdf((lo - mean) / sd),
        high = hi === Infinity ? 1 : cdf((hi - mean) / sd);
      if (bounds === 'truncate' && high - low < 1e-12)
        throw new RangeError('Randomness: truncated normal interval has insufficient probability mass');
      spec = {
        type,
        ...(log ? { logMean: mean, logDeviation: sd } : { mean, deviation: sd, bounds }),
        ...(min !== undefined && { min }),
        ...(max !== undefined && { max })
      };
      quantile = u => {
        if (u === 0 && min !== undefined) return min;
        if (u === 1 && max !== undefined) return max;
        const z = mean + sd * normalQuantile(bounds === 'truncate' ? low + (high - low) * u : u),
          value = log ? Math.exp(z) : z;
        return clamp(value, min ?? -1e9, max ?? 1e9);
      };
    }
    if (type === 'exponential') {
      const mean = number(raw.mean ?? 1, 1e-9, 1e6, 'exponential mean'),
        min = number(raw.min ?? 0, 0, 1e9),
        max = number(raw.max ?? 1e9, min, 1e9);
      if (min >= max) throw new RangeError('Randomness: exponential bounds need positive width');
      // Shifted conditional exponential avoids subtracting nearly equal tail CDFs.
      const mass = -Math.expm1(-(max - min) / mean);
      spec = { type, mean, min, max };
      quantile = u => Math.min(max, min - mean * Math.log1p(-u * mass));
    }
    if (type === 'bernoulli') {
      const probability = number(raw.probability ?? 0.5, 0, 1, 'probability');
      spec = { type, probability };
      quantile = u => probability === 1 || (probability > 0 && u >= 1 - probability);
    }
    if (type === 'choice') {
      if (!Array.isArray(raw.values) || !raw.values.length || raw.values.length > 1024)
        throw new RangeError('Randomness: choice needs 1 to 1024 values');
      const values = json(raw.values),
        weights = raw.weights === undefined ? values.map(() => 1) : raw.weights;
      if (!Array.isArray(weights) || weights.length !== values.length)
        throw new TypeError('Randomness: choice weights must match values');
      const copy = Array.from(weights, w => number(w, 0, 1e9, 'choice weight')),
        total = copy.reduce((a, b) => a + b, 0);
      if (!total) throw new RangeError('Randomness: choice needs positive total weight');
      const cumulative = [];
      let sum = 0;
      for (const w of copy) cumulative.push((sum += w / total));
      cumulative[cumulative.length - 1] = 1;
      spec = { type, values, weights: copy };
      quantile = u => {
        if (u === 1) {
          let index = copy.length - 1;
          while (copy[index] === 0) index--;
          return json(values[index]);
        }
        let lo = 0,
          hi = cumulative.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (u < cumulative[mid]) hi = mid;
          else lo = mid + 1;
        }
        return json(values[lo]);
      };
    }
    if (type === 'correlated') {
      const channels = raw.channels;
      if (!Array.isArray(channels) || !channels.length || channels.length > 32)
        throw new RangeError('Randomness: correlated recipes need 1 to 32 channels');
      const seen = new Set(),
        items = Array.from(channels, c => {
          record(c, ['name', 'distribution'], 'correlated channel');
          if (typeof c.name !== 'string' || !c.name.length || c.name.length > 256 || seen.has(c.name))
            throw new TypeError('Randomness: channel names must be distinct nonempty strings');
          seen.add(c.name);
          if (
            c.distribution?.type === 'correlated' ||
            (prepared.has(c.distribution) && c.distribution.spec.type === 'correlated')
          )
            throw new TypeError('Randomness: nested correlated channels are unsupported');
          const compiled = distribution(c.distribution);
          return { name: c.name, compiled };
        });
      const n = items.length,
        matrix = raw.correlation ?? items.map((_, i) => items.map((_, j) => +(i === j)));
      if (!Array.isArray(matrix) || matrix.length !== n || matrix.some(row => !Array.isArray(row) || row.length !== n))
        throw new TypeError('Randomness: correlation matrix must match channels');
      const C = matrix.map(row => Array.from(row, v => number(v, -1, 1, 'correlation'))),
        L = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (Math.abs(C[i][j] - C[j][i]) > 1e-10 || (i === j && Math.abs(C[i][j] - 1) > 1e-10))
            throw new RangeError('Randomness: correlation must be symmetric with unit diagonal');
      for (let i = 0; i < n; i++)
        for (let j = 0; j <= i; j++) {
          let v = C[i][j];
          for (let k = 0; k < j; k++) v -= L[i][k] * L[j][k];
          if (i === j) {
            if (v < -1e-10) throw new RangeError('Randomness: correlation must be positive semidefinite');
            L[i][j] = Math.sqrt(Math.max(0, v));
          } else if (L[j][j] > 1e-12) L[i][j] = v / L[j][j];
          else if (Math.abs(v) > 1e-10) throw new RangeError('Randomness: correlation must be positive semidefinite');
        }
      cost = n * 2;
      spec = { type, channels: items.map(c => ({ name: c.name, distribution: c.compiled.spec })), correlation: C };
      draw = (random, key, budget) => {
        if (cost > budget) throw new RangeError('Randomness: sample exceeds its word budget');
        const latent = items.map(c => normalQuantile(source(derive(key, 'latent', [c.name]), 2).open()));
        return Object.fromEntries(
          items.map((c, i) => {
            let z = 0;
            for (let j = 0; j <= i; j++) z += L[i][j] * latent[j];
            const u = clamp(cdf(z), 1 / (2 * TWO52), 1 - 1 / (2 * TWO52));
            return [c.name, c.compiled.quantile(u)];
          })
        );
      };
    }
    freeze(spec);
    const result = {
      spec,
      cost,
      ...(type !== 'correlated' && {
        quantile(u) {
          number(u, 0, 1, 'quantile');
          return quantile(u);
        }
      })
    };
    prepared.set(result, { draw: draw ?? (random => quantile(random.open())) });
    return Object.freeze(result);
  }
  function create(seed = 0, options = {}) {
    atom(seed);
    record(options, ['maxStreams', 'maxDraws', 'maxWords', 'maxBatch'], 'randomness budgets');
    const limits = freeze({
      maxStreams: integer(options.maxStreams ?? 1024, 1, 65536, 'stream budget'),
      maxDraws: integer(options.maxDraws ?? 1e7, 1, Number.MAX_SAFE_INTEGER, 'draw budget'),
      maxWords: integer(options.maxWords ?? 256, 1, 4096, 'word budget'),
      maxBatch: integer(options.maxBatch ?? 65536, 1, 1000000, 'batch budget')
    });
    const rootKey = derive([0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344], 'seed', [seed]),
      entries = new Map();
    function stream(...names) {
      const parts = path(names),
        id = JSON.stringify(parts);
      if (entries.has(id)) {
        const entry = entries.get(id);
        entry.active = true;
        return entry.handle;
      }
      if (entries.size >= limits.maxStreams) throw new RangeError('Randomness: named stream budget exceeded');
      const key = derive(rootKey, 'stream', parts),
        entry = { path: parts, key, cursor: 0, active: true };
      function generate(domain, address, spec) {
        const d = distribution(spec),
          sampleKey = derive(key, domain, address);
        return prepared.get(d).draw(source(sampleKey, limits.maxWords), sampleKey, limits.maxWords);
      }
      function at(index, spec) {
        integer(index, 0, limits.maxDraws - 1, 'draw index');
        return generate('index', [index], spec);
      }
      function next(spec) {
        const value = at(entry.cursor, spec);
        entry.cursor++;
        entry.active = true;
        return value;
      }
      const handle = Object.freeze({
        path: freeze(parts.slice()),
        seed32: mix(key[0] ^ key[1] ^ key[2] ^ key[3]) || 0x9e3779b9,
        next,
        at,
        sample: (address, spec) => generate('key', path(address), spec),
        fork: (...suffix) => stream(...parts, ...path(suffix)),
        seek(index = 0) {
          integer(index, 0, limits.maxDraws, 'stream cursor');
          entry.cursor = index;
          entry.active = true;
          return handle;
        },
        skip(count) {
          integer(count, 0, limits.maxDraws, 'skip count');
          return handle.seek(entry.cursor + count);
        },
        batch(count, spec) {
          integer(count, 0, limits.maxBatch, 'batch size');
          if (entry.cursor + count > limits.maxDraws) throw new RangeError('Randomness: batch exceeds draw budget');
          const saved = entry.cursor,
            active = entry.active,
            compiled = distribution(spec);
          try {
            return Array.from({ length: count }, () => next(compiled));
          } catch (e) {
            entry.cursor = saved;
            entry.active = active;
            throw e;
          }
        },
        order(keys) {
          if (!Array.isArray(keys) || keys.length > limits.maxBatch)
            throw new RangeError('Randomness: ranking exceeds batch budget');
          const used = new Set();
          return keys
            .map(value => {
              const k = path(value),
                id = JSON.stringify(k);
              if (used.has(id)) throw new TypeError('Randomness: ranking keys must be unique');
              used.add(id);
              return { value, id, key: k };
            })
            .map(row => ({ ...row, score: generate('rank', row.key) }))
            .sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map(row => row.value);
        },
        get cursor() {
          return entry.cursor;
        }
      });
      entry.handle = handle;
      entries.set(id, entry);
      handles.set(handle, { key });
      return handle;
    }
    function snapshot() {
      return {
        algorithm,
        seed,
        limits: { ...limits },
        streams: [...entries.values()]
          .filter(e => e.active)
          .map(e => ({ path: e.path.slice(), cursor: e.cursor }))
          .sort((a, b) => {
            const x = JSON.stringify(a.path),
              y = JSON.stringify(b.path);
            return x < y ? -1 : x > y ? 1 : 0;
          })
      };
    }
    function restore(state) {
      record(state, ['algorithm', 'seed', 'limits', 'streams'], 'checkpoint');
      if (state.algorithm !== algorithm || state.seed !== seed)
        throw new TypeError('Randomness: checkpoint algorithm or seed mismatch');
      record(state.limits, ['maxStreams', 'maxDraws', 'maxWords', 'maxBatch'], 'checkpoint budgets');
      if (!['maxStreams', 'maxDraws', 'maxWords', 'maxBatch'].every(key => Object.hasOwn(state.limits, key)))
        throw new TypeError('Randomness: incomplete checkpoint budgets');
      const declared = create(seed, state.limits).limits;
      if (!Array.isArray(state.streams) || state.streams.length > Math.min(limits.maxStreams, declared.maxStreams))
        throw new RangeError('Randomness: checkpoint exceeds stream budget');
      const seen = new Set(),
        rows = Array.from(state.streams, row => {
          record(row, ['path', 'cursor'], 'checkpoint stream');
          if (!Array.isArray(row.path)) throw new TypeError('Randomness: checkpoint paths must be arrays');
          const p = path(row.path),
            id = JSON.stringify(p);
          if (seen.has(id)) throw new TypeError('Randomness: duplicate checkpoint stream');
          seen.add(id);
          return {
            path: p,
            id,
            cursor: integer(row.cursor, 0, Math.min(limits.maxDraws, declared.maxDraws), 'checkpoint cursor')
          };
        });
      if (new Set([...entries.keys(), ...seen]).size > limits.maxStreams)
        throw new RangeError('Randomness: checkpoint handles exceed stream budget');
      for (const entry of entries.values()) {
        entry.cursor = 0;
        entry.active = false;
      }
      for (const row of rows) {
        const handle = stream(...row.path);
        handle.seek(row.cursor);
      }
      return api;
    }
    const api = Object.freeze({
      algorithm,
      seed,
      limits,
      stream,
      snapshot,
      restore,
      reset() {
        for (const entry of entries.values()) entry.cursor = 0;
        return api;
      }
    });
    return api;
  }
  function from(state, options) {
    if (!state || state.algorithm !== algorithm) throw new TypeError('Randomness: unsupported checkpoint algorithm');
    return create(state.seed, options ?? state.limits).restore(state);
  }
  return Object.freeze({
    algorithm,
    create,
    from,
    distribution,
    isStream: value => handles.has(value),
    correlated: spec => {
      record(spec, ['channels', 'correlation'], 'correlated recipe');
      return distribution({ type: 'correlated', ...spec });
    }
  });
})();
if (typeof module !== 'undefined') module.exports = Randomness;
