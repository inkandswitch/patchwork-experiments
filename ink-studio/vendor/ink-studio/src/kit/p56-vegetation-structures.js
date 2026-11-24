/* Native vein networks, pipe-model taper, and obstacle-aware roots. */
(function (K) {
  const P = K.procedural,
    V = K.V,
    EPS = 1e-8,
    finite = n => Number.isFinite(n) && Math.abs(n) <= 1e6,
    point = (p, n) => Array.isArray(p) && p.length === n && p.every(finite),
    positive = n => finite(n) && n > EPS,
    integer = (n, a, b) => Number.isSafeInteger(n) && n >= a && n <= b;

  function pipe(nodes, { tipRadius = 0.025, exponent = 2.3 } = {}) {
    if (
      !Array.isArray(nodes) || !integer(nodes.length, 1, 200000) || !positive(tipRadius) ||
      !Number.isFinite(exponent) || exponent < 0.75 || exponent > 12
    ) throw new Error('Pipe taper needs a bounded parent forest and a positive tip radius and exponent');
    const forest = nodes.map((node, i) => {
      if (!integer(node?.parent, -1, i - 1)) throw new Error('Pipe taper parents must precede their children');
      return { parent: node.parent, kids: 0 };
    });
    for (const n of forest) if (n.parent >= 0) forest[n.parent].kids++;
    return Object.freeze(Array.from(K.form.pipeRadii(forest, tipRadius, exponent)));
  }

  function venation(outline, {
    root, toward, step = 0.12, influence = 0.9, kill = 0.11, sourceSpacing = 0.22,
    trunk = 0, tipRadius = 0.012, exponent = 2, seed = 0, iterations = 54, maxSources = 220, maxNodes = 1600, maxChecks = 12000000
  } = {}) {
    if (
      !Array.isArray(outline) || !integer(outline.length, 3, 2000) || !outline.every(p => point(p, 2)) ||
      !point(root, 2) || !point(toward, 2) || Math.hypot(toward[0] - root[0], toward[1] - root[1]) <= EPS ||
      ![step, influence, kill, sourceSpacing, tipRadius].every(positive) || !finite(trunk) || trunk < 0 ||
      !Number.isFinite(exponent) || exponent < 0.75 || exponent > 12 ||
      !Number.isSafeInteger(seed) || !integer(iterations, 1, 160) ||
      !integer(maxSources, 1, 2000) || !integer(maxNodes, 2, 10000) || !integer(maxChecks, 1, 50000000)
    ) throw new Error('Venation needs an outline, root, vein direction and growth limits');
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    for (const p of outline) for (let i = 0; i < 2; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
    function inside(x, y) {
      let odd = false;
      for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const a = outline[i], b = outline[j],
          dx = b[0] - a[0], dy = b[1] - a[1];
        if (
          Math.abs((x - a[0]) * dy - (y - a[1]) * dx) <= EPS * Math.hypot(dx, dy) &&
          x >= Math.min(a[0], b[0]) - EPS && x <= Math.max(a[0], b[0]) + EPS &&
          y >= Math.min(a[1], b[1]) - EPS && y <= Math.max(a[1], b[1]) + EPS
        ) return true;
        if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * dx / dy) odd = !odd;
      }
      return odd;
    }
    if (!inside(...root)) throw new Error('Venation root lies outside the outline');
    const cloud = P.sampling.poisson({
      bounds: { min, max }, radius: sourceSpacing, mask: p => inside(...p), seed, maxPoints: maxSources,
      maxTrials: 80000, maxChecks: 600000
    });
    const { nodes, limbs, tips } = K.form.colonize({
      at: [root[0], root[1], 0], up: [toward[0] - root[0], toward[1] - root[1], 0],
      attractors: cloud.samples.map(({ point }) => [point[0], point[1], 0]), growthMask: inside,
      trunk, step, influence, kill, iterations, maxNodes, maxChecks, seed, r: tipRadius, pipe: exponent
    });
    return P.data.freeze({ nodes, limbs, tips, sources: cloud.samples.map(s => s.point.slice()) });
  }

  function roots(starts, {
    moisture, obstacle, allowed, gravity = [0, -1, 0], step = 0.15,
    length = 2.5, clearance = 0.06, waterBias = 1.3, gravityBias = 0.65, inertia = 0.7,
    jitter = 0.16, branchChance = 0.09, seed = 0, maxNodes = 6000, maxSteps = 60000,
    tipRadius = 0.014, exponent = 2.4
  } = {}) {
    if (
      !Array.isArray(starts) || !integer(starts.length, 1, 512) || !starts.every(p => point(p, 3)) ||
      !point(gravity, 3) || !positive(V.len(gravity)) || ![step, length].every(positive) ||
      ![clearance, waterBias, gravityBias, inertia, jitter].every(v => finite(v) && v >= 0) ||
      !Number.isFinite(branchChance) || branchChance < 0 || branchChance > 1 || !Number.isSafeInteger(seed) ||
      !integer(maxNodes, starts.length, 20000) || !integer(maxSteps, 1, 200000) ||
      [moisture, obstacle, allowed].some(fn => fn !== undefined && typeof fn !== 'function')
    ) throw new Error('Root growth needs finite starts, field controls and bounded growth');
    const down = V.norm(gravity),
      dice = K.grow.dice(P.data.hash('root-growth', seed)),
      work = { steps: 0 },
      nodes = [], queue = [],
      maximum = Math.ceil(length / step);
    function valid(p) {
      if (!point(p, 3)) return false;
      if (allowed && !allowed(...p)) return false;
      if (!obstacle) return true;
      return obstacle(...p) >= clearance;
    }
    function gradient(fn, p) {
      if (!fn) return [0, 0, 0];
      const d = step * 0.2,
        g = p.map((_, axis) => {
          const left = p.slice(), right = p.slice();
          left[axis] -= d;
          right[axis] += d;
          const dv = fn(...right) - fn(...left);
          return Number.isFinite(dv) ? dv / (2 * d) : 0;
        });
      const length = V.len(g);
      return length > EPS && Number.isFinite(length) ? V.mul(g, 1 / length) : [0, 0, 0];
    }
    for (const p of starts) {
      if (!valid(p)) throw new Error('A root start lies outside the growth domain');
      queue.push({ node: nodes.length, direction: down, age: 0, branch: false });
      nodes.push({ p: p.slice(), parent: -1 });
    }
    let status = 'ok';
    for (let index = 0; index < queue.length; index++) {
      const tip = queue[index];
      if (tip.age >= maximum) continue;
      if (nodes.length >= maxNodes || work.steps >= maxSteps) {
        status = 'budget';
        break;
      }
      work.steps++;
      const p = nodes[tip.node].p,
        wet = gradient(moisture, p),
        near = obstacle && obstacle(...p) < clearance + step * 1.7,
        outward = near ? gradient(obstacle, p) : [0, 0, 0],
        intent = V.add(V.add(V.mul(tip.direction, tip.branch ? Math.max(1, inertia * 3) : inertia),
          V.mul(down, gravityBias)), V.mul(wet, waterBias)),
        perturb = [dice() - 0.5, dice() - 0.5, dice() - 0.5],
        direct = V.norm(V.add(V.mad(intent, perturb, jitter), V.mul(outward, near ? 0.4 : 0))),
        side = V.norm(V.cross(direct, Math.abs(direct[1]) < 0.94 ? [0, 1, 0] : [1, 0, 0])),
        crosswise = V.cross(direct, side);
      const alternatives = [direct, V.mad(direct, outward, 1.6), ...[side, crosswise].flatMap(v => [
        V.mad(direct, v, 0.9), V.mad(direct, v, -0.9)
      ])];
      let next = null, aimed = null, best = -Infinity;
      for (const alternative of alternatives) {
        const direction = V.norm(alternative);
        if (V.len(direction) <= EPS) continue;
        const q = V.mad(p, direction, step);
        if (![0.25, 0.5, 0.75, 1].every(t => valid(V.mad(p, direction, step * t)))) continue;
        const suitability = moisture ? moisture(...q) : 0;
        if (!finite(suitability)) throw new Error('Root moisture must be finite in the growth domain');
        const score = V.dot(direction, direct) + suitability * waterBias;
        if (score <= best) continue;
        best = score;
        next = q;
        aimed = direction;
      }
      if (!next) continue;
      const node = nodes.length;
      nodes.push({ p: next, parent: tip.node });
      queue.push({ node, direction: aimed, age: tip.age + 1, branch: false });
      if (!tip.branch && dice() < branchChance) {
        const direction = V.norm(V.mad(aimed, side, dice() < 0.5 ? -1.65 : 1.65));
        queue.push({ node, direction, age: tip.age + 1, branch: true });
      }
    }
    const radii = pipe(nodes, { tipRadius, exponent }),
      limbs = nodes.flatMap((n, i) => n.parent < 0 ? [] : [{
        pts: [nodes[n.parent].p, n.p], r0: radii[n.parent], r1: radii[i], depth: 0
      }]);
    return P.data.freeze({ status, nodes, radii, limbs, work });
  }

  Object.assign(P.growth, { pipe, venation, roots });
})(KIT);
