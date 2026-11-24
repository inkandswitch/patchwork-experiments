/* Retained diorama brushes over independently sampled world-space chunks. */
(function (K) {
  const P = K.procedural, DIO = K.diorama, { V } = K;
  const { freeze, hash } = P.data, { overlap, expand, contains } = P.spatial;
  const modes = ['sculpt', 'paint', 'place', 'erase', 'scatter'];
  const finite = Number.isFinite, integer = Number.isSafeInteger;
  const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(finite);
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const fields = (o, allowed) => record(o) && Object.keys(o).every(key => allowed.includes(key));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function pointBounds(points, radius) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const point of points) for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], point[i] - radius);
      max[i] = Math.max(max[i], point[i] + radius);
    }
    return { min, max };
  }

  function prepare(spec, roles) {
    const config = spec.brushRegion;
    if (!fields(config, ['bounds', 'solids', 'cell', 'chunkCells', 'strokes']) ||
        !fields(config.bounds, ['min', 'max']) || !vector(config.bounds.min) || !vector(config.bounds.max) ||
        !config.bounds.min.every((min, i) => min < config.bounds.max[i]))
      throw new TypeError('A brush region needs ordered XYZ min and max bounds');
    const { bounds, solids = [], cell = .16, chunkCells = 12, strokes = [] } = config;
    if (!finite(cell * 2) || cell <= 0 || !integer(chunkCells) || chunkCells < 2)
      throw new RangeError('Brush regions need a positive cell size and chunkCells of at least two');
    const grid = { min: bounds.min.map(n => Math.floor(n / cell)), max: bounds.max.map(n => Math.ceil(n / cell)) };
    const size = V.sub(grid.max, grid.min);
    if (![...grid.min, ...grid.max].every(integer) || size.reduce((a, b) => a * b, 1) > 300000)
      throw new RangeError('Brush region exceeds its 300,000-cell budget');
    if (size.reduce((product, n) => product * Math.ceil(n / chunkCells), 1) > 4096)
      throw new RangeError('Brush region exceeds its 4096-chunk budget');
    const named = new Map((spec.solids ?? []).map(solid => [solid?.id, solid]));
    if (!Array.isArray(solids) || new Set(solids).size !== solids.length ||
        solids.some(id => !TargetSelectors.name(id) || !named.has(id) || named.get(id).part || named.get(id).ghost || named.get(id).hold || named.get(id).carve))
      throw new TypeError('Brush regions need distinct IDs of stationary surface solids');
    if (spec.solids?.some(solid => solid?.part) || spec.motion?.length || spec.effects?.length || spec.tap)
      throw new TypeError('A diorama with a brush region needs stationary scene geometry and lighting');
    if (!Array.isArray(strokes)) throw new TypeError('Brush strokes must be an ordered list');
    const seen = new Set();
    for (const stroke of strokes) {
      const { id, mode, points, radius, material = 'stone', shape, count, size, seed } = stroke ?? {};
      const placement = mode === 'place' || mode === 'scatter';
      if (!fields(stroke, ['id', 'mode', 'points', 'radius', ...(mode === 'erase' ? [] : ['material']),
        ...(placement ? ['shape'] : []), ...(mode === 'scatter' ? ['count', 'size', 'seed'] : [])]) ||
        !TargetSelectors.name(id) || seen.has(id) || !modes.includes(mode) ||
        !Array.isArray(points) || !points.length || points.length > 4096 || !Array.from(points).every(vector) ||
        !finite(radius) || radius <= 0)
        throw new TypeError('A stroke needs a unique ID, brush mode, finite XYZ points and positive radius');
      if (mode !== 'erase' && (typeof material !== 'string' || !Object.hasOwn(roles, material)))
        throw new RangeError('Unknown brush material: ' + material);
      if (shape !== undefined && !['ball', 'box'].includes(shape)) throw new TypeError('Placed stamps need a ball or box shape');
      if (mode === 'scatter' && (count !== undefined && (!integer(count) || count < 1 || count > 1024) ||
          size !== undefined && (!finite(size) || size <= 0) || seed !== undefined && !integer(seed)))
        throw new RangeError('Scatter needs a positive stamp size, a count from 1 to 1024 and an integer seed');
      if (!overlap(pointBounds(points, radius + (mode === 'scatter' ? size ?? radius * .15 : 0)), bounds))
        throw new RangeError('Brush stroke must touch the selected region: ' + id);
      seen.add(id);
    }
    return { bounds, grid, solids, cell, chunkCells, strokes };
  }

  function compileStroke(stroke, sceneSeed) {
    const { id, mode, points, radius, material = 'stone', shape = 'ball' } = stroke;
    const owner = index => 'brush:' + JSON.stringify([id, index]);
    let entries, margin = radius;
    if (mode === 'place' || mode === 'scatter') {
      let positions = points;
      if (mode === 'scatter') {
        const dice = K.grow.dice(hash(id, stroke.seed ?? sceneSeed)), count = stroke.count ?? 12;
        margin = stroke.size ?? radius * .15;
        positions = Array.from({ length: count }, (_, i) => {
          const center = points[Math.floor(i * points.length / count)];
          const angle = dice() * 2 * Math.PI, offset = Math.sqrt(dice()) * radius;
          return [center[0] + Math.cos(angle) * offset, center[1], center[2] + Math.sin(angle) * offset];
        });
      }
      entries = positions.map((point, i) => ({
        owner: owner(i),
        bounds: pointBounds([point], margin),
        sdf: (shape === 'box' ? K.shape.box(point, [margin, margin, margin]) : K.shape.sphere(point, margin)).sd
      }));
    } else {
      entries = points.length === 1 ? [{ owner: owner(0), bounds: pointBounds(points, radius), sdf: K.shape.sphere(points[0], radius).sd }] :
        points.slice(1).map((point, i) => ({ owner: owner(0), bounds: pointBounds([points[i], point], radius),
          sdf: V.dist(points[i], point) > 1e-8 ? K.shape.capsule(points[i], point, radius).sd : K.shape.sphere(point, radius).sd }));
    }
    const bounds = {
      min: [0, 1, 2].map(i => entries.reduce((n, entry) => Math.min(n, entry.bounds.min[i]), Infinity)),
      max: [0, 1, 2].map(i => entries.reduce((n, entry) => Math.max(n, entry.bounds.max[i]), -Infinity))
    };
    return { id, mode, material, bounds, entries, signature: JSON.stringify(stroke) };
  }

  function compileScene(spec, env, region, settings) {
    const { brushRegion, solids, ...rest } = spec;
    const selected = new Set(region.solids), { grid, cell, chunkCells } = region;
    const base = DIO.build({ ...rest, solids }, env);
    let backdrop = base;
    if (selected.size) {
      const keep = [], { objects, objectIds } = base.renderMetadata;
      const lo = grid.min.map(n => n * cell), hi = grid.max.map(n => n * cell);
      for (let i = 0; i < base.count; i++) {
        if (!selected.has(objects[objectIds[i]]) || lo.some((n, axis) =>
            base.data[i * 16 + axis] < n || base.data[i * 16 + axis] >= hi[axis])) keep.push(i);
      }
      backdrop = SplatProvenance.subset(base, keep);
    }
    const field = selected.size ? DIO.brushField({ ...rest, parts: undefined,
      solids: solids.filter(solid => selected.has(solid.id) || solid.carve) }, env) : null;
    const sun = V.norm(settings.sun), { min, max } = region.bounds;
    const domain = K.shape.box(V.lerp(min, max, .5), V.mul(V.sub(max, min), .5)).sd;
    const chunks = [];
    for (let x = grid.min[0]; x < grid.max[0]; x += chunkCells)
      for (let y = grid.min[1]; y < grid.max[1]; y += chunkCells)
        for (let z = grid.min[2]; z < grid.max[2]; z += chunkCells) {
          const min = [x, y, z], max = min.map((n, i) => Math.min(n + chunkCells, grid.max[i]));
          chunks.push({ key: min.join('/'), grid: { min, max }, bounds: {
            min: min.map(n => n * cell), max: max.map(n => n * cell)
          } });
        }
    return { backdrop, field, sun, domain, chunks, entries: new Map(), compiled: new Map() };
  }

  function bakeChunk(state, chunk, active, region, settings, seed, surface) {
    const { cell } = region, band = cell * 2;
    const geometry = active.filter(op => op.mode !== 'paint');
    const sdf = (x, y, z) => {
      let d = clamp(state.field?.sdf(x, y, z) ?? band, -band, band);
      const limit = state.domain(x, y, z);
      for (const { mode, entries } of geometry) {
        let value = band;
        for (const entry of entries) value = Math.min(value, entry.sdf(x, y, z));
        const clipped = Math.max(value, limit);
        d = mode === 'erase' ? Math.max(d, -clipped) : Math.min(d, clipped);
      }
      return clamp(d, -band, band);
    };
    if (!surface) surface = P.geometry.surfaceNets(sdf, chunk.bounds, { cell, latticeBounds: chunk.grid, topology: false, refine: 1 });
    function materialAt(probe, point, normal) {
      const source = state.field?.surfaceAt(...probe, true);
      const base = source?.distance <= 0 && state.field.materialAt(source.material, point, normal);
      let sample = base ? {
        owner: source.owner, material: base.materialId, target: base.surfaceId ? { surface: base.surfaceId, ...source.target } : source.target,
        ramp: base.rf?.(...probe) || base.r
      } : null;
      if (!contains(region.bounds, probe)) return sample;
      for (const op of active) {
        const entry = op.entries.find(item => contains(item.bounds, probe) && item.sdf(...probe) <= 0);
        if (!entry) continue;
        if (op.mode === 'erase') sample = null;
        else if (op.mode === 'paint') {
          if (sample) sample = { ...sample, material: op.material, ramp: settings.roles[op.material] };
        } else if (!sample) sample = { owner: entry.owner, material: op.material, ramp: settings.roles[op.material],
          target: { entity: 'brush-stroke:' + op.id, surface: 'brush-region' } };
      }
      return sample;
    }
    const B = makeBuilder(hash(chunk.key, seed), settings.palette, { initialCapacity: Math.max(1, surface.points.length) });
    const ids = [];
    for (const [i, point] of surface.points.entries()) {
      const normal = surface.normals[i], sample = materialAt(V.mad(point, normal, -cell * .1), point, normal) ??
        materialAt(V.mad(point, normal, -cell * .35), point, normal);
      if (!sample?.ramp?.length) continue;
      const shade = clamp((V.dot(normal, state.sun) + .23) / 1.23, 0, 1);
      const color = B.P[sample.ramp[Math.round(shade * (sample.ramp.length - 1))]];
      if (!color) continue;
      const first = B.count();
      B.disc(...point, normal, cell * .74, cell * .115, color, 1.3);
      B.describeSplats(first, B.count(), { object: sample.owner, material: sample.material, target: sample.target });
      const xyz = surface.active[i].key.split('/').map((n, axis) => Number(n) + chunk.grid.min[axis]);
      ids.push('brush-surface:' + xyz.join('/'));
    }
    const { data, count, moving, back, renderMetadata, pal } = B.finish();
    return { surface, splats: Object.freeze({ data: data.slice(), count, moving, back, renderMetadata, pal, splatIds: freeze(ids) }) };
  }

  function create() {
    let sourceKey, state;
    return Object.freeze({
      build(spec, env, settings) {
        const region = prepare(spec, settings.roles), { strokes, ...layout } = region;
        const key = JSON.stringify([{ ...spec, brushRegion: layout }, settings]);
        const current = key === sourceKey ? state : compileScene(spec, env, region, settings);
        const seed = spec.seed ?? 1, compiled = new Map();
        const ops = strokes.map(stroke => {
          const signature = JSON.stringify(stroke);
          const op = current.compiled.get(signature) ?? compileStroke(stroke, seed);
          compiled.set(signature, op);
          return op;
        });
        const entries = new Map(), rebuilt = [], sampled = [];
        for (const chunk of current.chunks) {
          const bounds = expand(chunk.bounds, region.cell * 2);
          const active = ops.filter(op => overlap(op.bounds, bounds))
            .map(op => ({ ...op, entries: op.entries.filter(entry => overlap(entry.bounds, bounds)) }))
            .filter(op => op.entries.length);
          const signature = JSON.stringify(active.map(op => op.signature));
          const geometry = JSON.stringify(active.filter(op => op.mode !== 'paint').map(op => op.signature));
          const before = current.entries.get(chunk.key);
          if (before?.signature === signature) {
            entries.set(chunk.key, before);
            continue;
          }
          const reuse = before?.geometry === geometry ? before.surface : undefined;
          const value = bakeChunk(current, chunk, active, region, settings, seed, reuse);
          entries.set(chunk.key, { ...value, signature, geometry });
          rebuilt.push(chunk.key);
          if (!reuse) sampled.push(chunk.key);
        }
        const chunks = new Map([...entries].map(([key, value]) => [key, value.splats]));
        const work = freeze({ rebuilt, sampled, reused: entries.size - rebuilt.length });
        const backdrop = current.backdrop;
        const world = SplatProvenance.join([backdrop, ...chunks.values()], { ...backdrop, spec,
          ...(!spec.camera?.target && !backdrop.count && { cam: { ...backdrop.cam, target: V.lerp(region.bounds.min, region.bounds.max, .5) } }),
          brushRegion: Object.freeze({ chunks, work }) });
        sourceKey = key;
        state = { ...current, entries, compiled };
        return world;
      }
    });
  }

  K.authoring.brushRegions = Object.freeze({ prepare, create });
})(KIT);
