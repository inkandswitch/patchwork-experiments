/* Fixed-step ambient motion over caller-supplied habitat and locomotion queries. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V, TAU = Math.PI * 2;
  const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const within = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
  const offsets = [0, .5, -.5, 1, -1, Math.PI / 2, -Math.PI / 2, 1.95, -1.95];

  function create(members, { place, move, destination, step = 1 / 30 } = {}) {
    if (!Array.isArray(members) || members.length > 128 || typeof place !== 'function' || typeof move !== 'function' ||
        destination !== undefined && typeof destination !== 'function' || !within(step, 1 / 120, .125))
      throw Error('Ambient motion needs a bounded roster, habitat, locomotion and step');
    const entries = new Map();
    for (const raw of members) {
      const { id, home, kind = 'default', seed = 0, speed = .7, radius = .16,
        range = 3, rest = [.8, 2.5], turn = 7, yaw = 0, arrival = Math.min(radius, .12) } = raw ?? {};
      if (typeof id !== 'string' || !id || id.length > 128 || entries.has(id) || !vector(home) ||
          typeof kind !== 'string' || !Number.isSafeInteger(seed) || !within(speed, .01, 30) ||
          !within(radius, .01, 4) || !within(range, .04, 120) || !within(turn, .1, 100) ||
          !Array.isArray(rest) || rest.length !== 2 || !within(rest[0], 0, 60) || !within(rest[1], rest[0], 60) ||
          !Number.isFinite(yaw) || !within(arrival, 0, 120)) throw Error('Invalid ambient member');
      const spec = Object.freeze({ id, kind, home: Object.freeze(home.slice()), speed, radius, range,
        rest: Object.freeze(rest.slice()), turn, arrival, seed: P.data.hash('ambient-motion/' + id, seed) });
      entries.set(id, { spec, point: null, last: null, yaw: angle(yaw), lastYaw: angle(yaw), distance: 0, lastDistance: 0,
        serial: 0, mode: 'rest', until: 0, target: null, signal: null, detour: null, suspended: false });
    }
    const states = [...entries.values()].sort((a, b) => a.spec.id < b.spec.id ? -1 : 1);
    let tick = 0, remainder = 0;

    function query(fn, ...args) {
      const point = fn(...args);
      if (point == null) return null;
      if (!vector(point)) throw Error('Ambient queries must return an XYZ point or null');
      return point.slice();
    }
    function spaced(point, state) {
      return states.every(other => {
        if (other === state || other.suspended || !other.point) return true;
        const distance = state.spec.radius + other.spec.radius;
        if (V.dist(point, other.point) >= distance - 1e-6) return true;
        // Permit a member to increase separation after a habitat change.
        return state.point && V.dist(point, other.point) > V.dist(state.point, other.point) + 1e-6;
      });
    }
    function settle(state, at, now, context) {
      const { spec } = state;
      const project = q => {
        const point = query(place, q, spec, context);
        return point && spaced(point, state) ? point : null;
      };
      let point = project(at);
      for (let ring = 1; !point && ring <= 4; ring++) {
        const r = spec.range * ring / 4, origin = ring < 3 ? at : spec.home;
        for (let dir = 0; !point && dir < 12; dir++) {
          const yaw = TAU * dir / 12 + K.hash(spec.seed, ring, 301) * TAU;
          point = project(V.add(origin, [Math.sin(yaw) * r, 0, Math.cos(yaw) * r]));
        }
      }
      if (!point && V.dist(at, spec.home) > 1e-5) point = project(spec.home);
      const changed = !point || !state.point || V.dist(point, state.point) > 1e-5;
      state.point = state.last = point;
      if (changed) {
        state.target = null;
        state.detour = null;
        state.until = now + spec.rest[0] * K.hash(spec.seed, state.serial, 277);
        state.mode = point ? 'rest' : 'dormant';
      }
    }
    function reconcile(context) {
      for (const state of states)
        if (!state.suspended) settle(state, state.point || state.spec.home, tick * step, context);
    }
    function goal(state, context) {
      const { spec } = state, serial = state.serial++;
      if (destination) {
        const target = query(destination, state.point.slice(), spec, serial, context);
        return target && query(place, target, spec, context);
      }
      for (let i = 0; i < 8; i++) {
        const yaw = K.hash(spec.seed, serial, i * 2 + 107) * TAU;
        const radius = spec.range * (.25 + .75 * Math.sqrt(K.hash(spec.seed, serial, i * 2 + 108)));
        const target = query(place, V.add(spec.home, [Math.sin(yaw) * radius, 0, Math.cos(yaw) * radius]), spec, context);
        if (target && V.dist(state.point, target) > spec.radius) return target;
      }
      return null;
    }
    function rest(state, now) {
      const [low, high] = state.spec.rest;
      state.target = null;
      state.detour = null;
      state.mode = 'rest';
      state.until = now + low + (high - low) * K.hash(state.spec.seed, state.serial, 509);
    }
    function face(state, aim) {
      if (Math.hypot(aim[0], aim[2]) < 1e-7) return;
      const delta = angle(Math.atan2(aim[0], aim[2]) - state.yaw), cap = state.spec.turn * step;
      state.yaw = angle(state.yaw + Math.max(-cap, Math.min(cap, delta)));
    }
    function integrate(state, now, context) {
      if (state.suspended) return;
      const { spec, point } = state;
      state.last = point;
      state.lastYaw = state.yaw;
      state.lastDistance = state.distance;
      if (!point) return;
      if (state.signal?.end <= now) {
        state.signal = null;
        state.detour = null;
      }
      const signal = state.signal;
      if (!signal && !state.target) {
        if (now < state.until) { state.mode = 'rest'; return; }
        state.target = goal(state, context);
        if (!state.target) { rest(state, now); return; }
      }
      const target = signal?.point || state.target, aim = V.sub(target, point), length = V.len(aim),
        stop = signal?.stop ?? spec.arrival;
      if (signal && now < signal.holdEnd || length <= stop + 1e-6) {
        if (signal) { state.mode = now < signal.holdEnd ? 'engaged' : 'gathered'; face(state, aim); }
        else rest(state, now);
        return;
      }
      const pace = Math.min(spec.speed * step, length - stop), direction = V.mul(aim, pace / length);
      state.mode = signal ? 'follow' : 'roam';
      const side = K.hash(spec.seed, state.serial, 401) < .5 ? 1 : -1;
      function attempt(delta) {
        const next = query(move, point.slice(), delta, spec, context);
        if (!next || V.dist(point, next) < pace * .18 || !spaced(next, state)) return false;
        state.point = next;
        state.distance += V.dist(point, next);
        face(state, V.sub(next, point));
        return true;
      }
      if (state.detour && now < state.detour.end) {
        const [x,z] = state.detour.direction, horizontal = Math.hypot(direction[0],direction[2]);
        if (attempt([x*horizontal,direction[1],z*horizontal])) return;
      }
      state.detour = null;
      for (const offset of offsets) {
        const c = Math.cos(offset), s = Math.sin(offset * side);
        const delta = [direction[0] * c + direction[2] * s, direction[1], direction[2] * c - direction[0] * s];
        if (!attempt(delta)) continue;
        const run = Math.hypot(delta[0],delta[2]);
        if (Math.abs(offset) >= 1 && run > 1e-6)
          state.detour = { direction:[delta[0]/run,delta[2]/run], end:now+.35 };
        return;
      }
      if (signal) face(state, aim);
      else rest(state, now);
    }
    function advance(elapsed, context) {
      if (!within(elapsed, 0, 1)) throw Error('Ambient elapsed time must be between zero and one second');
      remainder += elapsed;
      const steps = Math.floor((remainder + 1e-10) / step);
      remainder = Math.max(0, remainder - steps * step);
      for (let i = 0; i < steps; i++) {
        const now = ++tick * step;
        for (const state of states) integrate(state, now, context);
      }
      return steps;
    }
    function attract(id, point, { hold = .55, duration = 5, stop = .65 } = {}) {
      const state = entries.get(id);
      if (!state?.point || state.suspended || !vector(point) || !within(duration, .05, 60) ||
          !within(hold, 0, duration) || !within(stop, .02, 10))
        throw Error('Ambient attraction needs an active member, target and bounded timing');
      state.target = null;
      state.detour = null;
      state.signal = { point: point.slice(), stop, holdEnd: tick * step + hold, end: tick * step + duration };
    }
    function retarget(id, point) {
      if (!vector(point)) throw Error('Ambient target must be an XYZ point');
      const state = entries.get(id);
      if (state?.signal) state.signal.point = point.slice();
    }
    function suspend(id) {
      const state = entries.get(id);
      if (!state || state.suspended) return false;
      state.suspended = true;
      state.signal = null;
      state.target = null;
      state.detour = null;
      state.lastYaw = state.yaw;
      state.lastDistance = state.distance;
      return true;
    }
    function resume(id, context, point) {
      const state = entries.get(id);
      if (!state?.suspended) return false;
      if (point !== undefined && !vector(point)) throw Error('Ambient release point must be an XYZ point');
      const now = tick * step;
      settle(state, point || state.point || state.spec.home, now, context);
      if (state.point) rest(state, now);
      state.suspended = false;
      return true;
    }
    function poses() {
      const blend = remainder / step;
      return states.map(state => ({
        id: state.spec.id, kind: state.spec.kind, mode: state.suspended ? 'suspended' : state.mode,
        point: !state.suspended && state.point ? V.mad(state.last, V.sub(state.point, state.last), blend) : null,
        yaw: angle(state.lastYaw + angle(state.yaw - state.lastYaw) * blend),
        distance: state.lastDistance + (state.distance - state.lastDistance) * blend
      }));
    }
    return Object.freeze({ reconcile, advance, attract, retarget, suspend, resume, poses, get time() { return tick * step; } });
  }
  P.ambientMotion = Object.freeze({ create });
})(KIT);
