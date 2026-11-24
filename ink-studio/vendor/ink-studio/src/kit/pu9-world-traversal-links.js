/* Character traversal over authored routes, timetables and movement fields. */
(function (K) {
  const W = K.world, { V } = K;
  const { check, record, vector, safeKey } = W.data;
  const { freeze } = K.procedural.data;
  const zero = Object.freeze([0, 0, 0]), epsilon = 1e-7;
  const num = (value, min, max = 1e5) => Number.isFinite(value) && value >= min && value <= max;
  const point = value => vector(value) && value.every(v => Math.abs(v) <= 1e5);
  const inside = (p, box) => p.every((v, i) => v >= box.min[i] && v <= box.max[i]);
  const bounded = value => point(value.min) && point(value.max) && value.min.every((v, i) => v < value.max[i]);
  const copy = value => value && Object.freeze([...value]);

  function compile(id, raw) {
    check(safeKey(id) && id.length <= 80 && record(raw) && ['route', 'scheduled', 'impulse', 'flow'].includes(raw.kind),
      'Invalid traversal link ' + id);
    const { kind, enabled = true, entry = {}, exit = {}, switches = [] } = raw;
    const rail = kind === 'route' || kind === 'scheduled';
    check(record(entry) && record(exit) && Array.isArray(switches), 'Invalid traversal entry or exit for ' + id);
    const auto = entry.auto ?? (kind === 'impulse' || kind === 'flow');
    const reach = entry.radius ?? .65, minSpeed = entry.minSpeed ?? 0;
    check((typeof enabled === 'boolean' || typeof enabled === 'function') &&
      typeof auto === 'boolean' && num(reach, .01, 20) && num(minSpeed, 0) &&
      (entry.modes === undefined || Array.isArray(entry.modes) && entry.modes.length > 0 && entry.modes.every(safeKey)) &&
      (entry.normal === undefined || !rail && point(entry.normal) && V.len(entry.normal) > epsilon) &&
      num(exit.inherit ?? 1, 0, 4) && point(exit.boost ?? zero) && point(exit.offset ?? zero),
    'Invalid traversal entry or exit for ' + id);
    const rule = { id, kind, rail, enabled, auto, reach, minSpeed, modes: copy(entry.modes),
      normal: entry.normal && copy(V.norm(entry.normal)), exit: Object.freeze({
        boost: copy(exit.boost ?? zero), inherit: exit.inherit ?? 1, offset: copy(exit.offset ?? zero)
      }) };
    if (rail) {
      let route = raw.route;
      if (!route) {
        check(Array.isArray(raw.path) && raw.path.length >= 2 && raw.path.length <= 4096 && raw.path.every(point),
          'Traversal route requires a follower or bounded path points');
        route = K.anim.route(K.anim.path(raw.path, { closed: raw.motion?.mode === 'loop' }), raw.motion);
      }
      check(['frame', 'state', 'vehicle', 'timeAtDistance', 'nextEvent'].every(key => typeof route[key] === 'function') &&
        num(route.length, epsilon) && num(route.duration, epsilon, 1e9), 'Invalid traversal route follower');
      const { from = 0, to = route.length, offset = zero, phase = 0, maxWait = 30, maxBoardSpeed = .15 } = raw;
      check(num(from, 0, route.length) && num(to, 0, route.length) && Math.abs(from - to) > epsilon &&
        (kind !== 'scheduled' || !route.closed || from !== route.length && to !== route.length) &&
        (kind === 'route' ? from < to : from < to || route.mode !== 'once') &&
        point(offset) && num(Math.abs(phase), 0, 1e9) && num(maxWait, 0, 3600) && num(maxBoardSpeed, 0),
      'Invalid traversal route endpoints or timetable');
      check(Array.isArray(switches) && switches.length <= 32 && switches.every(row =>
        record(row) && safeKey(row.link) && num(row.at, from, to) && num(row.radius ?? .5, .01, 20)) &&
        (!switches.length || kind === 'route') && new Set(switches.map(row => row.link)).size === switches.length,
      'Invalid traversal switches for ' + id);
      const start = route.timeAtDistance(from, { departure: true }), end = route.timeAtDistance(to);
      return { ...rule, route, from, to, start, end, phase, maxWait, maxBoardSpeed, offset: copy(offset),
        at: copy(V.add(route.frame(from).p, offset)), switches: switches.map(row => ({ ...row, radius: row.radius ?? .5 })) };
    }
    check(!switches.length && V.len(rule.exit.offset) === 0, 'Track switches and exit offsets require a route');
    if (kind === 'impulse') {
      check(point(entry.at) && point(raw.velocity) && V.len(raw.velocity) > epsilon && num(raw.inherit ?? 0, 0, 4),
        'An impulse link needs an entry and launch velocity');
      return { ...rule, at: copy(entry.at), velocity: copy(raw.velocity), inherit: raw.inherit ?? 0 };
    }
    check(record(raw.volume) && bounded(raw.volume) && point(raw.acceleration) &&
      V.len(raw.acceleration) > epsilon && num(raw.speedLimit ?? 12, .01) && num(raw.duration ?? 30, .01, 3600) &&
      entry.normal === undefined, 'A flow link needs a volume and acceleration');
    return { ...rule, volume: { min: copy(raw.volume.min), max: copy(raw.volume.max) },
      acceleration: copy(raw.acceleration), speedLimit: raw.speedLimit ?? 12, duration: raw.duration ?? 30 };
  }

  function crossing(rule, from, to) {
    const d = V.sub(to, from);
    if (rule.volume) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < epsilon) {
          if (from[i] < rule.volume.min[i] || from[i] > rule.volume.max[i]) return null;
        } else {
          const a = (rule.volume.min[i] - from[i]) / d[i], b = (rule.volume.max[i] - from[i]) / d[i];
          lo = Math.max(lo, Math.min(a, b));
          hi = Math.min(hi, Math.max(a, b));
          if (lo > hi) return null;
        }
      }
      return lo;
    }
    const offset = V.sub(from, rule.at);
    if (rule.normal) {
      const a = V.dot(offset, rule.normal), b = V.dot(d, rule.normal);
      if (a >= 0 || b <= 0) return null;
      const at = -a / b;
      return at <= 1 && V.len(V.mad(offset, d, at)) <= rule.reach ? at : null;
    }
    const c = V.dot(offset, offset) - rule.reach ** 2;
    if (c <= 0) return 0;
    const a = V.dot(d, d), b = V.dot(offset, d), discriminant = b * b - a * c;
    if (a <= epsilon ** 2 || b >= 0 || discriminant < 0) return null;
    const at = c / (-b + Math.sqrt(discriminant));
    return at <= 1 ? at : null;
  }

  function atEntry(rule, p) {
    return rule.volume ? inside(p, rule.volume) : V.dist(p, rule.at) <= rule.reach;
  }

  function touches(segment, point) {
    const d = V.sub(segment.actor.position, segment.previous), lengthSquared = V.dot(d, d);
    const fraction = lengthSquared ? K.clamp(V.dot(V.sub(point, segment.previous), d) / lengthSquared, 0, 1) : 0;
    return V.dist(point, V.mad(segment.previous, d, fraction)) < .0005;
  }

  function station(rule, time) {
    const { route, from, to, phase, maxBoardSpeed } = rule;
    const sample = route.state(time + phase), direction = from < to || route.closed ? 1 : -1;
    const endTurn = route.mode === 'pingpong' && (from === 0 || from === route.length);
    if (Math.abs(sample.distance - from) > epsilon || sample.speed > maxBoardSpeed + epsilon ||
        !endTurn && sample.direction !== direction || sample.finished) return null;
    let event = route.nextEvent(time + phase, [{ at: to }]);
    if (event && event.direction !== direction) event = route.nextEvent(event.time, [{ at: to }]);
    return event?.direction === direction ? event.time - phase : null;
  }

  function create({ controller = W.characters.create(), links } = {}) {
    check(record(links) && Object.keys(links).length > 0 && Object.keys(links).length <= 128,
    'Traversal needs a character controller and up to 128 links');
    const rules = new Map(Object.keys(links).sort().map(id => [id, compile(id, links[id])]));
    for (const rule of rules.values()) for (const next of rule.switches ?? [])
      check(next.link !== rule.id && rules.get(next.link)?.kind === 'route', 'A switch must lead to another on-demand route');

    const automatic = [...rules.values()].filter(rule => rule.auto);
    const hasTimetable = [...rules.values()].some(rule => rule.kind === 'scheduled');

    function withController(controller) {
      check(['state', 'step', 'sweepTo', 'fits'].every(key => typeof controller?.[key] === 'function') &&
        num(controller.tuning?.maxStep, epsilon, 1) && Number.isSafeInteger(controller.tuning.maxSteps) &&
        controller.tuning.maxSteps > 0, 'Traversal needs a capsule controller');
      function state(actor) {
        const saved = actor?.traversal;
        if (saved !== undefined) {
          const rule = rules.get(saved?.link);
          check(record(saved) && rule && (
            saved.phase === 'released' ||
            saved.phase === 'waiting' && rule.kind === 'scheduled' && Number.isFinite(saved.since) ||
            saved.phase === 'riding' && rule.rail && Number.isFinite(saved.clock) && Number.isFinite(saved.end) &&
              saved.clock <= saved.end && (rule.kind === 'route' ? saved.clock >= rule.start && saved.end === rule.end :
                saved.end - saved.clock <= 2 * Math.max(rule.route.duration, rule.route.period) + epsilon) ||
            saved.phase === 'flow' && rule.kind === 'flow' && num(saved.elapsed, 0, rule.duration)),
          'Invalid saved character traversal');
        }
        return controller.state(actor);
      }

      function step(actor, input = {}, seconds, world, options = {}) {
        const { time = hasTimetable ? undefined : 0, enabled } = options;
        const count = Math.ceil(seconds / controller.tuning.maxStep);
        check(num(Math.abs(time), 0, 1e9) && Number.isFinite(seconds) && seconds >= 0 && count <= controller.tuning.maxSteps &&
          (enabled === undefined || typeof enabled === 'function') &&
          (input.traverse === undefined || rules.has(input.traverse)) &&
          (input.detach === undefined || typeof input.detach === 'boolean'), 'Invalid character traversal step');
        const { traverse, detach, ...movement } = input;
        let current = state(actor);
        if (!count) return controller.step(current, movement, seconds, world);
        const requested = rules.get(traverse);
        if (!requested && !automatic.length && !current.traversal) return controller.step(current, movement, seconds, world);
        const segments = [], events = [];
        let blocked = false, support = null;
        const dt = seconds / count;
        const emit = (type, rule, at, extra = {}) =>
          events.push({ type: 'traversal-' + type, link: rule.id, time: at, position: current.position, ...extra });
        const setPhase = (rule, phase, fields = {}) => { current = { ...current, traversal: { link: rule.id, phase, ...fields } }; };
        const clearPhase = () => { const { traversal, ...rest } = current; current = rest; };
        const admitted = (rule, actor, at) => rule && current.traversal?.link !== rule.id &&
          (!rule.modes || rule.modes.includes(actor.mode)) && V.len(actor.velocity) >= rule.minSpeed &&
          (typeof rule.enabled === 'function' ? rule.enabled({ actor, world, time: at, input, link: rule.id }) : rule.enabled) &&
          (!enabled || enabled(rule.id));
        function relocate(position, velocity) {
          const before = current.position;
          const { surfaceAnchor, surfaceMomentum, ...body } = current;
          const up = typeof world.gravityAt === 'function' ?
            W.gravity.normalize(world.gravityAt(position), [0, -controller.tuning.gravity, 0]).up : current.up;
          const heading = V.norm(W.gravity.tangent(velocity, up), current.forward);
          current = { ...body, position, velocity, up, forward: heading, gravityForward: heading, mode: 'air', jumpHeld: !!input.jump };
          if (V.dist(before, position) > epsilon) segments.push({ previous: before, actor: current });
          support = null;
        }
        function release(rule, at, cause, velocity = current.velocity, target = current.position) {
          const outgoing = V.add(V.mul(velocity, rule.exit.inherit), rule.exit.boost);
          relocate(target, outgoing);
          current = { ...current, surfaceMomentum: outgoing };
          setPhase(rule, 'released');
          emit('exit', rule, at, { cause, velocity: outgoing });
        }
        function place(rule, at, clock, end, prior) {
          const sample = rule.route.vehicle(clock), position = V.add(sample.p, rule.offset);
          const motion = controller.sweepTo(current, position, world);
          if (motion.blocked || !controller.fits(world, position)) {
            blocked = true;
            emit('blocked', rule, at, { stage: 'entry' });
            return false;
          }
          relocate(position, sample.velocity);
          setPhase(rule, 'riding', { clock, end });
          emit(prior ? 'switch' : 'enter', rule, at, prior ? { from: prior.id } : {});
          return true;
        }
        function enter(rule, at) {
          if (rule.kind === 'impulse') {
            const velocity = V.add(V.mul(current.velocity, rule.inherit), rule.velocity);
            emit('enter', rule, at);
            release(rule, at, 'impulse', velocity);
          } else if (rule.kind === 'flow') {
            setPhase(rule, 'flow', { elapsed: 0 });
            emit('enter', rule, at);
          } else if (rule.kind === 'scheduled') {
            setPhase(rule, 'waiting', { since: at });
            emit('wait', rule, at);
          } else place(rule, at, rule.start, rule.end);
        }
        const idle = { ...movement, move: [0, 0], moveWorld: zero, jump: false, vertical: 0, climb: false,
          ...(controller.controllers&&{throttle:0,steer:0}) };
        function walk(duration, controls = movement) {
          const result = controller.step(current, controls, duration, world);
          current = result.actor;
          support = result.support;
          blocked ||= result.blocked;
          return result;
        }
        function retain(result) {
          segments.push(...result.segments);
          events.push(...result.events);
        }

        for (let i = 0; i < count; i++) {
          const at = time + i * dt, until = at + dt;
          let saved = current.traversal, rule = saved && rules.get(saved.link), remaining = dt, attemptedEntry = false;
          if (saved?.phase === 'released' && !atEntry(rule, current.position)) {
            clearPhase();
            saved = rule = undefined;
          }
          if (detach && saved && saved.phase !== 'released') {
            if (saved.phase === 'waiting') {
              setPhase(rule, 'released');
              emit('cancel', rule, at, { cause: 'detach' });
            } else release(rule, at, 'detach');
          } else if (saved?.phase === 'riding' && requested?.id !== rule.id && requested &&
              rule.switches?.some(next => next.link === requested.id &&
                Math.abs(rule.route.state(saved.clock).distance - next.at) <= next.radius) &&
              atEntry(requested, current.position) && admitted(requested, current, at)) {
            place(requested, at, requested.start, requested.end, rule);
          } else if ((!saved || saved.phase === 'released') && !detach && requested && !requested.normal &&
              atEntry(requested, current.position) && admitted(requested, current, at)) {
            attemptedEntry = true;
            enter(requested, at);
          }

          saved = current.traversal;
          rule = saved && rules.get(saved.link);
          if (saved?.phase === 'waiting') {
            const eligible = atEntry(rule, current.position) &&
              (!rule.modes || rule.modes.includes(current.mode)) && (!enabled || enabled(rule.id)) &&
              (typeof rule.enabled === 'function' ? rule.enabled({ actor: current, world, time: at, input, link: rule.id }) : rule.enabled);
            if (!eligible || at - saved.since >= rule.maxWait + epsilon) {
              setPhase(rule, 'released');
              emit('cancel', rule, at, { cause: eligible ? 'timeout' : 'unavailable' });
            } else {
              let boardAt = at, end = station(rule, at);
              if (end === null) {
                const next = rule.route.nextEvent(at + rule.phase, [{ at: rule.from }]);
                if (!next) {
                  setPhase(rule, 'released');
                  emit('cancel', rule, at, { cause: 'no-service' });
                  retain(walk(dt));
                  continue;
                }
                if (next.time - rule.phase <= until + epsilon) {
                  boardAt = Math.min(until, next.time - rule.phase);
                  end = station(rule, boardAt);
                }
              }
              if (end !== null && place(rule, boardAt, boardAt + rule.phase, end + rule.phase)) remaining = until - boardAt;
              else {
                retain(walk(dt, idle));
                continue;
              }
            }
          }

          saved = current.traversal;
          rule = saved && rules.get(saved.link);
          if (saved?.phase === 'riding') {
            const timed = rule.kind === 'scheduled', wanted = timed ? until + rule.phase : saved.clock + remaining;
            check(wanted >= saved.clock - epsilon, 'Traversal clock moved backwards');
            const junction = !timed && requested && rule.switches.find(next => next.link === requested.id);
            const switchClock = junction ? rule.route.timeAtDistance(junction.at) : Infinity;
            const reachesSwitch = switchClock > saved.clock + epsilon && switchClock <= Math.min(wanted, saved.end);
            const clock = Math.max(saved.clock, Math.min(saved.end, wanted, reachesSwitch ? switchClock : Infinity));
            const travel = rule.route.state(clock).travel - rule.route.state(saved.clock).travel;
            const legs = Math.max(1, Math.ceil(travel / .2));
            check(Number.isSafeInteger(legs) && legs <= 256, 'Traversal exceeds the route sweep budget');
            let stopped = false;
            for (let leg = 1; leg <= legs; leg++) {
              const sampleClock = leg === legs ? clock : saved.clock + (clock - saved.clock) * leg / legs;
              const sample = rule.route.vehicle(sampleClock), position = V.add(sample.p, rule.offset);
              const motion = controller.sweepTo(current, position, world);
              if (motion.blocked || !controller.fits(world, position)) {
                stopped = blocked = true;
                emit('blocked', rule, until, { stage: 'motion' });
                if (timed) release(rule, until, 'blocked', zero);
                break;
              }
              relocate(position, sample.velocity);
              setPhase(rule, 'riding', { clock: sampleClock, end: saved.end });
            }
            if (stopped) continue;
            const reachedAt = Math.max(at, Math.min(until, until - (wanted - clock)));
            if (reachesSwitch && atEntry(requested, current.position) && admitted(requested, current, reachedAt) &&
                place(requested, reachedAt, requested.start, requested.end, rule)) continue;
            if (clock >= saved.end) {
              const target = V.add(current.position, rule.exit.offset), exit = controller.sweepTo(current, target, world);
              if (exit.blocked || !controller.fits(world, target)) {
                blocked = true;
                emit('blocked', rule, until, { stage: 'exit' });
                continue;
              }
              const velocity = timed ? current.velocity :
                rule.route.vehicle(Math.max(rule.start, saved.end - .00001)).velocity;
              release(rule, reachedAt, 'arrival', velocity, target);
              if (until - reachedAt > epsilon) retain(walk(until - reachedAt));
            }
            continue;
          }
          if (saved?.phase === 'flow') {
            const duration = Math.min(dt, rule.duration - saved.elapsed);
            const direction = V.norm(rule.acceleration), speed = V.dot(current.velocity, direction);
            const gain = Math.max(0, Math.min(V.len(rule.acceleration) * duration, rule.speedLimit - speed));
            const velocity = V.mad(current.velocity, direction, gain);
            const { surfaceAnchor, ...body } = current;
            current = { ...body, velocity, surfaceMomentum: velocity, mode: 'air' };
            const result = walk(duration);
            retain(result);
            if (!inside(current.position, rule.volume) || saved.elapsed + duration >= rule.duration - epsilon)
              release(rule, at + duration, 'flow-end');
            else setPhase(rule, 'flow', { elapsed: saved.elapsed + duration });
            if (duration < dt) retain(walk(dt - duration));
            continue;
          }

          const before = current, result = walk(dt);
          if (detach || attemptedEntry) { retain(result); continue; }
          const candidates = requested ? [requested] : automatic;
          let hit;
          for (const [index, segment] of result.segments.entries()) {
            for (const candidate of candidates) {
              const fraction = crossing(candidate, segment.previous, segment.actor.position);
              if (fraction === null || hit && fraction >= hit.fraction) continue;
              const position = V.mad(segment.previous, V.sub(segment.actor.position, segment.previous), fraction);
              const contact = { ...segment.actor, position };
              if (admitted(candidate, contact, until)) hit = { candidate, segment, index, fraction, contact };
            }
            if (hit) break;
          }
          if (!hit && candidates.length && !result.segments.length) {
            const candidate = candidates.find(rule => admitted(rule, before, until) && !rule.normal && atEntry(rule, before.position));
            if (candidate) enter(candidate, until);
            retain(result);
          } else if (!hit) retain(result);
          else {
            const { candidate, segment, index, contact } = hit;
            current = contact;
            const preceding = result.segments.slice(0, index);
            const partial = { previous: segment.previous, actor: contact };
            const segmentCount = segments.length, eventCount = events.length;
            segments.push(...preceding);
            if (V.dist(contact.position, segment.previous) > epsilon) segments.push(partial);
            enter(candidate, until);
            if (current.traversal?.link !== candidate.id) {
              current = result.actor;
              segments.length = segmentCount;
              retain(result);
            } else {
              const prior = result.events.filter(event => event.position &&
                (touches(partial, event.position) || preceding.some(path => touches(path, event.position))));
              events.splice(eventCount, 0, ...prior);
            }
          }
        }
        const result = controller.step(current, movement, 0, world);
        return freeze({ ...result, actor: state(current), support, segments, events, blocked });
      }
      return Object.freeze({ controller, state, step, withController });
    }
    return withController(controller);
  }

  W.traversalLinks = Object.freeze({ create });
})(KIT);
