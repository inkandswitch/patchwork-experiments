/* Retained neighborhood rules on stable, authored connections. */
const GraphCellular = (() => {
  const { clone, freeze, hash } = KIT.procedural.data;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const name = (value, limit = 180) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
  const weightOK = value => Number.isFinite(value) && value > 0 && value <= 1e6;
  const record = value => value != null && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const sequence = value => Array.isArray(value) || ArrayBuffer.isView(value) && Number.isSafeInteger(value.length);
  const order = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const check = (ok, message) => { if (!ok) throw new RangeError('Graph automaton: ' + message); };
  const maxNodes = 65536, maxEdges = 262144, maxWork = 32000000;
  const format = 'ink-studio/graph-automaton';
  const ruleStates = new WeakMap();

  function pulse({ threshold = 1, refractory = 4 } = {}) {
    check(weightOK(threshold) && integer(refractory, 0, 254), 'pulse needs a positive threshold and 0–254 refractory ticks');
    const states = refractory + 2;
    const update = ({ state, inputs }) => {
      if (state > 0) return (state + 1) % states;
      let weight = 0;
      for (const input of inputs) {
        if (input.state !== 1) continue;
        weight += input.edge.weight;
        if (weight >= threshold) return 1;
      }
      return 0;
    };
    ruleStates.set(update, states);
    return Object.freeze(update);
  }

  function topology(rawNodes, rawEdges, stateOK, domain) {
    check(Array.isArray(rawNodes) && integer(rawNodes.length, 1, maxNodes) &&
      Array.isArray(rawEdges) && rawEdges.length <= maxEdges, 'expected a bounded node and edge list');
    const sorted = Array.from(rawNodes, raw => {
      const spec = typeof raw === 'string' ? { id: raw } : raw;
      const { id, type = 'cell', data = {}, state, locked = false } = spec ?? {};
      check(record(spec) && name(id) && name(type) && (state === undefined || stateOK(state)) && typeof locked === 'boolean',
        'nodes need an ID, optional type, and valid state and lock');
      return { id, state, locked, node: freeze({ id, type, data: clone(data) }) };
    }).sort(order);
    const nodes = Object.freeze(sorted.map(item => item.node));
    const indices = new Map(nodes.map(({ id }, i) => [id, i]));
    check(indices.size === nodes.length, 'node IDs must be unique');
    const edges = Array.from(rawEdges, raw => {
      const { from, to, type = 'link', id, bidirectional = false, weight = 1, delay = 1, data = {} } = raw ?? {};
      check(record(raw) && indices.has(from) && indices.has(to) && name(type) &&
        (id === undefined || name(id, 4096)) && typeof bidirectional === 'boolean' && weightOK(weight) && integer(delay, 1, 64),
      'edges need valid endpoints, positive weight and delay of 1–64 ticks');
      const ids = bidirectional && from > to ? [to, from] : [from, to];
      const key = id ?? JSON.stringify([bidirectional, ...ids, type]);
      const metrics = domain && { length: raw.length, units: domain.units, seam: raw.seam ?? null };
      return freeze({ id: key, from: ids[0], to: ids[1], type, bidirectional, weight, delay, ...metrics, data: clone(data) });
    }).sort(order);
    check(new Set(edges.map(edge => edge.id)).size === edges.length, 'edge IDs must be unique');
    const incoming = nodes.map(() => []);
    let historySize = 1, work = nodes.length;
    for (const edge of edges) {
      const from = indices.get(edge.from), to = indices.get(edge.to);
      incoming[to].push({ index: from, node: nodes[from], edge, ...(domain && { cell: domain.cell(nodes[from].id) }) });
      work++;
      if (edge.bidirectional && from !== to) {
        incoming[from].push({ index: to, node: nodes[to], edge, ...(domain && { cell: domain.cell(nodes[to].id) }) });
        work++;
      }
      historySize = Math.max(historySize, edge.delay);
    }
    return { sorted, nodes, indices, edges: Object.freeze(edges), incoming, work, historySize };
  }

  function create({ nodes: rawNodes, edges: rawEdges = [], states, initial, rule, seed = 0 } = {}, domain) {
    function ruleInfo(update) { return ruleStates.get(update) ?? CellularRules.info(update)?.states; }
    const channels = domain?.channels, dt = domain?.dt;
    const fieldMode = channels !== undefined;
    if (fieldMode) check(states === undefined, 'named channels and an integer alphabet are separate state models');
    else states ??= ruleInfo(rule) ?? 2;
    const zero = fieldMode ? freeze(Object.fromEntries(channels.map(name => [name, 0]))) : 0;
    if (initial === undefined) initial = zero;
    const stateOK = fieldMode
      ? value => record(value) && Object.keys(value).length === channels.length &&
        channels.every(name => Object.hasOwn(value, name) && Number.isFinite(value[name]))
      : value => integer(value, 0, states - 1);
    const plane = fieldMode ? Array : Uint8Array;
    const encode = fieldMode ? value => freeze(Object.fromEntries(channels.map(name => [name, value[name]]))) : value => value;
    check((fieldMode || integer(states, 2, 256)) && Number.isSafeInteger(seed) &&
      (typeof initial === 'function' || stateOK(initial)), 'expected a valid state model, seed and initializer');
    function checkRule(update) {
      const known = CellularRules.info(update);
      check(typeof update === 'function' && !known?.line, 'graph needs a neighborhood rule');
      const expected = ruleInfo(update);
      check(expected === undefined || !fieldMode && expected === states, 'rule alphabet must match graph states');
    }
    if (rule !== undefined) checkRule(rule);
    const { sorted, nodes, edges, incoming, indices, work, historySize } = topology(rawNodes, rawEdges, stateOK, domain);
    if (fieldMode) check(nodes.length * historySize * channels.length <= 2000000, 'named channel history exceeds its sample budget');
    const idSeeds = nodes.map(({ id }) => hash(id));
    const initialScope = hash('cellular-graph/initial', seed);
    const start = plane.from(sorted, ({ id, node, state }, i) => {
      const value = state ?? (typeof initial === 'function' ? initial({ id, node, random: KIT.grow.dice(initialScope ^ idSeeds[i]) }) : initial);
      check(stateOK(value), 'initial state is outside the alphabet');
      return encode(value);
    });
    const pins = Uint8Array.from(sorted, item => Number(item.locked));
    const signature = hash(JSON.stringify(domain
      ? [states, seed, nodes, edges, domain.kind, domain.units, domain.dt, domain.timeUnit, channels, domain.cells]
      : [states, seed, nodes, edges]));
    const ring = () => { const entries = new Array(historySize); entries[0] = start; return entries; };
    const open = domain && new Uint8Array(nodes.length);
    let history = ring(), locked = pins, blocked = open, tick = 0, revision = 0, busy = false, previous;
    const available = () => check(!busy, 'cannot edit the graph during a rule');
    const lookup = id => {
      check(indices.has(id), 'unknown node ' + String(id));
      return indices.get(id);
    };
    const read = (entries, i, at) => at < 0 ? zero : entries[at % historySize][i];
    function commit(entries, at, locks = locked, obstacles = blocked) {
      history = entries; tick = at; locked = locks; blocked = obstacles; revision++; previous = undefined;
    }

    function step(count = 1, update = rule) {
      available();
      checkRule(update);
      check(integer(count, 1, 10000) && count * work * (channels?.length ?? 1) <= maxWork &&
        tick + count <= Number.MAX_SAFE_INTEGER && (!domain || Number.isFinite((tick + count) * dt)),
        'step exceeds the work or tick budget');
      const draft = history.slice(), obstacles = blocked?.includes(1) ? blocked : null;
      busy = true;
      try {
        for (let j = 1; j <= count; j++) {
          const time = tick + j, before = draft[(time - 1) % historySize], next = before.slice();
          const scope = hash('cellular-graph/rule/' + time, seed);
          for (let i = 0; i < nodes.length; i++) {
            if (locked[i] || obstacles?.[i]) continue;
            const node = nodes[i];
            const links = obstacles ? incoming[i].filter(link => !obstacles[link.index]) : incoming[i];
            const inputs = links.map(({ index, node, edge, cell }) => {
              const sampledTick = time - edge.delay;
              return { id: node.id, node, edge, sampledTick, state: read(draft, index, sampledTick), ...(domain && { cell }) };
            });
            const neighbors = inputs.map(input => input.state);
            const state = update({ id: node.id, node, state: before[i], tick: time, inputs, neighbors,
              random: KIT.grow.dice(scope ^ idSeeds[i]), ...(domain && { cell: domain.cell(node.id), dt, time: time * dt, timeUnit: domain.timeUnit }) });
            check(stateOK(state), 'a rule must return a valid cell state');
            next[i] = encode(state);
          }
          draft[time % historySize] = next;
        }
      } finally { busy = false; }
      commit(draft, tick + count);
      return tick;
    }

    function edit(changes) {
      available();
      check(Array.isArray(changes) && changes.length <= maxNodes, 'expected a bounded edit list');
      const fields = domain ? ['id', 'state', 'locked', 'blocked'] : ['id', 'state', 'locked'];
      const plan = Array.from(changes, item => {
        check(record(item) && Object.keys(item).every(key => fields.includes(key)) &&
          (item.state !== undefined || item.locked !== undefined || item.blocked !== undefined) &&
          (item.state === undefined || stateOK(item.state)) && (item.locked === undefined || typeof item.locked === 'boolean') &&
          (item.blocked === undefined || typeof item.blocked === 'boolean'), 'edits need a node ID and valid state, lock or obstacle');
        return { i: lookup(item.id), state: item.state, lock: item.locked, block: item.blocked };
      });
      if (!plan.length) return;
      const next = history[tick % historySize].slice(), locks = locked.slice(), draft = history.slice();
      const obstacles = blocked?.slice(), cleared = new Set(), current = tick % historySize;
      for (const { i, state, lock, block } of plan) {
        if (block !== undefined) {
          obstacles[i] = Number(block);
          if (block) { next[i] = zero; cleared.add(i); }
        }
        if (state !== undefined && !obstacles?.[i]) next[i] = encode(state);
        if (lock !== undefined) locks[i] = Number(lock);
      }
      // A closed cell drops signals still waiting in its delay history.
      if (cleared.size) for (let slot = 0; slot < historySize; slot++) {
        if (slot === current || !draft[slot]) continue;
        const previous = draft[slot].slice();
        for (const i of cleared) previous[i] = zero;
        draft[slot] = previous;
      }
      draft[current] = next;
      commit(draft, tick, locks, obstacles);
    }

    function frame() {
      if (previous) return previous;
      const entries = history, at = tick, locks = locked, obstacles = blocked;
      previous = Object.freeze({ tick: at, nodes, states, historySize,
        get(id, age = 0) {
          check(integer(age, 0, historySize - 1), 'requested age exceeds retained edge history');
          return read(entries, lookup(id), at - age);
        },
        isLocked: id => Boolean(locks[lookup(id)]),
        ...(domain && { isBlocked: id => Boolean(obstacles[lookup(id)]) }), data: () => entries[at % historySize].slice()
      });
      return previous;
    }

    function checkpoint() {
      const first = Math.max(0, tick - historySize + 1);
      return { format, version: 1, signature, tick, locked: Array.from(locked),
        ...(blocked?.includes(1) && { blocked: Array.from(blocked) }),
        history: Array.from({ length: tick - first + 1 }, (_, i) => Array.from(history[(first + i) % historySize])) };
    }
    function restore(saved) {
      available();
      check(saved?.format === format && saved.version === 1 && saved.signature === signature &&
        integer(saved.tick, 0, Number.MAX_SAFE_INTEGER) && (!domain || Number.isFinite(saved.tick * dt)) &&
        Array.isArray(saved.history) &&
        saved.history.length === Math.min(saved.tick + 1, historySize), 'checkpoint is incompatible');
      function pack(values, valid, output = Uint8Array, convert = value => value) {
        check(sequence(values) && values.length === nodes.length, 'checkpoint planes must match the graph');
        return output.from(values, value => {
          check(valid(value), 'checkpoint contains an invalid state or lock');
          return convert(value);
        });
      }
      const bit = n => n === 0 || n === 1;
      check(domain || saved.blocked === undefined, 'checkpoint obstacles need a shared domain');
      const locks = pack(saved.locked, bit), obstacles = saved.blocked === undefined ? open : pack(saved.blocked, bit);
      const entries = new Array(historySize), first = saved.tick - saved.history.length + 1;
      const isZero = fieldMode ? value => channels.every(name => value[name] === 0) : value => value === 0;
      for (let i = 0; i < saved.history.length; i++) {
        const row = pack(saved.history[i], stateOK, plane, encode);
        check(saved.blocked === undefined || row.every((value, j) => !obstacles[j] || isZero(value)),
          'checkpoint has state in a blocked cell');
        entries[(first + i) % historySize] = row;
      }
      commit(entries, saved.tick, locks, obstacles);
      return tick;
    }

    return Object.freeze({ nodes, edges, states, historySize, step, edit, frame, checkpoint, restore,
      get(id) { return read(history, lookup(id), tick); },
      get tick() { return tick; }, get revision() { return revision; },
      reset() { available(); commit(ring(), 0, pins, open); }
    });
  }
  const api = Object.freeze({ create: options => create(options), rules: Object.freeze({ pulse }) });
  return Object.freeze({ api, onDomain: create });
})();
