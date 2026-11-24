/* Deterministic look inputs. A binding is sampled once for a render or query. */
const LookInputs = (() => {
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const matches = (value, fallback) => type(value) === type(fallback) &&
    (typeof value !== 'number' || Number.isFinite(value));
  const clamp = n => Math.max(0, Math.min(1, n));

  function substitute(value, params) {
    if (Array.isArray(value)) {
      let output;
      for (let i = 0; i < value.length; i++) {
        const next = substitute(value[i], params);
        if (next !== value[i]) (output ??= value.slice())[i] = next;
      }
      return output ?? value;
    }
    if (!record(value)) return value;
    if (Object.hasOwn(value, '$param')) {
      const name = value.$param;
      if (Object.keys(value).length !== 1 || typeof name !== 'string' || !Object.hasOwn(params, name))
        throw Error('Unknown or invalid look parameter: ' + name);
      return params[name];
    }
    let output;
    for (const [key, item] of Object.entries(value)) {
      const next = substitute(item, params);
      if (next !== item) (output ??= { ...value })[key] = next;
    }
    return output ?? value;
  }

  function validateDriver(driver, fallback) {
    const common = ['source', 'keys', 'interpolation'];
    const options = { time: [], signal: ['port', 'path'], query: ['field', 'target', 'args', 'path'] };
    if (!driver || !Object.hasOwn(options, driver.source) || !fields(driver, [...common, ...options[driver.source]]))
      throw new TypeError('A look input needs a time, signal or query source and optional keys');
    const { source, keys, interpolation = 'linear', path, field, target, args, port } = driver;
    if (source === 'signal' && !text(port)) throw new TypeError('A signal look input needs a port');
    if (source === 'query' && (!text(field) || field.startsWith('look/') ||
        (target !== undefined && !record(target) && !(Array.isArray(target) && target.length === 3 && target.every(Number.isFinite))) ||
        (args !== undefined && !record(args)))) throw new TypeError('A query look input needs a non-look field and an optional point or selector');
    if (path !== undefined && (!Array.isArray(path) || path.length > 32 || !Array.from(path).every(key =>
      text(key) || Number.isSafeInteger(key) && key >= 0))) throw new TypeError('A look input path needs keys or array indices');
    if (!['linear', 'step'].includes(interpolation) || keys === undefined && driver.interpolation !== undefined)
      throw new TypeError('Look input keys use linear or step interpolation');
    if (keys !== undefined && (!Array.isArray(keys) || !keys.length || keys.length > 128 ||
        !Array.from(keys).every((row, i) => Array.isArray(row) && row.length === 2 && Number.isFinite(row[0]) &&
          (!i || row[0] > keys[i - 1][0] && Number.isFinite(row[0] - keys[i - 1][0])) && matches(row[1], fallback) &&
          (interpolation === 'step' || typeof row[1] === 'number'))))
      throw new TypeError('Look input keys need increasing finite positions and values matching the parameter type');
  }

  function validate(inputs, values) {
    if (!fields(inputs, ['strength', 'params']) || inputs.params !== undefined && !record(inputs.params))
      throw new TypeError('Look inputs accept a strength driver and named parameter drivers');
    if (inputs.strength !== undefined) validateDriver(inputs.strength, 1);
    for (const [key, driver] of Object.entries(inputs.params ?? {})) {
      if (!Object.hasOwn(values, key)) throw new TypeError('Unknown driven look parameter: ' + key);
      validateDriver(driver, values[key]);
    }
  }

  function readQuery(driver, query) {
    const result = driver.source === 'signal' ? query?.probe('world/signal', undefined, { port: driver.port }) :
      query?.probe(driver.field, driver.target, driver.args);
    return result?.status === 'ok' ? result.value : undefined;
  }

  function sample(driver, fallback, session) {
    let input = session.time;
    if (driver.source !== 'time') {
      input = session.read ? session.read(driver) : readQuery(driver, session.query());
      for (const key of driver.path ?? []) input = input != null && Object.hasOwn(input, key) ? input[key] : undefined;
    }
    if (!driver.keys) return matches(input, fallback) ? input : fallback;
    if (typeof input === 'boolean') input = Number(input);
    if (!Number.isFinite(input)) return fallback;
    const { keys, interpolation } = driver;
    if (input <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [end, value] = keys[i];
      if (input >= end) continue;
      const [start, prior] = keys[i - 1];
      if (interpolation === 'step') return prior;
      const weight = (input - start) / (end - start);
      return prior * (1 - weight) + value * weight;
    }
    return keys[keys.length - 1][1];
  }

  function session(time = 0, query) {
    if (!Number.isFinite(time)) throw new TypeError('Look input time must be finite');
    let ready = false, snapshot;
    const samples = new Map();
    return { time, cache: new WeakMap(), query() {
      if (!ready) {
        snapshot = query?.();
        ready = true;
      }
      return snapshot;
    }, read(driver) {
      const signal = driver.source === 'signal';
      const address = signal ? ['signal', driver.port] : ['query', driver.field, driver.target, driver.args];
      const key = JSON.stringify(address);
      if (!samples.has(key)) samples.set(key, readQuery(driver, this.query()));
      return samples.get(key);
    } };
  }

  function resolve(binding, state) {
    if (!state) return null;
    if (state.cache.has(binding)) return state.cache.get(binding);
    const params = { ...binding.values };
    const strength = binding.inputs.strength === undefined ? binding.strength :
      clamp(sample(binding.inputs.strength, binding.strength, state));
    for (const [name, driver] of Object.entries(binding.inputs.params ?? {}))
      params[name] = sample(driver, params[name], state);
    const stack = substitute(binding.stack, params);
    const output = { strength, params,
      ...(stack && { stack: { ...stack, amount: strength * (stack.amount ?? 1) } }),
      ...(binding.palette !== false && (binding.palette !== undefined || binding.swatches !== undefined) && {
        palette: { ...substitute(binding.palette, params), ...(binding.swatches !== undefined && { palette: binding.swatches }) }
      }),
      mask: binding.maskOverride === undefined ? substitute(binding.mask, params) : binding.maskOverride };
    state.cache.set(binding, output);
    return output;
  }

  return Object.freeze({ substitute, validate, validateDriver, sample, session, resolve });
})();
if (typeof module !== 'undefined') module.exports = LookInputs;
