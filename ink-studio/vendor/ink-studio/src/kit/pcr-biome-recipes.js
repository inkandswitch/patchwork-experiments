/* Retained biome recipes and deterministic world-space authoring queries. */
(function (K) {
  const P = K.procedural, A = K.authoring, { freeze, hash } = P.data;
  const root = 'biome-world';
  const types = { recipe: 'biome-recipe', region: 'biome-region', stroke: 'biome-stroke',
    landmark: 'biome-landmark-pin', route: 'biome-route-pin' };
  const finite = Number.isFinite;
  const unit = n => finite(n) && n >= 0 && n <= 1;
  const seedOK = n => Number.isSafeInteger(n) && Math.abs(n) <= 4294967295;
  const name = v => typeof v === 'string' && v.trim().length > 0 &&
    v.length <= 160 && !['__proto__', 'prototype', 'constructor'].includes(v);
  const record = v => v && typeof v === 'object' && !Array.isArray(v);
  const vector = (v, predicate = finite) => Array.isArray(v) && v.length === 3 && Array.from(v).every(predicate);
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const key = (type, ...ids) => type + '/' + JSON.stringify(ids);
  const validMedium = new Set(['air', 'water', 'solid']);
  const environments = new WeakMap();
  const byId = (a, b) => order(a.id, b.id);
  const nonnegative = n => finite(n) && n >= 0;

  function named(list, label, limit, prepare) {
    if (!Array.isArray(list) || list.length > limit) throw new Error(label + ' needs an array within its budget');
    const rows = new Map();
    for (const item of list) {
      const id = item?.id;
      if (!name(id) || rows.has(id)) throw new Error(label + ' needs unique IDs');
      rows.set(id, prepare(item));
    }
    return rows;
  }

  function habitat(raw = {}) {
    if (!record(raw) || (raw.media !== undefined &&
        (!Array.isArray(raw.media) || !raw.media.length || !Array.from(raw.media).every(kind => validMedium.has(kind)))) ||
        (raw.ranges !== undefined && !record(raw.ranges)))
      throw new Error('Habitat needs medium kinds and named condition ranges');
    const ranges = Object.entries(raw.ranges ?? {}).sort(([a], [b]) => order(a, b));
    for (const [field, range] of ranges) {
      if (!name(field) || !record(range)) throw new Error('Invalid habitat range ' + field);
      const { min, max, fade = 0 } = range;
      if ((min === undefined && max === undefined) || (min !== undefined && !finite(min)) ||
          (max !== undefined && !finite(max)) || min > max || !nonnegative(fade))
        throw new Error('Invalid habitat range ' + field);
    }
    return { media: raw.media, ranges };
  }

  function suitability(rule, y, conditions, medium, checks) {
    let weight = 1;
    if (rule.media) {
      weight = Number(rule.media.includes(medium.kind));
      if (checks) checks.push({ field: 'medium', value: medium.kind, allowed: rule.media, weight });
    }
    for (const [field, range] of rule.ranges) {
      const { min, max, fade = 0 } = range;
      const value = field === 'depth' ? medium.depth : field === 'elevation' ? y : conditions[field];
      const gap = finite(value) ? Math.max(0, (min ?? -Infinity) - value, value - (max ?? Infinity)) : Infinity;
      const gain = gap === 0 ? 1 : fade ? Math.max(0, 1 - gap / fade) : 0;
      if (checks) checks.push({ field, value: finite(value) ? value : null, range, weight: gain });
      weight *= gain;
    }
    return weight;
  }

  function compileRecipe(definition, seed) {
    const { id, landform = {}, strata = {}, materials, populations = [], landmarks = [],
      routes = [], ambient = [], traversal = [] } = definition;
    if (!record(landform) || !record(strata) || !record(materials) || !Object.keys(materials).length ||
        (landform.kind !== undefined && !name(landform.kind)) ||
        !Array.isArray(traversal) || !Array.from(traversal).every(name))
      throw new Error('A biome recipe needs named material ramps and valid landform, strata and traversal data');
    const ramps = new Map();
    for (const [role, colors] of Object.entries(materials)) {
      if (!name(role) || !Array.isArray(colors) || !colors.length || colors.length > 32)
        throw new Error('Biome materials need named ramps of up to 32 colors');
      ramps.set(role, freeze(colors.map(P.styles.rgb)));
    }
    const fallback = strata.fallback ?? [...ramps.keys()].sort()[0];
    const bands = P.materialBands({ fallback: { material: fallback }, layers: strata.layers ?? [] });
    for (const band of [bands.fallback, ...bands.layers])
      if (!ramps.has(band.material)) throw new Error('Unknown biome stratum material ' + band.material);
    const height = P.fields.compile(landform.height ?? 0, { seed: hash(id, seed) });
    const population = named(populations, 'Biome populations', 64, rule => {
      const { species = rule.id, asset = species, density = 1 } = rule;
      if (!name(species) || !name(asset) || species === '*' || !unit(density))
        throw new Error('Biome populations need a species, asset and density in [0, 1]');
      return { id: rule.id, species, asset, density, habitat: habitat(rule.habitat), salt: hash(key(id, rule.id), seed) };
    });
    const markers = named(landmarks, 'Biome landmarks', 128, marker => {
      const { at, asset = marker.id, jitter = 0, clearance = 0 } = marker;
      if (!vector(at, unit) || !name(asset) || !nonnegative(jitter) || jitter > 1e6 || !nonnegative(clearance))
        throw new Error('Biome landmarks need normalized XYZ coordinates, an asset, jitter and clearance');
      return { id: marker.id, at, asset, jitter, clearance };
    });
    const paths = named(routes, 'Biome routes', 128, path => {
      const { points, clearance = 0 } = path;
      if (!Array.isArray(points) || points.length < 2 || points.length > 4097 ||
          !Array.from(points).every(p => vector(p, unit) || record(p) && markers.has(p.landmark)) ||
          !nonnegative(clearance))
        throw new Error('Biome routes need normalized points or named landmark endpoints');
      return { id: path.id, points, clearance };
    });
    const cues = named(ambient, 'Biome ambient cues', 64, cue => {
      const gain = cue.gain ?? 1;
      if (!unit(gain)) throw new Error('Biome ambient gain must be in [0, 1]');
      return { id: cue.id, gain };
    });
    return { definition, habitat: habitat(definition.habitat), height, bands, ramps,
      population: [...population.values()].sort(byId), markers, paths, cues, traversal };
  }

  function compileStroke(stroke) {
    const { id, channel, target, operation = 'add', strength = 1, height, order: index } = stroke;
    const needsTarget = channel === 'population' || operation === 'add';
    if (!name(id) || !['biome', 'population'].includes(channel) || !['add', 'erase'].includes(operation) ||
        (needsTarget && !name(target)) || !unit(strength) ||
        !Number.isSafeInteger(index) || index < 0 ||
        (height !== undefined && (!Array.isArray(height) || height.length !== 2 ||
          !Array.from(height).every(finite) || height[0] > height[1])))
      throw new Error('Invalid biome paint stroke');
    const brush = P.masks.stroke(stroke);
    const bounds = { min: brush.bounds.min.slice(), max: brush.bounds.max.slice() };
    bounds.min[1] = height?.[0] ?? -Number.MAX_VALUE;
    bounds.max[1] = height?.[1] ?? Number.MAX_VALUE;
    return { id, channel, target, operation, strength, index, brush, bounds };
  }

  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

  function compileView(snapshot, environment, recipeCache) {
    const { media, solid, conditions, project } = environment;
    if (project !== undefined && typeof project !== 'function') throw new TypeError('Biome feature projection needs a sampler');
    const settings = snapshot.entities[root];
    const { seed, fallback, nextStroke } = settings?.parameters ?? {};
    if (settings?.type !== root || settings.parameters.version !== 1 || !seedOK(seed) || !name(fallback) ||
        !Number.isSafeInteger(nextStroke) || nextStroke < 0)
      throw new Error('Snapshot needs a compatible biome world');
    const entities = Object.values(snapshot.entities);
    function list(type) {
      return entities.filter(e => e.type === types[type]).map(e => {
        const data = e.parameters;
        const ids = type === 'landmark' || type === 'route' ? [data.region, data.id] : [data.id];
        if (!ids.every(name) || e.id !== key(type, ...ids) || e.parent !== root)
          throw new Error('Invalid retained biome ' + type + ' identity: ' + e.id);
        return data;
      });
    }
    const recipes = named(list('recipe'), 'Biome recipes', 512, definition => {
      const cached = recipeCache.get(definition);
      if (cached?.seed === seed) return cached.recipe;
      const recipe = compileRecipe(definition, seed);
      recipeCache.set(definition, { seed, recipe });
      return recipe;
    });
    if (!recipes.has(fallback)) throw new Error('Unknown fallback biome recipe ' + fallback);
    const regions = named(list('region'), 'Biome regions', 4096, region => {
      if (!recipes.has(region.biome) || !unit(region.weight ?? 1) ||
          !vector(region.bounds?.min) || !vector(region.bounds?.max) ||
          !region.bounds.min.every((v, i) => finite(region.bounds.max[i] - v)))
        throw new Error('Biome region needs a known recipe, finite bounds and weight in [0, 1]');
      P.spatial.bounds(region.bounds);
      const field = region.field === undefined ? null : P.fields.compile(region.field, { seed: hash(region.id, seed) });
      return { ...region, field };
    });
    function fieldWeight(region, x, y, z, time) {
      const value = region.field ? region.field(x, y, z, time) : 1;
      if (!finite(value)) throw new RangeError('Biome region field must resolve to a finite weight');
      return Math.max(0, Math.min(1, value));
    }
    const base = P.biomes.create({ fallback, media, solid, conditions, regions: [...regions.values()].map(region => ({
      id: region.id, biome: region.biome, bounds: region.bounds,
      weight: (x, y, z, t, local, medium) => (region.weight ?? 1) * fieldWeight(region, x, y, z, t) *
        suitability(recipes.get(region.biome).habitat, y, local, medium)
    })) });
    const brushRows = list('stroke');
    if (brushRows.reduce((sum, stroke) => sum + (stroke?.points?.length ?? 0), 0) > 262144)
      throw new Error('Biome paint exceeds its point budget');
    const strokes = named(brushRows, 'Biome paint', 4096, stroke => {
      if (stroke.channel === 'biome' && stroke.operation !== 'erase' && !recipes.has(stroke.target))
        throw new Error('Unknown paint biome ' + stroke.target);
      if (stroke.order >= nextStroke) throw new Error('Biome stroke order is outside the document sequence');
      return compileStroke(stroke);
    });
    const brushIndex = P.spatial.pointIndex([...strokes.values()]);
    const pinMap = (type, valid) => {
      const pins = new Map();
      for (const pin of list(type)) {
        if (!name(pin.region) || !name(pin.id) || !valid(pin)) throw new Error('Invalid biome ' + type + ' pin');
        const id = key(type, pin.region, pin.id);
        if (pins.has(id)) throw new Error('Duplicate biome pin ' + id);
        pins.set(id, pin);
      }
      return pins;
    };
    const landmarkPins = pinMap('landmark', pin => vector(pin.point));
    const routePins = pinMap('route', pin => Boolean(P.routes.polyline(pin.points)));
    const landmarks = [], routes = [], reservations = [];
    for (const region of [...regions.values()].sort(byId)) {
      const recipe = recipes.get(region.biome), markers = new Map();
      const atWorld = fraction => fraction.map((v, axis) =>
        region.bounds.min[axis] + v * (region.bounds.max[axis] - region.bounds.min[axis]));
      for (const marker of [...recipe.markers.values()].sort(byId)) {
        const id = key('landmark', region.id, marker.id), pin = landmarkPins.get(id);
        const dice = K.grow.dice(hash(id, seed));
        const generated = atWorld(marker.at).map(v => v + (2 * dice() - 1) * marker.jitter);
        const point = pin?.point ?? (project ? project(generated, { kind: 'landmark', id: marker.id, region: region.id }) : generated);
        if (!vector(point)) throw new RangeError('Nonfinite landmark placement');
        const item = freeze({ id: marker.id, region: region.id, asset: marker.asset,
          point, pinned: Boolean(pin), clearance: marker.clearance });
        markers.set(item.id, item);
        landmarks.push(item);
        if (item.clearance) {
          const bounds = P.spatial.expand({ min: point, max: point }, item.clearance);
          reservations.push({ ...item, kind: 'landmark', bounds, distance: q => K.V.dist(point, q) });
        }
      }
      for (const path of [...recipe.paths.values()].sort(byId)) {
        const pin = routePins.get(key('route', region.id, path.id));
        const points = pin?.points ?? path.points.map((p, index) => {
          if (!Array.isArray(p)) return markers.get(p.landmark).point;
          const generated = atWorld(p);
          return project ? project(generated, { kind: 'route', id: path.id, region: region.id, index }) : generated;
        });
        const route = P.routes.polyline(points);
        const item = freeze({ id: path.id, region: region.id, points: route.points,
          pinned: Boolean(pin), clearance: path.clearance });
        routes.push(item);
        if (item.clearance)
          reservations.push({ ...item, kind: 'route', bounds: P.spatial.expand(route.bounds, item.clearance),
            distance: q => route.closest(q).distance });
      }
    }
    const layout = freeze({ landmarks, routes });
    const reserveIndex = P.spatial.pointIndex(reservations);
    function blocked(point) {
      const matches = [];
      reserveIndex(point, item => {
        const distance = item.distance(point);
        if (distance < item.clearance) matches.push({ kind: item.kind, region: item.region, id: item.id, distance });
      });
      return matches.sort((a, b) => order(a.kind, b.kind) || order(a.region, b.region) || byId(a, b));
    }

    function sampleAt(point, time, trace = false) {
      const raw = trace ? base.inspect(...point, time) : base.sample(...point, time);
      const original = new Map(raw.weights.map(row => [row.id, row.weight]));
      const weights = new Map(original), exclusions = new Map(), hits = [], applied = [];
      brushIndex(point, row => hits.push(row));
      hits.sort((a, b) => a.index - b.index || byId(a, b));
      for (const stroke of hits) {
        const coverage = stroke.strength * stroke.brush.weight([point[0], point[2]]);
        if (coverage <= 0) continue;
        const { id, channel, target, operation } = stroke;
        if (trace) applied.push({ id, channel, ...(target === undefined ? {} : { target }), operation, coverage });
        if (channel === 'population') {
          exclusions.set(target, (exclusions.get(target) ?? 0) * (1 - coverage) + (operation === 'add' ? coverage : 0));
          continue;
        }
        for (const [key, weight] of weights) weights.set(key, weight * (1 - coverage));
        const paint = operation === 'erase' ? original : [[target, 1]];
        for (const [key, weight] of paint) weights.set(key, (weights.get(key) ?? 0) + weight * coverage);
      }
      const resolved = [...weights].filter(([, weight]) => weight > 0).sort(([a, w], [b, v]) => v - w || order(a, b))
        .map(([id, weight]) => ({ id, weight }));
      return { point, time, raw, biome: resolved[0].id, weights: resolved, exclusions, applied };
    }

    function heightOffsetAt(local, point) {
      let offset = 0;
      for (const { id, weight } of local.weights) offset += weight * recipes.get(id).height(...point, local.time);
      if (!finite(offset)) throw new RangeError('Biome landforms must resolve to a finite height');
      return offset;
    }
    function materialAt(local, surfaceY, y) {
      if (!finite(surfaceY)) throw new RangeError('Biome strata need a finite surface height');
      const recipe = recipes.get(local.biome), stratum = recipe.bands.at(y - surfaceY);
      return { stratum, ramp: recipe.ramps.get(stratum.material) };
    }
    function appearance(local, surfaceY, point = local.point) {
      const { weights, biome } = local, y = point[1];
      const chosen = recipes.get(biome), ambient = new Map();
      for (const { id, weight } of weights) {
        const recipe = recipes.get(id);
        for (const cue of recipe.cues.values()) ambient.set(cue.id, (ambient.get(cue.id) ?? 0) + weight * cue.gain);
      }
      return { landform: chosen.definition.landform ?? {}, heightOffset: heightOffsetAt(local, point),
        ...materialAt(local, surfaceY, y), traversal: chosen.traversal,
        ambient: [...ambient].sort(([a], [b]) => order(a, b)).map(([id, gain]) => ({ id, gain })) };
    }

    function populationAt(local, reserved, trace, species) {
      const weights = new Map(local.weights.map(row => [row.id, row.weight]));
      const entries = species ? recipes.keys() : weights.keys();
      const { medium, conditions } = local.raw, rows = [];
      for (const biome of entries) for (const rule of recipes.get(biome).population) {
        if (species && rule.species !== species) continue;
        const checks = trace ? [] : undefined;
        const habitatWeight = suitability(rule.habitat, local.point[1], conditions, medium, checks);
        const biomeWeight = weights.get(biome) ?? 0;
        const exclusion = 1 - (1 - (local.exclusions.get('*') ?? 0)) * (1 - (local.exclusions.get(rule.species) ?? 0));
        const density = reserved.length ? 0 : biomeWeight * rule.density * habitatWeight * (1 - exclusion);
        if (trace || density > 0) rows.push({ biome, id: rule.id, species: rule.species, asset: rule.asset,
          salt: rule.salt, density, ...(trace ? { biomeWeight, habitatWeight, baseDensity: rule.density, exclusion, checks } : {}) });
      }
      return rows;
    }

    function sample(x, y, z, time = 0) {
      const local = sampleAt([x, y, z], time);
      return { biome: local.biome, weights: local.weights, medium: local.raw.medium, conditions: local.raw.conditions };
    }
    function inspect(x, y, z, { time = 0, surfaceY = y, species, habitatOffset = 0 } = {}) {
      if ((species !== undefined && !name(species)) || !finite(habitatOffset))
        throw new Error('Inspection needs a finite habitat offset and optional species ID');
      const point = [x, y, z], sampleY = y + habitatOffset;
      const local = sampleAt([x, sampleY, z], time, true), reserved = blocked(point), raw = local.raw;
      const candidates = raw.regions.map(region => {
        const checks = [], definition = regions.get(region.id);
        suitability(recipes.get(region.biome).habitat, sampleY, raw.conditions, raw.medium, checks);
        return { ...region, authoredWeight: definition.weight ?? 1,
          fieldWeight: fieldWeight(definition, x, sampleY, z, time), checks };
      });
      return freeze({ biome: local.biome, weights: local.weights, medium: raw.medium, conditions: raw.conditions, sampleY,
        base: { weights: raw.weights, regions: candidates, fallback }, strokes: local.applied, reservations: reserved,
        exclusions: [...local.exclusions].sort(([a], [b]) => order(a, b)).map(([target, weight]) => ({ target, weight })),
        populations: populationAt(local, reserved, true, species).map(({ salt, ...row }) => row),
        ...appearance(local, surfaceY, point) });
    }

    function populate(bounds, { height, layer = 'surface', time = 0, habitatOffset = 0, ...options } = {}) {
      if (typeof height !== 'function' || !name(layer) || !finite(time) || !finite(habitatOffset))
        throw new Error('Population needs a height sampler, layer, finite time and habitat offset');
      const boxes = Array.isArray(bounds) ? bounds.map(P.spatial.bounds) : [P.spatial.bounds(bounds)];
      const plan = P.populations.layout(boxes, (x, z, candidate) => {
        const y = height(x, z);
        if (y == null) return null;
        if (!finite(y)) throw new RangeError('Population height must be finite or null');
        const point = [x, y, z], local = sampleAt([x, y + habitatOffset, z], time);
        const rows = populationAt(local, blocked(point), false);
        let winner, best = Infinity, total = 0;
        for (const row of rows) {
          total += row.density;
          const score = -Math.log(Math.max(1e-12, 1 - K.hash(candidate.seed, row.salt, 827))) / row.density;
          if (score < best || (score === best && winner && (order(row.biome, winner.biome) || byId(row, winner)) < 0)) {
            best = score;
            winner = row;
          }
        }
        if (!winner) return null;
        return { density: Math.min(1, total), biome: winner.biome, rule: winner.id,
          species: winner.species, asset: winner.asset, position: point };
      }, { ...options, seed: hash(layer, seed) }, sample => boxes.some(box => P.spatial.contains(box, sample.position)));
      return freeze({ ...plan, instances: plan.instances.map(row => ({ ...row, id: key(layer, row.key) })) });
    }

    function changesFrom(previous) {
      const old = previous.snapshot.entities, next = snapshot.entities;
      if (previous.seed !== seed || old[root]?.parameters.fallback !== fallback ||
          environments.get(previous)?.conditions !== environment.conditions)
        return freeze({ global: true, regions: [] });
      const dirty = [];
      for (const id of new Set([...Object.keys(old), ...Object.keys(next)])) {
        const a = old[id], b = next[id];
        if (a === b || same(a?.parameters, b?.parameters) && a?.type === b?.type) continue;
        for (const row of [a, b]) {
          if (row?.type === types.recipe) return freeze({ global: true, regions: [] });
          if (row?.type === types.region) dirty.push(row.parameters.bounds);
          if (row?.type === types.stroke) dirty.push(compileStroke(row.parameters).bounds);
        }
      }
      function features(type) {
        const map = list => new Map(list.map(item => [key(type, item.region, item.id), item]));
        const a = map(previous.layout[type]), b = map(layout[type]);
        for (const id of new Set([...a.keys(), ...b.keys()])) {
          const left = a.get(id), right = b.get(id);
          if (same(left, right)) continue;
          if (left?.points && right?.points && left.pinned === right.pinned && left.clearance === right.clearance) {
            const segments = Math.max(left.points.length, right.points.length) - 1;
            for (let i = 0; i < segments; i++) {
              const before = left.points.slice(i, i + 2), after = right.points.slice(i, i + 2);
              if (same(before, after)) continue;
              for (const points of [before, after]) if (points.length === 2)
                dirty.push(P.spatial.expand(P.spatial.boxOf(points), left.clearance));
            }
            continue;
          }
          for (const item of [left, right]) {
            if (!item) continue;
            const points = item.points ?? [item.point];
            if (points.length === 1) dirty.push(P.spatial.expand(P.spatial.boxOf(points), item.clearance));
            else for (let i = 1; i < points.length; i++)
              dirty.push(P.spatial.expand(P.spatial.boxOf([points[i - 1], points[i]]), item.clearance));
          }
        }
      }
      features('landmarks');
      features('routes');
      return freeze({ global: dirty.length > 4096, regions: dirty.length > 4096 ? [] : dirty });
    }

    const result = Object.freeze({ snapshot, seed, layout, sample, inspect, populate, changesFrom,
      withEnvironment: overrides => compileView(snapshot, { ...environment, ...overrides }, recipeCache),
      heightOffsetAt: (x, y, z, time = 0) => {
        const point = [x, y, z];
        return heightOffsetAt(sampleAt(point, time), point);
      },
      appearanceAt: (x, y, z, { time = 0, surfaceY = y, probe = [x, y, z] } = {}) => {
        if (!vector(probe)) throw new Error('Biome appearance needs a finite XYZ probe');
        return freeze(appearance(sampleAt(probe, time), surfaceY, [x, y, z]));
      },
      materialAt: (x, y, z, { time = 0, surfaceY = y, probe = [x, y, z] } = {}) => {
        if (!vector(probe)) throw new Error('Biome material needs a finite XYZ probe');
        return freeze(materialAt(sampleAt(probe, time), surfaceY, y));
      },
      mediumAt: base.mediumAt,
      recipe: id => recipes.get(id)?.definition ?? null });
    environments.set(result, environment);
    return result;
  }

  function create({ seed = 1, fallback, recipes = [], regions = [], snapshot, media, solid, conditions, historyLimit } = {}) {
    const cache = new WeakMap(), recipeCache = new WeakMap();
    function compile(state) {
      if (!cache.has(state)) cache.set(state, compileView(state, { media, solid, conditions }, recipeCache));
      return cache.get(state);
    }
    if (!snapshot) {
      if (!name(fallback)) throw new Error('A biome world needs a fallback recipe ID');
      const initial = A.document(undefined, { historyLimit: 0 });
      initial.transact('Create biome world', () => {
        initial.create(root, { id: root, parameters: { version: 1, seed, fallback, nextStroke: 0 } });
        for (const [type, list] of [['recipe', recipes], ['region', regions]])
          for (const [id, parameters] of named(list, type, type === 'recipe' ? 512 : 4096, value => value))
            initial.create(types[type], { id: key(type, id), parent: root, parameters });
      });
      snapshot = initial.snapshot();
    }
    const doc = A.document(snapshot, { historyLimit, prepareSnapshot: state => { compile(state); return state; } });
    doc.beforeCommit(() => compile(doc.snapshot()));
    const edit = (label, apply) => doc.pending() ? apply() : doc.transact(label, apply);
    function store(type, parameters, ids = [parameters?.id]) {
      if (!ids.every(name)) throw new Error('A biome edit needs stable IDs');
      parameters = P.data.clone(parameters);
      const id = key(type, ...ids), existing = doc.get(id);
      if (existing && JSON.stringify(existing.parameters) === JSON.stringify(parameters)) return id;
      if (existing) doc.remove(id);
      return doc.create(types[type], { id, parent: root, parameters });
    }
    const remove = (type, ...ids) => edit('Remove biome ' + type, () => {
      const id = key(type, ...ids);
      return doc.get(id) ? Boolean(doc.remove(id).length) : false;
    });
    function pin(type, region, id, data) {
      const owner = doc.get(key('region', region))?.parameters;
      const recipe = owner && doc.get(key('recipe', owner.biome))?.parameters;
      if (!recipe?.[type === 'route' ? 'routes' : 'landmarks']?.some(item => item.id === id))
        throw new Error('Unknown biome ' + type + ' in region ' + region);
      return edit('Pin biome ' + type, () => store(type, { region, id, ...data }, [region, id]));
    }
    return Object.freeze({
      document: doc,
      view: () => compile(doc.snapshot()),
      setRecipe: recipe => edit('Edit biome recipe', () => store('recipe', recipe)),
      setRegion: region => edit('Edit biome region', () => store('region', region)),
      removeRegion: id => remove('region', id),
      setSeed: seed => edit('Reseed biome world', () => doc.update(root, { parameters: { seed } })),
      paint(stroke) {
        return edit('Paint biome', () => {
          const { nextStroke } = doc.get(root).parameters, existing = doc.get(key('stroke', stroke?.id));
          if (!existing) doc.update(root, { parameters: { nextStroke: nextStroke + 1 } });
          return store('stroke', { ...stroke, order: existing?.parameters.order ?? nextStroke });
        });
      },
      removePaint: id => remove('stroke', id),
      pinLandmark: (region, id, point) => pin('landmark', region, id, { point }),
      pinRoute: (region, id, points) => pin('route', region, id, { points }),
      unpinLandmark: (region, id) => remove('landmark', region, id),
      unpinRoute: (region, id) => remove('route', region, id)
    });
  }
  P.biomeRecipes = Object.freeze({ create });
})(KIT);
