/* Integer local toppling with synchronous avalanche waves and explicit sinks. */
const SandpileCellular = (() => {
  const { hash } = KIT.procedural.data;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const sequence = value => Array.isArray(value) || ArrayBuffer.isView(value) && Number.isSafeInteger(value.length);
  const check = (ok, message) => { if (!ok) throw new RangeError('Sandpile: ' + message); };
  const maxCells = 65536, maxGrains = 0xffffffff, maxTick = Number.MAX_SAFE_INTEGER;
  const format = 'ink-studio/cellular-sandpile';
  const square = [[1, 0, 0], [0, -1, 0], [-1, 0, 0], [0, 1, 0]];
  const stencils = { square, hex: [...square, [1, -1, 0], [-1, 1, 0]], voxel: [...square, [0, 0, 1], [0, 0, -1]] };
  const wrap = (value, size) => (value % size + size) % size;

  function create({ width, height, depth = 1, lattice = depth > 1 ? 'voxel' : 'square',
    boundary = 'open', initial = 0, mask, maxWork = 32000000 } = {}) {
    check([width, height, depth].every(n => integer(n, 1, 1024)) && width * height * depth <= maxCells &&
      Object.hasOwn(stencils, lattice) && (lattice === 'voxel' || depth === 1) && ['open', 'wrap'].includes(boundary) &&
      (mask === undefined || typeof mask === 'function') && integer(maxWork, 1, 85000000),
    'expected a bounded square, hex or voxel lattice with open or wrapped edges');
    const plane = width * height, size = plane * depth, offsets = stencils[lattice], threshold = offsets.length;
    const at = (x, y, z) => integer(x, 0, width - 1) && integer(y, 0, height - 1) && integer(z, 0, depth - 1);
    const index = (x, y, z) => z * plane + y * width + x;
    const coord = i => [i % width, Math.floor(i / width) % height, Math.floor(i / plane)];
    const allowed = new Uint8Array(size), links = new Int32Array(size * threshold).fill(-1), original = new Uint32Array(size);
    const context = i => { const [x, y, z] = coord(i); return { x, y, z }; };
    check(integer(initial, 0, maxGrains) || typeof initial === 'function' || sequence(initial) && initial.length === size,
      'initial grains must be an integer, sampler or packed array');
    let initialMass = 0;
    for (let i = 0; i < size; i++) {
      const point = context(i);
      allowed[i] = Number(!mask || Boolean(mask(point)));
      const amount = typeof initial === 'function' ? initial(point) : sequence(initial) ? initial[i] : initial;
      check(integer(amount, 0, maxGrains), 'grain counts must be nonnegative integers');
      if (!allowed[i]) continue;
      initialMass += amount;
      check(initialMass <= maxGrains, 'initial field exceeds its grain budget');
      original[i] = amount;
    }
    for (let i = 0; i < size; i++) {
      if (!allowed[i]) continue;
      const [x, y, z] = coord(i);
      offsets.forEach(([a, b, c], j) => {
        let u = x + a, v = y + b, w = z + c;
        if (boundary === 'wrap') { u = wrap(u, width); v = wrap(v, height); w = wrap(w, depth); }
        if (!at(u, v, w)) return;
        const target = index(u, v, w);
        if (allowed[target]) links[i * threshold + j] = target;
      });
    }
    const signature = hash(JSON.stringify([width, height, depth, lattice, boundary, Array.from(allowed)]));
    const unstable = grains => {
      const cells = [];
      for (let i = 0; i < size; i++) if (grains[i] >= threshold) cells.push(i);
      return cells;
    };
    const fresh = () => ({ grains: original, topplings: new Float64Array(size), lastToppled: new Float64Array(size),
      frontier: unstable(original), tick: 0, initial: initialMass, mass: initialMass, added: 0, lost: 0, totalTopplings: 0 });
    let state = fresh(), revision = 0, savedFrame;
    function commit(next) { state = next; revision++; savedFrame = undefined; }
    function cell(x, y, z) {
      check(at(x, y, z), 'cell coordinates are outside the lattice');
      return index(x, y, z);
    }

    function add(drops) {
      check(Array.isArray(drops) && drops.length <= maxCells, 'expected a bounded list of grain drops');
      if (!drops.length) return 0;
      const grains = state.grains.slice();
      let placed = 0, drained = 0;
      for (const drop of drops) {
        const { x, y, z = 0, grains: amount } = drop ?? {};
        const i = cell(x, y, z);
        check(integer(amount, 1, maxGrains), 'a drop needs a positive integer grain count');
        if (allowed[i]) {
          placed += amount;
          check(placed + state.mass <= maxGrains, 'drop exceeds the grain budget');
          grains[i] += amount;
        } else drained += amount;
        check(Number.isSafeInteger(state.initial + state.added + placed + drained), 'drop exceeds the ledger range');
      }
      commit({ ...state, grains, frontier: unstable(grains), mass: state.mass + placed,
        added: state.added + placed + drained, lost: state.lost + drained });
      return placed;
    }

    function step(waves = 1) {
      check(integer(waves, 1, 20000), 'expected between 1 and 20,000 waves');
      let { frontier, tick } = state, count = 0, topples = 0, lost = 0, work = 0;
      if (!frontier.length) return { status: 'stable', stable: true, waves: 0, topplings: 0, lost: 0, tick };
      const grains = state.grains.slice(), topplings = state.topplings.slice(), lastToppled = state.lastToppled.slice();
      const marked = new Uint8Array(size);
      const changed = [];
      function touch(i) {
        if (marked[i]) return;
        marked[i] = 1;
        changed.push(i);
      }
      let status = 'limit';
      while (frontier.length && count < waves) {
        const cost = frontier.length * (threshold + 1);
        if (work + cost > maxWork) { status = 'budget'; break; }
        check(tick < maxTick && Number.isSafeInteger(state.totalTopplings + topples + frontier.length),
          'avalanche exceeds the tick or toppling range');
        tick++; count++; work += cost; topples += frontier.length;
        changed.length = 0;
        for (const i of frontier) {
          grains[i] -= threshold;
          topplings[i]++;
          lastToppled[i] = tick;
          touch(i);
          const start = i * threshold;
          for (let j = start; j < start + threshold; j++) {
            const target = links[j];
            if (target < 0) { lost++; continue; }
            grains[target]++;
            touch(target);
          }
        }
        frontier = changed.filter(i => {
          marked[i] = 0;
          return grains[i] >= threshold;
        });
      }
      if (!frontier.length) status = 'stable';
      if (count) commit({ ...state, grains, topplings, lastToppled, frontier, tick,
        mass: state.mass - lost, lost: state.lost + lost, totalTopplings: state.totalTopplings + topples });
      return { status, stable: status === 'stable', waves: count, topplings: topples, lost, tick };
    }

    function frame() {
      if (savedFrame) return savedFrame;
      const captured = state;
      savedFrame = Object.freeze({ width, height, depth, lattice, threshold, tick: captured.tick,
        stable: !captured.frontier.length, unstable: captured.frontier.length, totalTopplings: captured.totalTopplings,
        mass: Object.freeze({ initial: captured.initial, added: captured.added, lost: captured.lost, retained: captured.mass }),
        data(name = 'grains') { return ['grains', 'topplings', 'lastToppled'].includes(name) ? captured[name].slice() : undefined; },
        get(x, y, z = 0) { return captured.grains[cell(x, y, z)]; },
        active(x, y, z = 0) { return Boolean(allowed[cell(x, y, z)]); }
      });
      return savedFrame;
    }

    function checkpoint() {
      const { tick, initial, added, lost, grains, topplings, lastToppled } = state;
      return { format, version: 1, signature, tick, initial, added, lost,
        grains: Array.from(grains), topplings: Array.from(topplings), lastToppled: Array.from(lastToppled) };
    }
    function restore(saved) {
      check(saved?.format === format && saved.version === 1 && saved.signature === signature &&
        integer(saved.tick, 0, maxTick) && integer(saved.initial, 0, maxGrains) &&
        integer(saved.added, 0, maxTick - saved.initial) && integer(saved.lost, 0, saved.initial + saved.added) &&
        ['grains', 'topplings', 'lastToppled'].every(name => sequence(saved[name]) && saved[name].length === size),
      'checkpoint is incompatible');
      let totalTopplings = 0, mass = 0;
      for (let i = 0; i < size; i++) {
        const grains = saved.grains[i], count = saved.topplings[i], last = saved.lastToppled[i];
        check(integer(grains, 0, maxGrains) && integer(count, 0, saved.tick) && integer(last, count, saved.tick) &&
          Boolean(count) === Boolean(last) && (allowed[i] || grains === 0 && count === 0), 'invalid checkpoint cell');
        totalTopplings += count; mass += grains;
      }
      check(Number.isSafeInteger(totalTopplings) && mass <= maxGrains && mass === saved.initial + saved.added - saved.lost,
        'invalid checkpoint mass or toppling ledger');
      const grains = Uint32Array.from(saved.grains);
      commit({ tick: saved.tick, initial: saved.initial, added: saved.added, lost: saved.lost, grains, mass, totalTopplings,
        topplings: Float64Array.from(saved.topplings), lastToppled: Float64Array.from(saved.lastToppled), frontier: unstable(grains) });
      return state.tick;
    }
    return Object.freeze({ width, height, depth, lattice, threshold, boundary, add, step, frame, checkpoint, restore,
      stabilize({ maxWaves = 10000 } = {}) { return step(maxWaves); },
      get tick() { return state.tick; }, get revision() { return revision; },
      position(x, y, z = 0) {
        cell(x, y, z);
        return lattice === 'hex' ? [x + .5 * y, Math.sqrt(3) / 2 * y, 0] : [x, y, z];
      },
      reset() { commit(fresh()); }
    });
  }
  return Object.freeze({ create });
})();
