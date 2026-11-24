/* Directional tensor street traces and seeded growth of connected road graphs. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-8,
    limit = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    positive = n => Number.isFinite(n) && n > EPS,
    vector = p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6),
    near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    dot = (a, b) => a[0] * b[0] + a[1] * b[1],
    cross = (a, b) => a[0] * b[1] - a[1] * b[0],
    sub = (a, b) => [a[0] - b[0], a[1] - b[1]],
    move = (p, direction, step) => [p[0] + direction[0] * step, p[1] + direction[1] * step],
    heading = a => [Math.cos(a), Math.sin(a)];

  function tensor(components, { fallback = 0 } = {}) {
    if (!Array.isArray(components) || !limit(components.length, 1, 256) || !Number.isFinite(fallback))
      throw new Error('Street tensors need one or more directional components');
    const fields = components.map(spec => {
      const { type = 'grid', origin = [0, 0], angle = 0, radius = Infinity, strength = 1, falloff = 2 } = spec ?? {};
      if (!['grid', 'radial', 'ring'].includes(type) || !vector(origin) || !Number.isFinite(angle) ||
        !(radius === Infinity || positive(radius)) || !positive(strength) || !positive(falloff))
        throw new Error('Invalid street tensor component');
      return { type, origin: origin.slice(), angle, radius, strength, falloff };
    });
    function sample(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Street tensor coordinates must be finite');
      let a = 0, b = 0;
      for (const field of fields) {
        const dx = x - field.origin[0], dz = z - field.origin[1],
          distance = Math.hypot(dx, dz), decay = Math.max(0, 1 - distance / field.radius);
        if (!decay || (distance <= EPS && field.type !== 'grid')) continue;
        let theta = field.angle;
        if (field.type !== 'grid') theta += Math.atan2(dz, dx) + (field.type === 'ring' ? Math.PI / 2 : 0);
        const weight = field.strength * decay ** field.falloff;
        a += weight * Math.cos(2 * theta);
        b += weight * Math.sin(2 * theta);
      }
      const strength = Math.hypot(a, b), angle = strength > EPS ? Math.atan2(b, a) / 2 : fallback,
        major = heading(angle);
      return { major, minor: [-major[1], major[0]], strength };
    }
    return Object.freeze({ sample });
  }

  function domain(bounds, height, mask) {
    if (!vector(bounds?.min) || !vector(bounds?.max) || bounds.min.some((v, i) => bounds.max[i] <= v) ||
      typeof height !== 'function' || (mask !== undefined && typeof mask !== 'function'))
      throw new Error('Street generation needs bounded XZ coordinates, a height sampler and an optional mask');
    const min = bounds.min.slice(), max = bounds.max.slice();
    function permitted(p) {
      return p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && (!mask || mask(...p));
    }
    function world(p) {
      const y = height(...p);
      if (!Number.isFinite(y)) throw new Error('Street height must be finite');
      return [p[0], y, p[1]];
    }
    return { permitted, world };
  }

  function followTensor(field, seeds, {
    bounds, height = () => 0, mask, step = 0.28, length = 12, maxSteps = 60000
  } = {}) {
    if (
      typeof field?.sample !== 'function' || !Array.isArray(seeds) || !limit(seeds.length, 1, 4096) ||
      !positive(step) || !positive(length) || !limit(maxSteps, 1, 300000)
    ) throw new Error('Tensor traces need a field, seeded points and bounded step settings');
    const { permitted, world } = domain(bounds, height, mask),
      found = [], used = new Set(), work = { steps: 0 };
    function vectorAt(p, family, prior) {
      const direction = field.sample(...p)?.[family];
      if (!vector(direction) || !positive(Math.hypot(...direction))) throw new Error('Street tensor directions must be finite nonzero vectors');
      const magnitude = Math.hypot(...direction),
        sense = prior && dot(direction, prior) < 0 ? -1 : 1;
      return direction.map(v => sense * v / magnitude);
    }
    function walk(start, family, direction) {
      let point = start, travelled = 0;
      const path = [], visited = new Set();
      while (travelled < length && path.length < 2047) {
        if (++work.steps > maxSteps) throw new Error('Tensor traces exceed their step budget');
        const distance = Math.min(step, length - travelled),
          first = vectorAt(point, family, direction),
          mid = move(point, first, distance / 2);
        if (!permitted(mid)) break;
        direction = vectorAt(mid, family, first);
        const next = move(point, direction, distance);
        if (!permitted(next)) break;
        const cell = next.map(v => Math.floor(v / (step * 0.4))).join(':');
        if (visited.has(cell)) break;
        visited.add(cell);
        path.push(next);
        point = next;
        travelled += distance;
      }
      return path;
    }
    for (const [index, seed] of seeds.entries()) {
      const start = Array.isArray(seed) ? seed : seed?.point,
        id = seed?.id ?? 'street-' + index,
        family = seed?.family ?? 'major';
      if (!vector(start) || typeof id !== 'string' || !id || used.has(id) || !['major', 'minor'].includes(family))
        throw new Error('Street seeds need unique IDs, XZ points, and a valid tensor family');
      used.add(id);
      if (!permitted(start)) continue;
      const direction = vectorAt(start, family),
        forward = walk(start, family, direction), back = walk(start, family, direction.map(v => -v));
      const points = back.reverse().concat([start], forward);
      if (points.length >= 2) found.push(Object.freeze({ id, family, route: P.routes.polyline(points.map(world)) }));
    }
    return Object.freeze({ streets: Object.freeze(found), work: Object.freeze(work) });
  }

  function growStreets(seeds, {
    bounds, height = () => 0, mask, field, cost, step = 0.45, maxSlope = 1,
    seed = 0, branchChance = 0.16, branchAngle = Math.PI / 2, snap = step * 0.55,
    maxAge = 30, maxSegments = 1600, maxChecks = 2500000
  } = {}) {
    if (
      !Array.isArray(seeds) || !limit(seeds.length, 1, 2048) ||
      !positive(step) || !Number.isFinite(snap) || snap < 0 || snap > step ||
      !(maxSlope >= 0) || !Number.isSafeInteger(seed) ||
      !Number.isFinite(branchAngle) || !Number.isFinite(branchChance) || branchChance < 0 || branchChance > 1 ||
      !limit(maxAge, 1, 4096) || !limit(maxSegments, 1, 16000) || !limit(maxChecks, 1, 30000000) ||
      (field !== undefined && typeof field?.sample !== 'function') ||
      (cost !== undefined && typeof cost !== 'function')
    ) throw new Error('Road agents need seeds, terrain controls and bounded work');
    const { permitted, world } = domain(bounds, height, mask),
      dice = K.grow.dice(P.data.hash('growing-streets', seed)),
      points = [], edges = [], agents = [],
      work = { checks: 0, agents: 0 },
      exhausted = Symbol('street agent budget');
    let serial = 0;
    function check() {
      if (++work.checks > maxChecks) throw exhausted;
    }
    function node(position) {
      const index = points.length;
      points.push({ plan: position.slice(), world: world(position) });
      return index;
    }
    for (const root of seeds) {
      const { point, angle } = root ?? {};
      if (!vector(point) || !Number.isFinite(angle) || !permitted(point)) throw new Error('Road agent seeds need a passable point and heading');
      let id = points.findIndex(existing => near(point, existing.plan) <= EPS);
      if (id < 0) id = node(point);
      agents.push({ node: id, angle, age: 0 });
    }
    function allowed(a, b) {
      const x = points[a], q = world(b), travel = near(x.plan, b);
      if (travel < Math.max(EPS * 16, step * 0.04) || Math.abs(q[1] - x.world[1]) > travel * maxSlope) return false;
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        if (!permitted(move(x.plan, sub(b, x.plan), t))) return false;
      }
      return true;
    }
    function closest(point, exclude) {
      let found = -1, gap = Math.max(EPS * 16, snap);
      for (const [i, q] of points.entries()) {
        check();
        if (exclude === i) continue;
        const d = near(point, q.plan);
        if (d >= gap) continue;
        gap = d;
        found = i;
      }
      return found;
    }
    function crossing(from, into) {
      const p = points[from].plan,
        d = sub(into, p);
      let hit = null, earliest = 1 + EPS;
      for (const edge of edges) {
        check();
        if (edge.a === from || edge.b === from) continue;
        const a = points[edge.a].plan, b = points[edge.b].plan,
          e = sub(b, a), side = sub(a, p), determinant = cross(d, e);
        if (Math.abs(determinant) <= EPS) {
          if (Math.abs(cross(side, d)) > EPS) continue;
          const distance2 = dot(d, d);
          for (const endpoint of [a, b]) {
            const t = dot(sub(endpoint, p), d) / distance2;
            if (t <= EPS || t >= earliest) continue;
            earliest = t;
            hit = { edge, point: endpoint };
          }
          continue;
        }
        const t = cross(side, e) / determinant, u = cross(side, d) / determinant;
        if (t <= EPS || t >= earliest || u < -EPS || u > 1 + EPS) continue;
        earliest = t;
        hit = { edge, point: move(p, d, Math.min(1, t)) };
      }
      return hit;
    }
    function duplicate(a, b) {
      return edges.some(e => (e.a === a && e.b === b) || (e.b === a && e.a === b));
    }
    let status = 'ok';
    try {
      for (let i = 0; i < agents.length; i++) {
        if (edges.length >= maxSegments) {
          status = 'limit';
          break;
        }
        work.agents++;
        const actor = agents[i], p = points[actor.node].plan;
        if (actor.age >= maxAge) continue;
        let proposal = null, best = Infinity;
        const reference = heading(actor.angle), local = field?.sample(...p),
          bias = local?.major;
        for (const amount of [0, 0.32, -0.32, 0.63, -0.63, 0.98, -0.98]) {
          check();
          const angle = actor.angle + amount,
            direction = heading(angle), target = move(p, direction, step),
            clipped = crossing(actor.node, target),
            to = clipped?.point ?? target;
          if (!allowed(actor.node, to)) continue;
          const value = cost ? cost(...to) : 0;
          if (value === Infinity) continue;
          if (!Number.isFinite(value) || value < 0) throw new Error('Road growth cost must be nonnegative or infinity');
          const score = value + (1 - dot(direction, reference)) * 0.35 +
            (bias ? (1 - Math.abs(dot(direction, bias))) * 0.24 : 0) + dice() * 0.04;
          if (score >= best) continue;
          best = score;
          proposal = { angle, target: to, clipped };
        }
        if (!proposal) continue;
        const { angle, target, clipped } = proposal,
          a = actor.node;
        let b, joined = false;
        if (clipped) {
          const { edge } = clipped;
          if (near(target, points[edge.a].plan) <= EPS * 16) b = edge.a;
          else if (near(target, points[edge.b].plan) <= EPS * 16) b = edge.b;
          else {
            if (edges.length + 2 > maxSegments) {
              status = 'limit';
              break;
            }
            b = node(target);
            const old = edge.b;
            edge.b = b;
            edges.push({ id: 'road-' + serial++, a: b, b: old });
          }
          joined = true;
        } else {
          b = closest(target, a);
          if (b >= 0 && (!allowed(a, points[b].plan) || crossing(a, points[b].plan))) b = -1;
          if (b < 0) b = node(target);
          else joined = true;
        }
        if (duplicate(a, b)) continue;
        edges.push({ id: 'road-' + serial++, a, b });
        if (joined) continue;
        agents.push({ node: b, angle, age: actor.age + 1 });
        if (dice() < branchChance && actor.age > 0) {
          agents.push({ node: b, angle: angle + (dice() < 0.5 ? -branchAngle : branchAngle), age: Math.floor(actor.age * 0.5) });
        }
      }
    } catch (error) {
      if (error !== exhausted) throw error;
      status = 'budget';
    }
    return Object.freeze({
      status,
      points: P.data.freeze(points.map(p => p.world)),
      edges: Object.freeze(edges.map(e => Object.freeze({ ...e, route: P.routes.polyline([points[e.a].world, points[e.b].world]) }))),
      work: Object.freeze(work)
    });
  }

  Object.assign(P.routes, { tensor, followTensor, growStreets });
})(KIT);
