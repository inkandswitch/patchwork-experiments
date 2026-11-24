/* Bounded stress-guided crack fronts on an artist-supplied material grid. */
(function (K) {
  const P = K.procedural, CARDINAL = Math.PI * 0.25,
    integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    bounded = (n, min, max) => Number.isFinite(n) && n >= min && n <= max,
    norm = ([x, z]) => {
      const n = Math.hypot(x, z);
      if (!Number.isFinite(n) || n < 1e-8) throw new Error('Crack directions must be finite and nonzero');
      return [x / n, z / n];
    },
    vector = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
    steps = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]].map(([x,z], i) => ({
      x, z, i, length: Math.hypot(x, z), direction: norm([x,z])
    }));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

  function crack({
    width, height, starts, stress, toughness = 0.16, mask,
    gain = 0.3, retention = 0.9, alignment = 0.25, steer = 0.65, roughness = 0.12,
    branching = 0.16, branchThreshold = 0.58, branchEnergy = 0.64, maxBranches = 18,
    seed = 0, maxNodes = 3000, maxChecks = 70000
  } = {}) {
    if (
      !integer(width, 2, 1024) || !integer(height, 2, 1024) || width * height > 500000 ||
      !Array.isArray(starts) || !integer(starts.length, 1, 128) || typeof stress !== 'function' ||
      (typeof toughness !== 'function' && !bounded(toughness, 0, 5)) ||
      (mask !== undefined && typeof mask !== 'function') || !bounded(gain, 0, 5) ||
      ![retention, alignment, steer, roughness, branching, branchThreshold, branchEnergy].every(n => bounded(n, 0, 1)) ||
      !integer(maxBranches, 0, 256) || !Number.isSafeInteger(seed) ||
      !integer(maxNodes, starts.length, 30000) || !integer(maxChecks, 1, 3000000)
    ) throw new Error('Crack propagation needs a bounded grid, stress and front controls');
    const nodes = [], edges = [], chains = [], fronts = [], fields = new Map(),
      cells = new Uint32Array(width * height), diagonals = new Int8Array(width * height),
      work = { checks: 0, branches: 0 },
      index = (x, z) => z * width + x,
      passable = (x, z) => integer(x, 0, width - 1) && integer(z, 0, height - 1) && (!mask || mask(x, z));
    const corner = (a, b) => index(Math.min(a.x, b.x), Math.min(a.z, b.z));
    const diagonal = (a, b) => (a.x - b.x) * (a.z - b.z);
    function field(x, z) {
      const i = index(x, z);
      if (fields.has(i)) return fields.get(i);
      const sample = stress(x, z), load = typeof sample === 'number' ? sample : sample?.load,
        direction = sample?.direction, resist = typeof toughness === 'function' ? toughness(x, z) : toughness;
      if (!bounded(load, 0, 5) || !bounded(resist, 0, 5) || (direction !== undefined && !vector(direction)))
        throw new Error('Crack fields need a finite stress load, toughness and optional direction');
      const result = { load, resist, direction: direction ? norm(direction) : null };
      fields.set(i, result);
      return result;
    }
    for (const start of starts) {
      const { at, angle = 0, energy = 1 } = start ?? {};
      if (!vector(at) || !passable(...at) || cells[index(...at)] ||
        !Number.isFinite(angle) || !bounded(energy, 0, 5) || energy === 0)
        throw new Error('Crack starts must be distinct passable seeds with positive energy');
      const [x, z] = at, node = nodes.length;
      nodes.push({ x, z, energy, parent: -1 });
      cells[index(x, z)] = node + 1;
      fronts.push({ node, path: chains.length, direction: [Math.cos(angle), Math.sin(angle)] });
      chains.push([node]);
    }
    let status = 'ok';
    function advance(front, candidate, branch = false) {
      const { x, z, energy, direction } = candidate, next = nodes.length;
      nodes.push({ x, z, energy: branch ? energy * branchEnergy : energy, parent: front.node });
      edges.push({ from: front.node, to: next, branch });
      cells[index(x, z)] = next + 1;
      const line = diagonal(nodes[front.node], candidate);
      if (line) diagonals[corner(nodes[front.node], candidate)] = line;
      let path = front.path;
      if (branch) {
        path = chains.length;
        chains.push([front.node]);
        work.branches++;
      }
      chains[path].push(next);
      fronts.push({ node: next, direction, path });
    }
    for (let k = 0; k < fronts.length; k++) {
      if (nodes.length >= maxNodes || work.checks + steps.length > maxChecks) {
        status = 'budget';
        break;
      }
      work.checks += steps.length;
      const front = fronts[k], current = nodes[front.node], choices = [];
      for (const step of steps) {
        const x = current.x + step.x, z = current.z + step.z,
          forward = dot(front.direction, step.direction);
        if (forward < -0.04 || !passable(x, z) || cells[index(x, z)]) continue;
        if (step.x && step.z && (!passable(current.x, z) || !passable(x, current.z))) continue;
        if (step.x && step.z && diagonals[corner(current, { x, z })] === -step.x * step.z) continue;
        const { load, resist, direction } = field(x, z), axis = direction ? Math.abs(dot(direction, step.direction)) : 1,
          energy = Math.min(5, current.energy * retention + (gain * load * (1 - steer + steer * axis) - resist) * step.length);
        if (energy <= 0) continue;
        const random = P.data.hash(current.x + '/' + current.z + '/' + step.i, seed) / 4294967296,
          score = energy + alignment * forward + roughness * (random - 0.5) + steer * load * axis * 0.2;
        choices.push({ x, z, energy, score, load, direction: step.direction, i: step.i });
      }
      choices.sort((a, b) => b.score - a.score || a.i - b.i);
      const main = choices[0];
      if (!main) continue;
      advance(front, main);
      const chance = P.data.hash('split/' + current.x + '/' + current.z, seed) / 4294967296;
      if (work.branches >= maxBranches || nodes.length >= maxNodes || chance >= branching || main.load < branchThreshold) continue;
      const split = choices.find(choice => dot(choice.direction, main.direction) <= Math.cos(CARDINAL) + 1e-8);
      if (split && split.energy * branchEnergy > 0.05) advance(front, split, true);
    }
    return Object.freeze({ status, width, height, cells, nodes: P.data.freeze(nodes), edges: P.data.freeze(edges),
      chains: P.data.freeze(chains), work: Object.freeze(work) });
  }
  P.fracture.crack = crack;
})(KIT);
