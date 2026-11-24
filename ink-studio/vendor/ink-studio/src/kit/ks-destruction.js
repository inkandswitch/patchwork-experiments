/* Named splat structures, momentum-preserving handoffs and swept impacts.
   K.destruction(stage, {groups, links, gravity, ground, solid, maxPieces})
   Owns its rubble/debris solvers. Add it once, after kinematic animation.
   See docs/destruction.md for group ownership, support and reset contracts. */
(function (K) {
  const { V, M } = K, EPS = 1e-8;
  const bindings = new WeakMap();
  const vec = v => (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const positive = v => Number.isFinite(v) && v > 0;
  const vector = (v, name) => { if (!vec(v)) throw new RangeError(name + ' needs a finite vector'); return Array.from(v); };
  const bounded = (n, max, name) => { if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError('Invalid ' + name + ' budget'); return n; };
  const distanceBox = (p, lo, hi) => {
    const q = p.map((x, a) => Math.max(lo[a] - x, x - hi[a]));
    return Math.hypot(...q.map(x => Math.max(0, x))) + Math.min(0, Math.max(...q));
  };
  function sphereSweep(a, b, c, radius) {
    const d = V.sub(b, a), m = V.sub(a, c), dd = V.dot(d, d), outside = V.dot(m, m) - radius * radius;
    if (outside <= 0) return 0;
    if (dd < EPS * EPS) return null;
    const along = V.dot(m, d), disc = along * along - dd * outside;
    if (along >= 0 || disc < 0) return null;
    const t = outside / (-along + Math.sqrt(disc));
    return t >= 0 && t <= 1 ? t : null;
  }
  function boxSweep(a, b, lo, hi, radius) {
    let enter = 0, exit = 1;
    for (let k = 0; k < 3; k++) {
      const d = b[k] - a[k];
      if (Math.abs(d) < EPS) { if (a[k] < lo[k] - radius || a[k] > hi[k] + radius) return false; }
      else {
        const x = (lo[k] - radius - a[k]) / d, y = (hi[k] + radius - a[k]) / d;
        enter = Math.max(enter, Math.min(x, y)); exit = Math.min(exit, Math.max(x, y));
        if (enter > exit) return false;
      }
    }
    return true;
  }
  const normalAt = (sdf, p, fallback) => {
    const e = 0.001;
    const gradient = [0, 1, 2].map(a => {
      const lo = p.slice(), hi = p.slice(); lo[a] -= e; hi[a] += e;
      return sdf(...hi) - sdf(...lo);
    });
    if (!gradient.every(Number.isFinite)) throw new RangeError('Collision field must return finite distances');
    return V.norm(gradient, fallback);
  };
  // Conservative advancement requires a world-space signed distance function.
  function fieldSweep(a, b, radius, sdf) {
    const delta = V.sub(b, a), length = V.len(delta);
    let t = 0;
    for (let i = 0; i < 192; i++) {
      const p = V.mad(a, delta, t), distance = sdf(...p) - radius;
      if (!Number.isFinite(distance)) throw new RangeError('Collision field must return finite distances');
      if (distance < 0.0001) return { fraction: t, center: p, normal: normalAt(sdf, p, V.norm(V.mul(delta, -1))) };
      if (length < EPS) return null;
      t += Math.max(distance * 0.85, 0.00001) / length;
      if (t > 1) return null;
    }
    throw new RangeError('Collision field exceeded its tracing budget');
  }
  function partition(ids, D, pitch, origin) {
    const cells = new Map();
    for (const id of ids) {
      const q = id * 16, key = [0, 1, 2].map(a => Math.floor((D[q + a] - origin[a]) / pitch)).join(',');
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(id);
    }
    return [...cells.values()];
  }
  function centroid(ids, D) {
    const c = [0, 0, 0];
    for (const id of ids) { const q = id * 16; c[0] += D[q]; c[1] += D[q + 1]; c[2] += D[q + 2]; }
    return V.mul(c, 1 / ids.length);
  }
  function guide(ids, D) {
    const p = id => Array.from(D.subarray(id * 16, id * 16 + 3)), a = p(ids[0]);
    let second = ids[0], best = -1, third = ids[0];
    for (const id of ids) { const d = V.dist(a, p(id)); if (d > best) { best = d; second = id; } }
    const axis = V.sub(p(second), a); best = -1;
    for (const id of ids) { const d = V.len(V.cross(axis, V.sub(p(id), a))); if (d > best) { best = d; third = id; } }
    return [ids[0], second, third];
  }
  function basis(ids, D) {
    const p = id => Array.from(D.subarray(id * 16, id * 16 + 3));
    const a = p(ids[0]), x = V.sub(p(ids[1]), a), n = V.cross(x, V.sub(p(ids[2]), a));
    if (V.len(x) < EPS || V.len(n) < EPS) return null;
    const right = V.norm(x), up = V.norm(n), forward = V.cross(right, up);
    return [right[0], up[0], forward[0], right[1], up[1], forward[1], right[2], up[2], forward[2]];
  }

  K.destruction = (st, options = {}) => {
    if (!(st?.D instanceof Float32Array) || !(st.base instanceof Float32Array) || !Number.isSafeInteger(st.N) || st.D.length < st.N * 16 || typeof st.touch !== 'function')
      throw new TypeError('Destruction needs a splat stage');
    const occupied = bindings.get(st) ?? new Map();
    const ownership=K.geometryOwnership(st),token={};
    const { D } = st, maxPieces = bounded(options.maxPieces ?? 128, 2048, 'piece');
    const maxProjectiles = bounded(options.maxProjectiles ?? 64, 1024, 'projectile');
    const maxEvents = bounded(options.maxEvents ?? 1024, 100000, 'event');
    const contactPoints = bounded(options.points ?? 12, 64, 'contact point');
    const maxSplats = bounded(options.maxSplats ?? 250000, 2000000, 'splat');
    const gravity = options.gravity ?? 18, scale = options.collisionScale ?? 1, seed = options.seed ?? 17;
    if (!Number.isSafeInteger(seed) || st.physicsOwned && (!(st.physicsOwned instanceof Uint8Array) || st.physicsOwned.length < st.N))
      throw new RangeError('Invalid destruction seed or stage ownership mask');
    const ground = options.ground ?? (() => 0), solid = options.solid ?? ((x, y, z) => y - ground(x, z));
    if (!Number.isFinite(gravity) || gravity < 0 || !positive(scale) || typeof ground !== 'function' || typeof solid !== 'function')
      throw new RangeError('Invalid destruction gravity or collision settings');
    const authored = options.groups === undefined ? st.W?.breakables : undefined;
    const definitions = authored?.groups ?? options.groups;
    const connections = options.links === undefined ? authored?.links : options.links;
    if (!Array.isArray(definitions) || !definitions.length || definitions.length > 4096)
      throw new RangeError('Destruction needs one to 4096 named groups');
    const groups = new Map(), owner = new Map(), links = [], events = [], projectiles = [], adjacency = new Map();
    const pieceShapes = new WeakMap();
    let rubble, debris, accumulator = 0, clock = 0, serial = 0, disposed = false, selectionRows;
    function alive() { if (disposed) throw new Error('Destruction binding is disposed'); }
    const metadata = typeof TargetSelectors !== 'undefined' ? TargetSelectors.index(st.W) : null;
    function radii(id) {
      const q = id * 16;
      return scale * Math.sqrt(Math.max(0,
        D[q + 4] + Math.abs(D[q + 5]) + Math.abs(D[q + 6]),
        D[q + 8] + Math.abs(D[q + 5]) + Math.abs(D[q + 9]),
        D[q + 10] + Math.abs(D[q + 6]) + Math.abs(D[q + 9])));
    }
    for (const spec of definitions) {
      if (!spec || typeof spec.id !== 'string' || !spec.id.trim() || spec.id.length > 256 || groups.has(spec.id))
        throw new RangeError('Structural groups need distinct nonempty names');
      if ((spec.ids === undefined) === (spec.selector === undefined)) throw new RangeError('Choose group ids or a named selector');
      let ids;
      if (spec.selector !== undefined) {
        if (!metadata) throw new Error('Named selectors are unavailable');
        const selector = TargetSelectors.prepare(spec.selector); ids = [];
        if (!selectionRows) {
          selectionRows = new Map();
          for (let i = 0; i < st.N; i++) { const target = metadata.row(i); if (!selectionRows.has(target)) selectionRows.set(target, []); selectionRows.get(target).push(i); }
        }
        for (const [target, rows] of selectionRows) if (TargetSelectors.matches(selector, target)) for (const id of rows) ids.push(id);
      } else {
        if (!Array.isArray(spec.ids) && !ArrayBuffer.isView(spec.ids)) throw new TypeError('Group ids must be an array');
        ids = Array.from(spec.ids);
      }
      if (!ids.length || owner.size + ids.length > maxSplats) throw new RangeError('Empty group or destruction splat budget exceeded');
      const unique = new Set();
      for (const id of ids) {
        if (!Number.isSafeInteger(id) || id < 0 || id >= st.N || unique.has(id) || owner.has(id) || occupied.has(id) || ownership.owner(id)!==undefined || st.physicsOwned?.[id]) throw new RangeError('Structural splat ownership must be distinct and in range');
        unique.add(id);
        const q = id * 16;
        if (!Array.from(D.subarray(q, q + 16)).every(Number.isFinite)) throw new RangeError('Structural geometry must be finite');
      }
      const mass = spec.mass ?? Math.max(1, ids.length * 0.02), strength = spec.strength ?? 2;
      const mode = spec.mode ?? 'rubble', fragmentSize = spec.fragmentSize ?? 0;
      if (!positive(mass) || !positive(strength) || !['rubble', 'debris'].includes(mode) || !Number.isFinite(fragmentSize) || fragmentSize < 0 ||
        spec.motion !== undefined && typeof spec.motion !== 'function' || spec.solid !== undefined && typeof spec.solid !== 'function')
        throw new RangeError('Invalid structural mass, strength, fragments or motion');
      const saved = new Float32Array(ids.length * 16), appearance = new Float32Array(ids.length * 2), free = new Uint8Array(ids.length);
      ids.forEach((id, k) => { saved.set(D.subarray(id * 16, id * 16 + 16), k * 16); appearance[k * 2] = st.base[id * 16 + 3]; appearance[k * 2 + 1] = st.base[id * 16 + 7]; free[k] = st.rig?.free[id] ?? 0; owner.set(id, spec.id); });
      groups.set(spec.id, { id: spec.id, ids, saved, appearance, free, mass, strength, mode, fragmentSize,
        anchor: Boolean(spec.anchor), breakable: spec.breakable !== false, static: Boolean(spec.static), motion: spec.motion,
        solid: spec.solid, parts: authored && spec.parts, guide: guide(ids, D), intact: true, damage: 0, v: [0, 0, 0], w: [0, 0, 0], sampled: false });
    }
    if (connections !== undefined && (!Array.isArray(connections) || connections.length > 16384)) throw new RangeError('Support link budget exceeded');
    for (const id of groups.keys()) adjacency.set(id, []);
    const linkKeys = new Set();
    for (const link of connections ?? []) {
      if (!Array.isArray(link) || link.length !== 2 || link[0] === link[1] || !link.every(id => groups.has(id))) throw new RangeError('Support links need two distinct known group names');
      const key = JSON.stringify(link.slice().sort());
      if (linkKeys.has(key)) throw new RangeError('Support links must be distinct');
      linkKeys.add(key);
      const edge = { a: link[0], b: link[1], active: true }; links.push(edge);
      adjacency.get(edge.a).push(edge); adjacency.get(edge.b).push(edge);
    }
    const support = options.support ?? authored?.support ?? links.length > 0;
    if (support && ![...groups.values()].some(g => g.anchor)) throw new RangeError('Support graphs need an anchored group');
    function unsupported(removed = new Set(), severed = null) {
      if (!support) return [];
      const reached = new Set(), queue = [];
      for (const g of groups.values()) if (g.anchor && g.intact && !removed.has(g.id)) { reached.add(g.id); queue.push(g.id); }
      for (let i = 0; i < queue.length; i++) for (const edge of adjacency.get(queue[i])) {
        if (!edge.active || edge === severed) continue;
        const next = edge.a === queue[i] ? edge.b : edge.b === queue[i] ? edge.a : null;
        if (next !== null && !reached.has(next) && !removed.has(next) && groups.get(next).intact) { reached.add(next); queue.push(next); }
      }
      return [...groups.values()].filter(g => g.intact && !removed.has(g.id) && !reached.has(g.id));
    }
    if (unsupported().length) throw new RangeError('Every supported group must initially connect to an anchor');
    function emit(event) {
      if (events.length === maxEvents) events.shift();
      events.push({ time: clock, ...event });
    }
    function solvers() {
      debris = K.debris(st, { gravity, ground });
      rubble = K.rubble(st, { gravity, solid, breakAt: Infinity, points: contactPoints });
    }
    solvers();
    function refresh(g, dt = 0) {
      const center = centroid(g.ids, D), frame = basis(g.guide, D);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const id of g.ids) {
        const q = id * 16, r = radii(id);
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], D[q + a] - r); hi[a] = Math.max(hi[a], D[q + a] + r); }
      }
      if (dt > 0 && g.sampled) {
        g.v = V.mul(V.sub(center, g.center), 1 / dt);
        const turn = frame && g.frame ? M.axisAngle(M.mul(frame, M.tr(g.frame))) : null;
        g.w = turn ? V.mul(turn.axis, turn.angle / dt) : [0, 0, 0];
      }
      g.center = center; g.frame = frame; g.lo = lo; g.hi = hi; g.sampled = true;
    }
    function sync(dt = 0) {
      alive();
      if (!Number.isFinite(dt) || dt < 0 || dt > 0.25) throw new RangeError('Motion sampling needs a step in [0, 0.25]');
      for (const g of groups.values()) if (g.intact && (!g.static || !g.sampled)) refresh(g, dt);
    }
    sync();
    function known(id) { alive(); const g = groups.get(id); if (!g) throw new RangeError('Unknown structural group: ' + id); return g; }
    function sampleHit(a, b, center, radius, splat, best) {
      const fraction = sphereSweep(a, b, center, radius);
      if (fraction === null || best && fraction >= best.fraction) return null;
      const p = V.lerp(a, b, fraction), normal = V.norm(V.sub(p, center), V.norm(V.sub(a, b)));
      return { fraction, center: p, normal, ...(splat !== undefined && { splat }) };
    }
    function sweep(from, to, radius = 0, { exclude = null, environment = false, dynamic = false } = {}) {
      alive();
      const a = vector(from, 'Sweep start'), b = vector(to, 'Sweep end');
      if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Sweep radius must be nonnegative');
      let best = environment ? fieldSweep(a, b, radius, solid) : null;
      if (best) best.group = null;
      for (const g of groups.values()) {
        if (!g.intact || g.id === exclude || !boxSweep(a, b, g.lo, g.hi, radius)) continue;
        let hit = null;
        if (g.solid) hit = fieldSweep(a, b, radius, g.solid);
        else for (const id of g.ids) {
          const q = id * 16, center = [D[q], D[q + 1], D[q + 2]];
          hit = sampleHit(a, b, center, radius + radii(id), id, hit) ?? hit;
        }
        if (hit && (!best || hit.fraction < best.fraction)) best = { ...hit, group: g.id };
      }
      if (dynamic) for (const body of rubble.bodies) {
        const shape = pieceShapes.get(body);
        if (body.group === exclude || sphereSweep(a, b, body.c, radius + body.rad + (shape?.extent ?? body.pr)) === null) continue;
        if (shape) {
          // Trace in the moving body's frame so all splat centers stay fixed throughout the step.
          const inverse = M.tr(body.R);
          const from = M.app(inverse, V.sub(a, body.c)), to = M.app(inverse, V.sub(b, body.c));
          const center = [0, 0, 0];
          let localHit = null;
          for (let i = 0; i < body.ids.length; i++) {
            const start = i * 9;
            center[0] = body.loc[start]; center[1] = body.loc[start + 1]; center[2] = body.loc[start + 2];
            localHit = sampleHit(from, to, center, radius + shape.radii[i], body.ids[i], localHit ?? best) ?? localHit;
          }
          if (localHit) best = { ...localHit, center: V.lerp(a, b, localHit.fraction), normal: M.app(body.R, localHit.normal), group: body.group, body };
        } else for (const local of body.pts) {
          const center = V.add(body.c, M.app(body.R, local));
          const hit = sampleHit(a, b, center, radius + body.pr, undefined, best);
          if (hit) best = { ...hit, group: body.group, body };
        }
      }
      return best && { ...best, p: V.mad(best.center, best.normal, -radius) };
    }
    function motion(g, override) {
      const pose = g.motion ? g.motion(st.time, g.id) : {};
      if (!pose || typeof pose !== 'object') throw new RangeError('Group motion must return a record');
      return { v: vector(override.v ?? pose.v ?? g.v, 'Linear velocity'), w: vector(override.w ?? pose.w ?? g.w, 'Angular velocity'),
        origin: vector(override.origin ?? pose.origin ?? g.center, 'Motion origin') };
    }
    // Resolve the complete release before changing damage, ownership or solver state.
    function planRelease(forced, overrides = new Map(), severed = null) {
      const removed = new Set(forced.map(g => g.id));
      const batch = [...forced, ...unsupported(removed, severed)];
      // Leave room for every remaining structure to detach as at least one body.
      const reserve = maxPieces >= groups.size ? [...groups.values()].filter(g => g.intact && !batch.includes(g)).length : 0;
      const available = maxPieces - rubble.bodies.length - debris.chunks.length - reserve;
      if (batch.length > available) { const error = new RangeError('Destruction piece budget exceeded'); error.code = 'DESTRUCTION_PIECE_BUDGET'; throw error; }
      let remaining = available;
      return batch.map((g, i) => {
        refresh(g);
        const override = overrides.get(g.id) ?? {}, m = motion(g, override);
        const mode = override.mode ?? g.mode, size = override.fragmentSize ?? g.fragmentSize;
        const impulse = vector(override.impulse ?? [0, 0, 0], 'Release impulse');
        const p = vector(override.p ?? g.center, 'Impulse position');
        const scatter = override.scatter ?? 0, life = override.life ?? 5;
        if (!['rubble', 'debris'].includes(mode) || !Number.isFinite(size) || size < 0 || !Number.isFinite(scatter) || scatter < 0 || !positive(life)) throw new RangeError('Invalid release options');
        const limit = Math.max(1, Math.floor(remaining / (batch.length - i)));
        const extent = Math.max(...g.hi.map((value, a) => value - g.lo[a]));
        let pitch = Math.max(size, extent / (limit * 2)), fragments = size > 0 ? partition(g.ids, D, pitch, g.lo) : [g.ids];
        for (let pass = 0; fragments.length > limit && pass < 32; pass++) { pitch *= 1.6; fragments = partition(g.ids, D, pitch, g.lo); }
        if (fragments.length > limit) fragments = [g.ids];
        remaining -= fragments.length;
        let radius2 = 0;
        for (const id of g.ids) { const q = id * 16, x = D[q] - g.center[0], y = D[q + 1] - g.center[1], z = D[q + 2] - g.center[2]; radius2 += x * x + y * y + z * z; }
        const inertia = Math.max(g.mass * radius2 / g.ids.length * 2 / 3, g.mass * 0.001);
        const dv = V.mul(impulse, 1 / g.mass), dw = V.mul(V.cross(V.sub(p, g.center), impulse), 1 / inertia);
        const kicks = fragments.map((ids, k) => [0, 1, 2].map(a => (K.hash(g.ids[0] + k, a + 7, seed) - 0.5) * scatter * 2));
        const mean = [0, 0, 0];
        kicks.forEach((kick, k) => { for (let a = 0; a < 3; a++) mean[a] += kick[a] * fragments[k].length / g.ids.length; });
        return { g, mode, life, direct: removed.has(g.id), pieces: fragments.map((ids, k) => {
          const c = centroid(ids, D), v = V.add(V.add(m.v, V.cross(m.w, V.sub(c, m.origin))), V.add(dv, V.cross(dw, V.sub(c, g.center))));
          return { ids, mass: g.mass * ids.length / g.ids.length, v: V.add(v, V.sub(kicks[k], mean)), w: V.add(m.w, dw) };
        }) };
      });
    }
    function commit(plans, reason) {
      const result = [];
      for (const plan of plans) {
        const g = plan.g; g.intact = false; g.damage = Math.max(1, g.damage);
        ownership.activate(token,g.ids);
        for (const piece of plan.pieces) {
          const body = plan.mode === 'rubble' ? rubble.spawn(piece.ids, piece) : debris.spawn(piece.ids, { ...piece, life: plan.life });
          body.group = g.id; body.mass = piece.mass;
          if (plan.mode === 'rubble') {
            body.im = 1 / piece.mass;
            body.ii = 1 / (0.4 * piece.mass * Math.max(body.rad, 0.15) ** 2);
            if (g.parts) {
              const sizes = piece.ids.map(radii);
              pieceShapes.set(body, { radii: sizes, extent: sizes.reduce((max, size) => Math.max(max, size), 0) });
            }
          }
          result.push(body);
        }
        emit({ kind: 'release', group: g.id, reason: plan.direct ? reason : 'support', pieces: plan.pieces.length });
      }
      return result;
    }
    function release(id, override = {}) {
      const g = known(id);
      if (!g.intact) return [];
      return commit(planRelease([g], new Map([[id, override]])), 'release');
    }
    function sever(a, b) {
      known(a); known(b);
      const edge = links.find(e => e.a === a && e.b === b || e.a === b && e.b === a);
      if (!edge) throw new RangeError('Unknown support link');
      if (!edge.active) return [];
      const plans = planRelease([], new Map(), edge);
      edge.active = false; emit({ kind: 'sever', a, b });
      return commit(plans, 'support');
    }
    function separation(g, p) {
      if (g.solid) { const d = g.solid(...p); if (!Number.isFinite(d)) throw new RangeError('Collision field must return finite distances'); return Math.max(0, d); }
      let nearest = Infinity;
      for (const id of g.ids) { const q = id * 16; nearest = Math.min(nearest, Math.hypot(p[0] - D[q], p[1] - D[q + 1], p[2] - D[q + 2]) - radii(id)); }
      return Math.max(0, nearest);
    }
    function impact({ p, impulse, radius = 0, group } = {}) {
      alive();
      p = vector(p, 'Impact position'); impulse = vector(impulse, 'Impact impulse');
      if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Impact radius must be nonnegative');
      const candidates = group === undefined ? [...groups.values()] : [known(group)], damage = [], forced = [], overrides = new Map();
      for (const g of candidates) {
        if (!g.intact || !g.breakable) continue;
        const bound = Math.max(0, distanceBox(p, g.lo, g.hi));
        if (group === undefined && bound > radius) continue;
        const distance = group === undefined ? separation(g, p) : 0;
        if (distance > radius + 1e-7) continue;
        const weight = radius > 0 ? Math.max(0, 1 - distance / radius) : 1;
        const applied = V.mul(impulse, weight), next = g.damage + V.len(applied) / g.strength;
        damage.push({ g, next });
        if (next >= 1) { forced.push(g); overrides.set(g.id, { p, impulse: applied }); }
      }
      let plans;
      try { plans = planRelease(forced, overrides); } catch (error) {
        if (error.code !== 'DESTRUCTION_PIECE_BUDGET') throw error;
        emit({ kind: 'budget-blocked', groups: forced.map(g => g.id) });
        return { hits: damage.map(d => d.g.id), released: [], pieces: [], blocked: true };
      }
      for (const d of damage) { d.g.damage = d.next; emit({ kind: 'impact', group: d.g.id, damage: d.next, p: p.slice(), impulse: impulse.slice() }); }
      const pieces = commit(plans, 'impact');
      return { hits: damage.map(d => d.g.id), released: plans.map(plan => plan.g.id), pieces };
    }
    function launch(spec = {}) {
      alive();
      if (projectiles.length === maxProjectiles) throw new RangeError('Projectile budget exceeded');
      const p = vector(spec.p, 'Projectile position'), v = vector(spec.v, 'Projectile velocity');
      const radius = spec.radius ?? 0.2, mass = spec.mass ?? 1, life = spec.life ?? 12, restitution = spec.restitution ?? 0.15;
      const id = spec.id ?? 'shot-' + serial;
      if (typeof id !== 'string' || !id || id.length > 256 || projectiles.some(shot => shot.id === id) || !positive(radius) || !positive(mass) || !positive(life) || !Number.isFinite(restitution) || restitution < 0 || restitution > 1)
        throw new RangeError('Invalid projectile identity, mass, radius, lifetime or restitution');
      const shot = { id, p, v, radius, mass, life, restitution, active: true, hits: 0 };
      serial++; projectiles.push(shot); return shot;
    }
    function reaction(hit, velocity, mass, restitution, lever = [0, 0, 0], inverseInertia = 0) {
      const body = hit.body, g = body || hit.group === null ? null : known(hit.group);
      const target = body ? { v: body.v, w: body.w, origin: body.c } : g ? motion(g, {}) : { v: [0, 0, 0], w: [0, 0, 0], origin: hit.p };
      const targetLever = V.sub(hit.p, target.origin), targetVelocity = V.add(target.v, V.cross(target.w, targetLever));
      const vn = V.dot(V.sub(velocity, targetVelocity), hit.normal);
      if (vn >= 0) return { impulse: [0, 0, 0], released: false };
      const arm = V.cross(lever, hit.normal), sourceInverse = 1 / mass + inverseInertia * V.dot(arm, arm);
      const targetArm = V.cross(targetLever, hit.normal);
      const inverse = body ? body.im + body.ii * V.dot(targetArm, targetArm) : g?.breakable ? 1 / g.mass : 0;
      let j = -(1 + restitution) * vn / (sourceInverse + inverse);
      const released = g ? impact({ p: hit.p, impulse: V.mul(hit.normal, -j), group: g.id }).released.includes(g.id) : false;
      if (body) {
        body.v = V.mad(body.v, hit.normal, -j * body.im);
        body.w = V.mad(body.w, targetArm, -j * body.ii);
        body.asleep = false; body.still = 0;
      } else if (!released) j = -(1 + restitution) * vn / sourceInverse;
      return { impulse: V.mul(hit.normal, j), released };
    }
    function project(step) {
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const shot = projectiles[i]; shot.life -= step;
        shot.v[1] -= gravity * step;
        let remaining = step;
        for (let contact = 0; remaining > 1e-8 && contact < 8; contact++) {
          const end = V.mad(shot.p, shot.v, remaining), hit = sweep(shot.p, end, shot.radius, { environment: true, dynamic: true });
          if (!hit) { shot.p = end; break; }
          const result = reaction(hit, shot.v, shot.mass, shot.restitution);
          if (V.len(result.impulse) < EPS) { shot.p = end; break; }
          shot.p = V.mad(hit.center, hit.normal, 0.0002);
          shot.v = V.mad(shot.v, result.impulse, 1 / shot.mass); shot.hits++;
          emit({ kind: 'projectile-hit', projectile: shot.id, group: hit.group, p: hit.p, released: result.released, piece: Boolean(hit.body) });
          remaining *= 1 - hit.fraction;
          if (V.len(shot.v) < 0.3 || shot.hits >= 32) { shot.life = 0; break; }
        }
        if (shot.life <= 0) { shot.active = false; projectiles.splice(i, 1); }
      }
    }
    function collidePieces(step) {
      for (const body of rubble.bodies.slice()) {
        if (body.asleep) continue;
        let best = null;
        for (const local of body.pts) {
          const lever = M.app(body.R, local), p = V.add(body.c, lever), v = V.add(body.v, V.cross(body.w, lever));
          const hit = sweep(p, V.mad(p, v, step), body.pr);
          if (hit && V.dot(v, hit.normal) < -0.1 && (!best || hit.fraction < best.hit.fraction)) best = { hit, v, lever };
        }
        if (!best) continue;
        const { hit, v, lever } = best, before = body.v.slice(), result = reaction(hit, v, body.mass, 0.12, lever, body.ii);
        body.v = V.mad(body.v, result.impulse, body.im);
        body.w = V.mad(body.w, V.cross(lever, result.impulse), body.ii);
        body.c = V.mad(body.c, V.sub(before, body.v), step * hit.fraction);
        emit({ kind: 'piece-hit', group: body.group, target: hit.group, p: hit.p, released: result.released });
      }
    }
    function update(dt) {
      if (!Number.isFinite(dt) || dt < 0 || dt > 0.25) throw new RangeError('Destruction update needs a step in [0, 0.25]');
      sync(dt); accumulator += dt;
      const step = 1 / 120;
      while (accumulator + 1e-12 >= step) {
        accumulator = Math.max(0, accumulator - step); clock += step;
        project(step); collidePieces(step); rubble.step(step); debris.update(step);
      }
      rubble.write();
    }
    function reset() {
      alive();
      for (const shot of projectiles) shot.active = false;
      projectiles.length = 0; events.length = 0; accumulator = 0; clock = 0; serial = 0;
      for (const g of groups.values()) {
        ownership.deactivate(token,g.ids);
        g.ids.forEach((id, k) => { D.set(g.saved.subarray(k * 16, k * 16 + 16), id * 16); st.base[id * 16 + 3] = g.appearance[k * 2]; st.base[id * 16 + 7] = g.appearance[k * 2 + 1]; if (st.rig) st.rig.free[id] = g.free[k]; st.touch(id); });
        g.intact = true; g.damage = 0; g.v = [0, 0, 0]; g.w = [0, 0, 0]; g.sampled = false;
      }
      for (const edge of links) edge.active = true;
      solvers(); sync();
    }
    function inspect(id) {
      const g = known(id);
      return { id, ...(g.parts && { parts: g.parts.slice() }), intact: g.intact, damage: g.damage, mass: g.mass, anchor: g.anchor, splats: g.ids.length,
        center: g.center.slice(), velocity: g.v.slice(), angularVelocity: g.w.slice(),
        pieces: rubble.bodies.filter(b => b.group === id).length + debris.chunks.filter(b => b.group === id).length };
    }
    ownership.reserve(token,[...owner.keys()]);
    for (const id of owner.keys()) occupied.set(id, true);
    bindings.set(st, occupied);
    const api = { release, sever, impact, sweep, launch, sync, update, reset, inspect,
      intact: id => known(id).intact, drainEvents: () => events.splice(0), projectiles,
      paint: (id, color) => { if (!disposed) debris.paint(id, color); },
      dispose() {
        if (disposed) return;
        reset(); ownership.release(token); disposed = true;
        for (const id of owner.keys()) occupied.delete(id);
        for (const list of [st.systems, st.painters]) { const index = list.indexOf(api); if (index >= 0) list.splice(index, 1); }
      },
      get rubble() { return rubble; }, get debris() { return debris; },
      get stats() { return { groups: groups.size, intact: [...groups.values()].filter(g => g.intact).length,
        pieces: rubble.bodies.length + debris.chunks.length, projectiles: projectiles.length, time: clock, pendingEvents: events.length }; } };
    return api;
  };
})(KIT);
