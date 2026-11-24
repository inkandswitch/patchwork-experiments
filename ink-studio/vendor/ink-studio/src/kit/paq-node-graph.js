/* Headless typed graphs with exposed inputs, reusable groups and inspectable cached outputs. */
(function (K) {
  const P = K.procedural;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const id = value => typeof value === 'string' && /^[a-zA-Z][\w.-]{0,99}$/.test(value) &&
    !['constructor', 'prototype', '__proto__'].includes(value);
  const {validator, compatible} = P.graphTypes;
  function schema(value) {
    if (!record(value)) throw new TypeError('Expected named graph sockets');
    return Object.fromEntries(Object.entries(value).map(([name, spec]) => {
      const config = typeof spec === 'string' ? { type: spec } : spec;
      const valid = validator(config?.type);
      if (!id(name) || !valid)
        throw new RangeError('Unknown graph socket ' + name);
      if (Object.hasOwn(config, 'default') && !valid(config.default))
        throw new TypeError('Wrong default type for graph socket ' + name);
      return [name, { ...config }];
    }));
  }

  function create(source, { operations = {}, groups = {}, planOnly = false } = {}) {
    const stored = P.data.freeze(P.data.clone(source));
    const specInputs = schema(stored.inputs || {});
    if (!record(stored.nodes) || !record(stored.outputs) || Object.keys(stored.nodes).length > 2000)
      throw new RangeError('A graph needs named nodes and outputs within its node budget');
    const specs = stored.nodes, configs = new Map(), stack = new Set(), order = [];
    const pending = new Map(), marks = new Map();

    function binding(value) {
      function literal(value) {
        const type = ['number','boolean','string'].find(name => validator(name)(value)) ?? 'any';
        return { kind: 'value', value, type };
      }
      if (!record(value)) return literal(value);
      if (Object.hasOwn(value, 'value')) return literal(value.value);
      if (Object.hasOwn(value, 'input')) {
        if (!Object.hasOwn(specInputs, value.input)) throw new RangeError('Unknown graph input ' + value.input);
        return { kind: 'input', id: value.input, type: specInputs[value.input].type };
      }
      if (Object.hasOwn(value, 'node')) {
        visit(value.node);
        const config = configs.get(value.node), port = value.port || 'value';
        if (!Object.hasOwn(config.outputs, port)) throw new RangeError('Unknown graph output ' + value.node + '.' + port);
        return { kind: 'node', id: value.node, port, type: config.outputs[port].type };
      }
      if (Object.hasOwn(value, 'keys')) {
        const mode = value.mode || 'number';
        const track = K.anim.keyframeTrack.create({ value: mode }, value.keys.map(key => ({ ...key, value: { value: key.value } })));
        if (!track.keys.length) throw new RangeError('Animated graph parameters need at least one key');
        const v = track.keys[0].value.value;
        const type = ['number','vec2','vec3'].find(name => validator(name)(v)) ?? 'any';
        return { kind: 'track', track, type, mode };
      }
      return literal(value);
    }

    function visit(name) {
      if (configs.has(name)) return;
      if (stack.has(name)) throw new Error('Graph dependency cycle at ' + name);
      if (!id(name) || !Object.hasOwn(specs, name)) throw new RangeError('Unknown graph node ' + name);
      const spec = specs[name];
      if (!record(spec) || !id(spec.op)) throw new TypeError('Invalid graph node ' + name);
      const template = Object.hasOwn(operations, spec.op) ? operations[spec.op] :
        Object.hasOwn(groups, spec.op) ? groups[spec.op] : Object.hasOwn(P.graph.operations || {}, spec.op) ? P.graph.operations[spec.op] : null;
      const operation = template?.specialize ? template.specialize(spec,groups) : template;
      if (typeof operation?.run !== 'function' && typeof operation?.instantiate !== 'function')
        throw new TypeError('Unknown graph operation ' + spec.op);
      stack.add(name);
      const sockets = schema(operation.inputs || {}), outputs = schema(operation.outputs || { value: 'any' });
      const given = { ...spec.params, ...spec.inputs };
      for (const key of Object.keys(given)) if (!Object.hasOwn(sockets, key)) throw new RangeError('Unknown socket ' + name + '.' + key);
      const bindings = Object.entries(sockets).map(([key, socket]) => {
        if (!Object.hasOwn(given, key) && !Object.hasOwn(socket, 'default'))
          throw new RangeError('Missing graph socket ' + name + '.' + key);
        const link = binding(Object.hasOwn(given, key) ? given[key] : { value: socket.default });
        if (link.kind !== 'value' && (link.kind !== 'track' || planOnly) && !compatible(link.type,socket.type))
          throw new TypeError('Incompatible graph socket ' + name + '.' + key);
        const valid=validator(socket.type);
        if (link.kind === 'value' && !valid(link.value)) throw new TypeError('Wrong value for graph socket ' + name + '.' + key);
        return [key, socket, link, valid];
      });
      stack.delete(name);
      const run = planOnly ? undefined : operation.instantiate ? operation.instantiate() : operation.run;
      configs.set(name, { name, op: spec.op, group:spec.group, type:spec.type, run, outputs, bindings, clock: !!operation.time });
      order.push(name);
    }
    for (const name of Object.keys(specs)) visit(name);
    const results = Object.entries(stored.outputs).map(([name, link]) => {
      if (!id(name)) throw new RangeError('Invalid graph output name ' + name);
      return [name, binding(link)];
    });

    const resolve = (link, values, time) => {
      if (link.kind === 'value') return link.value;
      if (link.kind === 'input') return values[link.id];
      if (link.kind === 'track') return link.track.sample(time).value;
      return pending.get(link.id).outputs[link.port];
    };

    function parameters(input = {}) {
      if (!record(input)) throw new TypeError('Graph inputs must be named values');
      return Object.fromEntries(Object.entries(specInputs).map(([name, socket]) => {
        const value = Object.hasOwn(input, name) ? input[name] : socket.default;
        if (!validator(socket.type)(value)) throw new TypeError('Wrong input value for graph socket ' + name);
        return [name, value];
      }));
    }

    function evaluate(input = {}, { time = 0, seed = 0 } = {}) {
      if (planOnly) throw new Error('A graph plan cannot be evaluated');
      if (!Number.isFinite(time) || !Number.isSafeInteger(seed)) throw new TypeError('Invalid graph run options');
      const values = parameters(input);
      pending.clear();
      const status = {};
      for (const name of order) {
        const { bindings, run, outputs, clock } = configs.get(name);
        const entries = bindings.map(([key, , link, valid]) => {
          const value = resolve(link, values, time);
          if (!valid(value)) throw new TypeError('Wrong linked value for graph socket ' + name + '.' + key);
          return [key, value];
        });
        const previous = marks.get(name), comparable = entries.map(([, value]) => value);
        const reused = previous?.seed === seed && (!clock || previous.time === time) &&
          comparable.every((value, i) => {
            const prior = previous.values[i];
            return Object.is(value, prior) || bindings[i][2].kind === 'track' && Array.isArray(value) &&
              Array.isArray(prior) && value.length === prior.length && value.every((n, k) => Object.is(n, prior[k]));
          });
        if (reused) pending.set(name, previous);
        else {
          const produced = run(Object.fromEntries(entries), { time, seed: P.data.hash(name, seed), node: name });
          if (!record(produced)) throw new TypeError('Graph node must return named outputs: ' + name);
          for (const [key, socket] of Object.entries(outputs))
            if (!Object.hasOwn(produced, key) || !validator(socket.type)(produced[key]))
              throw new TypeError('Wrong output from graph node ' + name + '.' + key);
          pending.set(name, { seed, time, values: comparable, outputs: produced, subgraph: run.inspect?.() });
        }
        status[name] = reused ? 'cached' : 'evaluated';
      }
      const outputs = Object.fromEntries(results.map(([key, link]) => [key, resolve(link, values, time)]));
      const snapshot = new Map(pending);
      for (const [name, item] of snapshot) marks.set(name, item);
      return { outputs, status, preview(node, port = 'value') {
        const [name, ...nested] = node.split('/');
        const result = snapshot.get(name);
        if (nested.length && result?.subgraph) return result.subgraph.preview(nested.join('/'), port);
        if (!result || !Object.hasOwn(result.outputs, port))
          throw new RangeError('Unknown graph preview output ' + node + '.' + port);
        return result.outputs[port];
      }, inspectGroup(name) { return snapshot.get(name)?.subgraph || null; } };
    }

    function plan() {
      function describe(link) {
        const { kind, id, port, type } = link;
        if (kind === 'track') return { kind, type, mode:link.mode, keyCount:link.track.keys.length };
        if (kind === 'value') return { kind, type };
        return { kind, type, id, ...(port !== undefined && {port}) };
      }
      return P.data.clone({
        inputs: specInputs,
        nodes: order.map(name => {
          const {op,group,type,outputs,bindings,clock} = configs.get(name);
          return {id:name,op,...(group!==undefined && {group}),...(type!==undefined && {type}),time:clock,outputs,
            inputs:Object.fromEntries(bindings.map(([key,socket,link]) => [key,{type:socket.type,source:describe(link)}]))};
        }),
        outputs: Object.fromEntries(results.map(([name,link]) => [name,describe(link)]))
      });
    }

    return Object.freeze({ spec: stored, evaluate, parameters, plan, clear() {
      marks.clear();
      for (const config of configs.values()) config.run?.clear?.();
    } });
  }

  function group(spec, { operations, groups, outputs } = {}) {
    const inputTypes = schema(spec.inputs || {});
    const outputTypes = schema(outputs || Object.fromEntries(Object.keys(spec.outputs || {}).map(name => [name, 'any'])));
    return { inputs: inputTypes, outputs: outputTypes, expandedNodes:Object.keys(spec.nodes ?? {}).length, time: true, instantiate() {
      const graph = create(spec, { operations, groups });
      let latest;
      const run = (inputs, context) => {
        latest = graph.evaluate(inputs, context);
        return latest.outputs;
      };
      run.inspect = () => latest;
      run.clear = () => graph.clear();
      return run;
    } };
  }

  function repeat(value, times, apply, { seed = 0, limit = 4096 } = {}) {
    if (!Number.isSafeInteger(times) || times < 0 || times > limit || limit > 100000 ||
        typeof apply !== 'function' || !Number.isSafeInteger(seed)) throw new RangeError('Invalid repeat zone');
    for (let index = 0; index < times; index++) value = apply(value, { index, seed: P.data.hash(String(index), seed) });
    return value;
  }

  function each(elements, apply, { seed = 0, limit = 100000 } = {}) {
    if (!Array.isArray(elements) || elements.length > limit || limit > 250000 ||
        typeof apply !== 'function' || !Number.isSafeInteger(seed)) throw new RangeError('Invalid per-element zone');
    const seen = new Set();
    return elements.map((value, index) => {
      const id = value?.id ?? index;
      if ((typeof id !== 'string' && !Number.isSafeInteger(id)) || seen.has(id))
        throw new RangeError('Per-element items need unique string or integer IDs');
      seen.add(id);
      return apply(value, { id, index, seed: P.data.hash(typeof id + '/' + id, seed) });
    });
  }

  function simulation({ initial, step, dt = 1 / 60, checkpoint = 15, cache = 32, maxSteps = 10000,
    clone = P.data.clone, seed = 0 } = {}) {
    if (typeof step !== 'function' || typeof clone !== 'function' || !Number.isFinite(dt) || dt <= 0 ||
        ![checkpoint, cache, maxSteps].every(n => Number.isSafeInteger(n) && n > 0 && n <= 100000) ||
        !Number.isSafeInteger(seed)) throw new RangeError('Invalid simulation zone');
    let revision, root, frames = new Map();
    function sample(time, { inputs, version = 0 } = {}) {
      const frame = Math.floor(time / dt + 1e-8);
      if (!Number.isFinite(time) || frame < 0 || frame > maxSteps) throw new RangeError('Simulation time exceeds its step budget');
      if (!Object.is(revision, version) || root === undefined) {
        root = clone(typeof initial === 'function' ? initial(inputs, seed) : initial);
        revision = version;
        frames = new Map([[0, root]]);
      }
      let start = 0;
      for (const key of frames.keys()) if (key <= frame && key > start) start = key;
      let result = clone(frames.get(start) ?? root);
      for (let i = start + 1; i <= frame; i++) {
        result = step(result, { index: i, time: i * dt, dt, inputs, seed: P.data.hash(String(i), seed) });
        if (i % checkpoint === 0 || i === frame) {
          frames.set(i, clone(result));
          if (frames.size > cache + 1) frames.delete([...frames.keys()].find(key => key !== 0));
        }
      }
      return { frame, time: frame * dt, state: result, steps: frame - start, checkpoints: [...frames.keys()].sort((a, b) => a - b) };
    }
    return { sample, clear() { root = undefined; frames.clear(); } };
  }

  P.graph = { create, group, repeat, each, simulation };
})(KIT);
