/* Shared neighborhood domains for the retained cellular graph runtime. */
const CellularDomains = (() => {
  const K = KIT, V = K.V, { clone, freeze } = K.procedural.data;
  const maxCells = 65536, maxEdges = 262144, sides = ['u0', 'u1', 'v0', 'v1'];
  const compiled = new WeakMap();
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const positive = n => Number.isFinite(n) && n > 0;
  const label = (s, limit = 180) => typeof s === 'string' && s.trim().length > 0 && s.length <= limit;
  const keyName = s => typeof s === 'string' && /^[A-Za-z][\w-]{0,47}$/.test(s) &&
    !['prototype', 'constructor'].includes(s);
  const tuple = (a, n, valid = Number.isFinite) => Array.isArray(a) && a.length === n && Array.from(a).every(valid);
  const record = value => value != null && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const check = (ok, message) => { if (!ok) throw new RangeError('Cellular domain: ' + message); };
  const chartId = (id, x, y) => id + '/' + x + ',' + y;

  function build(kind, units, cells, edges, address, settings, authored = new Map()) {
    check(label(units, 48) && cells.length > 0 && cells.length <= maxCells && edges.length <= maxEdges,
      'expected a distance unit and a bounded nonempty domain');
    const byId = new Map(cells.map(cell => [cell.id, freeze({ ...cell, units })]));
    check(byId.size === cells.length, 'cell IDs must be distinct');
    const cell = where => byId.get(typeof where === 'string' ? where : address(where)) ?? null;
    const links = freeze(edges);
    const out = Object.freeze({ kind, units, cells: Object.freeze([...byId.values()]), edges: links,
      ...freeze(settings), cell });
    compiled.set(out, {
      nodes: out.cells.map(cell => {
        const raw = authored.get(cell.id);
        return { id: cell.id, type: raw?.type, state: raw?.state, locked: raw?.locked,
          data: cell.data };
      }),
      edges: links
    });
    return out;
  }

  function cartesian(kind, counts, { spacing, origin, units, boundary = 'closed', mask, neighborhood = 'faces' }) {
    const dimensions = counts.length;
    spacing ??= counts.map(() => 1);
    origin ??= counts.map(() => 0);
    const axes = typeof boundary === 'string' ? counts.map(() => boundary) : boundary;
    check(counts.every(n => integer(n, 1, 512)) && counts.reduce((a,b) => a*b, 1) <= maxCells &&
      tuple(spacing, dimensions, positive) && tuple(origin, dimensions) &&
      tuple(axes, dimensions, v => v === 'closed' || v === 'wrap') &&
      (mask === undefined || typeof mask === 'function') && ['faces', 'full'].includes(neighborhood),
      'expected bounded counts, spacing, origin, per-axis boundaries and a faces or full neighborhood');
    const offsets = [];
    for (let z = dimensions === 3 ? -1 : 0; z <= (dimensions === 3 ? 1 : 0); z++) {
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
        const delta = dimensions === 3 ? [x,y,z] : [x,y];
        // Keep one representative of each opposite pair and reconstruct its two faces.
        if (delta.findLast(n => n !== 0) === 1 &&
            (neighborhood === 'full' || delta.filter(Boolean).length === 1)) offsets.push(delta);
      }
    }
    const p = ([x,y,z = 0]) => [origin[0] + spacing[0] * (x + .5), origin[1] + spacing[1] * (y + .5),
      dimensions === 3 ? origin[2] + spacing[2] * (z + .5) : 0];
    const count = counts.reduce((a,b) => a*b, 1);
    const cells = [], edges = [];
    for (let i = 0; i < count; i++) {
      const x = i % counts[0], y = Math.floor(i / counts[0]) % counts[1], z = Math.floor(i / (counts[0] * counts[1]));
      const at = dimensions === 3 ? [x,y,z] : [x,y], position = p(at);
      check(position.every(Number.isFinite), 'cell positions must be finite');
      const cell = freeze({ id: at.join(','), address: at, position, units });
      if (mask && !mask(cell)) continue;
      cells.push(cell);
    }
    const active = new Set(cells.map(cell => cell.id));
    const wrap = (n, length) => (n % length + length) % length;
    for (const { id, address: at } of cells) for (const [i, delta] of offsets.entries()) {
      const next = at.map((n, j) => n + delta[j]);
      if (next.some((n,j) => axes[j] === 'closed' && (n < 0 || n >= counts[j]))) continue;
      const periodic = next.some((n,j) => n < 0 || n >= counts[j]);
      const target = next.map((n,j) => wrap(n, counts[j])).join(',');
      if (!active.has(target)) continue;
      const length = Math.hypot(...delta.map((n,j) => n * spacing[j]));
      check(positive(length) && edges.length + Number(id === target) < maxEdges, 'neighborhood exceeds the edge or distance budget');
      const edge = { id: id + '/' + i, from: id, to: target, bidirectional: true, weight: 1, delay: 1, length,
        data: { periodic } };
      edges.push(edge);
      // A wrapped size-one axis still has two directed offset slots.
      if (id === target) edges.push({ ...edge, id: edge.id + '/opposite' });
    }
    return build(kind, units, cells, edges, where =>
      tuple(where, dimensions, Number.isSafeInteger) ? where.join(',') : null,
    { counts: counts.slice(), origin: origin.slice(), spacing: spacing.slice(), boundary: axes.slice(), neighborhood });
  }

  function image(options = {}) {
    return cartesian('image', [options.width, options.height], { ...options, units: options.units ?? 'pixel' });
  }

  function volume(options = {}) {
    return cartesian('volume', [options.width, options.height, options.depth], { ...options, units: options.units ?? 'world' });
  }

  function charts({ charts: specs, seams = [], units = 'world' } = {}) {
    check(Array.isArray(specs) && integer(specs.length, 1, 64) && Array.isArray(seams) && seams.length <= specs.length * 2,
      'expected bounded chart and seam lists');
    const cells = [], edges = [], carriers = new Map(), active = new Map();
    let size = 0;
    function xyz(carrier, uv) {
      const p = carrier.sample(uv)?.p;
      check(tuple(p, 3), 'chart carriers need a finite XYZ position');
      return p.slice();
    }
    for (const raw of specs) {
      const { id, width, height, carrier, mask } = raw ?? {};
      check(keyName(id) && !carriers.has(id) && integer(width, 1, 512) && integer(height, 1, 512) &&
        typeof carrier?.sample === 'function' && (mask === undefined || typeof mask === 'function'),
      'charts need distinct IDs, bounded dimensions and a carrier');
      size += width * height;
      check(size <= maxCells, 'charts exceed the cell budget');
      carriers.set(id, { id, width, height, carrier });
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const uv = [(x + .5) / width, (y + .5) / height];
        const cell = freeze({ id: chartId(id,x,y), chart: id, address: [id,x,y],
          uv, position: xyz(carrier, uv.slice()), units });
        if (mask && !mask(cell)) continue;
        cells.push(cell);
        active.set(cell.id, cell);
      }
    }
    function link(a, b, length, weight = 1, seam = null) {
      check(positive(length), 'chart links need positive distances');
      const edge = { id: 'chart-link/' + edges.length, from: a.id, to: b.id, bidirectional: true,
        delay: 1, weight, length, seam, data: {} };
      edges.push(edge);
      if (a.id === b.id) edges.push({ ...edge, id: edge.id + '/opposite' });
    }
    for (const a of cells) {
      const [id,x,y] = a.address;
      for (const [nx,ny] of [[x+1,y], [x,y+1]]) {
        const b = active.get(chartId(id,nx,ny));
        if (b) link(a,b,V.dist(a.position,b.position));
      }
    }

    function endpoint(raw) {
      const chart = carriers.get(raw?.[0]), side = sides.indexOf(raw?.[1]);
      check(tuple(raw, 2, v => typeof v === 'string') && chart && side >= 0, 'seams need chart IDs and u0, u1, v0 or v1');
      const { id, width, height, carrier } = chart, u = side < 2, high = side % 2 === 1;
      return {
        key: id + ':' + sides[side], count: u ? height : width,
        cell: i => active.get(u ? chartId(id,high ? width-1 : 0,i) : chartId(id,i,high ? height-1 : 0)),
        boundary: cell => xyz(carrier, u ? [Number(high),cell.uv[1]] : [cell.uv[0],Number(high)])
      };
    }
    const used = new Set(), joins = [];
    for (const raw of seams) {
      const { a, b, reverse = false, weight = 1, length } = raw ?? {};
      const from = endpoint(a), to = endpoint(b);
      check(from.key !== to.key && !used.has(from.key) && !used.has(to.key) && from.count === to.count &&
        typeof reverse === 'boolean' && positive(weight) && weight <= 1e6 && (length === undefined || positive(length)),
      'seams need unused edges, matching sample counts, and positive lengths and weights');
      used.add(from.key);
      used.add(to.key);
      const id = 'seam-' + joins.length;
      joins.push({ id, a: a.slice(), b: b.slice(), reverse, weight, ...(length !== undefined && { length }) });
      for (let i = 0; i < from.count; i++) {
        const p = from.cell(i), q = to.cell(reverse ? from.count - i - 1 : i);
        if (p && q) link(p,q,length ?? V.dist(p.position,from.boundary(p)) + V.dist(q.position,to.boundary(q)),weight,id);
      }
    }
    const layout = [...carriers.values()].map(({ id,width,height }) => ({ id,width,height }));
    return build('charts', units, cells, edges, where =>
      tuple(where, 3, (_n) => true) && typeof where[0] === 'string' &&
      integer(where[1], 0, 511) && integer(where[2], 0, 511) ? chartId(...where) : null,
    { charts: layout, seams: joins, boundary: 'closed', neighborhood: 'faces' });
  }

  function graph({ nodes = [], edges = [], units = 'edge' } = {}) {
    check(Array.isArray(nodes) && integer(nodes.length, 1, maxCells) && Array.isArray(edges) && edges.length <= maxEdges,
      'expected a bounded graph of nodes and edges');
    const authored = new Map();
    const cells = Array.from(nodes, raw => {
      const { id, position = null, data = {}, type = 'cell', state, locked = false } =
        typeof raw === 'string' ? { id: raw } : raw ?? {};
      check(label(id) && !authored.has(id) && (position === null || tuple(position,3)) && record(data) &&
        label(type) && typeof locked === 'boolean',
        'graph nodes need unique IDs and optional positions and metadata');
      const cell = { id, address: id, position: position?.slice() ?? null, data: clone(data) };
      authored.set(id, { type, state, locked, cell });
      return cell;
    }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const links = Array.from(edges, raw => {
      const { from, to, id, weight = 1, delay = 1, bidirectional = false, type = 'link', data = {} } = raw ?? {};
      const a = authored.get(from)?.cell, b = authored.get(to)?.cell;
      const length = raw?.length ?? (units === 'edge' ? 1 : a?.position && b?.position ? V.dist(a.position,b.position) : null);
      check(a && b && positive(length) && positive(weight) && weight <= 1e6 && integer(delay,1,64) &&
        typeof bidirectional === 'boolean' && label(type) && (id === undefined || label(id,4096)) && record(data),
      'graph edges need endpoints, positive distance and weight, and a 1–64 tick delay');
      const [start,end] = bidirectional && from > to ? [to,from] : [from,to];
      const edgeId = id ?? JSON.stringify([bidirectional,start,end,type]);
      return { id: edgeId, from: start, to: end, length, weight, delay, bidirectional, type, data: clone(data) };
    }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    check(new Set(links.map(edge => edge.id)).size === links.length, 'graph edge IDs must be distinct');
    return build('graph', units, cells, links, () => null, { boundary: 'authored' }, authored);
  }

  function create({ domain, rule, states, channels, initial, seed = 0, dt = 1, timeUnit = 'tick' } = {}) {
    const topology = compiled.get(domain);
    check(topology && typeof rule === 'function' && positive(dt) && label(timeUnit,48) &&
      (channels === undefined || Array.isArray(channels) && integer(channels.length,1,12) &&
        Array.from(channels).every(keyName) && new Set(channels).size === channels.length),
    'expected a domain, neighborhood rule, positive timestep and optional distinct channel names');
    const names = channels && Object.freeze(channels.slice());
    const run = GraphCellular.onDomain({
      ...topology, rule, states, seed,
      initial: typeof initial === 'function' ? ({ id, random }) => initial({ cell: domain.cell(id), random }) : initial
    }, { channels: names, dt, timeUnit, kind: domain.kind, units: domain.units, cell: domain.cell, cells: domain.cells });
    let previous, revision = -1;
    function resolve(at) {
      const cell = domain.cell(at);
      check(cell, 'unknown or masked cell ' + String(at));
      return cell.id;
    }
    function frame() {
      if (run.revision === revision) return previous;
      const view = run.frame();
      revision = run.revision;
      previous = Object.freeze({ domain, states: run.states, channels: names, tick: view.tick, time: view.tick * dt, dt, timeUnit,
        historySize: view.historySize,
        get(at, age = 0) {
          const cell = domain.cell(at);
          return cell ? view.get(cell.id,age) : null;
        },
        isLocked: at => view.isLocked(resolve(at)),
        isBlocked: at => view.isBlocked(resolve(at)),
        data(channel) {
          if (names && channel === undefined) return domain.cells.map(cell => view.get(cell.id));
          if (names) {
            check(names.includes(channel), 'unknown state channel ' + String(channel));
            return Float64Array.from(domain.cells, cell => view.get(cell.id)[channel]);
          }
          check(channel === undefined, 'discrete state has one unnamed channel');
          return Uint8Array.from(domain.cells, cell => view.get(cell.id));
        }
      });
      return previous;
    }
    return Object.freeze({ domain, dt, timeUnit, states: run.states, channels: names,
      get tick() { return run.tick; }, frame, step: run.step, reset: run.reset,
      checkpoint: run.checkpoint, restore: run.restore,
      get: (at,age) => frame().get(at,age),
      edit(changes) {
        check(Array.isArray(changes) && changes.length <= domain.cells.length,'expected a bounded cell edit list');
        return run.edit(Array.from(changes, raw => {
          const { at, id, ...values } = raw ?? {};
          check((at === undefined) !== (id === undefined),'an edit needs a cell address or ID');
          return { ...values, id: resolve(at ?? id) };
        }));
      }
    });
  }

  function diffusion({ channel = 'value', rate = 1 } = {}) {
    check(keyName(channel) && positive(rate), 'diffusion needs a channel and a positive rate');
    return ({ state, inputs, dt }) => {
      const before = state[channel];
      check(Number.isFinite(before), 'diffusion channel must exist in the state');
      const weight = inputs.reduce((sum, input) => sum + input.edge.weight, 0);
      if (!weight) return state;
      const mean = inputs.reduce((sum,input) => sum + input.state[channel] * (input.edge.weight / weight), 0);
      const mix = Math.min(1, rate * dt);
      return { ...state, [channel]: before * (1 - mix) + mean * mix };
    };
  }

  return Object.freeze({ image, volume, charts, graph, create, rules: Object.freeze({ diffusion }) });
})();
