/* Bounded shape grammar with named partitions, fitted repeats, pinned spans and sockets. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-8,
    axes = ['x', 'y', 'z'],
    keyOK = key => typeof key === 'string' && key.length > 0 && key.length <= 120,
    number = x => Number.isFinite(x) && Math.abs(x) <= 1e6,
    count = (n, max) => Number.isSafeInteger(n) && n >= 1 && n <= max,
    vector = p => Array.isArray(p) && p.length === 3 && p.every(number);
  function fail(message) {
    throw new Error('Shape grammar: ' + message);
  }
  function axisOf(name) {
    const axis = axes.indexOf(name);
    if (axis < 0) fail('expected x, y, or z axis');
    return axis;
  }
  function interval(bounds, axis, lo, hi) {
    const min = bounds.min.slice(), max = bounds.max.slice();
    min[axis] = lo;
    max[axis] = hi;
    return { min, max };
  }
  function keys(entries) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 4096 ||
      entries.some(entry => !keyOK(entry?.key)) || new Set(entries.map(entry => entry.key)).size !== entries.length
    ) fail('operations need unique named entries');
    return entries;
  }
  function rootBounds(bounds) {
    if (!vector(bounds?.min) || !vector(bounds?.max) || bounds.min.some((v, i) => bounds.max[i] - v <= EPS))
      fail('scope requires positive finite XYZ bounds');
    return { min: bounds.min.slice(), max: bounds.max.slice() };
  }
  const direction = (axis, value) => [0, 1, 2].map(i => i === axis ? value : 0);

  function expand(scope, rules, { seed = 0, pinSets = {}, maxSteps = 30000, maxParts = 12000, maxDepth = 40 } = {}) {
    if (
      !rules || typeof rules !== 'object' || Array.isArray(rules) ||
      !pinSets || typeof pinSets !== 'object' || Array.isArray(pinSets) ||
      !keyOK(scope?.id ?? 'scope') || !Number.isSafeInteger(seed) ||
      !count(maxSteps, 200000) || !count(maxParts, 40000) || !count(maxDepth, 96)
    ) fail('invalid rules, scope, seed, or work limits');
    const bounds = rootBounds(scope?.bounds),
      parts = [], sockets = [], outputKeys = new Set();
    let steps = 0;
    function output(path, label, value, list) {
      if (label !== undefined) {
        if (!keyOK(label)) fail('output keys must be nonempty names');
        path = [...path, label];
      }
      const key = JSON.stringify(path);
      if (outputKeys.has(key)) fail('duplicate output key ' + key);
      if (parts.length + sockets.length >= maxParts) fail('output exceeds its part budget');
      outputKeys.add(key);
      list.push({ key, path, ...value });
    }
    function split(node, box, path, depth) {
      const axis = axisOf(node.axis),
        lo = box.min[axis], hi = box.max[axis],
        entries = keys(node.parts),
        portions = entries.map(entry => ({
          size: entry.size ?? 0, weight: entry.weight ?? (entry.size === undefined ? 1 : 0)
        }));
      if (portions.some(({ size, weight }) => !number(size) || !number(weight) || size < 0 || weight < 0 || (!size && !weight)))
        fail('split sizes and weights must be nonnegative with a positive contribution');
      const fixed = portions.reduce((sum, p) => sum + p.size, 0),
        weight = portions.reduce((sum, p) => sum + p.weight, 0),
        available = hi - lo - fixed;
      if (available < -EPS || (!weight && available > EPS)) fail('split dimensions do not fit the scope');
      let at = lo;
      for (const [i, entry] of entries.entries()) {
        const { size, weight: share } = portions[i],
          end = i === entries.length - 1 ? hi : at + size + (weight ? Math.max(0, available) * share / weight : 0);
        if (end - at > EPS) visit(entry.use, interval(box, axis, at, end), [...path, entry.key], depth + 1);
        at = end;
      }
    }
    function proportion(node, box, path, depth) {
      const { plane = ['x', 'y'], use = null, seam = null, ratio, depth: levels, axis, recurse, majorAt, gap,
        minSpan } = node;
      if (!Array.isArray(plane) || plane.length !== 2 || plane[0] === plane[1])
        fail('proportion needs two distinct axes');
      const dims = Array.from(plane, axisOf);
      const layout = P.proportions.subdivide({
        min: dims.map(dim => box.min[dim]), max: dims.map(dim => box.max[dim])
      }, { ratio, depth: levels, axis, recurse, majorAt, gap, minSpan });
      steps += layout.nodes.length - 1;
      if (steps > maxSteps) fail('execution exceeds its step or depth budget');
      function place(region, production) {
        const min = box.min.slice(), max = box.max.slice();
        for (const [i, dim] of dims.entries()) {
          min[dim] = region.bounds.min[i];
          max[dim] = region.bounds.max[i];
        }
        visit(production, { min, max }, [...path, ...region.path], depth + region.depth + 1);
      }
      for (const leaf of layout.leaves) {
        const side = leaf.path.at(-1);
        place(leaf, side && Object.hasOwn(node, side) ? node[side] : use);
      }
      if (seam !== null) for (const cut of layout.seams) {
        const dim = cut.axis === 'u' ? 0 : 1;
        if (cut.bounds.max[dim] - cut.bounds.min[dim] > EPS) place(cut, seam);
      }
    }
    function repeat(node, box, path, depth) {
      const axis = axisOf(node.axis),
        pitch = node.pitch, gap = node.gap ?? 0,
        lo = box.min[axis], hi = box.max[axis];
      if (!number(pitch) || pitch <= EPS || !number(gap) || gap < 0) fail('repeat needs a positive pitch and nonnegative gap');
      if (node.pinSet !== undefined && (!keyOK(node.pinSet) || node.pins !== undefined)) fail('repeat needs either a named pin set or inline pins');
      const specified = node.pinSet === undefined ? node.pins ?? [] : (Object.hasOwn(pinSets, node.pinSet) ? pinSets[node.pinSet] : []);
      if (!Array.isArray(specified) || specified.length > 4096) fail('repeat pins must be a bounded list');
      const ids = new Set(),
        pins = specified.map(pin => {
          if (!keyOK(pin?.id) || ids.has(pin.id) || !number(pin.at) || !number(pin.span) || pin.span <= EPS)
            fail('repeat pins need unique IDs, positions and positive spans');
          ids.add(pin.id);
          return { ...pin, low: pin.at - pin.span / 2, high: pin.at + pin.span / 2 };
        }).sort((a, b) => a.low - b.low);
      for (const [i, pin] of pins.entries()) {
        if (pin.low < (pins[i - 1]?.high ?? lo) - EPS || pin.high > hi + EPS) fail('repeat pins overlap or leave the scope');
      }
      function bays(a, b, left, right) {
        if (b - a <= EPS) return;
        const nx = Math.max(1, Math.round((b - a) / pitch));
        if (nx > maxSteps - steps || nx > 65536) fail('repeat exceeds its step budget');
        const { cells } = P.fittedCourses({ width: b - a, height: 1, unit: [pitch, 1], budget: nx });
        const fromHigh = !left && Boolean(right),
          namespace = JSON.stringify([left ?? null, right ?? null]);
        for (const [i, cell] of cells.entries()) {
          const low = a + cell.bounds.min[0] + (i > 0 ? gap * 0.5 : 0),
            high = a + cell.bounds.max[0] - (i < nx - 1 ? gap * 0.5 : 0);
          if (high - low <= EPS) fail('repeat gap consumes a fitted cell');
          const slot = fromHigh ? nx - i - 1 : i;
          visit(node.use, interval(box, axis, low, high), [...path, 'bay', namespace, slot], depth + 1);
        }
      }
      let at = lo, previous = null;
      for (const pin of pins) {
        const start = Math.max(lo, pin.low), end = Math.min(hi, pin.high);
        bays(at, start, previous, pin.id);
        visit(pin.use ?? node.pinUse ?? node.use, interval(box, axis, start, end), [...path, 'pin', pin.id], depth + 1);
        at = end;
        previous = pin.id;
      }
      bays(at, hi, previous, null);
    }
    function visit(operation, box, path, depth) {
      if (++steps > maxSteps || depth > maxDepth) fail('execution exceeds its step or depth budget');
      if (operation === null) return;
      if (typeof operation === 'string') {
        if (!Object.hasOwn(rules, operation)) fail('unknown production ' + operation);
        visit(rules[operation], box, path, depth + 1);
        return;
      }
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) fail('invalid production');
      switch (operation.op) {
        case 'emit': {
          const { role, key, data = {} } = operation;
          if (!keyOK(role)) fail('emitted pieces need a role');
          const center = box.min.map((v, i) => (v + box.max[i]) * 0.5),
            half = box.min.map((v, i) => (box.max[i] - v) * 0.5);
          output(path, key, { role, bounds: box, center, half, data: P.data.clone(data) }, parts);
          break;
        }
        case 'socket': {
          const { name, key = name, side = 'max', at = [0.5, 0.5, 0.5], axis: which = 'z', data = {} } = operation,
            axis = axisOf(which);
          if (!keyOK(name) || !['min', 'max'].includes(side) || !vector(at) || at.some(v => v < 0 || v > 1))
            fail('sockets need a name, a face and normalized XYZ offsets');
          const point = box.min.map((v, i) => i === axis ? box[side][i] : v + at[i] * (box.max[i] - v));
          output(path, key, { name, point, normal: direction(axis, side === 'max' ? 1 : -1), data: P.data.clone(data) }, sockets);
          break;
        }
        case 'group':
          for (const child of keys(operation.children)) visit(child.use, box, [...path, child.key], depth + 1);
          break;
        case 'split':
          split(operation, box, path, depth);
          break;
        case 'proportion':
          proportion(operation, box, path, depth);
          break;
        case 'repeat':
          repeat(operation, box, path, depth);
          break;
        case 'inset': {
          const margin = operation.margin ?? 0,
            both = number(margin) ? [margin, margin, margin] : margin,
            low = operation.min ?? both, high = operation.max ?? both;
          if (!vector(low) || !vector(high) || [...low, ...high].some(v => v < 0))
            fail('insets need nonnegative XYZ margins');
          const next = { min: box.min.map((v, i) => v + low[i]), max: box.max.map((v, i) => v - high[i]) };
          if (next.min.some((v, i) => next.max[i] - v <= EPS)) {
            if (!operation.optional) fail('inset consumes its scope');
          } else visit(operation.use, next, path, depth + 1);
          break;
        }
        case 'choice': {
          const options = keys(operation.options),
            weights = options.map(option => option.weight ?? 1);
          if (weights.some(w => !number(w) || w <= 0)) fail('choices need positive weights');
          const total = weights.reduce((sum, value) => sum + value, 0);
          let pick = P.data.hash(JSON.stringify(path), seed >>> 0) / 4294967296 * total,
            chosen = options.at(-1);
          for (const [i, option] of options.entries()) {
            pick -= weights[i];
            if (pick >= 0) continue;
            chosen = option;
            break;
          }
          visit(chosen.use, box, [...path, chosen.key], depth + 1);
          break;
        }
        default:
          fail('unknown operation ' + operation.op);
      }
    }
    visit(scope.symbol, bounds, [scope.id ?? 'scope'], 0);
    return P.data.freeze({ parts, sockets, work: { steps } });
  }

  function children(layout, { partType = 'grammarPart', socketType = 'grammarSocket' } = {}) {
    if (!Array.isArray(layout?.parts) || !Array.isArray(layout?.sockets) || !keyOK(partType) || !keyOK(socketType))
      fail('retained children need an expanded layout and named types');
    return [...layout.parts.map(record => ({ key: record.key, type: partType, parameters: record })),
      ...layout.sockets.map(record => ({ key: record.key, type: socketType, parameters: record }))];
  }

  P.grammar = { expand, children };
})(KIT);
