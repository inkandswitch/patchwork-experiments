/* Checkpointed recipes for ordered switches, timed windows, and typed world actuators. */
(function (K) {
  const W = K.world, Q = W.query;
  const { check, record, id, own, equal } = W.data;
  const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const table = (value, min, max, label) => {
    check(record(value) && bounded(Object.keys(value).length, min, max) &&
      Object.keys(value).every(id), 'Invalid puzzle ' + label);
    return Object.entries(value);
  };

  function compile(config) {
    const inputs = config.inputs ?? {}, nodes = config.nodes ?? {}, outputs = config.outputs;
    const pins = table(inputs, 0, 48, 'inputs');
    const entries = table(nodes, 0, 96, 'nodes');
    const ports = table(outputs, 1, 24, 'outputs');
    check(pins.every(([, type]) => type === 'bool' || type === 'event'), 'Puzzle inputs must be bool or event');
    const refs = name => typeof name === 'string' && (own(inputs, name) || own(nodes, name));
    const list = names => Array.isArray(names) && bounded(names.length, 1, 48) && names.every(refs);
    const definitions = new Map();
    for (const [name, node] of entries) {
      check(!own(inputs, name) && record(node), 'Invalid or duplicate puzzle node ' + name);
      let dependencies;
      switch (node.op) {
        case 'all': case 'any': case 'count':
          check(list(node.inputs) && new Set(node.inputs).size === node.inputs.length &&
            (node.op !== 'count' || bounded(node.min, 1, node.inputs.length)), 'Invalid puzzle conditions: ' + name);
          dependencies = node.inputs;
          break;
        case 'not':
          dependencies = [node.input];
          break;
        case 'sequence': {
          check(list(node.steps), 'Invalid puzzle sequence: ' + name);
          const symbols = [...new Set(node.steps)], prefix = [0];
          for (let index = 1, length = 0; index < node.steps.length; index++) {
            while (length && node.steps[index] !== node.steps[length]) length = prefix[length - 1];
            if (node.steps[index] === node.steps[length]) length++;
            prefix.push(length);
          }
          definitions.set(name, { ...node, symbols, prefix });
          dependencies = symbols;
          break;
        }
        case 'window':
          check(bounded(node.ticks, 1, 3600), 'Invalid puzzle window duration: ' + name);
          dependencies = [node.trigger];
          break;
        case 'latch':
          dependencies = [node.set];
          break;
        default: throw Error('Unknown puzzle operation: ' + node.op);
      }
      if (node.reset !== undefined) {
        check(['sequence', 'window', 'latch'].includes(node.op), 'Reset needs a stateful puzzle node: ' + name);
        dependencies = [...dependencies, node.reset];
      }
      check(dependencies.every(refs), 'Unknown puzzle reference on ' + name);
      definitions.set(name, { ...(definitions.get(name) ?? node), dependencies });
    }
    check(ports.every(([, ref]) => refs(ref)), 'A puzzle output must reference an input or node');

    const visiting = new Set(), order = [], sources = new Map(pins.map(([name]) => [name, [name]]));
    function visit(name) {
      if (sources.has(name)) return;
      check(!visiting.has(name), 'Puzzle dependency cycle at ' + name);
      visiting.add(name);
      const node = definitions.get(name);
      node.dependencies.forEach(visit);
      visiting.delete(name);
      order.push([name, node]);
      sources.set(name, [...new Set(node.dependencies.flatMap(ref => sources.get(ref)))]);
    }
    for (const [name] of entries) visit(name);
    const moves = table(config.moves ?? {}, 0, 32, 'moves').map(([name, move]) => {
      check(record(move) && Object.keys(move).every(key => ['set','pulse','when'].includes(key)) &&
        record(move.set ?? {}) && Object.entries(move.set ?? {}).every(([key, value]) =>
          own(inputs, key) && inputs[key] === 'bool' && typeof value === 'boolean') &&
        Array.isArray(move.pulse ?? []) && (move.pulse ?? []).every(key => own(inputs, key) && inputs[key] === 'event') &&
        new Set(move.pulse ?? []).size === (move.pulse ?? []).length &&
        (Object.keys(move.set ?? {}).length || (move.pulse ?? []).length), 'Invalid puzzle move: ' + name);
      const when = move.when;
      check(when === undefined || record(when) && refs(when.signal) &&
        (when.is === undefined || typeof when.is === 'boolean'), 'Invalid puzzle move guard: ' + name);
      return { name, ...move };
    });
    return { inputs, pins, order, ports, definitions, sources, moves };
  }

  function condition(node, values) {
    switch (node.op) {
      case 'all': return node.inputs.every(ref => values[ref]);
      case 'any': return node.inputs.some(ref => values[ref]);
      case 'not': return !values[node.input];
      case 'count': return node.inputs.filter(ref => values[ref]).length >= node.min;
    }
  }

  function evaluate(graph, state, input) {
    const values = {}, memory = {}, rising = new Set();
    for (const [name, type] of graph.pins) {
      values[name] = type === 'bool' ? input?.[name] ?? false : Boolean(input?.[name]?.length);
      if (input && values[name] && (type === 'event' || !state.values[name])) rising.add(name);
    }
    const edge = ref => rising.has(ref);
    for (const [name, node] of graph.order) {
      const reset = edge(node.reset);
      let value;
      switch (node.op) {
        case 'sequence': {
          let progress = state?.memory[name] ?? 0;
          if (reset) progress = 0;
          else if (progress < node.steps.length) {
            const active = node.symbols.filter(edge);
            if (active.length > 1) progress = 0;
            if (active.length === 1) {
              while (progress && node.steps[progress] !== active[0]) progress = node.prefix[progress - 1];
              if (node.steps[progress] === active[0]) progress++;
            }
          }
          memory[name] = progress;
          value = progress === node.steps.length;
          break;
        }
        case 'window': {
          let remaining = state?.memory[name] ?? 0;
          if (reset) remaining = 0;
          else if (edge(node.trigger)) remaining = node.ticks;
          else if (remaining > 0) remaining = remaining === 1 ? -1 : remaining - 1;
          memory[name] = remaining;
          value = remaining > 0;
          break;
        }
        case 'latch': value = !reset && (edge(node.set) || (state?.values[name] ?? false)); break;
        default: value = condition(node, values);
      }
      values[name] = value;
      if (input && value && !state.values[name]) rising.add(name);
    }
    return { values, memory };
  }

  function explain(graph, state, output, ref) {
    const blockers = [], visited = new Set(), { values, memory } = state;
    function need(name) {
      if (values[name] || visited.has(name)) return;
      visited.add(name);
      const node = graph.definitions.get(name);
      if (!node) {
        blockers.push({ node: name, reason: graph.inputs[name] === 'event' ? 'awaiting-pulse' : 'inactive-input' });
        return;
      }
      switch (node.op) {
        case 'all': node.inputs.forEach(need); break;
        case 'any':
          blockers.push({ node: name, reason: 'no-alternative-active', alternatives: node.inputs });
          node.inputs.forEach(need);
          break;
        case 'count':
          blockers.push({ node: name, reason: 'too-few-active', needed: node.min,
            active: node.inputs.filter(ref => values[ref]), alternatives: node.inputs.filter(ref => !values[ref]) });
          break;
        case 'not': blockers.push({ node: name, reason: 'must-be-inactive', input: node.input }); break;
        case 'sequence':
          blockers.push({ node: name, reason: 'sequence-incomplete', progress: memory[name],
            length: node.steps.length, expected: node.steps[memory[name]] });
          break;
        case 'window': {
          const expired = memory[name] === -1;
          blockers.push({ node: name, reason: expired ? 'window-expired' : 'awaiting-trigger',
            trigger: node.trigger, ticks: node.ticks });
          if (!expired) need(node.trigger);
          break;
        }
        case 'latch':
          blockers.push({ node: name, reason: 'latch-unset', trigger: node.set });
          need(node.set);
          break;
      }
    }
    need(ref);
    return { output, active: values[ref], blockers };
  }

  function solve(graph, base, ref, { maxTicks = 32, maxTransitions = 4096 }) {
    check(bounded(maxTicks, 1, 128) && bounded(maxTransitions, 1, 16000), 'Invalid puzzle search budget');
    check(graph.moves.length > 0, 'Puzzle solve needs authored moves');
    const signature = state => JSON.stringify([
      graph.pins.map(([name]) => state.values[name]),
      graph.order.map(([name]) => [state.values[name], state.memory[name] ?? null])
    ]);
    const root = { state: base, tick: 0, parent: null };
    const queue = [root], seen = new Set([signature(base)]), moves = [null, ...graph.moves];
    let transitions = 0, limited = false;
    function solved(last) {
      const witness = [];
      for (let row = last; row.parent; row = row.parent)
        if (row.move) witness.push({ tick: row.tick, move: row.move.name,
          set: row.move.set ?? {}, pulse: row.move.pulse ?? [] });
      return { status: 'solved', ticks: last.tick, transitions, witness: witness.reverse() };
    }
    if (base.values[ref]) return solved(root);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index], { state, tick } = current;
      if (tick === maxTicks) {
        limited = true;
        continue;
      }
      for (const move of moves) {
        if (move?.when && state.values[move.when.signal] !== (move.when.is ?? true)) continue;
        if (transitions === maxTransitions) return { status: 'limit', transitions };
        transitions++;
        const input = Object.fromEntries(graph.pins.map(([name, type]) => {
          if (type === 'bool') return [name, own(move?.set, name) ? move.set[name] : state.values[name]];
          return [name, move?.pulse?.includes(name) ? [true] : []];
        }));
        const next = evaluate(graph, state, input), key = signature(next);
        if (seen.has(key)) continue;
        const candidate = { state: next, tick: tick + 1, parent: current, move };
        if (next.values[ref]) return solved(candidate);
        seen.add(key);
        queue.push(candidate);
      }
    }
    return { status: limited ? 'limit' : 'unreachable', transitions };
  }

  function puzzle(config) {
    const graph = compile(config), initial = evaluate(graph);
    const describe = state => Object.fromEntries(graph.ports.map(([name, ref]) =>
      [name, explain(graph, state, name, ref)]));
    function outputRef(args) {
      const name = args.output ?? (graph.ports.length === 1 ? graph.ports[0][0] : undefined);
      check(typeof name === 'string' && own(config.outputs, name), 'Name a published puzzle output');
      return [name, config.outputs[name]];
    }
    return {
      initial: () => initial, inputs: graph.inputs,
      outputs: Object.fromEntries(graph.ports.map(([name]) => [name, 'bool'])),
      output: state => Object.fromEntries(graph.ports.map(([name, ref]) => [name, state.values[ref]])),
      validateState(state) {
        check(record(state) && record(state.values) && record(state.memory) &&
          equal(Object.keys(state.values).sort(), Object.keys(initial.values).sort()) &&
          equal(Object.keys(state.memory).sort(), Object.keys(initial.memory).sort()) &&
          Object.values(state.values).every(value => typeof value === 'boolean'), 'Invalid puzzle checkpoint');
        for (const [name, node] of graph.order) {
          const value = state.memory[name];
          let actual = condition(node, state.values);
          if (node.op === 'sequence') {
            check(bounded(value, 0, node.steps.length), 'Invalid puzzle progress: ' + name);
            actual = value === node.steps.length;
          }
          if (node.op === 'window') {
            check(bounded(value, -1, node.ticks), 'Invalid puzzle window: ' + name);
            actual = value > 0;
          }
          check(actual === undefined || state.values[name] === actual, 'Invalid puzzle checkpoint: ' + name);
        }
      },
      step(state, { input, emit, causal }) {
        const next = evaluate(graph, state, input);
        for (const [name, ref] of graph.ports) {
          const changed = state.values[ref] !== next.values[ref];
          if (!changed && !causal) continue;
          const result = explain(graph, next, name, ref);
          if (!changed && equal(result, explain(graph, state, name, ref))) continue;
          const previous = causal?.previous(name);
          const evidence = causal?.record('puzzle-evaluated', result, {
            inputs: graph.sources.get(ref), causes: previous ? [previous] : [], outputs: [name]
          });
          if (changed) emit('puzzle-output-changed', result, evidence ? [evidence] : undefined);
        }
        return next;
      },
      fields: {
        state: { type: 'record', read: ({ state }) => Q.ok({ ...state, outputs: describe(state) }) }
      },
      traces: {
        why: { run({ state, args }) {
          return Q.ok(explain(graph, state, ...outputRef(args)));
        } },
        solve: { run({ state, args }) {
          const [output, ref] = outputRef(args);
          return Q.ok({ output, ...solve(graph, state, ref, args) });
        } }
      }
    };
  }

  W.runtime.register('puzzle', puzzle);
})(KIT);
