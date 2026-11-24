/* Fixed scene captures and bounded support turns for authored contacts. */
(function (K) {
  const { V, M, clamp, deform: D } = K;
  const xyz = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const direction = v => xyz(v) && Number.isFinite(V.len(v)) && V.len(v) > 1e-8;
  const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
  const freeze = value => K.procedural.data.freeze(value);

  function project(index, { origin, direction: ray = [0, -1, 0], distance, label } = {}) {
    if (typeof index?.raycast !== 'function' || !xyz(origin) || !direction(ray) ||
        !Number.isFinite(distance) || distance <= 0 || (label !== undefined && typeof label !== 'string'))
      throw new TypeError('A surface capture needs a mesh index, world ray, and positive distance');
    const axis = V.norm(ray), hit = index.raycast(origin.slice(), axis.slice(), distance);
    const surface = { kind: 'surface', origin: origin.slice(), direction: axis, distance, ...(label && { label }) };
    if (!hit) return freeze({ ...surface, hit: false });
    if (!xyz(hit.p) || !direction(hit.n) || !Number.isFinite(hit.distance) || hit.distance < 0 ||
        hit.distance > distance + 1e-5) throw new TypeError('Invalid scene surface intersection');
    const normal = V.norm(hit.n);
    return freeze({ ...surface, hit: true, point: hit.p.slice(), normal: V.dot(normal, axis) > 0 ? V.mul(normal, -1) : normal,
      hitDistance: hit.distance, ...(typeof hit.surface === 'string' && { surface: hit.surface }),
      ...(typeof hit.owner === 'string' && { owner: hit.owner }) });
  }

  function swing(from, to, limit = Math.PI) {
    const axis = V.cross(from, to), length = V.len(axis);
    const radians = Math.min(limit, Math.atan2(length, V.dot(from, to)));
    return { axis: V.norm(axis, V.perp(from)), radians };
  }
  const turn = ({ axis, radians }) => M.rot(axis, radians);
  function normalAt(puppet, id, point, local) {
    const p = puppet.parts[id], linear = p.D ? M.mul(p.A, D.jac(p.D, point)) : p.A;
    return V.norm(M.app(M.tr(M.inv(linear)), local));
  }

  function assist(puppet, request, target, weight, budget, locked) {
    const { upper, lower, part, point, assist: supports } = request;
    if (!supports.length) return [];
    const joint = id => puppet.point(id, puppet.parts[id].pivot);
    const shoulder = joint(upper), elbow = joint(lower);
    const length = V.dist(shoulder, elbow) + V.dist(elbow, puppet.point(part, point));
    const pressure = smooth((V.dist(shoulder, target) / Math.max(length, 1e-8) - 0.82) / 0.23) * weight;
    if (!pressure) return [];
    const turns = [];
    for (const support of supports) {
      if (locked(support.part)) continue;
      const origin = joint(support.part), a = V.sub(joint(upper), origin), b = V.sub(target, origin);
      if (V.len(a) < 1e-8 || V.len(b) < 1e-8) continue;
      const spent = budget.get(support.part) ?? 0;
      const limit = Math.min(support.limit * support.weight * pressure, support.limit - spent);
      if (limit <= 1e-7) continue;
      const delta = swing(V.norm(a), V.norm(b), limit);
      if (delta.radians <= 1e-7) continue;
      puppet.rotate(support.part, turn(delta));
      budget.set(support.part, spent + delta.radians);
      turns.push({ part: support.part, degrees: delta.radians * 180 / Math.PI });
    }
    return turns;
  }

  function seat(puppet, request, goal, normal, strength, basis) {
    const { part, upper, lower, point, pole, align } = request;
    const axes = puppet.parts[part], pivot = axes.pivot;
    const current = normalAt(puppet, part, point, align.normal);
    const delta = swing(current, normal);
    delta.radians *= strength * align.weight;
    if (upper === undefined) {
      puppet.rotate(part, turn(delta));
      puppet.pin(part, point, goal);
    } else if (part !== lower) {
      const tilt = turn(delta), desired = basis(M.mul(tilt, axes.A));
      const offset = V.sub(puppet.point(part, point), puppet.point(part, pivot));
      puppet.reach(upper, lower, pivot, V.sub(goal, M.app(tilt, offset)), { pole, effector: part });
      puppet.rotate(part, M.mul(desired, M.tr(basis(axes.A))));
    } else {
      puppet.reach(upper, lower, point, goal, { pole, effector: part });
      const along = V.sub(puppet.point(part, point), puppet.point(part, pivot));
      const now = normalAt(puppet, part, point, align.normal);
      if (V.len(along) < 1e-8) {
        const tilt = swing(now, normal);
        tilt.radians *= strength * align.weight;
        puppet.rotate(part, turn(tilt));
      } else {
        const axis = V.norm(along), a = V.mad(now, axis, -V.dot(axis, now));
        const b = V.mad(normal, axis, -V.dot(axis, normal));
        if (V.len(a) > 1e-8 && V.len(b) > 1e-8) {
          const radians = Math.atan2(V.dot(V.cross(a, b), axis), V.dot(a, b)) * strength * align.weight;
          puppet.rotate(part, M.rot(axis, radians));
        }
      }
    }
  }

  K.anim.contactSurfaces = Object.freeze({ project, direction, normalAt, seat, assist });
})(KIT);
