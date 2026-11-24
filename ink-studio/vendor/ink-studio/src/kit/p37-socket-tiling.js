/* Weighted simple-tiled WFC with pinned cells, socket constraints and bounded backtracking. */
(function (K) {
  const P = K.procedural,
    names = ['north', 'east', 'south', 'west'],
    delta = [[0, -1], [1, 0], [0, 1], [-1, 0]],
    sets = new WeakMap(),
    limit = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    socket = s => s === null || typeof s === 'string' || typeof s === 'boolean' || Number.isFinite(s),
    single = bits => bits !== 0n && (bits & (bits - 1n)) === 0n;

  function compile(input, { matches = (a, b) => a === b } = {}) {
    if (!Array.isArray(input) || !limit(input.length, 1, 256) || typeof matches !== 'function')
      throw new Error('Tiling needs between one and 256 tile definitions');
    const indices = new Map(),
      bits = [],
      lookup = new Map(),
      tiles = [];
    for (const [i, tile] of input.entries()) {
      if (
        typeof tile?.id !== 'string' || tile.id.length < 1 || tile.id.length > 120 || indices.has(tile.id) ||
        (tile.sockets !== undefined && (!tile.sockets || typeof tile.sockets !== 'object' || Array.isArray(tile.sockets) ||
          Object.keys(tile.sockets).some(key => !names.includes(key) || !socket(tile.sockets[key]))))
      ) throw new Error('Tiles need unique IDs and valid directional sockets');
      const weight = tile.weight ?? 1;
      if (!Number.isFinite(weight) || weight < 1e-9 || weight > 1e9) throw new Error('Tile weights must be finite and positive');
      const sockets = Object.fromEntries(names.map(key => [key, tile.sockets?.[key] ?? null]));
      tiles.push({ id: tile.id, weight, sockets });
      indices.set(tile.id, i);
      const bit = 1n << BigInt(i);
      bits.push(bit);
      lookup.set(bit, i);
    }
    const compatibility = names.map((name, direction) => tiles.map(a => {
      let allowed = 0n;
      for (let i = 0; i < tiles.length; i++) {
        const b = tiles[i];
        if (matches(a.sockets[name], b.sockets[names[(direction + 2) % 4]], name)) allowed |= bits[i];
      }
      return allowed;
    }));
    const model = Object.freeze({ tiles: P.data.freeze(tiles) });
    sets.set(model, { indices, bits, lookup, compatibility, full: (1n << BigInt(tiles.length)) - 1n });
    return model;
  }

  function solve(model, {
    width, height, seed = 0, mask, wrap = false, boundary = {},
    pins = [], ports = [], maxCells = 16000, maxWork = 2500000, maxBacktracks = 2000
  } = {}) {
    const library = sets.get(model);
    if (
      !library || !limit(width, 1, 65536) || !limit(height, 1, 65536) || !limit(maxCells, 1, 65536) ||
      width * height > maxCells || !Number.isSafeInteger(seed) ||
      (mask !== undefined && typeof mask !== 'function') ||
      !(typeof wrap === 'boolean' || (Array.isArray(wrap) && wrap.length === 2 && wrap.every(value => typeof value === 'boolean'))) ||
      !boundary || typeof boundary !== 'object' || Array.isArray(boundary) ||
      Object.keys(boundary).some(key => !names.includes(key) || !socket(boundary[key])) ||
      !Array.isArray(pins) || pins.length > 4 * maxCells || !Array.isArray(ports) || ports.length > 8 * maxCells ||
      !limit(maxWork, 1, 30000000) || !limit(maxBacktracks, 0, 100000)
    ) throw new Error('Invalid tiling model, grid, constraints or work limits');

    const { indices, bits, lookup, compatibility, full } = library,
      { tiles } = model,
      count = width * height,
      wrapAxis = Array.isArray(wrap) ? wrap : [wrap, wrap],
      domains = new Array(count),
      active = new Uint8Array(count),
      adjacent = new Int32Array(count * 4).fill(-1),
      versions = new Uint32Array(count),
      initial = [],
      trail = [],
      decisions = [],
      rand = K.grow.dice(P.data.hash('socket-tiling', seed)),
      weights = tiles.map(tile => tile.weight),
      weightLogs = weights.map(w => w * Math.log(w)),
      entropy = new Map(),
      supports = names.map(() => new Map()),
      queueMark = new Uint32Array(count),
      work = { decisions: 0, backtracks: 0, checks: 0 },
      exhausted = Symbol('tiling work limit');
    const tie = new Uint32Array(count),
      before = (a, b) => a.score < b.score || (a.score === b.score && (tie[a.cell] < tie[b.cell] ||
        (tie[a.cell] === tie[b.cell] && a.cell < b.cell)));
    let queueVersion = 0,
      selection = new ProceduralHeap(before);

    function check() {
      if (work.checks >= maxWork) throw exhausted;
      work.checks++;
    }
    function forTiles(domain, visit) {
      for (let remaining = domain; remaining;) {
        const b = remaining & -remaining;
        visit(lookup.get(b), b);
        remaining ^= b;
      }
    }
    function stats(domain) {
      let value = entropy.get(domain);
      if (value) return value;
      let total = 0, logs = 0;
      forTiles(domain, i => {
        check();
        total += weights[i];
        logs += weightLogs[i];
      });
      value = { total, score: Math.log(total) - logs / total };
      if (entropy.size < 4096) entropy.set(domain, value);
      return value;
    }
    function selectCandidate(domain) {
      let chance = rand() * stats(domain).total, selected = 0n;
      forTiles(domain, (i, bit) => {
        if (selected) return;
        check();
        chance -= weights[i];
        if (chance < 0) selected = bit;
      });
      return selected || (domain & -domain);
    }
    function register(cell) {
      if (!domains[cell] || single(domains[cell])) return;
      selection.push({ cell, score: stats(domains[cell]).score, version: versions[cell] });
    }
    function setDomain(cell, domain, save = true) {
      if (save) trail.push({ cell, old: domains[cell] });
      domains[cell] = domain;
      versions[cell]++;
      register(cell);
    }
    function undo(marker) {
      while (trail.length > marker) {
        const { cell, old } = trail.pop();
        setDomain(cell, old, false);
      }
    }
    function bestCell() {
      if (selection.size > Math.max(128, count * 6)) {
        selection = new ProceduralHeap(before);
        for (const cell of initial) register(cell);
      }
      while (selection.size) {
        const next = selection.pop();
        if (versions[next.cell] === next.version) return next.cell;
      }
      return -1;
    }

    function support(domain, direction) {
      const cache = supports[direction];
      if (cache.has(domain)) return cache.get(domain);
      let to = 0n;
      forTiles(domain, i => {
        check();
        to |= compatibility[direction][i];
      });
      if (cache.size < 4096) cache.set(domain, to);
      return to;
    }
    function neighbor(cell, direction) {
      const [dx, dz] = delta[direction];
      let x = cell % width + dx, z = Math.floor(cell / width) + dz;
      if (wrapAxis[0]) x = (x + width) % width;
      if (wrapAxis[1]) z = (z + height) % height;
      return x < 0 || x >= width || z < 0 || z >= height || !active[z * width + x] ? -1 : z * width + x;
    }
    function propagate(cells) {
      const queue = cells.slice(), version = ++queueVersion;
      for (const cell of queue) queueMark[cell] = version;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const cell = queue[cursor];
        queueMark[cell] = 0;
        for (let direction = 0; direction < 4; direction++) {
          const other = adjacent[cell * 4 + direction];
          if (other < 0 || other === cell) continue;
          check();
          const old = domains[other],
            next = old & support(domains[cell], direction);
          if (next === old) continue;
          if (!next) return { x: other % width, z: Math.floor(other / width), direction: names[(direction + 2) % 4] };
          setDomain(other, next);
          if (queueMark[other] !== version) {
            queueMark[other] = version;
            queue.push(other);
          }
        }
      }
      return null;
    }
    function cellFor(spec) {
      if (!limit(spec?.x, 0, width - 1) || !limit(spec?.z, 0, height - 1) || !active[spec.z * width + spec.x])
        throw new Error('Tiling pins and ports need an active grid cell');
      return spec.z * width + spec.x;
    }
    function restrict(cell, rule) {
      let next = 0n;
      forTiles(domains[cell], (i, bit) => {
        check();
        if (rule(tiles[i], i, bit)) next |= bit;
      });
      domains[cell] = next;
    }
    function result(status, extra = {}) {
      return Object.freeze({ status, width, height, ...extra, work: Object.freeze({ ...work }) });
    }
    function done() {
      const assigned = Object.freeze(domains.map(d => d ? tiles[lookup.get(d)].id : null));
      return result('ok', {
        tiles: assigned,
        at: (x, z) => limit(x, 0, width - 1) && limit(z, 0, height - 1) ? assigned[z * width + x] : null
      });
    }

    try {
      for (let i = 0; i < count; i++) {
        const x = i % width, z = Math.floor(i / width);
        domains[i] = 0n;
        if (mask && !mask(x, z)) continue;
        active[i] = 1;
        domains[i] = full;
        tie[i] = P.data.hash(String(i), seed >>> 0);
        initial.push(i);
      }
      for (const cell of initial) {
        for (let d = 0; d < 4; d++) {
          const other = neighbor(cell, d),
            name = names[d];
          adjacent[cell * 4 + d] = other;
          if (other < 0 && Object.hasOwn(boundary, name)) restrict(cell, tile => tile.sockets[name] === boundary[name]);
          if (other === cell) restrict(cell, (_, i, bit) => Boolean(compatibility[d][i] & bit));
        }
      }
      for (const pin of pins) {
        const cell = cellFor(pin),
          allowed = pin.tiles ?? [pin.tile];
        if (!Array.isArray(allowed) || !limit(allowed.length, 1, tiles.length) || allowed.some(id => !indices.has(id)))
          throw new Error('Tiling pins must name tiles in the model');
        const domain = allowed.reduce((mask, id) => mask | bits[indices.get(id)], 0n);
        domains[cell] &= domain;
      }
      for (const port of ports) {
        const cell = cellFor(port);
        if (!names.includes(port.direction) || !socket(port.socket)) throw new Error('Tiling ports need a direction and socket');
        restrict(cell, tile => tile.sockets[port.direction] === port.socket);
      }
      for (const cell of initial) {
        if (!domains[cell]) return result('contradiction', { conflict: { x: cell % width, z: Math.floor(cell / width) } });
        register(cell);
      }
      let failure = propagate(initial);
      if (failure) return result('contradiction', { conflict: failure });
      trail.length = 0;
      while (true) {
        let decision;
        if (!failure) {
          const cell = bestCell();
          if (cell < 0) return done();
          decision = { cell, marker: trail.length, remaining: domains[cell] };
          decisions.push(decision);
          work.decisions++;
        } else {
          while (decisions.length) {
            const previous = decisions.at(-1);
            undo(previous.marker);
            if (previous.remaining) {
              decision = previous;
              break;
            }
            decisions.pop();
          }
          if (!decision) return result('contradiction', { conflict: failure });
          if (work.backtracks >= maxBacktracks) return result('budget', { reason: 'backtracks', conflict: failure });
          work.backtracks++;
        }
        const chosen = selectCandidate(decision.remaining);
        decision.remaining ^= chosen;
        setDomain(decision.cell, chosen);
        failure = propagate([decision.cell]);
      }
    } catch (error) {
      if (error === exhausted) return result('budget', { reason: 'work' });
      throw error;
    }
  }

  P.tiles = { compile, solve };
})(KIT);
