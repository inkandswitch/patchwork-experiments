/* Seeded, bounded Bridson sampling for finite planar and volumetric assets. */
(function (K) {
  const P = K.procedural,
    TAU = 2 * Math.PI,
    finite = n => Number.isFinite(n) && Math.abs(n) <= 1e6,
    budget = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const within = (point, size) => point.every((value, i) => Number.isFinite(value) && value >= 0 && value <= size[i]);

  function poisson(spec = {}) {
    const {
      bounds, radius, minRadius = radius, maxRadius = radius,
      mask, seed = 0, attempts = 30, maxPoints = 10000,
      maxTrials = 1000000, maxChecks = 5000000, seeds = [], reseed = 0
    } = spec;
    const dimensions = bounds?.min?.length,
      unit = spec.axisScale ?? new Array(dimensions === 3 ? 3 : 2).fill(1),
      vector = p => Array.isArray(p) && p.length === dimensions && p.every(finite),
      fixed = typeof radius === 'number';
    if (
      ![2, 3].includes(dimensions) || !vector(bounds.min) || !vector(bounds.max) ||
      bounds.min.some((x, i) => x >= bounds.max[i]) ||
      !vector(unit) || unit.some(scale => scale < 1e-6) ||
      ![minRadius, maxRadius].every(n => finite(n) && n >= 1e-7) || minRadius > maxRadius ||
      (fixed ? radius !== minRadius || radius !== maxRadius : typeof radius !== 'function') ||
      (mask !== undefined && typeof mask !== 'function') ||
      !Number.isSafeInteger(seed) || !budget(maxPoints, 1, 100000) || !budget(attempts, 1, 256) ||
      !budget(maxTrials, 1, 10000000) || !budget(maxChecks, 1, 60000000) ||
      !budget(reseed, 0, 10000) || !Array.isArray(seeds) || seeds.length > maxPoints ||
      !seeds.every(vector)
    ) throw new Error('Invalid Poisson bounds, radii, seed points or work limits');

    const { min, max } = bounds,
      domain = max.map((x, i) => (x - min[i]) / unit[i]),
      cellSize = maxRadius,
      scale = point => point.map((value, i) => (value - min[i]) / unit[i]),
      unscale = point => point.map((value, i) => Math.min(max[i], min[i] + value * unit[i])),
      cells = new Map(),
      active = [],
      samples = [],
      dice = K.grow.dice(P.data.hash('bridson-poisson', seed)),
      work = { trials: 0, checks: 0, restarts: 0 },
      exhausted = Symbol('Poisson budget');
    if (domain.some(d => !Number.isFinite(d) || d / cellSize > 1e13))
      throw new Error('Poisson lattice exceeds its coordinate budget');

    function insert(position, exact) {
      if (work.trials >= maxTrials) throw exhausted;
      work.trials++;
      if (!within(position, domain)) return false;
      const point = Object.freeze(exact ? exact.slice() : unscale(position));
      if (mask && !mask(point)) return false;
      const r = fixed ? radius : radius(point);
      if (!Number.isFinite(r) || r < minRadius || r > maxRadius) throw new Error('Sample radius is outside its declared bounds');
      const [x, y, z = 0] = position.map(t => Math.floor(t / cellSize)),
        depth = dimensions === 3 ? 1 : 0;
      for (let k = z - depth; k <= z + depth; k++)
        for (let j = y - 1; j <= y + 1; j++)
          for (let i = x - 1; i <= x + 1; i++) {
            const entries = cells.get(i + ':' + j + ':' + k);
            if (!entries) continue;
            for (const other of entries) {
              if (work.checks >= maxChecks) throw exhausted;
              work.checks++;
              const gap = Math.max(r, other.radius);
              const d2 = position.reduce((total, value, axis) => total + (value - other.position[axis]) ** 2, 0);
              if (d2 < gap * gap) return false;
            }
          }
      const key = x + ':' + y + ':' + z,
        record = { position, radius: r };
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(record);
      active.push(record);
      samples.push(Object.freeze({ point, radius: r }));
      return true;
    }

    function around(record) {
      const angle = TAU * dice(),
        lower = record.radius,
        upper = 2 * (fixed ? lower : Math.max(lower, minRadius * (maxRadius / minRadius) ** dice())),
        reach = (lower ** dimensions + (upper ** dimensions - lower ** dimensions) * dice()) ** (1 / dimensions);
      if (dimensions === 2) return [record.position[0] + Math.cos(angle) * reach, record.position[1] + Math.sin(angle) * reach];
      const axial = 2 * dice() - 1,
        ring = reach * Math.sqrt(1 - axial * axial);
      return [
        record.position[0] + Math.cos(angle) * ring,
        record.position[1] + Math.sin(angle) * ring,
        record.position[2] + axial * reach
      ];
    }

    let status = 'complete';
    try {
      for (const point of seeds) {
        if (!insert(scale(point), point)) throw new Error('Poisson seed violates its bounds, mask or spacing');
      }
      if (!samples.length)
        for (let i = 0; i < attempts && !samples.length; i++) insert(domain.map(d => d * dice()));
      while (samples.length < maxPoints) {
        if (!active.length) {
          if (work.restarts >= reseed) break;
          work.restarts++;
          insert(domain.map(d => d * dice()));
          continue;
        }
        const index = Math.floor(dice() * active.length),
          record = active[index];
        let inserted = false;
        for (let i = 0; i < attempts && !inserted; i++) inserted = insert(around(record));
        if (!inserted) {
          active[index] = active[active.length - 1];
          active.pop();
        }
      }
      if (samples.length === maxPoints) status = 'point-limit';
    } catch (error) {
      if (error !== exhausted) throw error;
      status = 'budget';
    }
    return Object.freeze({ status, samples: Object.freeze(samples), work: Object.freeze(work) });
  }

  P.sampling = { poisson };
})(KIT);
