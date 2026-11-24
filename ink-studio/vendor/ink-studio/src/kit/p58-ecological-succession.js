/* Seed dispersal and discrete competition between artist-authored populations. */
(function (K) {
  const P = K.procedural,
    integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    within = (n, min, max) => Number.isFinite(n) && n >= min && n <= max,
    probability = n => within(n, 0, 1);

  function dispersal({
    model = 'gaussian', radius = 4, spread = radius / 2, drift = [0, 0], aspect = 1, angle = 0
  } = {}) {
    if (
      !['gaussian', 'exponential'].includes(model) || !integer(radius, 1, 36) ||
      !within(spread, 0.15, 72) || !within(aspect, 0.125, 8) || !Number.isFinite(angle) ||
      !Array.isArray(drift) || drift.length !== 2 || !drift.every(n => within(n, -radius, radius))
    ) throw new Error('Dispersal needs a bounded Gaussian or exponential kernel');
    const offsets = [], c = Math.cos(angle), s = Math.sin(angle);
    let maximum = -Infinity;
    for (let z = -radius; z <= radius; z++) for (let x = -radius; x <= radius; x++) {
      if (x * x + z * z > radius * radius) continue;
      const a = x - drift[0], b = z - drift[1],
        d = Math.hypot((a * c + b * s) / aspect, b * c - a * s) / spread,
        exponent = model === 'gaussian' ? -0.5 * d * d : -d;
      offsets.push({ x, z, exponent });
      maximum = Math.max(maximum, exponent);
    }
    const weights = [];
    let total = 0;
    for (const { x, z, exponent } of offsets) {
      const weight = Math.exp(exponent - maximum);
      if (weight < 1e-12) continue;
      weights.push({ x, z, weight });
      total += weight;
    }
    for (const offset of weights) offset.weight /= total;
    return P.data.freeze(weights);
  }

  function succession({
    width, height, species, initial = [], years = 16, seed = 0, mask, maxWork = 28000000
  } = {}) {
    if (
      !integer(width, 1, 512) || !integer(height, 1, 512) || width * height > 150000 ||
      !Array.isArray(species) || !integer(species.length, 1, 32) || !Array.isArray(initial) ||
      initial.length > width * height || !integer(years, 0, 500) || !Number.isSafeInteger(seed) ||
      (mask !== undefined && typeof mask !== 'function') || !integer(maxWork, 1, 100000000)
    ) throw new Error('Succession needs a bounded habitat, species, and timeline');
    const size = width * height, used = new Set();
    if (size * species.length > maxWork) throw new Error('Succession exceeds its habitat budget');
    const available = new Uint8Array(size), coordinate = i => [i % width, Math.floor(i / width)];
    for (let i = 0; i < size; i++) available[i] = Number(!mask || mask(...coordinate(i)));
    const kinds = species.map(option => {
      const { id, habitat, maturity = 2, lifespan = 50, survival = 0.985, fecundity = 6,
        competition = 1, immigration = 0, kernel } = option ?? {};
      if (
        typeof id !== 'string' || !id || id.length > 128 || used.has(id) ||
        (habitat !== undefined && typeof habitat !== 'function') ||
        !integer(maturity, 0, 2000) || !integer(lifespan, maturity + 1, 4000) ||
        !probability(survival) || !probability(immigration) || !within(fecundity, 0, 500) ||
        !within(competition, 0, 1000)
      ) throw new Error('Invalid succession species');
      used.add(id);
      const rates = Float32Array.from(available, (allowed, i) => {
        const value = allowed ? habitat ? habitat(...coordinate(i)) : 1 : 0;
        if (!probability(value)) throw new Error('Habitat suitability must be between zero and one');
        return value;
      });
      return { id, rates, maturity, lifespan, survival, fecundity, competition, immigration,
        offsets: dispersal(kernel), pressure: new Float64Array(size) };
    });
    const indices = new Map(kinds.map(({ id }, i) => [id, i + 1])),
      dice = K.grow.dice(P.data.hash('ecological-succession', seed)),
      timeline = [];
    let cells = new Uint8Array(size), ages = new Uint16Array(size),
      nextCells = new Uint8Array(size), nextAges = new Uint16Array(size),
      work = size * kinds.length;
    for (const item of initial) {
      const { x, z, species, age = 0 } = item ?? {}, kind = indices.get(species), i = z * width + x;
      if (
        !integer(x, 0, width - 1) || !integer(z, 0, height - 1) || !kind ||
        !integer(age, 0, kinds[kind - 1].lifespan - 1) || !available[i] || cells[i]
      ) throw new Error('Initial populations need distinct locations and valid species and ages');
      cells[i] = kind;
      ages[i] = age;
    }
    function count() {
      const totals = new Uint32Array(kinds.length);
      for (const i of cells) if (i) totals[i - 1]++;
      return Object.freeze(Object.fromEntries(kinds.map(({ id }, i) => [id, totals[i]])));
    }
    timeline.push(count());
    let status = 'ok';
    for (let year = 0; year < years; year++) {
      let cost = size * (2 * kinds.length + 3);
      for (let i = 0; i < size; i++) {
        const kind = kinds[cells[i] - 1];
        if (kind && ages[i] >= kind.maturity && kind.fecundity) cost += kind.offsets.length;
      }
      if (work + cost > maxWork) {
        status = 'budget';
        break;
      }
      work += cost;
      for (const kind of kinds) kind.pressure.fill(kind.immigration);
      for (let i = 0; i < size; i++) {
        const kind = kinds[cells[i] - 1];
        if (!kind || ages[i] < kind.maturity || !kind.fecundity) continue;
        const [x, z] = coordinate(i);
        for (const offset of kind.offsets) {
          const u = x + offset.x, v = z + offset.z;
          if (u >= 0 && u < width && v >= 0 && v < height)
            kind.pressure[v * width + u] += kind.fecundity * offset.weight;
        }
      }
      for (let i = 0; i < size; i++) {
        if (!available[i]) continue;
        const occupant = cells[i], kind = kinds[occupant - 1], age = ages[i] + 1,
          retained = kind && age < kind.lifespan && dice() < kind.survival * kind.rates[i],
          resistance = retained ? kind.competition : 0;
        let incoming = 0, winner = 0;
        for (const [j, rival] of kinds.entries()) {
          if (retained && occupant === j + 1) continue;
          const pressure = rival.pressure[i] * rival.rates[i] * rival.competition;
          if (!pressure) continue;
          incoming += pressure;
          if (dice() * incoming < pressure) winner = j + 1;
        }
        const replaced = winner && dice() < -Math.expm1(-incoming) * incoming / (incoming + resistance);
        nextCells[i] = replaced ? winner : retained ? occupant : 0;
        nextAges[i] = !replaced && retained ? age : 0;
      }
      [cells, nextCells] = [nextCells, cells];
      [ages, nextAges] = [nextAges, ages];
      timeline.push(count());
    }
    const ids = Object.freeze(kinds.map(({ id }) => id));
    return Object.freeze({ status, width, height, ids, cells, ages, work, timeline: Object.freeze(timeline),
      sample(x, z) {
        if (!integer(x, 0, width - 1) || !integer(z, 0, height - 1)) return null;
        const i = z * width + x;
        return cells[i] ? { species: ids[cells[i] - 1], age: ages[i] } : null;
      }
    });
  }

  Object.assign(P.growth, { dispersal, succession });
})(KIT);
