/* Seat occupancy and kinematic traversal for carriers with upright riders. */
(function (K) {
  const W = K.world, { V, M } = K, C = W.colliders;
  const { id, record, vector, check } = W.data, { clone, freeze } = K.procedural.data;
  const up = Object.freeze([0, 1, 0]), forward = Object.freeze([0, 0, -1]), identity = Object.freeze(M.id());
  const slide = Object.freeze({ allowSurfaceSlide: true });
  const eps = 1e-7, finite = Number.isFinite;
  const range = (n, lo, hi) => finite(n) && n >= lo && n <= hi;
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const point = p => Array.isArray(p) && p.length === 3 && Array.from(p).every(finite);
  const bodySize = ({ radius, height } = {}) => range(radius, .03, 4) && range(height, 2 * radius + .05, 12);
  const same = a => a > -eps && a < eps;
  const unavailable = reason => Object.freeze({ status: 'blocked', reason });

  function frame({ position, yaw = 0 } = {}) {
    check(point(position) && range(yaw, -1e6, 1e6), 'A carrier pose needs XYZ and a finite yaw in radians');
    const origin = position.slice(), rotation = M.rot(up, yaw);
    return { position: origin, yaw, rotation, at: p => V.add(origin, M.app(rotation, p)) };
  }
  function capsule(radius, height, center = [0, 0, 0]) {
    const shaft = height * .5 - radius;
    return { kind: 'capsule', radius, a: V.mad(center, up, -shaft), b: V.mad(center, up, shaft) };
  }
  function actorBody(position, collider) {
    return { position, collider, rotation: identity };
  }
  function obstruction(body, solids, delta = [0, 0, 0], turn = 0) {
    let earliest = null;
    const stationary = !turn && !V.len(delta);
    for (const solid of solids) {
      const overlap = C.contact(body, solid);
      if (overlap?.gap < -eps) return { solid: solid.id, part: overlap.parts[0], fraction: 0 };
      if (stationary) continue;
      const hit = turn ? C.sweepYaw(body, solid, delta, turn) : C.sweep(body, solid, delta, slide);
      if (hit && (hit.time < 1 - eps || hit.limited) && (!earliest || hit.time < earliest.fraction)) {
        earliest = { solid: solid.id, part: hit.parts[0], fraction: hit.time, ...(hit.limited && { limited: true }) };
      }
    }
    return earliest;
  }
  function obstacles(world, excluded) {
    check(Array.isArray(world?.solids) && world.solids.length <= 4096, 'Boarding needs a bounded list of world solids');
    return world.solids
      .filter(solid => !excluded.has(solid?.id) && !excluded.has(solid?.entity))
      .map(solid => {
        check(id(solid?.id) && point(solid.position) && (solid.rotation === undefined || vector(solid.rotation, 9)) &&
          (solid.collider || point(solid.half) && solid.half.every(n => n > 0)), 'Invalid boarding world solid');
        return solid.rotation === undefined ? { ...solid, rotation: identity } : solid;
      });
  }
  function transferClear(from, to, collider, solids) {
    const clear = (a, b) => !obstruction(actorBody(a, collider), solids, V.sub(b, a)) &&
      !obstruction(actorBody(b, collider), solids);
    if (clear(from, to)) return true;
    const height = Math.max(from[1], to[1]);
    const highFrom = [from[0], height, from[2]], highTo = [to[0], height, to[2]];
    return clear(from, highFrom) && clear(highFrom, highTo) && clear(highTo, to);
  }
  function fromQuery(query, { bodies, support, allowSupport } = {}) {
    check(typeof query?.probe === 'function' && typeof bodies === 'string' && typeof support === 'string' &&
      (allowSupport === undefined || typeof allowSupport === 'function'), 'Boarding needs body and support fields');
    const read = query.probe(bodies);
    check(read.status === 'ok' && record(read.value), 'Boarding bodies field needs a body record');
    return Object.freeze({
      solids: Object.freeze(Object.values(read.value)),
      ...(allowSupport && { allowSupport }),
      supports(x, z, low, high) {
        const hit = query.probe(support, [x, (low + high) * .5, z], { low, high });
        return hit.status === 'ok' ? hit.value : [];
      }
    });
  }

  function create({ carriers } = {}) {
    check(record(carriers) && Object.keys(carriers).length <= 256, 'Boarding needs a bounded carrier catalog');
    const specs = new Map();
    for (const [carrier, source] of Object.entries(carriers)) {
      check(id(carrier) && record(source) && record(source.seats), 'Invalid boarding carrier ' + carrier);
      const collider = freeze(clone(source.collider)), hull = collider.kind === 'compound' ? collider.parts : [collider];
      C.local(collider);
      const seats = new Map();
      check(Object.keys(source.seats).length > 0 && hull.length + Object.keys(source.seats).length <= 12,
        'A carrier needs seats and at most twelve combined collider parts');
      for (const [key, seat] of Object.entries(source.seats)) {
        check(id(key) && record(seat), 'Invalid carrier seat ' + carrier + '/' + key);
        const { at, exits, reach = 2.5, rise = .35, drop = .6, maxRadius = 4, maxHeight = 12 } = seat;
        check(point(at) && at.every(n => Math.abs(n) <= 9990) && Array.isArray(exits) &&
          exits.length > 0 && exits.length <= 12 && Array.from(exits).every(point) &&
          range(reach, .05, 32) && range(rise, 0, 4) && range(drop, 0, 16) &&
          range(maxRadius, .03, 4) && range(maxHeight, .11, 12), 'Invalid carrier seat ' + carrier + '/' + key);
        seats.set(key, freeze(clone({ at, exits, reach, rise, drop, maxRadius, maxHeight })));
      }
      specs.set(carrier, { collider, hull, seats });
    }
    let riders = new Map(), occupied = new Map(), colliders = new Map(), updating = false;
    const reference = (carrier, seat) => carrier + '/' + seat;
    const accepts = (seat, actor) => actor.radius <= seat.maxRadius && actor.height <= seat.maxHeight;
    function requireCarrier(carrier) {
      const spec = specs.get(carrier);
      check(spec, 'Unknown carrier ' + carrier);
      return spec;
    }
    function guard() { check(!updating, 'Boarding state is already being updated'); }
    function withUpdate(run) {
      guard();
      updating = true;
      try { return run(); }
      finally { updating = false; }
    }
    function members(carrier) {
      return [...requireCarrier(carrier).seats.keys()].flatMap(seat => {
        const row = occupied.get(reference(carrier, seat));
        return row ? [row] : [];
      });
    }
    function riderPose(row, carrierFrame) {
      const { seats } = requireCarrier(row.carrier);
      return { position: carrierFrame.at(seats.get(row.seat).at), up, forward: M.app(carrierFrame.rotation, forward) };
    }
    function poses(carrier, pose) {
      const carrierFrame = frame(pose);
      return freeze(members(carrier).map(row => ({ ...row, pose: riderPose(row, carrierFrame) })));
    }
    function hullBody(carrier, carrierFrame) {
      return { id: carrier, position: carrierFrame.position, rotation: carrierFrame.rotation,
        collider: requireCarrier(carrier).collider };
    }
    function compound(carrier, carrierFrame, members) {
      let collider = colliders.get(carrier);
      if (!collider) {
        const { hull, seats } = requireCarrier(carrier);
        collider = members.length ? freeze({ kind: 'compound', parts: [...hull,
          ...members.map(row => capsule(row.radius, row.height, seats.get(row.seat).at))] }) : requireCarrier(carrier).collider;
        colliders.set(carrier, collider);
      }
      return { id: carrier, position: carrierFrame.position, rotation: carrierFrame.rotation, collider };
    }
    function body(carrier, pose) { return freeze(compound(carrier, frame(pose), members(carrier))); }
    function transferSolids(carrier, rider, carrierFrame, world) {
      const crew = members(carrier), excluded = new Set([carrier, rider, ...crew.map(row => row.rider)]);
      return [...obstacles(world, excluded), hullBody(carrier, carrierFrame),
        ...crew.filter(row => row.rider !== rider).map(row =>
          ({ id: row.rider, ...actorBody(riderPose(row, carrierFrame).position, capsule(row.radius, row.height)) }))];
    }
    function seatStatus(carrier, seat, actor) {
      const socket = specs.get(carrier)?.seats.get(seat);
      if (!socket) return 'unknown-seat';
      if (occupied.has(reference(carrier, seat))) return 'occupied';
      if (!accepts(socket, actor)) return 'body-size';
      return null;
    }
    function vacate(row) {
      riders.delete(row.rider);
      occupied.delete(reference(row.carrier, row.seat));
      colliders.delete(row.carrier);
    }
    function release(rider) {
      guard();
      const row = riders.get(rider);
      if (!row) return false;
      vacate(row);
      return true;
    }
    function board({ carrier, seat, actor, pose, world } = {}) {
      return withUpdate(() => {
        check(id(actor?.id) && point(actor.position) && bodySize(actor), 'A rider needs an ID, XYZ center and capsule dimensions');
        if (specs.has(actor.id)) return unavailable('rider-is-carrier');
        if (riders.has(actor.id)) return unavailable('already-boarded');
        const blocked = seatStatus(carrier, seat, actor);
        if (blocked) return unavailable(blocked);
        const carrierFrame = frame(pose), socket = specs.get(carrier).seats.get(seat);
        const row = Object.freeze({ rider: actor.id, carrier, seat, radius: actor.radius, height: actor.height });
        const arrival = riderPose(row, carrierFrame);
        if (V.dist(actor.position, arrival.position) > socket.reach) return unavailable('out-of-reach');
        const solids = transferSolids(carrier, actor.id, carrierFrame, world);
        if (!transferClear(actor.position, arrival.position, capsule(actor.radius, actor.height), solids))
          return unavailable('boarding-obstructed');
        riders.set(row.rider, row);
        occupied.set(reference(carrier, seat), row);
        colliders.delete(carrier);
        return freeze({ status: 'boarded', ...row, pose: arrival });
      });
    }
    function dismount({ rider, pose, world } = {}) {
      return withUpdate(() => {
        const row = riders.get(rider);
        if (!row) return unavailable('not-boarded');
        const { carrier, seat, radius, height } = row, carrierFrame = frame(pose);
        const socket = specs.get(carrier).seats.get(seat), seated = riderPose(row, carrierFrame);
        check(typeof world?.supports === 'function' &&
          (world.allowSupport === undefined || typeof world.allowSupport === 'function'), 'Dismount needs a ground support query');
        const solids = transferSolids(carrier, rider, carrierFrame, world), collider = capsule(radius, height);
        const ground = K.procedural.traversal.create({
          radius, height, stepUp: 0, stepDown: socket.drop,
          supports(x, z, low, high) {
            const rows = world.supports(x, z, low, high);
            return world.allowSupport ? rows.filter(support => world.allowSupport(support, { rider, point: [x, support.y, z] })) : rows;
          },
          clearance: position => solids.reduce((best, solid) => Math.min(best, C.distance(solid, position)), Infinity)
        });
        for (const at of socket.exits) {
          const support = ground.stand(carrierFrame.at(at), { rise: socket.rise, drop: socket.drop });
          if (!support) continue;
          const position = V.mad(support.foot, up, height * .5);
          if (!transferClear(seated.position, position, collider, solids)) continue;
          const arrival = freeze({ status: 'dismounted', ...row, support: clone(support),
            pose: { ...seated, position, velocity: [0, 0, 0], mode: 'ground' } });
          vacate(row);
          return arrival;
        }
        return unavailable('no-safe-exit');
      });
    }
    function move({ carrier, from, to, world } = {}) {
      const crew = members(carrier), start = frame(from), end = frame(to);
      const solids = obstacles(world, new Set([carrier, ...crew.map(row => row.rider)]));
      const delta = V.sub(end.position, start.position);
      const change = end.yaw - start.yaw, turn = Math.atan2(Math.sin(change), Math.cos(change));
      const hit = obstruction(compound(carrier, start, crew), solids, delta, same(turn) ? 0 : turn) ??
        obstruction(compound(carrier, end, crew), solids);
      const next = hit ? start : end, hullParts = specs.get(carrier).hull.length;
      return freeze({ status: hit ? 'blocked' : 'ready', pose: { position: next.position, yaw: next.yaw },
        occupants: crew.map(row => ({ ...row, pose: riderPose(row, next) })),
        ...(hit && { obstacle: { ...hit, rider: crew[hit.part - hullParts]?.rider ?? null } }) });
    }

    function checkpoint() {
      return freeze({ version: 1, riders: [...riders.values()].sort((a, b) => order(a.rider, b.rider)) });
    }
    function restore(saved) {
      guard();
      check(saved?.version === 1 && Array.isArray(saved.riders) && saved.riders.length <= 2816, 'Invalid boarding checkpoint');
      const nextRiders = new Map(), nextOccupied = new Map();
      for (const row of saved.riders) {
        const seat = specs.get(row?.carrier)?.seats.get(row?.seat), key = reference(row?.carrier, row?.seat);
        check(seat && id(row?.rider) && !specs.has(row.rider) && bodySize(row) && accepts(seat, row) &&
          !nextRiders.has(row.rider) && !nextOccupied.has(key), 'Invalid or competing saved rider');
        const { rider, carrier, radius, height } = row;
        const next = Object.freeze({ rider, carrier, seat: row.seat, radius, height });
        nextRiders.set(rider, next);
        nextOccupied.set(key, next);
      }
      riders = nextRiders;
      occupied = nextOccupied;
      colliders = new Map();
      return checkpoint();
    }

    function plan({ actor, to, walkSpeed, walk, offers = [], minimumSavings = .25 } = {}) {
      check(id(actor?.id) && point(actor.position) && bodySize(actor) && point(to) && finite(walkSpeed) &&
        walkSpeed > 0 && typeof walk === 'function' && Array.isArray(offers) && offers.length <= 32 &&
        finite(minimumSavings) && minimumSavings >= 0, 'Invalid boarding route comparison');
      return withUpdate(() => {
        function leg(from, goal) {
          const path = walk(from.slice(), goal.slice());
          if (path?.status !== 'ok') return null;
          const { points } = path;
          check(Array.isArray(points) && points.length > 0 && points.length <= 4096 &&
            Array.from(points).every(point), 'A reachable route needs finite waypoints');
          const length = path.length ?? points.slice(1).reduce((n, p, i) => n + V.dist(p, points[i]), 0);
          check(finite(length) && length >= 0 && finite(length / walkSpeed), 'Route length is out of range');
          return { points: points.map(p => p.slice()), seconds: length / walkSpeed };
        }
        const direct = leg(actor.position, to), rejected = [], candidates = [], seen = new Set();
        for (const offer of offers) {
          const { id: key, carrier, seat, boardAt, leaveAt, rideSeconds, waitSeconds = 0,
            boardSeconds = .75, leaveSeconds = .5 } = offer ?? {};
          check(id(key) && !seen.has(key) && point(boardAt) && point(leaveAt) &&
            [waitSeconds, boardSeconds, leaveSeconds].every(n => range(n, 0, 1e9)) &&
            (rideSeconds === null || range(rideSeconds, 0, 1e9)), 'Invalid carrier route offer');
          seen.add(key);
          const blocked = specs.has(actor.id) ? 'rider-is-carrier' : riders.has(actor.id) ? 'already-boarded' :
            seatStatus(carrier, seat, actor);
          if (blocked || rideSeconds === null) {
            rejected.push({ id: key, reason: blocked ?? 'ride-unreachable' });
            continue;
          }
          const approach = leg(actor.position, boardAt), onward = approach && leg(leaveAt, to);
          if (!approach || !onward) {
            rejected.push({ id: key, reason: approach ? 'onward-unreachable' : 'approach-unreachable' });
            continue;
          }
          const seconds = approach.seconds + waitSeconds + boardSeconds + rideSeconds + leaveSeconds + onward.seconds;
          check(finite(seconds), 'Carrier travel time is out of range');
          candidates.push({ type: 'board', id: key, carrier, seat, approach, onward, waitSeconds, boardSeconds,
            rideSeconds, leaveSeconds, seconds, savings: direct ? direct.seconds - seconds : null });
        }
        candidates.sort((a, b) => a.seconds - b.seconds || order(a.id, b.id));
        const best = candidates[0], walkChoice = direct && { type: 'walk', ...direct };
        const choice = best && (!direct || best.seconds < direct.seconds && best.savings >= minimumSavings) ? best : walkChoice;
        return freeze({ choice, walking: walkChoice, candidates, rejected });
      });
    }
    return Object.freeze({ board, dismount, release, move, poses, body, plan, checkpoint, restore });
  }
  W.boarding = Object.freeze({ create, fromQuery });
})(KIT);
