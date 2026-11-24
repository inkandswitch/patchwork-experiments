/* Bounded XZ routing with exact endpoint pins, weighted terrain, and directional A*. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-8,
    directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]],
    slots = directions.length + 1,
    pinHeading = directions.length,
    exhausted = Symbol('sample budget'),
    horizontal = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]),
    heading = (a, b) => horizontal(a, b) > EPS ? Math.atan2(b[2] - a[2], b[0] - a[0]) : null,
    vector = p => Array.isArray(p) && p.length === 3 && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6),
    budget = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max,
    limit = n => n === Infinity || (Number.isFinite(n) && n >= 0);

  function turn(a, b, weight) {
    if (a === null || b === null || !weight) return 0;
    const diff = Math.abs(a - b);
    return weight * Math.min(diff, 2 * Math.PI - diff);
  }

  function evaluator(options, step, stats) {
    const { height, clearance, keepOut, cost, minClearance, maxSlope, slopeCost, maxDeviation, maxSamples } = options;
    function point(x, y, z, ground) {
      if (stats.samples >= maxSamples) throw exhausted;
      stats.samples++;
      if (!Number.isFinite(y) || !Number.isFinite(ground) || Math.abs(y - ground) > maxDeviation + EPS ||
        keepOut?.(x, z, y)) return Infinity;
      const gap = clearance ? clearance(x, y, z) : Infinity;
      if (!(gap >= minClearance)) return Infinity;
      const extra = cost ? cost(x, y, z) : 0;
      if (!limit(extra)) throw new Error('Terrain route cost must be nonnegative');
      return extra;
    }
    function edge(a, b) {
      if (a[0] > b[0] || (a[0] === b[0] && a[2] > b[2])) [a, b] = [b, a];
      const distance = horizontal(a, b);
      if (distance <= EPS) return Math.abs(b[1] - a[1]) <= EPS ? 0 : Infinity;
      const rise = Math.abs(b[1] - a[1]) / distance;
      if (rise > maxSlope + EPS) return Infinity;
      const n = Math.max(2, Math.ceil(distance / step));
      let localCost = 0,
        incline = 0,
        previous = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          x = i === n ? b[0] : a[0] + (b[0] - a[0]) * t,
          y = i === n ? b[1] : a[1] + (b[1] - a[1]) * t,
          z = i === n ? b[2] : a[2] + (b[2] - a[2]) * t,
          ground = height(x, z),
          extra = point(x, y, z, ground);
        if (!Number.isFinite(extra)) return Infinity;
        localCost += extra * (i === 0 || i === n ? 0.5 : 1);
        if (previous !== null) {
          const slope = Math.abs(ground - previous) / (distance / n);
          if (slope > maxSlope + EPS) return Infinity;
          incline += slope;
        }
        previous = ground;
      }
      return distance * (1 + (localCost + slopeCost * incline) / n);
    }
    return { edge, pin: p => point(...p, height(p[0], p[2])) };
  }

  function simplify(points, edge, turnCost, lookAhead) {
    if (lookAhead < 2 || points.length <= 2) return points;
    const costs = [0],
      turns = [0],
      angles = points.slice(1).map((p, i) => heading(points[i], p));
    for (let i = 0; i < angles.length; i++) {
      costs.push(costs[i] + edge(points[i], points[i + 1]));
      turns.push(turns[i] + turn(angles[i - 1] ?? null, angles[i], turnCost));
    }
    const result = [points[0]];
    let incoming = null;
    for (let i = 0; i < points.length - 1;) {
      let next = i + 1;
      for (let j = Math.min(points.length - 1, i + lookAhead); j > next; j--) {
        const angle = heading(points[i], points[j]),
          outgoing = angles[j] ?? null,
          oldCost = costs[j] - costs[i] + turns[j] - turns[i + 1] +
            turn(incoming, angles[i], turnCost) + turn(angles[j - 1], outgoing, turnCost),
          newCost = edge(points[i], points[j]) + turn(incoming, angle, turnCost) + turn(angle, outgoing, turnCost);
        if (newCost <= oldCost + EPS) {
          next = j;
          break;
        }
      }
      incoming = heading(points[i], points[next]);
      result.push(points[next]);
      i = next;
    }
    return result;
  }

  function terrain(start, end, spec = {}) {
    const {
      bounds, height, clearance, keepOut, cost, cell = 0.5, sampleStep = cell / 3,
      minClearance = 0, maxSlope = Infinity, slopeCost = 0, turnCost = 0, maxDeviation = Infinity,
      lookAhead = 16, maxCells = 50000, maxVisits = 180000, maxSamples = 3000000
    } = spec;
    if (
      !vector(start) || !vector(end) || !vector(bounds?.min) || !vector(bounds?.max) ||
      ![0, 2].every(i => bounds.min[i] < bounds.max[i] && [start, end].every(p => p[i] >= bounds.min[i] && p[i] <= bounds.max[i])) ||
      horizontal(start, end) <= EPS || typeof height !== 'function' ||
      [clearance, keepOut, cost].some(value => value !== undefined && typeof value !== 'function') ||
      ![cell, sampleStep].every(n => Number.isFinite(n) && n > EPS) ||
      ![minClearance, slopeCost, turnCost].every(n => Number.isFinite(n) && n >= 0) ||
      !limit(maxSlope) || !limit(maxDeviation) ||
      !budget(maxCells, 250000) || !budget(maxVisits, 2250000) || !budget(maxSamples, 30000000) ||
      !Number.isSafeInteger(lookAhead) || lookAhead < 0 || lookAhead > 128
    ) throw new Error('Invalid terrain route pins, bounds, callbacks or search limits');

    const [x0, , z0] = bounds.min,
      [x1, , z1] = bounds.max,
      nx = Math.ceil((x1 - x0) / cell) + 1,
      nz = Math.ceil((z1 - z0) / cell) + 1,
      count = nx * nz,
      stats = { cells: count, visits: 0, samples: 0 },
      outcome = (status, fields = {}) => Object.freeze({ status, ...fields, work: Object.freeze({ ...stats }) });
    if (count > maxCells) return outcome('budget', { reason: 'cells' });

    const dx = (x1 - x0) / (nx - 1),
      dz = (z1 - z0) / (nz - 1),
      points = new Array(count),
      bearings = directions.map(([x, z]) => Math.atan2(z * dz, x * dx)),
      source = slots * count,
      target = source + 1,
      { edge, pin } = evaluator({ height, clearance, keepOut, cost, minClearance, maxSlope, slopeCost, maxDeviation, maxSamples }, sampleStep, stats);
    function at(index) {
      if (!points[index]) {
        const i = index % nx,
          j = Math.floor(index / nx),
          x = i === nx - 1 ? x1 : x0 + i * dx,
          z = j === nz - 1 ? z1 : z0 + j * dz;
        points[index] = [x, height(x, z), z];
      }
      return points[index];
    }
    function near(p) {
      const x = Math.round((p[0] - x0) / dx),
        z = Math.round((p[2] - z0) / dz),
        indices = [];
      for (let j = Math.max(0, z - 1); j <= Math.min(nz - 1, z + 1); j++)
        for (let i = Math.max(0, x - 1); i <= Math.min(nx - 1, x + 1); i++) indices.push(j * nx + i);
      return indices;
    }
    const valueAt = id => id === source ? start : id === target ? end : at(Math.floor(id / slots));
    try {
      if (![start, end].every(p => Number.isFinite(pin(p)))) return outcome('blocked-pin');
      const goalNeighbors = new Map(near(end).map(i => [i, edge(at(i), end)])),
        edges = new Float64Array(count * directions.length).fill(NaN),
        distance = new Float64Array(target + 1).fill(Infinity),
        parent = new Int32Array(target + 1).fill(-1),
        open = new ProceduralHeap((a, b) => a.priority < b.priority || (a.priority === b.priority && a.id < b.id));
      function enqueue(id, predecessor, g) {
        if (g >= distance[id]) return;
        distance[id] = g;
        parent[id] = predecessor;
        open.push({ id, g, priority: g + horizontal(valueAt(id), end) });
      }

      enqueue(source, -1, 0);
      while (open.size) {
        const { id, g } = open.pop();
        if (g !== distance[id]) continue;
        if (id === target) {
          const raw = [];
          for (let current = id; current >= 0; current = parent[current]) {
            const p = valueAt(current);
            if (!raw.length || horizontal(raw.at(-1), p) > EPS) raw.push(p);
            else if (current === source) raw[raw.length - 1] = start;
          }
          raw.reverse();
          const result = simplify(raw, edge, turnCost, lookAhead);
          if (result.length > 4097) return outcome('budget', { reason: 'points' });
          let total = 0,
            incoming = null;
          for (let i = 1; i < result.length; i++) {
            const angle = heading(result[i - 1], result[i]);
            total += edge(result[i - 1], result[i]) + turn(incoming, angle, turnCost);
            incoming = angle;
          }
          if (!Number.isFinite(total)) return outcome('unreachable');
          return outcome('ok', { route: P.routes.polyline(result), cost: total, gridPoints: raw.length });
        }
        if (stats.visits >= maxVisits) return outcome('budget', { reason: 'visits' });
        stats.visits++;
        if (id === source) {
          if (horizontal(start, end) <= 2 * Math.hypot(dx, dz)) enqueue(target, id, edge(start, end));
          for (const i of near(start)) enqueue(i * slots + pinHeading, id, edge(start, at(i)));
          continue;
        }

        const index = Math.floor(id / slots),
          prior = id % slots,
          point = at(index),
          angle = prior === pinHeading ? heading(start, point) : bearings[prior];
        if (goalNeighbors.has(index))
          enqueue(target, id, g + goalNeighbors.get(index) + turn(angle, heading(point, end), turnCost));
        for (let direction = 0; direction < directions.length; direction++) {
          const [di, dj] = directions[direction],
            i = index % nx + di,
            j = Math.floor(index / nx) + dj;
          if (i < 0 || i >= nx || j < 0 || j >= nz) continue;
          const next = j * nx + i,
            cache = index * directions.length + direction;
          if (Number.isNaN(edges[cache])) {
            const back = (direction + directions.length / 2) % directions.length,
              weight = edge(point, at(next));
            edges[cache] = weight;
            edges[next * directions.length + back] = weight;
          }
          enqueue(next * slots + direction, id, g + edges[cache] + turn(angle, bearings[direction], turnCost));
        }
      }
      return outcome('unreachable');
    } catch (error) {
      if (error === exhausted) return outcome('budget', { reason: 'samples' });
      throw error;
    }
  }

  P.routes.terrain = terrain;
  P.routes.terrainSampler = options=>evaluator({slopeCost:0,maxDeviation:Infinity,maxSamples:Infinity,...options},
    options.sampleStep,{samples:0});
})(KIT);
