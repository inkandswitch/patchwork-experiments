/* Named places, local simulation clocks and directed travel links. */
(function (K) {
  const W = K.world, V = K.V, { freeze, clone } = K.procedural.data;
  const finite = Number.isFinite;
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(finite);
  const positive = value => finite(value) && value > 0;
  const name = value => typeof value === 'string' && value.trim().length > 0;
  const point = value => {
    if (!xyz(value)) throw new TypeError('Expected finite XYZ coordinates');
    return value.slice();
  };
  function synchronous(value, label) {
    if (typeof value?.then === 'function') {
      Promise.resolve(value).catch(() => {});
      throw new TypeError(label + ' must be synchronous');
    }
    return value;
  }

  function anchor({ origin, normal = [0, 0, 1], up = [0, 1, 0] } = {}) {
    const n = V.norm(point(normal), [0, 0, 0]), right = V.norm(V.cross(point(up), n), [0, 0, 0]);
    if (V.len(n) < 0.99 || V.len(right) < 0.99)
      throw new RangeError('Portal anchor axes must be nonzero and independent');
    return freeze({ origin: point(origin), normal: n, right, up: V.cross(n, right) });
  }

  function doorway({ from, to, halfWidth, halfHeight, shape = 'rect' } = {}) {
    if (!positive(halfWidth) || !positive(halfHeight) || !['rect', 'ellipse'].includes(shape))
      throw new RangeError('A doorway needs positive half extents and a rectangular or elliptical aperture');
    const a = anchor(from), b = anchor(to);
    const project = (p, basis) => [V.dot(p, basis.right), V.dot(p, basis.up), V.dot(p, basis.normal)];
    const direction = value => {
      const [x, y, z] = project(point(value), a);
      return V.mad(V.mad(V.mul(b.right, -x), b.up, y), b.normal, -z);
    };
    const transformPoint = value => V.add(b.origin, direction(V.sub(point(value), a.origin)));
    function mapCamera(camera) {
      if (camera == null) return null;
      return freeze({ ...clone(camera), eye: transformPoint(camera.eye), right: direction(camera.right),
        up: direction(camera.up), back: direction(camera.back),
        ...(camera.target === undefined ? {} : { target: transformPoint(camera.target) }) });
    }
    function hit(previous, next, { radius = 0 } = {}) {
      if (!finite(radius) || radius < 0) throw new RangeError('Crossing radius must be nonnegative');
      const p = V.sub(point(previous), a.origin), q = V.sub(point(next), a.origin);
      const z0 = V.dot(p, a.normal), z1 = V.dot(q, a.normal);
      if (z0 < 0 || z1 >= 0 || radius >= Math.min(halfWidth, halfHeight)) return null;
      const fraction = z0 / (z0 - z1), at = V.mad(p, V.sub(q, p), fraction);
      const x = V.dot(at, a.right), y = V.dot(at, a.up);
      const fits = shape === 'ellipse' ?
        Math.hypot(x / halfWidth, y / halfHeight) + radius / Math.min(halfWidth, halfHeight) <= 1 :
        Math.abs(x) + radius <= halfWidth && Math.abs(y) + radius <= halfHeight;
      if (!fits) return null;
      return freeze({ fraction, point: V.add(a.origin, at) });
    }
    return Object.freeze({ from: a, to: b, halfWidth, halfHeight, shape,
      point: transformPoint, direction, camera: mapCamera, hit });
  }

  function unique(rows, kind) {
    if (!Array.isArray(rows) || rows.length > 4096) throw new TypeError('Expected a bounded list of ' + kind);
    const result = new Map();
    for (const row of rows) {
      if (!name(row?.id) || result.has(row.id)) throw new TypeError(kind + ' need unique IDs');
      result.set(row.id, row);
    }
    return result;
  }

  function create({ places, links = [], templates = [], saved = {}, carry, lifecycle: manageEntities = false } = {}) {
    if (carry !== undefined && !['mapActor', 'planTravel', 'checkpoint', 'planRestore'].every(key =>
      typeof carry?.[key] === 'function')) throw new TypeError('Expected a carry registry');
    if (typeof manageEntities !== 'boolean') throw new TypeError('Place lifecycle must be true or false');
    const catalog = unique(places, 'Places'), graph = unique(links, 'Links');
    const recipes = unique(templates, 'Place templates');
    const exits = new Map(), away = new Map(), observers = new Set();
    let instances = new Map(), entrances = new Map(), visits = new Map();
    const noLinks = Object.freeze([]);
    let memory = savedStates(saved), clocks = new Map();
    let active = null, pending = null, restoring = null, stepping = false, handoff = false;
    let walking = false, fading = null, disposed = false;
    function authored(asset) {
      const rows = synchronous(asset?.authoredEntities?.(), 'Authored entity readers') ?? {};
      if (!W.data.record(rows)) throw new TypeError('Authored entities need a keyed record');
      return rows;
    }
    const entities = manageEntities && W.entityLifecycle.create({
      guard, known: id => catalog.has(id),
      authored: id => authored(active?.id === id ? active.asset : away.get(id) ??
        (pending?.place.id === id ? pending.asset : null))
    });
    function lifecycleContext(id, staged) {
      const view = () => staged?.() ?? entities.view;
      return Object.freeze({
        scene: () => view().scene(id),
        get(key) { const group = view().get(key); return group?.place === id ? group : null; },
        assert: rows => view().assertPlace(id, rows)
      });
    }
    function savedStates(value) {
      if (!W.data.record(value)) throw new TypeError('Saved place state needs a JSON record keyed by place ID');
      return new Map(Object.entries(freeze(clone(value))));
    }
    function definition(id, row) {
      const tickPolicy = row.tickPolicy ?? 'pause';
      if (!W.data.safeKey(id) || typeof row.prepare !== 'function' || !['pause', 'continue'].includes(tickPolicy))
        throw new TypeError('Each place needs a stable ID, a prepare callback and a pause or continue tick policy');
      const anchors = freeze(Object.fromEntries(Object.entries(row.anchors ?? {}).map(([key, value]) => [key, anchor(value)])));
      return { id, anchors, prepare: row.prepare, tickPolicy };
    }
    for (const [id, row] of catalog) catalog.set(id, definition(id, row));
    for (const [id, row] of recipes) recipes.set(id, definition(id, row));
    function endpoint(value, places = catalog) {
      const place = places.get(value?.place), key = value?.anchor;
      const at = typeof key === 'string' && W.data.own(place?.anchors, key) && place.anchors[key];
      if (!at) throw new TypeError('Travel endpoints need a declared place and anchor');
      return Object.freeze({ place: place.id, anchor: value.anchor, at });
    }
    function makeLink(id, row, from, to, entrance) {
      const mode = row.mode ?? 'walk';
      const radius = row.radius ?? 1, height = row.height ?? 0.7, duration = row.duration ?? 0.8;
      if (!['walk', 'fade', 'drop'].includes(mode) || !positive(radius) || !positive(height) || !positive(duration) ||
          row.open !== undefined && typeof row.open !== 'function')
        throw new TypeError('Invalid travel mode, gate or trigger controls');
      if (row.transfer !== undefined && typeof row.transfer !== 'function')
        throw new TypeError('Link transfer must be a callback');
      const opening = mode === 'walk' ? doorway({ ...row.aperture, from: from.at, to: to.at }) : null;
      const sweep = mode === 'drop' ? doorway({ halfWidth: radius, halfHeight: radius, shape: 'ellipse',
        ...row.aperture, from: from.at, to: to.at }) : opening;
      const requires = row.requires === undefined ? undefined : freeze(clone(row.requires));
      W.query.condition(requires, {});
      return Object.freeze({ id, from, to, mode, opening, sweep, radius, height, duration,
        open: row.open, requires, transfer: row.transfer, ...(entrance === undefined ? {} : { entrance }) });
    }
    function attach(link) {
      graph.set(link.id, link);
      exits.set(link.from.place, Object.freeze([...(exits.get(link.from.place) ?? noLinks), link]));
    }
    function detach(link) {
      graph.delete(link.id);
      const remaining = exits.get(link.from.place).filter(other => other !== link);
      if (remaining.length) exits.set(link.from.place, Object.freeze(remaining));
      else exits.delete(link.from.place);
    }
    for (const [id, row] of graph) {
      const link = makeLink(id, row, endpoint(row.from), endpoint(row.to));
      graph.set(id, link);
      if (!exits.has(link.from.place)) exits.set(link.from.place, []);
      exits.get(link.from.place).push(link);
    }
    for (const outgoing of exits.values()) Object.freeze(outgoing);

    function addInstance({ id, template, seed, params = {} } = {}, places = catalog, known = instances) {
      const recipe = recipes.get(template);
      if (!W.data.id(id) || !recipe || !Number.isSafeInteger(seed) || !W.data.record(params))
        throw new TypeError('A place instance needs an ID, a declared template, an integer seed and JSON parameters');
      const spec = freeze(clone({ id, template, seed, params }));
      if (known.has(id) && W.data.equal(known.get(id), spec)) return known.get(id);
      if (places.has(id)) throw new RangeError('Place ID is already in use: ' + id);
      if (places.size >= 4096) throw new RangeError('Place limit reached');
      places.set(id, { ...recipe, id, prepare: context => recipe.prepare({ ...context, instance: spec }) });
      known.set(id, spec);
      return spec;
    }
    function registerInstance(spec) {
      guard();
      return addInstance(spec);
    }
    function makeEntrance({ id, source, to, at, aperture, returnTo, open, entered }, places, known) {
      if (!W.data.id(id) || !places.has(source) || source === to?.place || !known.has(to?.place) ||
          typeof open !== 'boolean' || typeof entered !== 'boolean' || !open && !entered)
        throw new TypeError('A portable entrance needs an ID, a source and a distinct place instance');
      const from = Object.freeze({ place: source, anchor: null, at: anchor(at) });
      const target = endpoint(to, places);
      const pose = freeze({ position: point(returnTo?.position),
        ...(returnTo.forward === undefined ? {} : { forward: point(returnTo.forward) }),
        ...(returnTo.up === undefined ? {} : { up: point(returnTo.up) }) });
      const landing = Object.freeze({ ...from, at: freeze({ ...from.at, origin: pose.position }) });
      const inId = 'portable:' + id + ':in', outId = 'portable:' + id + ':out';
      if (graph.has(inId) || graph.has(outId)) throw new RangeError('Portable link ID is already in use: ' + id);
      const entry = makeLink(inId, {
        aperture, open: () => !visits.has(target.place)
      }, from, target, id);
      const exit = makeLink(outId, {
        aperture, transfer: ({ arrival }) => arrival.velocity ? { ...arrival, ...pose, velocity: [0, 0, 0] } : { ...arrival, ...pose }
      }, target, landing, id);
      const args = freeze({ id, source, to: { place: target.place, anchor: target.anchor },
        at: { origin: point(at.origin), normal: point(at.normal ?? [0, 0, 1]), up: point(at.up ?? [0, 1, 0]) },
        aperture: { halfWidth: entry.opening.halfWidth, halfHeight: entry.opening.halfHeight,
          shape: entry.opening.shape }, returnTo: pose });
      return { args, entry, exit, open, entered };
    }
    function installEntrance(row) {
      if (row.open) attach(row.entry);
      if (row.entered) attach(row.exit);
    }
    function openEntrance({ id, to, at, aperture, returnTo } = {}) {
      guard();
      if (!active || walking || fading) throw new Error('Opening an entrance needs a settled active place');
      if (entrances.has(id)) throw new RangeError('Entrance ID is already in use: ' + id);
      if (entrances.size >= 4096) throw new RangeError('Portable entrance limit reached');
      const basis = anchor(at);
      const row = makeEntrance({ id, source: active.id, to, at, aperture,
        returnTo: returnTo ?? { position: basis.origin, forward: basis.normal, up: basis.up },
        open: true, entered: false }, catalog, instances);
      entrances.set(id, row);
      installEntrance(row);
      return row.entry;
    }
    function closeEntrance(id) {
      guard();
      const row = entrances.get(id);
      if (!row?.open) return false;
      row.open = false;
      detach(row.entry);
      if (!row.entered) entrances.delete(id);
      if (pending?.link === row.entry) cancel();
      return true;
    }
    function commitEntrance(link) {
      if (link.entrance === undefined) return;
      const row = entrances.get(link.entrance), destination = row.entry.to.place;
      if (link === row.entry) {
        row.entered = true;
        visits.set(destination, row);
        attach(row.exit);
      } else {
        row.entered = false;
        visits.delete(destination);
        detach(row.exit);
        if (!row.open) entrances.delete(link.entrance);
      }
    }

    const timeOf = id => clocks.get(id) ?? 0;
    function stateOf(id, asset) {
      const current = asset.checkpoint?.();
      return current === undefined ? memory.get(id) : current;
    }
    function guard() {
      if (disposed) throw new Error('The place session has been disposed');
      if (restoring || stepping || handoff) throw new Error('Place state is already being updated');
    }
    function permits(link, actor) {
      if (link.requires !== undefined && !W.query.condition(link.requires, {
        actor, get state() { return stateOf(active.id, active.asset); }, time: timeOf(active.id)
      })) return false;
      return !link.open || Boolean(link.open({ active, actor, link }));
    }
    function linked(id) {
      const link = graph.get(id);
      if (!link || link.from.place !== active?.id) throw new RangeError('This link does not start in the active place');
      return link;
    }
    const release = asset => {
      if (typeof asset?.dispose !== 'function' || asset === active?.asset) return;
      for (const resident of away.values()) if (resident === asset) return;
      asset.dispose();
    };
    function cancel() {
      const job = pending;
      pending = null;
      if (!job) return;
      job.controller.abort();
      release(job.asset);
    }
    function validateAsset(asset) {
      if (!asset || typeof asset !== 'object')
        throw new TypeError('Place preparation must return a payload');
      for (const method of ['step', 'checkpoint', 'prepareArrival', 'canArrive', 'dispose', 'authoredEntities']) {
        if (asset[method] !== undefined && typeof asset[method] !== 'function')
          throw new TypeError('Place payload ' + method + ' must be a callback');
      }
      return asset;
    }
    function request(place, at, link, reason) {
      cancel();
      const from = active, controller = new AbortController(), job = { from, controller, place, link, asset: null };
      pending = job;
      job.done = Promise.resolve().then(async () => {
        if (controller.signal.aborted) return null;
        const previous = from?.id === place.id ? from.asset : away.get(place.id);
        job.borrowed = previous;
        const context = { id: place.id, anchor: at, state: memory.get(place.id), previous: previous ?? null,
          time: timeOf(place.id), signal: controller.signal, reason, link,
          ...(entities && { lifecycle: lifecycleContext(place.id) }) };
        if (previous && place.tickPolicy === 'continue') {
          if (previous.prepareArrival) {
            context.state = stateOf(place.id, previous);
            await previous.prepareArrival(context);
          }
          return previous;
        }
        if (previous) context.state = stateOf(place.id, previous);
        return place.prepare(context);
      }).then(asset => {
        if (pending !== job) {
          if (asset !== job.borrowed) release(asset);
          return null;
        }
        try {
          validateAsset(asset);
          if (entities) entities.view.assertPlace(place.id, authored(asset));
          job.asset = asset;
        }
        catch (error) { release(asset); throw error; }
        return asset;
      }).catch(error => {
        if (pending !== job) return null;
        pending = null;
        throw error;
      });
      return job;
    }
    function encounter(link, { actor, previous, radius } = {}) {
      if (!actor) return { status: 'outside' };
      if (!permits(link, actor)) return { status: 'locked' };
      if (link.sweep) {
        const crossing = previous == null ? null : link.sweep.hit(previous, actor.position, { radius });
        return crossing ? { crossing } : { status: 'outside' };
      }
      const delta = V.sub(point(actor.position), link.from.at.origin);
      return Math.hypot(delta[0], delta[2]) <= link.radius && Math.abs(delta[1]) <= link.height
        ? { crossing: null } : { status: 'outside' };
    }
    function shiftCamera(camera, delta) {
      return freeze({ ...camera, eye: V.add(point(camera.eye), delta),
        ...(camera.target == null ? {} : { target: V.add(point(camera.target), delta) }) });
    }
    function evaluateArrival(job, actor, camera, crossing, previous) {
      const link = job.link;
      const opening = link.opening, drop = link.mode === 'drop', at = link.to.at;
      let arrival = freeze({ ...actor,
        position: opening ? opening.point(actor.position) : at.origin.slice(),
        ...(actor.velocity ? { velocity: opening ? opening.direction(actor.velocity) : drop ? point(actor.velocity) : [0, 0, 0] } : {}),
        ...(actor.forward && opening ? { forward: opening.direction(actor.forward) } : {}),
        ...(actor.up && opening ? { up: opening.direction(actor.up) } : {}),
        ...carry?.mapActor(link.from.place, actor, opening),
        ...entities?.mapActor?.(actor, opening)
      });
      let mappedCamera = opening?.camera(camera) ?? null;
      if (drop && camera) mappedCamera = shiftCamera(camera, V.sub(arrival.position, actor.position));
      if (link.transfer) {
        const next = synchronous(link.transfer(Object.freeze({
          actor, arrival, link, crossing, source: job.from, destination: job.asset
        })), 'Link transfer');
        if (!W.data.record(next) || !xyz(next.position)) throw new TypeError('Link transfer must return an actor with a finite position');
        if (mappedCamera) mappedCamera = shiftCamera(mappedCamera, V.sub(next.position, arrival.position));
        arrival = freeze(clone(next));
      }
      const clear = !job.asset.canArrive || synchronous(job.asset.canArrive(arrival, link), 'Arrival clearance');
      const result = { status: clear ? 'ready' : 'blocked', link, actor: arrival, camera: mappedCamera, crossing };
      if (!clear) return result;
      if (entities && actor.entityHandle !== undefined) {
        const plan = entities.planTravel({ actor, arrival, link, authored: authored(job.asset) });
        if (plan.status !== 'ready') return { ...result, status: 'blocked', entityBlocker: plan };
        result.entity = plan.entity;
        result.commitEntity = plan.commit;
      }
      if (!carry) return result;
      const plan = carry.planTravel({ actor, arrival, link, crossing, previous, destination: job.asset });
      return plan.status === 'ready' ? { ...result, cargo: plan.cargo, commitCarry: plan.commit }
        : { ...result, status: 'blocked', cargoBlocker: plan };
    }
    function checkArrival(id, options) {
      guard();
      const link = linked(id), job = pending?.link === link ? pending : null;
      handoff = true;
      try {
        const contact = options === undefined ? null : encounter(link, options);
        const status = contact?.status ?? (job?.asset ? 'prepared' : job ? 'loading' : 'unprepared');
        if (!contact || status !== 'prepared') return Object.freeze({ status, link });
        const { commitCarry, commitEntity, ...result } = evaluateArrival(job, freeze(clone(options.actor)),
          options.camera == null ? null : clone(options.camera), contact.crossing, options.previous);
        return Object.freeze(result);
      } finally {
        handoff = false;
      }
    }
    function activate(job, actor, camera, crossing, previous) {
      if (pending !== job || job.from !== active || !job.asset) return null;
      handoff = true;
      try {
        const link = job.link;
        let arrival = { link, actor: null, camera: null, crossing: null };
        let moveCargo, moveEntity;
        if (link) {
          if (!permits(link, actor)) return null;
          const { status, commitCarry, commitEntity, ...candidate } = evaluateArrival(job, actor, camera, crossing, previous);
          if (status !== 'ready') return null;
          moveCargo = commitCarry;
          moveEntity = commitEntity;
          arrival = candidate;
        }
        const source = active, state = source?.asset.checkpoint?.();
        const savedSource = state === undefined ? undefined : freeze(clone(state));
        moveCargo?.();
        moveEntity?.();
        if (state !== undefined) memory.set(source.id, savedSource);
        away.delete(job.place.id);
        if (source && source.id !== job.place.id && catalog.get(source.id).tickPolicy === 'continue')
          away.set(source.id, source.asset);
        active = Object.freeze({ id: job.place.id, asset: job.asset });
        pending = null;
        if (!link) {
          release(source?.asset);
          return Object.freeze({ ...arrival, place: active });
        }
        commitEntrance(link);
        const sourceDisposition = source.asset === active.asset ? 'reused' : away.has(source.id) ? 'retained' : 'released';
        const event = Object.freeze({ ...arrival, place: active, source, sourceDisposition });
        const errors = [];
        for (const observer of [...observers]) {
          try { synchronous(observer(event), 'Crossing listeners'); }
          catch (error) { errors.push(error); }
        }
        try { release(source.asset); }
        catch (error) { errors.push(error); }
        return errors.length ? Object.freeze({ ...event, errors: Object.freeze(errors) }) : event;
      } finally {
        handoff = false;
      }
    }
    function onCross(listener) {
      guard();
      if (typeof listener !== 'function') throw new TypeError('A crossing listener must be a callback');
      observers.add(listener);
      return () => observers.delete(listener);
    }
    function cancelPreparation(id = pending?.link?.id) {
      guard();
      if (!pending?.link || pending.link.id !== id || walking || fading) return false;
      cancel();
      return true;
    }

    async function enter(id, at) {
      guard();
      if (walking || fading) throw new Error('Travel is already in progress');
      const place = catalog.get(id);
      const target = typeof at === 'string' && W.data.own(place?.anchors, at) ? place.anchors[at] : null;
      if (!place || at !== undefined && !target) throw new RangeError('Unknown place or arrival anchor');
      const job = request(place, target, null, 'enter');
      if (!await job.done) return null;
      return activate(job, null, null, null)?.place ?? null;
    }
    function prepare(id) {
      guard();
      const link = linked(id);
      if (pending?.link === link) return pending.done;
      if (walking || fading) throw new Error('Travel is already in progress');
      return request(catalog.get(link.to.place), link.to.at, link, 'preview').done;
    }
    function approach(position, { distance = 8, actor } = {}) {
      guard();
      point(position);
      if (!positive(distance)) throw new RangeError('Preview distance must be positive');
      if (walking || fading) return null;
      let best = null, nearest = distance;
      for (const link of exits.get(active?.id) ?? []) {
        if (!link.opening || !permits(link, actor)) continue;
        const delta = V.sub(position, link.from.at.origin), d = V.len(delta);
        if (V.dot(delta, link.from.at.normal) >= 0 && (d < nearest || d === nearest && best && link.id < best.id)) {
          nearest = d;
          best = link;
        }
      }
      if (!best) {
        if (pending?.link?.opening) cancel();
        return null;
      }
      return Object.freeze({ link: best, ready: prepare(best.id) });
    }
    function view(id = pending?.link?.id, actor) {
      const job = pending, link = job?.link;
      if (!job?.asset || link?.id !== id || !link.opening || !permits(link, actor)) return null;
      return Object.freeze({ opening: link.opening, source: active.asset.world, destination: job.asset.world,
        link, asset: job.asset });
    }
    function previewLinks(actor) {
      if (!active || walking || fading) return noLinks;
      return Object.freeze((exits.get(active.id) ?? noLinks).filter(link => link.opening && permits(link, actor)));
    }
    async function cross(id, { previous, actor, camera, radius } = {}) {
      guard();
      if (walking || fading) return null;
      const link = linked(id);
      if (!link.sweep) return null;
      const { crossing } = encounter(link, { actor, previous, radius });
      if (!crossing) return null;
      const traveler = freeze(clone(actor)), view = camera == null ? null : clone(camera), segmentStart = point(previous);
      const loaded = prepare(id), job = pending;
      walking = true;
      try {
        if (!await loaded) return null;
        return activate(job, traveler, view, crossing, segmentStart);
      } finally {
        walking = false;
      }
    }
    function fade(id, { actor } = {}) {
      guard();
      if (walking || fading) throw new Error('Travel is already in progress');
      const link = linked(id);
      if (link.mode !== 'fade' || encounter(link, { actor }).status) return null;
      const loaded = prepare(id), job = pending, half = link.duration / 2;
      const traveler = freeze(clone(actor));
      let elapsed = 0, opacity = 0, phase = 'out', ready = false, error, arrival;
      loaded.then(value => {
        ready = true;
        if (!value) error = new Error('Destination preparation was cancelled');
      }, reason => { ready = true; error = reason; });
      const playback = Object.freeze({
        advance(dt) {
          guard();
          if (!finite(dt) || dt < 0) throw new RangeError('Fade steps need finite nonnegative time');
          if (phase === 'out') {
            const left = half - elapsed;
            elapsed = Math.min(half, elapsed + dt);
            opacity = elapsed / half;
            dt = Math.max(0, dt - left);
            if (elapsed === half) phase = 'hold';
          }
          if (phase === 'hold' && ready) {
            try {
              if (!error) arrival = activate(job, traveler, null, null);
            } catch (reason) {
              error = reason;
            }
            if (!arrival) error ??= new Error('Arrival is unavailable');
            if (pending === job) {
              try { cancel(); }
              catch (reason) { error ??= reason; }
            }
            elapsed = 0;
            phase = 'in';
          }
          if (phase === 'in') {
            elapsed = Math.min(half, elapsed + dt);
            opacity = 1 - elapsed / half;
            if (elapsed === half) {
              phase = error ? 'failed' : 'done';
              fading = null;
            }
          }
          return Object.freeze({ phase, opacity, arrival: arrival ?? null, error: error ?? null, place: active });
        }
      });
      fading = playback;
      return playback;
    }
    function place(id) {
      const definition = catalog.get(id);
      if (!definition) return null;
      return Object.freeze({ id, anchors: definition.anchors, tickPolicy: definition.tickPolicy, time: timeOf(id),
        status: active?.id === id ? 'active' : away.has(id) ? 'away' : 'inactive' });
    }
    function step(dt) {
      guard();
      if (!finite(dt) || dt < 0) throw new RangeError('Place steps need finite nonnegative time');
      if (!dt || !active) return;
      const residents = new Map(away).set(active.id, active.asset);
      const ids = [...residents.keys()].sort();
      if (ids.some(id => !finite(timeOf(id) + dt))) throw new RangeError('Place elapsed time is out of range');
      stepping = true;
      try {
        for (const id of ids) {
          const time = timeOf(id) + dt;
          synchronous(residents.get(id).step?.({ id, dt, time, active: id === active.id }), 'Place step callbacks');
          clocks.set(id, time);
        }
      } finally {
        stepping = false;
      }
    }
    function checkpoint() {
      guard();
      const states = new Map(memory), residents = new Map(away);
      if (active) residents.set(active.id, active.asset);
      for (const [id, asset] of residents) {
        const state = asset.checkpoint?.();
        if (state !== undefined) states.set(id, state);
      }
      return freeze({ place: active?.id ?? null, saved: clone(Object.fromEntries(states)),
        ...(carry && { carry: carry.checkpoint() }),
        ...(entities && { lifecycle: entities.api.checkpoint() }),
        ...(clocks.size ? { clocks: Object.fromEntries(clocks) } : {}),
        ...(away.size ? { away: [...away.keys()].sort() } : {}),
        ...(instances.size ? { portable: { version: 1, instances: [...instances.values()],
          entrances: [...entrances.values()].map(row => ({ ...row.args, open: row.open, entered: row.entered })) } } : {}) });
    }
    function restorePortable(data) {
      const places = new Map(catalog), known = new Map(instances);
      const entries = new Map(), returns = new Map();
      if (data !== undefined) {
        if (!W.data.record(data) || data.version !== 1) throw new TypeError('Invalid portable place checkpoint');
        for (const spec of unique(data.instances, 'Place instances').values()) addInstance(spec, places, known);
        for (const spec of unique(data.entrances, 'Portable entrances').values()) {
          const row = makeEntrance(spec, places, known), destination = row.entry.to.place;
          if (row.entered) {
            if (returns.has(destination)) throw new TypeError('An instance can have only one pending return');
            returns.set(destination, row);
          }
          entries.set(spec.id, row);
        }
      }
      return { places, known, entries, returns };
    }
    async function restore(data) {
      guard();
      if (active || pending) throw new Error('Restore needs an empty place session');
      if (!W.data.record(data)) throw new TypeError('Invalid place session checkpoint');
      const { places: restoredPlaces, known, entries, returns } = restorePortable(data.portable);
      if (data.carry !== undefined && !carry) throw new TypeError('This checkpoint needs a carry registry');
      const restoreCarry = data.carry === undefined ? null : carry.planRestore(data.carry, id => restoredPlaces.has(id));
      if (data.lifecycle !== undefined && !entities) throw new TypeError('This checkpoint needs entity lifecycle enabled');
      const restoreEntities = data.lifecycle === undefined ? null : entities.planRestore(data.lifecycle, id => restoredPlaces.has(id));
      if (data.place !== null && !restoredPlaces.has(data.place) || data.place === null && entries.size)
        throw new TypeError('Checkpoint needs a declared active place or null');
      const states = savedStates(data.saved);
      const times = data.clocks === undefined ? {} : data.clocks;
      if (!W.data.record(times) || !Object.entries(times).every(([id, time]) => restoredPlaces.has(id) && finite(time) && time >= 0))
        throw new TypeError('Invalid checkpoint place clocks');
      const nextClocks = new Map(Object.entries(times));
      const retained = data.away === undefined ? [] : data.away;
      if (!Array.isArray(retained) || retained.length > restoredPlaces.size || new Set(retained).size !== retained.length ||
          Array.from(retained).some(id => id === data.place || restoredPlaces.get(id)?.tickPolicy !== 'continue') ||
          retained.length && data.place === null)
        throw new TypeError('Invalid checkpoint away places');
      const current = data.place, background = retained.slice();
      const ids = current === null ? [] : [current, ...background];
      const controller = new AbortController(), assets = new Map();
      restoring = controller;
      try {
        for (const id of ids) {
          const asset = await restoredPlaces.get(id).prepare({ id, anchor: null, state: states.get(id), previous: null,
            time: nextClocks.get(id) ?? 0, signal: controller.signal, reason: 'restore', link: null,
            ...(entities && { lifecycle: lifecycleContext(id, () => restoring === controller ? restoreEntities?.view : null) }) });
          assets.set(id, asset);
          if (controller.signal.aborted) return null;
          validateAsset(asset);
          if (entities) (restoreEntities?.view ?? entities.view).assertPlace(id, authored(asset));
        }
        restoreCarry?.();
        restoreEntities?.commit();
        memory = states;
        clocks = nextClocks;
        for (const [id, definition] of restoredPlaces) catalog.set(id, definition);
        instances = known;
        entrances = entries;
        visits = returns;
        for (const row of entrances.values()) installEntrance(row);
        for (const id of background) away.set(id, assets.get(id));
        active = current === null ? null : Object.freeze({ id: current, asset: assets.get(current) });
        assets.clear();
        return active;
      } catch (error) {
        if (controller.signal.aborted) return null;
        throw error;
      } finally {
        restoring = null;
        for (const asset of new Set(assets.values())) release(asset);
      }
    }
    return Object.freeze({ current: () => active, place, linksFrom: id => exits.get(id) ?? noLinks,
      ...(entities && { lifecycle: entities.api }),
      registerInstance, openEntrance, closeEntrance,
      enter, approach, prepare, checkArrival, cancelPreparation, view, previewLinks, cross, fade, onCross, step, checkpoint, restore,
      dispose() {
        if (disposed) return;
        if (stepping || handoff) throw new Error('Place state is already being updated');
        disposed = true;
        observers.clear();
        restoring?.abort();
        const residents = new Set(away.values());
        if (active) residents.add(active.asset);
        try {
          cancel();
        } finally {
          active = null;
          away.clear();
          for (const asset of residents) release(asset);
        }
      } });
  }

  W.portals = Object.freeze({ anchor, doorway, create });
})(KIT);
