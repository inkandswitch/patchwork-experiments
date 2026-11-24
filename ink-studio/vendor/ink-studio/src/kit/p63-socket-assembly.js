/* Fit dimensioned modules between named sockets along an existing carrier route. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-8,
    name = s => typeof s === 'string' && s.length > 0 && s.length <= 120,
    finite = n => Number.isFinite(n) && Math.abs(n) <= 1e7,
    positive = n => finite(n) && n > EPS,
    integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b,
    order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function assemble(route, input, {
    id = 'assembly', start = 'default', end = 'default', pins = [], joins = [],
    seed = 0, maxParts = 80, maxChecks = 130000
  } = {}) {
    if (
      !positive(route?.length) || typeof route.sample !== 'function' ||
      !Array.isArray(input) || !integer(input.length, 1, 192) ||
      !name(id) || !name(start) || !name(end) || !Array.isArray(pins) || pins.length >= maxParts ||
      !Array.isArray(joins) || joins.length > 4096 || !Number.isSafeInteger(seed) ||
      !integer(maxParts, 1, 320) || !integer(maxChecks, 1, 1000000)
    ) throw new Error('Module assembly needs a carrier, pieces, sockets and bounded search');
    const ids = new Set(), catalog = [], types = new Set([start, end]), compatible = new Map();
    for (const entry of joins) {
      if (!Array.isArray(entry) || entry.length !== 2 || !entry.every(name))
        throw new Error('Assembly joins need ordered pairs of socket names');
      const [a, b] = entry;
      if (!compatible.has(a)) compatible.set(a, new Set());
      compatible.get(a).add(b);
      types.add(a);
      types.add(b);
    }
    for (const option of input) {
      const { id, length, min = length, max = length, cost = 1, in: enter = 'default', out = 'default',
        reversible = false, data = {} } = option ?? {};
      if (
        !name(id) || ids.has(id) || !positive(min) || !positive(length) || !positive(max) || min > length || length > max ||
        !positive(cost) || !name(enter) || !name(out) || typeof reversible !== 'boolean'
      ) throw new Error('Assembly pieces need unique names, positive dimensions and typed sockets');
      ids.add(id);
      types.add(enter);
      types.add(out);
      const p = { id, length, min, max, cost, enter, out, reversed: false, data: P.data.clone(data) };
      catalog.push(p);
      if (reversible) catalog.push({ ...p, enter: out, out: enter, reversed: true });
    }
    const known = new Set(['$start', '$end']),
      anchors = pins.map(pin => {
        const { id, at, socket, in: enter = socket, out = socket } = pin ?? {};
        if (!name(id) || known.has(id) || !finite(at) || at <= EPS || at >= 1 - EPS || !name(enter) || !name(out))
          throw new Error('Assembly pins need unique IDs, interior arc coordinates and sockets');
        known.add(id);
        types.add(enter);
        types.add(out);
        return { id, at, enter, out };
      }).sort((a, b) => a.at - b.at || order(a.id, b.id));
    if (anchors.some((a, i) => i && a.at - anchors[i - 1].at <= EPS))
      throw new Error('Assembly pin arc coordinates must be distinct');
    anchors.unshift({ id: '$start', at: 0, enter: start, out: start });
    anchors.push({ id: '$end', at: 1, enter: end, out: end });
    const connects = (a, b) => a === b || compatible.get(a)?.has(b),
      candidates = new Map(), upstream = new Map(),
      minPrice = Math.min(...catalog.map(p => p.cost / p.max)),
      minCount = 1 / Math.max(...catalog.map(p => p.max)),
      stepLimit = { checks: 0, queue: 0, priceSearchComplete: true };
    for (const socket of types) candidates.set(socket, catalog.filter(p => connects(socket, p.enter)).sort((a, b) => {
      const rank = p => P.data.hash(socket + ':' + p.id + ':' + Number(p.reversed), seed);
      return rank(a) - rank(b) || order(a.id, b.id) || Number(a.reversed) - Number(b.reversed);
    }));

    for (const [type, pieces] of candidates) for (const socket of new Set(pieces.map(p => p.out))) {
      if (!upstream.has(socket)) upstream.set(socket, []);
      upstream.get(socket).push(type);
    }
    function fit(length, from, to, slots, fewest = false) {
      const tolerance = EPS + 1e-10 * length, endable = new Set([...types].filter(type => connects(type, to))),
        rate = fewest ? minCount : minPrice;
      for (const type of endable) {
        for (const previous of upstream.get(type) ?? []) endable.add(previous);
      }
      if (!endable.has(from)) return { status: 'contradiction' };
      const queue = new ProceduralHeap((a, b) => a.priority < b.priority || (a.priority === b.priority && a.serial < b.serial)),
        best = new Map(), key = (type, min, max, count) => JSON.stringify([type, min.toPrecision(14), max.toPrecision(14), count]);
      let serial = 0;
      queue.push({ from, low: 0, high: 0, count: 0, cost: 0, priority: 0, serial: serial++ });
      while (queue.size) {
        const now = queue.pop();
        if (now.key !== undefined && best.get(now.key) !== now.cost) continue;
        if (now.piece && now.high >= length - tolerance && connects(now.from, to)) {
          const sequence = [];
          for (let path = now; path.piece; path = path.parent) sequence.push(path.piece);
          return { status: 'ok', sequence: sequence.reverse(),
            cost: fewest ? sequence.reduce((sum, p) => sum + p.cost, 0) : now.cost };
        }
        if (now.count === slots) continue;
        for (const p of candidates.get(now.from)) {
          if (stepLimit.checks >= maxChecks) return { status: 'budget' };
          stepLimit.checks++;
          const low = now.low + p.min, high = now.high + p.max, count = now.count + 1, cost = now.cost + (fewest ? 1 : p.cost);
          if (low > length + tolerance || !endable.has(p.out)) continue;
          const entry = key(p.out, low, high, count);
          if (cost >= (best.get(entry) ?? Infinity)) continue;
          best.set(entry, cost);
          queue.push({ from: p.out, low, high, count, cost, serial: serial++, key: entry, piece: p, parent: now,
            priority: cost + Math.max(0, length - high) * rate });
          stepLimit.queue = Math.max(stepLimit.queue, queue.size);
        }
      }
      return { status: 'contradiction' };
    }

    function frame(t) {
      const f = route.sample(t),
        vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
      if (!f || ![f.point, f.tangent, f.side, f.normal].every(vector)) throw new Error('Assembly route returned an invalid frame');
      return { point: f.point.slice(), tangent: f.tangent.slice(), side: f.side.slice(), normal: f.normal.slice() };
    }
    const parts = [], intervals = [], plans = [],
      finish = status => P.data.freeze({ id, status, cost, parts, intervals, anchors, work: stepLimit });
    let cost = 0, status = 'ok';
    let reserved = 0;
    if (pins.length) {
      for (let i = 1; i < anchors.length; i++) {
        const a = anchors[i - 1], b = anchors[i], length = (b.at - a.at) * route.length,
          result = fit(length, a.out, b.enter, maxParts - (anchors.length - 2), true);
        if (result.status !== 'ok') {
          intervals.push({ a: a.id, b: b.id, length, status: result.status });
          return finish(result.status);
        }
        plans.push(result);
        reserved += result.sequence.length;
      }
      if (reserved > maxParts) return finish('contradiction');
    }
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i], length = (b.at - a.at) * route.length,
        minimum = plans[i - 1], minPieces = minimum?.sequence.length ?? 0;
      reserved -= minPieces;
      const slots = maxParts - parts.length - reserved,
        requested = fit(length, a.out, b.enter, slots),
        result = requested.status === 'budget' && minimum ? minimum : requested;
      if (requested.status === 'budget') stepLimit.priceSearchComplete = false;
      intervals.push({ a: a.id, b: b.id, length, status: result.status });
      if (result.status !== 'ok') {
        status = result.status;
        break;
      }
      cost += result.cost;
      const natural = result.sequence.reduce((sum, p) => sum + p.length, 0), delta = length - natural,
        flexibility = result.sequence.reduce((sum, p) => sum + (delta > 0 ? p.max - p.length : p.length - p.min), 0),
        used = new Map();
      let left = a.at;
      for (const [j, p] of result.sequence.entries()) {
        const slack = delta > 0 ? p.max - p.length : p.length - p.min,
          run = p.length + (flexibility > EPS ? delta * slack / flexibility : 0),
          right = j === result.sequence.length - 1 ? b.at : left + run / route.length,
          ordinal = used.get(p.id) ?? 0;
        used.set(p.id, ordinal + 1);
        parts.push({ key: JSON.stringify([id, a.id, b.id, p.id, ordinal]), module: p.id, reversed: p.reversed,
          length: (right - left) * route.length, natural: p.length, t0: left, t1: right, data: p.data,
          in: p.enter, out: p.out, start: frame(left), end: frame(right), frame: frame((left + right) * 0.5)
        });
        left = right;
      }
    }
    return finish(status);
  }
  P.grammar.assemble = assemble;
})(KIT);
