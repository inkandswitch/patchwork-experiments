/* Deterministic branching walks on a caller-supplied connected surface. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  const vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const tangent = (p, n) => V.mad(p, n, -V.dot(p, n));
  const axisFor = n => Math.abs(n[1]) > .9 ? [0, 0, 1] : [0, 1, 0];
  function transport(heading, from, to) {
    const axis = V.cross(from, to), dot = V.dot(from, to), turn = V.cross(axis, heading);
    if (dot < -.999999) return tangent(heading, to);
    return V.add(V.add(heading, turn), V.mul(V.cross(axis, turn), 1 / (1 + dot)));
  }
  function frame(hit) {
    if (!hit || !vector(hit.point) || !vector(hit.normal) || V.len(hit.normal) < 1e-8)
      throw new Error('Growth projections need a finite point and normal');
    const { point, normal, ...metadata } = hit;
    for (const key of Object.keys(metadata))
      if (metadata[key] && typeof metadata[key] === 'object') metadata[key] = P.data.clone(metadata[key]);
    return { ...metadata, point: point.slice(), normal: V.norm(normal) };
  }

  function trace({ roots, project, connect = () => [], step = .19, steps = 22, branchEvery = 5,
    tips = 9, budget = 1600, bias = [0, 1, 0], attraction = .24, spread = .33, seed = 0 }) {
    if (!Array.isArray(roots) || roots.length > 64 || typeof project !== 'function' || typeof connect !== 'function' ||
        !Number.isFinite(step) || step <= 0 || !Number.isSafeInteger(steps) || steps < 1 || steps > 256 ||
        !Number.isSafeInteger(branchEvery) || branchEvery < 1 || !Number.isSafeInteger(tips) || tips < 1 || tips > 64 ||
        !Number.isSafeInteger(budget) || budget < 1 || budget > 16384 || !vector(bias) || !Number.isFinite(attraction) ||
        attraction < 0 || attraction > 1 || !Number.isFinite(spread) || spread < 0 || spread > Math.PI || !Number.isSafeInteger(seed)) {
      throw new Error('Surface growth needs bounded roots, step, tips and sampling settings');
    }
    const nodes = [], edges = [], ends = [], keys = new Set();
    const turn = (heading, n, angle) => V.add(V.mul(heading, Math.cos(angle)), V.mul(V.cross(n, heading), Math.sin(angle)));
    for (const root of roots) {
      if (!root || typeof root.key !== 'string' || !root.key || keys.has(root.key) || !vector(root.point) ||
          (root.direction !== undefined && !vector(root.direction))) throw new Error('Growth roots need unique keys and finite points');
      keys.add(root.key);
      const base = project(root.point, null, step, root);
      if (!base || nodes.length >= budget) continue;
      const first = { ...frame(base), key: root.key.length + ':' + root.key, root: root.key, depth: 0 };
      nodes.push(first);
      const wanted = tangent(root.direction || bias, first.normal);
      const heading = V.norm(V.len(wanted) > 1e-8 ? wanted : tangent(axisFor(first.normal), first.normal));
      const rootSeed = P.data.hash(root.key, seed);
      const pending = [{ key: first.key, at: first, heading, serial: 0, count: steps }];
      for (let i = 0; i < pending.length && nodes.length < budget; i++) {
        let { at, heading: direction, key, serial, count } = pending[i];
        for (let j = 0; j < count && nodes.length < budget; j++) {
          const n = at.normal, guide = tangent(bias, n), projected = tangent(direction, n);
          const aim = V.len(guide) < 1e-8 ? projected : V.add(V.mul(projected, 1 - attraction), V.mul(V.norm(guide), attraction));
          if (V.len(aim) < 1e-8) break;
          const yaw = (K.hash(rootSeed, serial * 271 + j, 13) - .5) * 2 * spread;
          let next, route, nextDirection;
          for (const alternate of [0, .55, -.55, 1.05, -1.05]) {
            const h = turn(V.norm(aim), n, yaw + alternate);
            const raw = project(V.mad(at.point, h, step), at, step, root);
            if (!raw) continue;
            const candidate = frame(raw), delta = V.sub(candidate.point, at.point);
            const travel = V.len(delta);
            const direction = transport(h, n, candidate.normal);
            if (travel < step * .32 || travel > step * 1.6 ||
                Math.max(V.dot(delta, h), V.dot(delta, direction)) < step * .12) continue;
            const via = connect(at, candidate, step);
            if (via === null) continue;
            if (!Array.isArray(via) || via.length > 8) throw new Error('Growth links need at most eight intermediate frames');
            next = candidate; route = via.map(frame); nextDirection = direction;
            break;
          }
          if (!next) break;
          const nextKey = key + '/' + j;
          const child = { ...next, key: nextKey, root: root.key, depth: at.depth + 1 };
          nodes.push(child);
          edges.push({ key: nextKey, from: at.key, to: child.key, frames: [at, ...route, child] });
          const transported = tangent(nextDirection, child.normal), delta = tangent(V.sub(child.point, at.point), child.normal);
          const across = V.cross(at.normal, child.normal);
          const around = V.len(across) > 1e-8 ? V.cross(V.norm(across), child.normal) : tangent(axisFor(child.normal), child.normal);
          direction = V.norm(V.len(transported) > .05 ? transported : V.len(delta) > .05 * step ? delta : around);
          at = child;
          if ((j + 1) % branchEvery === 0 && j + 3 < count && pending.length < tips) {
            const sign = K.hash(rootSeed, serial * 251 + j, 17) < .5 ? -1 : 1;
            pending.push({ key: nextKey + '/branch', at, heading: turn(direction, at.normal, sign * (1 + spread * .45)),
              serial: pending.length, count: Math.max(2, Math.floor((count - j - 1) * .58)) });
          }
        }
        ends.push(at.key);
      }
    }
    return P.data.freeze({ nodes, edges, ends });
  }

  P.surfaceGrowth = { trace, transport };
})(KIT);
