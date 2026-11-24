/* Persistent objects and socket attachments that can travel between places. */
(function (K) {
  const W = K.world, { V, M } = K, C = W.colliders;
  const { id, safeKey, record, own, check } = W.data, { clone, freeze } = K.procedural.data;
  const eps = 1e-7, identity = Object.freeze(M.id()), zero = Object.freeze([0, 0, 0]);
  const up = Object.freeze([0, 1, 0]), forward = Object.freeze([0, 0, -1]);
  const vector = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const matrix = m => Array.isArray(m) && m.length === 9 && Array.from(m).every(Number.isFinite);
  const blocked = (reason, detail = {}) => freeze({ status: 'blocked', reason, ...detail });
  const empty = Object.freeze([]);
  function pose(value) {
    if (vector(value)) return { position: value.slice(), rotation: identity };
    const { position, rotation = identity } = value ?? {};
    check(vector(position) && matrix(rotation), 'A carry pose needs XYZ and an optional rigid rotation matrix');
    const columns = M.tr(rotation);
    const [a, b, c] = [columns.slice(0, 3), columns.slice(3, 6), columns.slice(6, 9)];
    check([a, b, c].every(axis => Math.abs(V.len(axis) - 1) < 1e-6) &&
      V.dist(V.cross(a, b), c) < 1e-6, 'A carry rotation needs an orthonormal, right-handed basis');
    return { position: position.slice(), rotation: rotation === identity ? identity : rotation.slice() };
  }
  function carrierPose(actor) {
    if (actor.rotation !== undefined) return pose(actor);
    const { position, up: axis = up, forward: heading = forward } = actor;
    check(vector(axis) && vector(heading) && V.len(axis) > eps && V.len(heading) > eps, 'Invalid carrier orientation');
    return pose({ position, rotation: W.gravity.basis(V.norm(axis), heading) });
  }
  function combine(a, b) {
    return { position: V.add(a.position, M.app(a.rotation, b.position)), rotation: M.mul(a.rotation, b.rotation) };
  }
  function rigid(item, at = item.pose) {
    return { id: item.id, collider: item.collider, position: at.position, rotation: at.rotation };
  }
  function collision(from, to, solids) {
    for (const solid of solids) {
      if (C.contact(to, solid)?.gap < -eps || C.contact(from, solid)?.gap < -eps) return solid.id;
      const hit = C.sweepRotation(from, solid, V.sub(to.position, from.position), to.rotation);
      if (hit && (hit.limited || hit.time < 1 - eps)) return solid.id;
    }
    return null;
  }
  function fitsAperture(body, opening, travel) {
    const { origin, right, up, normal } = opening.from, den = V.dot(travel, normal);
    const x = V.mad(right, normal, -V.dot(right, travel) / den);
    const y = V.mad(up, normal, -V.dot(up, travel) / den);
    return C.geometry(body).parts.every(part => {
      const rx = part.radius * V.len(x), ry = part.radius * V.len(y);
      return part.points.every(point => {
        const relative = V.sub(point, origin);
        const u = (Math.abs(V.dot(relative, x)) + rx) / opening.halfWidth;
        const v = (Math.abs(V.dot(relative, y)) + ry) / opening.halfHeight;
        return opening.shape === 'ellipse' ? Math.hypot(u, v) <= 1 + eps : Math.max(u, v) <= 1 + eps;
      });
    });
  }
  function fromQuery(query, { bodies } = {}) {
    check(typeof query?.probe === 'function' && typeof bodies === 'string', 'Carry queries need a mechanics body field');
    const read = query.probe(bodies);
    check(read.status === 'ok' && record(read.value), 'Carry bodies field needs a body record');
    return Object.freeze({ solids: Object.freeze(Object.values(read.value)) });
  }

  function create({ items = [], socket = (actor, name) => own(actor.sockets, name) ? actor.sockets[name] : undefined } = {}) {
    check(typeof socket === 'function', 'Expected a carry socket resolver');
    let objects = new Map(), revision = 0;
    const byCarrier = new Map();
    function group(place, actor) {
      return (byCarrier.get(actor?.id) ?? empty).filter(item => item.place === place);
    }
    function posed(item, actor) {
      const value = socket(actor, item.held.socket);
      check(value !== undefined, 'Missing carry socket ' + item.held.socket + ' on ' + actor.id);
      return rigid(item, combine(combine(carrierPose(actor), pose(value)), item.held.grip));
    }
    function index() {
      byCarrier.clear();
      for (const item of objects.values()) if (item.held) {
        const list = byCarrier.get(item.held.carrier) ?? [];
        list.push(item);
        byCarrier.set(item.held.carrier, list);
      }
    }
    function itemRecord(raw) {
      check(record(raw) && id(raw.id) && safeKey(raw.place) && record(raw.collider), 'Carry items need a stable ID, place and collider');
      const collider = freeze(clone(raw.collider));
      C.local(collider);
      const common = { id: raw.id, place: raw.place, collider, data: clone(raw.data === undefined ? null : raw.data) };
      if (raw.held === undefined) return loose(common, pose(raw.pose), raw.velocity, raw.angular);
      const { carrier, socket: name, grip } = raw.held ?? {};
      check(id(carrier) && carrier !== raw.id && id(name), 'Invalid held carry item');
      return held(common, carrier, name, pose(grip));
    }
    function loose({ held, ...item }, at, velocity = zero, angular = zero) {
      check(vector(velocity) && vector(angular), 'Loose items need finite linear and angular velocities');
      return freeze({ ...item, pose: at, velocity: velocity.slice(), angular: angular.slice() });
    }
    function held({ pose, velocity, angular, ...item }, carrier, name, grip) {
      return freeze({ ...item, held: { carrier, socket: name, grip } });
    }
    function decode(rows) {
      check(Array.isArray(rows) && rows.length <= 4096, 'Carry state needs a bounded item list');
      const next = new Map(), slots = new Set(), carriers = new Map();
      for (const row of rows) {
        const item = itemRecord(row);
        check(!next.has(item.id), 'Duplicate carry item ' + item.id);
        if (item.held) {
          const { carrier, socket: name } = item.held, key = carrier + '/' + name;
          const prior = carriers.get(carrier), count = (prior?.count ?? 0) + 1;
          check(!slots.has(key) && count <= 32 && (!prior || prior.place === item.place), 'Invalid carry socket claims');
          slots.add(key);
          carriers.set(carrier, { count, place: item.place });
        }
        next.set(item.id, item);
      }
      for (const carrier of carriers.keys()) check(!next.has(carrier), 'A carrier and a carry item need distinct identities');
      return next;
    }
    objects = decode(items);
    index();
    function publish(next, expected = revision) {
      check(revision === expected, 'Carry state changed during an update');
      for (const item of next) objects.set(item.id, item);
      revision++;
      index();
    }
    function itemsAt(place) {
      return Object.freeze([...objects.values()].filter(item => item.place === place));
    }
    function solids(place, world, exclude) {
      check(Array.isArray(world?.solids) && world.solids.length <= 4096, 'Carry clearance needs a bounded list of solids');
      const authored = world.solids.filter(row => {
        const item = objects.get(row?.id);
        return !exclude.has(row?.id) && !exclude.has(row?.entity) && (!item || item.held && item.place === place);
      })
        .map(row => {
          check(safeKey(row?.id) && vector(row.position) && (row.rotation === undefined || matrix(row.rotation)) &&
            (row.collider || vector(row.half) && row.half.every(n => n > 0)), 'Invalid carry world solid');
          return row.rotation === undefined ? { ...row, rotation: identity } : row;
        });
      return authored.concat(itemsAt(place).filter(item => !item.held && !exclude.has(item.id)).map(item => rigid(item)));
    }
    function carrierCheck(actor) {
      check(id(actor?.id) && !objects.has(actor.id) && vector(actor.position), 'Carry needs a distinct carrier ID and pose');
    }
    function track(from, to, item, obstacles, via) {
      check(Array.isArray(via) && via.length <= 12, 'Carry paths support up to twelve waypoints');
      let start = from;
      for (const end of [...Array.from(via, at => rigid(item, pose(at))), to]) {
        const solid = collision(start, end, obstacles);
        if (solid !== null) return solid;
        start = end;
      }
      return null;
    }
    function pickup({ item: key, place, actor, socket: name, grip = zero, reach = 2, world, via = [] } = {}) {
      carrierCheck(actor);
      check(id(name) && Number.isFinite(reach) && reach > 0 && reach <= 32, 'Pickup needs a socket and a bounded reach');
      const item = objects.get(key);
      if (!item || item.place !== place || item.held) return blocked('unavailable-item', { item: key });
      const expected = revision;
      const crew = byCarrier.get(actor.id) ?? empty;
      if (crew.length && crew[0].place !== place) return blocked('carrier-place', { item: key });
      if (crew.some(row => row.held.socket === name) || crew.length >= 32) return blocked('occupied-socket', { item: key });
      const next = held(item, actor.id, name, pose(grip)), body = posed(next, actor);
      if (V.dist(item.pose.position, body.position) > reach) return blocked('out-of-reach', { item: key });
      const scene = solids(place, world, new Set([key, actor.id])).concat(crew.map(row => posed(row, actor)));
      const solid = track(rigid(item), body, item, scene, via);
      if (solid !== null) return blocked('clearance', { item: key, solid });
      publish([next], expected);
      return freeze({ status: 'held', item: next, body });
    }
    function detach({ item: key, place, actor, pose: target, world, via = [], velocity, angular = zero }, thrown) {
      carrierCheck(actor);
      const item = objects.get(key);
      if (!item || item.place !== place || item.held?.carrier !== actor.id) return blocked('unavailable-item', { item: key });
      const expected = revision;
      const from = posed(item, actor), at = thrown ? pose(from) : pose(target), to = rigid(item, at);
      const crew = group(place, actor).filter(row => row !== item);
      const scene = solids(place, world, new Set([key, actor.id])).concat(crew.map(row => posed(row, actor)));
      const solid = track(from, to, item, scene, via);
      if (solid !== null) return blocked('clearance', { item: key, solid });
      const next = loose(item, at, thrown ? V.add(velocity, actor.velocity ?? zero) : zero, angular);
      publish([next], expected);
      return freeze({ status: thrown ? 'thrown' : 'placed', item: next, body: to });
    }
    function place(options = {}) { return detach(options, false); }
    function toss(options = {}) {
      check(vector(options.velocity) && (options.actor?.velocity === undefined || vector(options.actor.velocity)),
        'Throw needs a finite velocity and optional carrier velocity');
      return detach(options, true);
    }
    function updateLoose(key, { pose: at, velocity, angular, data } = {}) {
      const item = objects.get(key);
      check(item && !item.held, 'Loose updates need a loose carry item');
      const next = loose({ ...item, data: data === undefined ? item.data : clone(data) },
        at === undefined ? item.pose : pose(at), velocity ?? item.velocity, angular ?? item.angular);
      publish([next]);
      return next;
    }
    function poses(place, actor) {
      return freeze(group(place, actor).map(item => posed(item, actor)));
    }
    function move({ place, from, to, world } = {}) {
      carrierCheck(from);
      carrierCheck(to);
      check(from.id === to.id, 'A carry move needs the same carrier at both ends');
      const crew = group(place, from);
      if (!crew.length) return freeze({ status: 'ready', items: empty });
      const scene = solids(place, world, new Set([from.id, ...crew.map(row => row.id)]));
      const arrival = crew.map(item => posed(item, to));
      for (const [i, item] of crew.entries()) {
        const solid = collision(posed(item, from), arrival[i], scene);
        if (solid !== null) return blocked('clearance', { item: item.id, solid });
        for (const other of arrival.slice(0, i))
          if (C.contact(arrival[i], other)?.gap < -eps) return blocked('clearance', { item: item.id, solid: other.id });
      }
      return freeze({ status: 'ready', items: arrival });
    }
    function mapActor(source, actor, opening) {
      if (!opening || !group(source, actor).length) return null;
      const basis = carrierPose(actor).rotation, columns = M.tr(basis);
      const mapped = M.tr([0, 3, 6].flatMap(i => opening.direction(columns.slice(i, i + 3))));
      return actor.rotation === undefined ? {
        forward: M.app(mapped, forward), up: M.app(mapped, up)
      } : { rotation: mapped };
    }
    function planTravel({ actor, arrival, link, previous, destination }) {
      const from = link.from.place, to = link.to.place, crew = group(from, actor);
      if (!crew.length) return { status: 'ready', cargo: empty };
      if (arrival.id !== actor.id) return blocked('carrier-identity');
      const expected = revision;
      if (link.sweep) {
        const travel = V.sub(actor.position, previous);
        for (const item of crew) if (!fitsAperture(posed(item, actor), link.sweep, travel))
          return blocked('aperture', { item: item.id });
      }
      const world = typeof destination.carryWorld === 'function' ? destination.carryWorld(arrival, link) : destination.carryWorld;
      if (!world) return blocked('destination-clearance');
      const scene = solids(to, world, new Set([actor.id, ...crew.map(row => row.id)]));
      const cargo = freeze(crew.map(item => posed(item, arrival)));
      for (const [i, body] of cargo.entries()) {
        const solid = collision(body, body, scene.concat(cargo.slice(0, i)));
        if (solid !== null) return blocked('clearance', { item: body.id, solid });
      }
      return { status: 'ready', cargo, commit() {
        check(revision === expected, 'Carry state changed during travel');
        if (from !== to) publish(crew.map(item => freeze({ ...item, place: to })));
      } };
    }
    function checkpoint() { return freeze({ version: 1, items: [...objects.values()] }); }
    function planRestore(saved, validPlace = () => true) {
      check(saved?.version === 1, 'Invalid carry checkpoint');
      const next = decode(saved.items), expected = revision;
      for (const item of next.values()) check(validPlace(item.place), 'Unknown carry checkpoint place ' + item.place);
      return () => {
        check(revision === expected, 'Carry state changed during restore');
        objects = next;
        revision++;
        index();
      };
    }
    function restore(saved) {
      planRestore(saved)();
      return checkpoint();
    }
    return Object.freeze({ item: key => objects.get(key) ?? null, itemsAt, poses, pickup, place, throw: toss, move, updateLoose,
      mapActor, planTravel, planRestore, checkpoint, restore });
  }
  W.carry = Object.freeze({ create, fromQuery });
})(KIT);
