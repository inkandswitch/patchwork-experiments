/* Stable world-space candidates. Density reveals additional ranked slots rather
   than rerolling existing instances. A consumer supplies habitat/ownership data;
   this service knows nothing about vegetation, painting, terrain or rendering. */
(function (K) {
  const A = K.procedural;
  function parameters(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Populations need configuration');
    const p = Object.assign(
      { spacing: 0.42, jitter: 0.9, slots: 4, seed: 0, maxCandidates: 160000, maxInstances: 16000 },
      A.data.clone(raw)
    );
    if (
      !Number.isFinite(p.spacing) ||
      p.spacing < 0.1 ||
      p.spacing > 8 ||
      !Number.isFinite(p.jitter) ||
      p.jitter < 0 ||
      p.jitter > 1 ||
      !Number.isSafeInteger(p.slots) ||
      p.slots < 1 ||
      p.slots > 8 ||
      !Number.isSafeInteger(p.seed) ||
      Math.abs(p.seed) > 4294967295 ||
      !Number.isSafeInteger(p.maxCandidates) ||
      p.maxCandidates < 1 ||
      p.maxCandidates > 500000 ||
      !Number.isSafeInteger(p.maxInstances) ||
      p.maxInstances < 1 ||
      p.maxInstances > 50000
    )
      throw new Error('Invalid population spacing, slots, seed or budgets');
    if (p.exclusion !== undefined) {
      const { distance, maxDistance = distance, species = {}, maxComparisons = 3000000 } = p.exclusion ?? {};
      const separation = n => Number.isFinite(n) && n >= 0 && n <= maxDistance;
      const table = o => o && typeof o === 'object' && !Array.isArray(o);
      if (
        !table(p.exclusion) || !separation(distance) || !Number.isFinite(maxDistance) || maxDistance > 64 * p.spacing ||
        !table(species) || Object.values(species).some(row => !table(row) || Object.values(row).some(n => !separation(n))) ||
        !Number.isSafeInteger(maxComparisons) || maxComparisons < 1 || maxComparisons > 30000000
      ) throw new Error('Invalid population exclusion distances or comparison budget');
      p.exclusion = { distance, maxDistance, species, maxComparisons };
    }
    return A.data.freeze(p);
  }
  function bounds(b) {
    if (
      !b ||
      ![b.min, b.max].every(q => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite)) ||
      b.min.some((v, i) => v > b.max[i]) ||
      [b.min[0], b.min[2], b.max[0], b.max[2]].some(v => Math.abs(v) > 1e6)
    )
      throw new Error('Populations need finite ordered bounds within the coordinate budget');
    return b;
  }
  function candidateAt(x, z, slot, p) {
    const seed = p.seed + slot * 1291,
      point = [
        (x + 0.5 + (K.hash(x, z, seed + 17) - 0.5) * p.jitter) * p.spacing,
        (z + 0.5 + (K.hash(x, z, seed + 59) - 0.5) * p.jitter) * p.spacing
      ];
    return A.data.freeze({
      key: x + ':' + z + ':' + slot,
      index: [x, z], slot, point,
      rank: (slot + K.hash(x, z, seed + 103)) / p.slots,
      seed: Math.floor(K.hash(x, z, seed + 137) * 2147483647),
      yaw: K.hash(x, z, seed + 173) * Math.PI * 2,
      scale: 0.8 + 0.4 * K.hash(x, z, seed + 211)
    });
  }

  function sampleAt(candidate, evaluate) {
    const sample = evaluate(...candidate.point, candidate);
    if (sample == null) return null;
    if (
      typeof sample !== 'object' || Array.isArray(sample) ||
      !Number.isFinite(sample.density) || sample.density < 0 || sample.density > 1
    ) throw new Error('Population samples need a density from zero to one');
    return candidate.rank < sample.density ? sample : null;
  }

  function spacingFilter(p, evaluate) {
    const { distance, maxDistance, species, maxComparisons } = p.exclusion,
      radius = maxDistance ? Math.floor(maxDistance / p.spacing) + 1 : 0,
      states = new Map(),
      cellKey = (x, z) => x + ':' + z;
    let comparisons = 0;
    function compare() {
      if (++comparisons > maxComparisons) throw new Error('Population exclusion exceeds its comparison budget');
    }
    function at(x, z) {
      const key = cellKey(x, z);
      if (states.has(key)) return states.get(key);
      if ((states.size + 1) * p.slots > p.maxCandidates) throw new Error('Population exclusion halo exceeds its candidate budget');
      const all = [],
        eligible = [];
      for (let slot = 0; slot < p.slots; slot++) {
        const candidate = candidateAt(x, z, slot, p),
          sample = sampleAt(candidate, evaluate);
        all.push(candidate);
        if (!sample) continue;
        const minimum = sample.minDistance ?? distance,
          kind = sample.species ?? '';
        if (!Number.isFinite(minimum) || minimum < 0 || minimum > maxDistance || typeof kind !== 'string')
          throw new Error('Population sample has an invalid exclusion distance or species');
        eligible.push({ candidate, sample: A.data.clone(sample), minimum, kind });
      }
      const cell = { all, eligible };
      states.set(key, cell);
      return cell;
    }
    function precedes(a, b) {
      if (a.rank !== b.rank) return a.rank < b.rank;
      if (a.index[1] !== b.index[1]) return a.index[1] < b.index[1];
      if (a.index[0] !== b.index[0]) return a.index[0] < b.index[0];
      return a.slot < b.slot;
    }
    function speciesDistance(a, b) {
      return Object.hasOwn(species, a) && Object.hasOwn(species[a], b) ? species[a][b] : 0;
    }
    function accept(current) {
      if (!radius) return true;
      const { candidate, minimum, kind } = current,
        [x, z] = candidate.index,
        [px, pz] = candidate.point;
      // A higher-priority eligible slot blocks the current slot even if it was itself blocked.
      // That local rule avoids chains of decisions crossing work-region boundaries.
      for (let v = z - radius; v <= z + radius; v++) {
        for (let u = x - radius; u <= x + radius; u++) {
          compare();
          for (const neighbor of at(u, v).eligible) {
            compare();
            if (!precedes(neighbor.candidate, candidate)) continue;
            const required = Math.max(minimum, neighbor.minimum, speciesDistance(kind, neighbor.kind), speciesDistance(neighbor.kind, kind)),
              [qx, qz] = neighbor.candidate.point;
            if ((qx - px) ** 2 + (qz - pz) ** 2 < required ** 2) return false;
          }
        }
      }
      return true;
    }
    return { at, accept, work: () => ({ evaluated: states.size * p.slots, comparisons }) };
  }

  function layout(regions, evaluate, raw = {}, include) {
    const p = parameters(raw);
    if (!Array.isArray(regions) || regions.length > 4096 || typeof evaluate !== 'function' ||
        (include !== undefined && typeof include !== 'function'))
      throw new Error('Populations need bounded work regions and an evaluator');
    const cells = new Map(),
      instances = [],
      filter = p.exclusion ? spacingFilter(p, evaluate) : null;
    let candidates = 0;
    for (const region of regions) {
      const b = bounds(region),
        x0 = Math.floor(b.min[0] / p.spacing),
        x1 = Math.floor(b.max[0] / p.spacing),
        z0 = Math.floor(b.min[2] / p.spacing),
        z1 = Math.floor(b.max[2] / p.spacing);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) * p.slots > p.maxCandidates)
        throw new Error('Population region exceeds its candidate budget');
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          cells.set(x + ':' + z, [x, z]);
          if (cells.size * p.slots > p.maxCandidates) throw new Error('Population exceeds its candidate budget');
        }
    }
    function inRegion([x, z]) {
      return regions.some(b => x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]);
    }
    function emit(candidate, sample) {
      // Scope the output without changing which neighbors participate in spacing.
      if (include && !include(sample)) return;
      if (instances.length >= p.maxInstances) throw new Error('Population exceeds its instance budget');
      instances.push(A.data.freeze({ ...candidate, sample }));
    }
    for (const [x, z] of [...cells.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
      if (filter) {
        const { all, eligible } = filter.at(x, z);
        for (const candidate of all) if (inRegion(candidate.point)) candidates++;
        for (const entry of eligible) {
          if (inRegion(entry.candidate.point) && filter.accept(entry)) emit(entry.candidate, entry.sample);
        }
        continue;
      }
      for (let slot = 0; slot < p.slots; slot++) {
        const candidate = candidateAt(x, z, slot, p);
        if (!inRegion(candidate.point)) continue;
        candidates++;
        const sample = sampleAt(candidate, evaluate);
        if (sample) emit(candidate, A.data.clone(sample));
      }
    }
    return A.data.freeze({ parameters: p, instances, sampling: { cells: cells.size, candidates, ...filter?.work() } });
  }
  function mix(entries, {seed = 0, patchSize = 0, coherence = 0} = {}) {
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 32 ||
        !Number.isSafeInteger(seed) || !Number.isFinite(patchSize) || patchSize < 0 || patchSize > 1e6 ||
        !Number.isFinite(coherence) || coherence < 0 || coherence > 1 || (coherence && patchSize < .01))
      throw new Error('Population mix needs bounded options, patch size and coherence');
    const keys = new Set(), choices = [];
    for (const entry of entries) {
      const {key, weight} = entry ?? {};
      if (typeof key !== 'string' || !key || keys.has(key) || !Number.isFinite(weight) || weight < 0)
        throw new Error('Population mix needs unique keys and nonnegative weights');
      keys.add(key);
      if (weight) choices.push({key, weight, salt: A.data.hash(key,seed)});
    }
    if (!choices.length) throw new Error('Population mix needs a positive weight');
    const largest = Math.max(...choices.map(choice => choice.weight));
    function patch(x,z) {
      x /= patchSize;
      z /= patchSize;
      const ix = Math.floor(x), iz = Math.floor(z);
      let nearest = Infinity, salt = 0;
      for (let j = iz-1; j <= iz+1; j++) for (let i = ix-1; i <= ix+1; i++) {
        const a = i+.5+(K.hash(i,j,seed+271)-.5)*.6;
        const b = j+.5+(K.hash(i,j,seed+421)-.5)*.6;
        const distance = (a-x)**2+(b-z)**2;
        if (distance >= nearest) continue;
        nearest = distance;
        salt = A.data.hash(i+':'+j,seed);
      }
      return salt;
    }
    return (point, individual) => {
      if (!Array.isArray(point) || point.length !== 2 ||
          !point.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6) ||
          !Number.isSafeInteger(individual))
        throw new Error('Population mix samples need bounded XZ and an integer seed');
      const identity = coherence && K.hash(individual,seed,683) < coherence ? patch(...point) : individual;
      let winner = choices[0].key, best = Infinity;
      for (const {key, weight, salt} of choices) {
        const u = Math.max(1e-12,1-K.hash(identity,salt,827));
        const score = -Math.log(u)/(weight/largest);
        if (score < best || (score === best && key < winner)) {
          best = score;
          winner = key;
        }
      }
      return winner;
    };
  }
  A.populations = { parameters, layout, mix };
})(KIT);
