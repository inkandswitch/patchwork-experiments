/* Shared retained controls, numeric expressions and snapshot readers. */
(function (K) {
  const { clone, freeze, isImmutable } = K.procedural.data;
  const cache = new WeakMap();
  const operators = {
    add: [2, (a, b) => a + b],
    subtract: [2, (a, b) => a - b],
    multiply: [2, (a, b) => a * b],
    divide: [2, (a, b) => a / b],
    min: [2, Math.min], max: [2, Math.max],
    clamp: [3, (x, lo, hi) => Math.min(hi, Math.max(lo, x))],
    mix: [3, (a, b, t) => a + (b - a) * t],
    abs: [1, Math.abs], sin: [1, Math.sin], cos: [1, Math.cos]
  };
  const finite = Number.isFinite;
  const fields = (value, allowed) => K.world.data.record(value) && Object.keys(value).every(key => allowed.includes(key));
  const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

  function prepare(definition) {
    if (definition === undefined) return null;
    if (isImmutable(definition) && cache.has(definition)) return cache.get(definition);
    const { record, own, id, check, selector } = K.world.data;
    check(fields(definition, ['controls', 'values', 'bindings']), 'Expected a parameter binding program');
    const { controls = {}, values = {}, bindings = [] } = clone(definition);
    check(record(controls) && record(values) && Object.keys(controls).every(id) && Object.keys(values).every(id) &&
      !Object.keys(values).some(name => own(controls, name)) && Object.keys(controls).length + Object.keys(values).length <= 512,
      'Parameters need distinct named controls and values');
    check(Array.isArray(bindings) && bindings.length <= 4096, 'Expected a bounded binding list');
    const paths = new Set();
    const targets = bindings.map(row => {
      check(fields(row, ['path', 'parameter']) && (own(controls, row.parameter) || own(values, row.parameter)),
        'A binding needs a path and an existing parameter');
      const path = selector(row.path), key = JSON.stringify(path.map(String));
      check(!paths.has(key), 'Duplicate parameter binding at ' + path.join('/'));
      paths.add(key);
      return freeze({ path, parameter: row.parameter });
    });

    const compiled = new Map(), pending = new Set();
    let nodes = 0;
    function named(name, depth) {
      if (own(controls, name)) return state => state.controls[name];
      check(own(values, name), 'Unknown shared parameter: ' + name);
      check(!pending.has(name), 'Cyclic parameter dependency at ' + name);
      if (compiled.has(name)) return compiled.get(name);
      pending.add(name);
      const read = expression(values[name], depth);
      const sample = state => {
        if (!state.values.has(name)) state.values.set(name, read(state));
        return state.values.get(name);
      };
      compiled.set(name, sample);
      pending.delete(name);
      return sample;
    }
    function expression(value, depth) {
      check(++nodes <= 8192 && depth <= 48, 'Parameter expression exceeds its complexity budget');
      if (!record(value)) {
        const literal = freeze(value);
        return () => literal;
      }
      if (own(value, 'literal')) {
        check(fields(value, ['literal']), 'A parameter literal accepts one value');
        const literal = freeze(value.literal);
        return () => literal;
      }
      if (own(value, 'op')) {
        const operator = own(operators, value.op) && operators[value.op];
        check(operator && fields(value, ['op', 'args']) && Array.isArray(value.args) && value.args.length === operator[0],
          'Invalid parameter expression: ' + value.op);
        const readers = value.args.map(item => expression(item, depth + 1));
        return state => {
          const args = readers.map(read => read(state));
          check(args.every(finite), 'Numeric operands required for parameter expression ' + value.op);
          const output = operator[1](...args);
          check(finite(output), 'Non-finite result from parameter expression ' + value.op);
          return output;
        };
      }
      if (value.source === 'parameter' || value.source === 'control') {
        check(fields(value, ['source', 'name']) && id(value.name) &&
          (value.source !== 'control' || own(controls, value.name)), 'Invalid parameter reference');
        return named(value.name, depth + 1);
      }
      const { fallback, ...driver } = value;
      check(own(value, 'fallback'), 'Time, field, signal and data parameters need a fallback');
      if (driver.source === 'data') {
        const { source, ...sample } = driver;
        K.dataInputs.sampleOptions(sample);
        freeze(fallback);
        return state => {
          const result = state.dataInputs.sample(sample, state.inputs.time);
          return result.status === 'ok' && kind(result.value) === kind(fallback) ? result.value : fallback;
        };
      }
      if (driver.source === 'field') driver.source = 'query';
      LookInputs.validateDriver(driver, fallback);
      freeze(fallback);
      return state => LookInputs.sample(driver, fallback, state.inputs);
    }
    for (const name of Object.keys(values)) named(name, 0);
    const defaults = freeze(controls);

    function sample(input = {}) {
      const { time = 0, controls: overrides = {}, query, dataInputs = K.dataInputs.prepare() } = input;
      check(record(overrides), 'Control overrides must be a named map');
      const active = { ...defaults };
      for (const [name, value] of Object.entries(overrides)) {
        check(own(defaults, name) && kind(value) === kind(defaults[name]), 'Unknown control or incompatible value: ' + name);
        active[name] = freeze(clone(value));
      }
      const inputs = LookInputs.session(time, typeof query === 'function' ? query : () => query);
      const state = { controls: active, values: new Map(), inputs, dataInputs };
      for (const read of compiled.values()) read(state);
      return freeze(clone({ ...active, ...Object.fromEntries(state.values) }));
    }
    const program = Object.freeze({
      targets: freeze(targets),
      sample,
      apply(source, input, select = () => true) {
        const values = sample(input);
        const operations = targets.filter(row => select(row.path)).map(({ path, parameter }) =>
          ({ op: 'set', path, value: values[parameter] }));
        const document = operations.length ? K.world.apply(source, operations, { validate: null }).world : source;
        return { document, values };
      }
    });
    if (isImmutable(definition)) cache.set(definition, program);
    return program;
  }

  K.parameters = Object.freeze({ prepare });
})(KIT);
