/* Bounded sample elimination and centroidal relaxation for finite layouts. */
(function (K) {
  const P = K.procedural,
    coord = n => Number.isFinite(n) && Math.abs(n) <= 1e6,
    point = (p, dimension) => Array.isArray(p) && p.length === dimension && p.every(coord),
    limit = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    squared = (a, b) => a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0);

  function eliminate(input, {
    count, radius, weights, power = 8, progressive = false, maxChecks = 3000000
  } = {}) {
    const dimension = input?.[0]?.length;
    if (
      !Array.isArray(input) || !limit(input.length, 1, 100000) ||
      ![2, 3].includes(dimension) || !input.every(p => point(p, dimension)) ||
      !limit(count, 1, input.length) || (radius !== undefined && (!coord(radius) || radius < 1e-8)) ||
      !Number.isFinite(power) || power < 1 || power > 32 || typeof progressive !== 'boolean' ||
      (weights !== undefined && (!Array.isArray(weights) || weights.length !== input.length ||
        weights.some(w => !Number.isFinite(w) || w < 1e-6 || w > 1e6))) ||
      !limit(maxChecks, 1, 20000000)
    ) throw new Error('Sample elimination needs finite points, a target, optional positive weights and a work budget');
    const points = input.map(p => p.slice()),
      spans = Array.from({ length: dimension }, (_, axis) => {
        let low = Infinity, high = -Infinity;
        for (const p of points) {
          low = Math.min(low, p[axis]);
          high = Math.max(high, p[axis]);
        }
        return high - low;
      }).filter(n => n >= 1e-8),
      actual = Math.max(1, spans.length),
      measure = spans.reduce((product, n) => product * n, 1),
      range = n => Math.max(1e-8, radius ? radius * (count / n) ** (1 / actual) : 2 * (measure / n) ** (1 / actual)),
      offsets = [-1, 0, 1].flatMap(x => [-1, 0, 1].flatMap(y => dimension === 2 ? [[x, y]] : [-1, 0, 1].map(z => [x, y, z]))),
      work = { comparisons: 0, removals: 0 };
    function pick(indices, target) {
      if (indices.length <= target) return indices;
      const r = range(target),
        r2 = r * r,
        grid = new Map(),
        records = [];
      for (const original of indices) {
        const p = points[original],
          cell = p.map(v => Math.floor(v / r)),
          sample = { original, p, neighbors: [], pressure: 0, version: 0, kept: true };
        for (const shift of offsets) {
          const key = cell.map((v, i) => v + shift[i]).join(':');
          for (const other of grid.get(key) ?? []) {
            if (++work.comparisons > maxChecks) throw new Error('Sample elimination exceeds its comparison budget');
            const d2 = squared(p, other.p);
            if (d2 >= r2) continue;
            const cost = (1 - Math.sqrt(d2) / r) ** power;
            sample.neighbors.push({ other, cost });
            other.neighbors.push({ other: sample, cost });
            sample.pressure += cost;
            other.pressure += cost;
          }
        }
        const key = cell.join(':');
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(sample);
        records.push(sample);
      }
      const queue = new ProceduralHeap((a, b) => a.score > b.score || (a.score === b.score && a.sample.original > b.sample.original));
      function register(sample) {
        queue.push({
          sample,
          score: sample.pressure / (weights?.[sample.original] ?? 1),
          version: sample.version
        });
      }
      for (const sample of records) register(sample);
      for (let live = records.length; live > target;) {
        const { sample, version } = queue.pop();
        if (!sample.kept || version !== sample.version) continue;
        sample.kept = false;
        live--;
        work.removals++;
        for (const { other, cost } of sample.neighbors) {
          if (!other.kept) continue;
          other.pressure = Math.max(0, other.pressure - cost);
          other.version++;
          register(other);
        }
      }
      return records.filter(sample => sample.kept).map(sample => sample.original);
    }
    const chosen = pick(points.map((_, i) => i), count),
      levels = [count];
    let indices = chosen;
    if (progressive) {
      const strata = [];
      while (indices.length > 1) {
        const finer = pick(indices, Math.ceil(indices.length / 2)),
          kept = new Set(finer);
        strata.push(indices.filter(i => !kept.has(i)));
        indices = finer;
        levels.push(indices.length);
      }
      indices = indices.concat(...strata.reverse());
    }
    return P.data.freeze({ indices, points: indices.map(i => points[i]), levels: levels.reverse(), work });
  }

  function lloyd(input, {
    bounds, spacing = 0.1, iterations = 4, amount = 1, mask, density, fixed = [],
    maxCells = 120000, maxChecks = 12000000
  } = {}) {
    if (
      !Array.isArray(input) || !limit(input.length, 1, 12000) || !input.every(p => point(p, 2)) ||
      !point(bounds?.min, 2) || !point(bounds?.max, 2) || bounds.min.some((n, i) => n >= bounds.max[i]) ||
      !Number.isFinite(spacing) || spacing < 1e-6 || !limit(iterations, 1, 128) || !Number.isFinite(amount) || amount < 0 || amount > 1 ||
      [mask, density].some(f => f !== undefined && typeof f !== 'function') ||
      !Array.isArray(fixed) || fixed.length > input.length || fixed.some(i => !limit(i, 0, input.length - 1)) ||
      !limit(maxCells, 1, 250000) || !limit(maxChecks, 1, 60000000)
    ) throw new Error('Lloyd relaxation needs points, a bounded domain, spacing and valid controls');
    const [x0, z0] = bounds.min,
      [x1, z1] = bounds.max,
      columns = Math.ceil((x1 - x0) / spacing),
      rows = Math.ceil((z1 - z0) / spacing),
      inside = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && (!mask || mask(x, z)),
      points = input.map(p => p.slice()),
      pins = new Set(fixed),
      cells = [],
      work = { cells: columns * rows, checks: 0, iterations: 0 };
    if (work.cells > maxCells) throw new Error('Lloyd relaxation exceeds its cell budget');
    if (points.some(p => !inside(...p))) throw new Error('Lloyd sites must be inside the domain');
    for (let z = 0; z < rows; z++)
      for (let x = 0; x < columns; x++) {
        const p = [x0 + (x1 - x0) * (x + 0.5) / columns, z0 + (z1 - z0) * (z + 0.5) / rows];
        if (!inside(...p)) continue;
        const weight = density ? density(...p) : 1;
        if (!Number.isFinite(weight) || weight < 0 || weight > 1e6) throw new Error('Lloyd density must be finite and nonnegative');
        if (weight > 0) cells.push({ p, weight });
      }
    if (cells.length * input.length * iterations > maxChecks)
      throw new Error('Lloyd relaxation exceeds its comparison budget');
    for (let pass = 0; pass < iterations; pass++) {
      const totals = points.map(() => [0, 0, 0]);
      for (const { p, weight } of cells) {
        let owner = 0, best = Infinity;
        for (const [i, q] of points.entries()) {
          const d2 = squared(p, q);
          if (d2 < best) {
            best = d2;
            owner = i;
          }
        }
        const sum = totals[owner];
        sum[0] += p[0] * weight;
        sum[1] += p[1] * weight;
        sum[2] += weight;
      }
      for (const [i, point] of points.entries()) {
        const [x, z, total] = totals[i];
        if (!total || pins.has(i)) continue;
        for (let attempt = 0, step = amount; attempt < 11 && step > 0; attempt++, step *= 0.5) {
          const moved = [point[0] + (x / total - point[0]) * step, point[1] + (z / total - point[1]) * step];
          if (!inside(...moved)) continue;
          points[i] = moved;
          break;
        }
      }
      work.checks += cells.length * points.length;
      work.iterations++;
    }
    return P.data.freeze({ points, work });
  }

  Object.assign(P.sampling, { eliminate, lloyd });
})(KIT);
