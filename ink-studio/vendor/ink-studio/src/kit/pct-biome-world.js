/* Headless chunk realization from biome intent and one shared physical frame. */
(function (K) {
  const P = K.procedural, { freeze, hash, clone } = P.data;
  const V = K.V, finite = Number.isFinite, integer = Number.isSafeInteger;
  const coordinates = (v, length, check = finite) => Array.isArray(v) && v.length === length && Array.from(v).every(check);
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const named = v => typeof v === 'string' && v.length > 0;
  const positive = v => finite(v) && v > 0;
  const checked = (v, what) => { if (!finite(v)) throw new RangeError(what + ' returned a nonfinite value'); return v; };

  function segmentInBox(a, b, box) {
    let lo = 0, hi = 1;
    const delta = V.sub(b, a);
    for (let i = 0; i < 3; i++) {
      if (delta[i] === 0) {
        if (a[i] < box.min[i] || (i === 1 ? a[i] > box.max[i] : a[i] >= box.max[i])) return null;
      } else {
        const enter = (box.min[i] - a[i]) / delta[i], exit = (box.max[i] - a[i]) / delta[i];
        lo = Math.max(lo, Math.min(enter, exit));
        hi = Math.min(hi, Math.max(enter, exit));
        if (hi <= lo) return null;
      }
    }
    return [V.mad(a, delta, lo), V.mad(a, delta, hi)];
  }

  function latticeField(grid, bounds, cell, values) {
    const cells = grid.max.map((v, i) => v - grid.min[i]), size = freeze(cells.map(v => v + 1));
    const at = (x, y, z) => values[x + size[0] * (y + size[1] * z)];
    function sample(x, y, z) {
      const point = [x, y, z];
      if (!P.spatial.contains(bounds, point)) return null;
      const q = point.map((v, i) => v === bounds.min[i] ? 0 : v === bounds.max[i] ? cells[i] :
        Math.max(0, Math.min(cells[i], v / cell - grid.min[i])));
      const base = q.map((v, i) => Math.min(cells[i] - 1, Math.floor(v)));
      const fraction = q.map((v, i) => v - base[i]);
      let sum = 0;
      for (const [dx, dy, dz] of P.geometry.hermite.corners) {
        const w = (dx ? fraction[0] : 1 - fraction[0]) * (dy ? fraction[1] : 1 - fraction[1]) *
          (dz ? fraction[2] : 1 - fraction[2]);
        sum += w * at(base[0] + dx, base[1] + dy, base[2] + dz);
      }
      return sum;
    }
    return Object.freeze({ size, cell, origin: bounds.min, sample, values: () => values.slice() });
  }

  function pointLighting({ lights = [], ambient = 1 } = {}) {
    if (!Array.isArray(lights) || lights.length > 256 || !finite(ambient) || ambient < 0 || ambient > 2)
      throw new RangeError('Surface lighting needs bounded lights and ambient intensity');
    const nearby = P.spatial.pointIndex(Array.from(lights, raw => {
      const { point, radius, color = [1, 1, 1], strength = 1, wrap = 0.24 } = raw ?? {};
      if (!coordinates(point, 3) || !positive(radius) ||
          !coordinates(color, 3, v => finite(v) && v >= 0 && v <= 1) ||
          !finite(strength) || strength < 0 || strength > 8 || !finite(wrap) || wrap < 0 || wrap > 1)
        throw new RangeError('A point lamp needs XYZ, a positive radius, RGB, strength and wrap');
      return { point: point.slice(), color: color.slice(), radius, strength, wrap,
        bounds: { min: point.map(v => v - radius), max: point.map(v => v + radius) } };
    }));
    return (rgb, { point, normal }) => {
      const lit = rgb.map(v => v * ambient);
      nearby(point, lamp => {
        const delta = V.sub(lamp.point, point), distance = V.len(delta);
        if (distance >= lamp.radius) return;
        const facing = distance ? Math.max(0, V.dot(normal, delta) / distance) : 1;
        const falloff = (1 - distance / lamp.radius) ** 2, power = lamp.strength * falloff *
          (lamp.wrap + (1 - lamp.wrap) * facing);
        for (let i = 0; i < 3; i++) lit[i] += lamp.color[i] * (95 + rgb[i] * 0.6) * power;
      });
      return lit.map(v => Math.min(255, v));
    };
  }

  function create({
    height, caves = [], cell = 0.25, chunkCells = 16, verticalCells = [-24, 24], terrainSlope = 1,
    layers = [], project, emit, palette = [0x13232b, 0x435a58, 0x78927a, 0xbdba92, 0xede0b9], materialRamps = {},
    dependencyHalo = 0, maxSplats = 50000, surfaceScatter = 0, shadeSurface, renderMetadata = true
  } = {}) {
    if (typeof height !== 'function' || !positive(cell) || cell < 1e-6 || !integer(chunkCells) || chunkCells < 1 ||
        !coordinates(verticalCells, 2, integer) || verticalCells[0] >= verticalCells[1] ||
        verticalCells[1] - verticalCells[0] > 4096 || verticalCells.some(v => Math.abs(v * cell) >= 1e6) ||
        chunkCells ** 2 * (verticalCells[1] - verticalCells[0]) > 250000 || !finite(terrainSlope) || terrainSlope < 0 ||
        !Array.isArray(caves) || !Array.isArray(layers) || layers.length > 64 ||
        (emit !== undefined && typeof emit !== 'function') || (project !== undefined && typeof project !== 'function') ||
        (shadeSurface !== undefined && typeof shadeSurface !== 'function') || typeof renderMetadata !== 'boolean' ||
        !Array.isArray(palette) || !palette.length || palette.length > 64 ||
        !Array.from(palette).every(v => integer(v) && v >= 0 && v <= 0xffffff) ||
        !finite(dependencyHalo) || dependencyHalo < 0 || !integer(maxSplats) || maxSplats < 1 ||
        !finite(surfaceScatter) || surfaceScatter < 0 || surfaceScatter > 0.35)
      throw new Error('Invalid headless biome world options');
    if (!materialRamps || typeof materialRamps !== 'object' || Array.isArray(materialRamps))
      throw new Error('Brick materials need a map of RGB ramps');
    const ramps = new Map(Object.entries(materialRamps).map(([id, ramp]) => {
      if (!named(id) || !Array.isArray(ramp) || !ramp.length || ramp.length > 64 ||
          !Array.from(ramp).every(v => integer(v) && v >= 0 && v <= 0xffffff))
        throw new Error('Brick material ramps need nonempty IDs and packed RGB colors');
      return [id, ramp.map(v => [v >> 16, (v >> 8) & 255, v & 255])];
    }));
    const pal = Object.freeze(palette.slice()), [bottom, top] = verticalCells, size = cell * chunkCells;
    const caveIndex = P.spatial.pointIndex(Array.from(caves, cave => {
      if (!coordinates(cave?.bounds?.min, 3) || !coordinates(cave?.bounds?.max, 3) || typeof cave.sdf !== 'function')
        throw new Error('A biome cave needs XYZ bounds and a negative-inside field');
      return { bounds: cave.bounds, sdf: cave.sdf };
    }));
    const names = new Set();
    const population = Array.from(layers, layer => {
      if (!named(layer?.id) || names.has(layer.id) || (layer.height !== undefined && typeof layer.height !== 'function') ||
          (layer.habitatOffset !== undefined && !finite(layer.habitatOffset)))
        throw new Error('Population layers need unique IDs and optional height samplers and offsets');
      names.add(layer.id);
      const options = P.populations.parameters(clone(layer.options ?? {}));
      return { id: layer.id, height: layer.height, habitatOffset: layer.habitatOffset, options };
    }).sort((a, b) => order(a.id, b.id));
    const halo = Math.max(dependencyHalo, cell, ...population.map(({ options }) =>
      options.exclusion ? options.exclusion.maxDistance + options.spacing : 0));
    const frames = new WeakMap(), realizations = new WeakMap(), geometry = new WeakMap(),
      emptyWater = P.waterBodies.scene([]);
    const sun = V.norm([-0.43, 0.84, 0.31]), slopeFactor = 1 / Math.hypot(1, terrainSlope);
    const epsilon = cell * 0.027;

    function prepare(source, { water = emptyWater, time = 0, bricks = null, geometryFrom } = {}) {
      if (typeof source?.withEnvironment !== 'function' || typeof water?.changesFrom !== 'function' || !finite(time) ||
          (bricks !== null && !P.sparseBricks.isSnapshot(bricks)))
        throw new Error('A world frame needs a biome recipe view, a water scene, finite time and optional sparse bricks');
      const carrier = frames.get(geometryFrom);
      if (geometryFrom !== undefined && (!carrier || carrier.source !== source || geometryFrom.bricks !== bricks ||
          geometryFrom.time !== time))
        throw new TypeError('Expected prepared geometry from the same authored inputs');
      const terrain = carrier ? null : source.withEnvironment({ media: water.media, solid: undefined, project: undefined });
      const heightAt = geometryFrom?.heightAt ?? ((x, z) => {
        const base = checked(height(x, z), 'Terrain height');
        return checked(base + terrain.heightOffsetAt(x, base, z, time), 'Realized height');
      });
      function field(sampleHeight) {
        function base(x, y, z) {
          const point = [x, y, z];
          let value = (y - sampleHeight(x, z)) * slopeFactor;
          caveIndex(point, ({ sdf }) => {
            value = Math.max(value, -checked(sdf(x, y, z), 'Cave field'));
          });
          return value;
        }
        return bricks?.stats.sculpted ? (x, y, z) => bricks.distance(x, y, z, base) : base;
      }
      const evaluate = field(heightAt);
      // Span and graph builds repeatedly sample several heights at the same XZ.
      function sampledDistance() {
        const columns = new Map();
        let size = 0;
        return field((x, z) => {
          let column = columns.get(x);
          if (column?.has(z)) return column.get(z);
          const y = heightAt(x, z);
          if (size < 65536) {
            if (!column) columns.set(x, column = new Map());
            column.set(z, y);
            size++;
          }
          return y;
        });
      }
      function distance(x, y, z) {
        if (![x, y, z].every(finite)) throw new Error('World collision queries need finite XYZ coordinates');
        return evaluate(x, y, z);
      }
      function normalOf(sample, x, y, z) {
        return [sample(x + epsilon, y, z) - sample(x - epsilon, y, z),
          sample(x, y + epsilon, z) - sample(x, y - epsilon, z),
          sample(x, y, z + epsilon) - sample(x, y, z - epsilon)];
      }
      function supports(x, z, low, high) {
        if (![x, z, low, high].every(finite) || low > high) throw new Error('Supports need a finite ordered height range');
        const start = Math.max(low, bottom * cell), end = Math.min(high, top * cell), result = [];
        if (end < start) return result;
        const count = Math.max(1, Math.ceil((end - start) / (cell * 0.5)));
        let last = start - epsilon, wasIn = distance(x, last, z) < 0;
        for (let i = 0; i <= count; i++) {
          const y = start + (end - start) * i / count, inside = distance(x, y, z) < 0;
          if (wasIn && !inside) {
            let a = last, b = y;
            for (let j = 0; j < 18; j++) {
              const m = (a + b) / 2;
              if (distance(x, m, z) < 0) a = m;
              else b = m;
            }
            const normal = V.norm(normalOf(distance, x, b, z));
            if (b >= start - epsilon && normal[1] > 0) {
              const surface = Math.abs(heightAt(x, z) - b) < epsilon ? 'terrain' : 'cave';
              result.push({ y: b, normal, id: surface });
              if (result.length > 256) throw new RangeError('World support count exceeds the traversal budget');
            }
          }
          last = y;
          wasIn = inside;
        }
        return result;
      }
      const geometry = Object.freeze({ heightAt, distance, supports });
      function onSupport(point, feature) {
        if (project) return project(point, feature, geometry);
        const [x, y, z] = point, all = supports(x, z, bottom * cell, top * cell);
        all.sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y));
        return all.length ? [x, all[0].y, z] : point;
      }
      const view = source.withEnvironment({ media: water.media, solid: distance,
        project: onSupport });

      function traceRoute(points, { radius = 0.18, stride = Math.min(cell / 4, radius / 2), maxSamples = 16000 } = {}) {
        const route = P.routes.polyline(points);
        if (!positive(radius) || !positive(stride) || stride > radius || !integer(maxSamples) || maxSamples < 1 ||
            Math.ceil(route.length / stride) + points.length > maxSamples)
          throw new Error('Route needs a positive radius and bounded stride and sample count');
        const media = [];
        let count = 0, clearance = Infinity;
        for (let i = 1; i < route.points.length; i++) {
          const start = route.points[i - 1], end = route.points[i], delta = V.sub(end, start);
          const length = V.len(delta), steps = Math.ceil(length / stride);
          for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
            const point = V.mad(start, delta, j / steps), gap = distance(...point);
            count++;
            clearance = Math.min(clearance, gap);
            if (gap < radius + stride / 2) return freeze({ ok: false, blocked: point, clearance, count, media });
            const { kind, id } = view.mediumAt(...point, time);
            if (media.at(-1)?.kind !== kind || media.at(-1)?.id !== id) media.push({ kind, id, point });
          }
        }
        return freeze({ ok: true, clearance, count, media });
      }
      const frame = Object.freeze({ water, view, time, bricks, ...geometry, traceRoute,
        bakeSpans: options => P.verticalSpans.bake({ ...options, solid: sampledDistance() }),
        bakeSpanTiles: options => P.verticalSpans.bakeTiles({ ...options, solid: sampledDistance() }),
        traversalGraph: options => P.traversalGraph.create({ ...options, clearance: sampledDistance() }),
        traversal: body => P.traversal.create({ ...body, supports, clearance: point => distance(...point) }) });
      frames.set(frame, { field, normalOf, source, carrier: carrier?.carrier ?? geometryFrom ?? null });
      return frame;
    }

    function address(index) {
      if (!coordinates(index, 2, integer) || index.some(v => Math.abs(v * size) > 1e6 - size))
        throw new Error('A biome chunk needs finite, bounded integer XZ indices');
      const [x, z] = index.map(v => v * chunkCells);
      const grid = { min: [x, bottom, z], max: [x + chunkCells, top, z + chunkCells] };
      const bounds = freeze({ min: grid.min.map(v => v * cell), max: grid.max.map(v => v * cell) });
      return { index: index.slice(), key: index.join('/'), grid, bounds };
    }

    function build(frame, index, retained) {
      const internals = frames.get(frame);
      if (!internals) throw new Error('Expected a frame from this biome world');
      const { key, grid, bounds } = address(index), { view, time, bricks } = frame;
      const columns = new Map();
      function heightAt(x, z) {
        const id = x + '/' + z;
        if (!columns.has(id)) columns.set(id, frame.heightAt(x, z));
        return columns.get(id);
      }
      const distance = internals.field(heightAt);
      const sampled = retained ?? captureSurface();
      function captureSurface() {
        const surface = P.geometry.surfaceNets(distance, bounds, {
          cell, latticeBounds: grid, topology: false, refine: 1, captureField: true,
          normal: (x, y, z) => internals.normalOf(distance, x, y, z)
        });
        if (surface.points.length > maxSplats) throw new RangeError('Biome chunk exceeds its splat budget');
        return { vertices: surface.points.map((point, i) => scatter(point, surface.normals[i], surface.active[i].key)),
          field: latticeField(grid, bounds, cell, surface.fieldSamples()), work: surface.work };
      }
      function scatter(point, normal, localKey) {
        const coord = localKey.split('/').map((v, axis) => Number(v) + grid.min[axis]);
        const id = 'surface/' + coord.join('/');
        if (surfaceScatter > 0) {
          const dice = K.grow.dice(hash(id, view.seed));
          const tangent = V.norm(V.cross(normal, Math.abs(normal[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
          const bitangent = V.cross(normal, tangent), amount = cell * surfaceScatter;
          const candidate = V.mad(V.mad(point, tangent, (dice() * 2 - 1) * amount), bitangent, (dice() * 2 - 1) * amount);
          const slope = (distance(...V.mad(candidate, normal, epsilon)) -
            distance(...V.mad(candidate, normal, -epsilon))) / (2 * epsilon);
          const offset = slope > 0.02 ? distance(...candidate) / slope : Infinity;
          if (Math.abs(offset) <= amount) {
            const projected = V.mad(candidate, normal, -offset);
            if (Math.abs(distance(...projected)) <= epsilon * 1.5) point = projected;
          }
        }
        return { id, point, normal, surfaceY: heightAt(point[0], point[2]) };
      }
      const builder = makeBuilder(hash(key, view.seed), pal, {
        renderMetadata, initialCapacity: Math.max(1, sampled.vertices.length)
      }), ids = [];
      const owned = p => P.spatial.contains(bounds, p) && p[0] < bounds.max[0] && p[2] < bounds.max[2];
      const terrainTarget = { surface: 'terrain' };
      for (const { id, point, normal, surfaceY } of sampled.vertices) {
        const shade = Math.max(0, V.dot(normal, sun));
        const paint = bricks && ramps.size ? bricks.attributes(...V.mad(point, normal, -cell * 0.22)).material : null;
        const painted = ramps.get(paint);
        const material = painted ? null : view.materialAt(...point, { surfaceY, time, probe: V.mad(point, normal, cell * 0.22) });
        const ramp = painted ?? material.ramp;
        const swatch = ramp[Math.round(shade * (ramp.length - 1))];
        const color = painted ? swatch : swatch.map(v => Math.round(v * 255));
        const shaded = shadeSurface?.(color.slice(), { point: point.slice(), normal: normal.slice(), frame }) ?? color;
        if (shadeSurface && !coordinates(shaded, 3, v => finite(v) && v >= 0 && v <= 255))
          throw new RangeError('Surface shading needs an RGB color in [0, 255]');
        const first = builder.count();
        builder.disc(...point, normal, cell * (0.52 + surfaceScatter * 0.24), cell * 0.11, shaded, 1);
        builder.describeSplats?.(first, builder.count(), { material: painted ? paint : material.stratum.material, target: terrainTarget });
        ids.push(id);
      }
      const placements = [];
      const ground = (x, z) => {
        const y = heightAt(x, z);
        if (bricks?.affectsColumn(x, z) && !(distance(x, y, z) === 0 &&
            distance(x, y - epsilon, z) < 0 && distance(x, y + epsilon, z) > 0)) {
          const found = frame.supports(x, z, bottom * cell, top * cell);
          return found.reduce((nearest, support) => nearest === null || Math.abs(support.y - y) < Math.abs(nearest - y) ?
            support.y : nearest, null);
        }
        return distance(x, y - epsilon, z) < 0 ? y : null;
      };
      for (const layer of population) {
        const plan = view.populate(bounds, { ...layer.options, layer: layer.id, time, habitatOffset: layer.habitatOffset,
          height: layer.height ? (x, z) => layer.height(x, z, frame) : ground });
        for (const row of plan.instances) if (owned(row.sample.position)) {
          placements.push({ kind: 'population', id: 'population/' + row.id, point: row.sample.position, asset: row.sample.asset,
            species: row.sample.species, biome: row.sample.biome, seed: row.seed, yaw: row.yaw, scale: row.scale });
        }
      }
      for (const marker of view.layout.landmarks) if (owned(marker.point)) {
        const id = 'landmark/' + JSON.stringify([marker.region, marker.id]);
        placements.push({ ...marker, kind: 'landmark', id, seed: hash(id, view.seed) });
      }
      const routes = [];
      for (const route of view.layout.routes) for (let i = 1; i < route.points.length; i++) {
        const points = segmentInBox(route.points[i - 1], route.points[i], bounds);
        if (points) routes.push({ region: route.region, route: route.id, segment: i - 1, points, pinned: route.pinned });
      }
      const scenePlacements = freeze(placements.sort((a, b) => order(a.id, b.id)));
      for (const item of scenePlacements) {
        const first = builder.count();
        if (emit) emit(builder, item, frame);
        else {
          builder.iso(...item.point, cell * 0.22, builder.P.at(-1), 1);
          builder.describeSplats?.(first, builder.count(), { object: item.id });
        }
        for (let i = first; i < builder.count(); i++) ids.push(item.id + '/' + (i - first));
        if (builder.count() > maxSplats) throw new RangeError('Biome chunk exceeds its splat budget');
      }
      if (builder.count() > maxSplats) throw new RangeError('Biome chunk exceeds its splat budget');
      const { data, count, moving, back, renderMetadata: metadata, surfaceData, surfaces, materialAlbedo,
        pix, fine, attr, ramps: pixelRamps, rampOff, pats } = builder.finish();
      const packed = data.byteLength === data.buffer.byteLength ? data : data.slice();
      const chunk = Object.freeze({ key, index: freeze(index.slice()), bounds, placements: scenePlacements, routes: freeze(routes),
        field: sampled.field, work: freeze({ ...sampled.work, heightColumns: columns.size, reusedSurface: Boolean(retained) }),
        splats: Object.freeze({ data: packed, count, moving, back, ids: freeze(ids), renderMetadata: metadata,
          surfaceData, surfaces, materialAlbedo, pix, fine, attr, ramps: pixelRamps, rampOff, pats }) });
      geometry.set(chunk, sampled);
      return chunk;
    }

    function makeWorld(frame, chunks, meta = {}) {
      if (!frames.has(frame) || !Array.isArray(chunks)) throw new Error('Expected a prepared frame and built chunks');
      const sorted = chunks.slice().sort((a, b) => order(a.key, b.key));
      if (sorted.some((chunk, i) => i > 0 && chunk.key === sorted[i - 1].key))
        throw new Error('World chunks need distinct keys');
      return SplatProvenance.join(sorted.map(chunk => chunk.splats), {
        radius: 14, detail: 1 / cell, dither: 1, fog: { c: 0, start: 1, max: 0 },
        ...meta, cam: { target: [0, 0, 0], dist: 12, yaw: 0, pitch: 0, ...meta.cam }, water: frame.water, pal
      });
    }

    let published, queue = Promise.resolve();
    const initial = P.chunks.create({ preview: ({ input }, { previous }) =>
      build(input.frame, input.index, input.reuseGeometry ? geometry.get(previous) : undefined) });
    async function realize(frame, indices, { previous, changes } = {}) {
      if (!frames.has(frame) || !Array.isArray(indices) || indices.length > 4096)
        throw new Error('Expected a prepared frame and a bounded chunk set');
      const old = realizations.get(previous);
      if (previous !== undefined && !old) throw new TypeError('Expected a realization from this biome compiler');
      const requests = indices.map(address);
      const before = previous?.frame;
      let geometryDirty = [], dirty = [], global = false;
      if (before && changes) {
        const relevant = changes.filter(row=>row.field !== 'render/layout');
        geometryDirty = relevant.filter(row=>row.field === 'terrain/solid' && row.bounds).map(row=>row.bounds);
        dirty = relevant.filter(row=>row.bounds).map(row=>row.bounds);
        global = relevant.some(row=>row.bounds === null);
      } else if (before) {
        const intent = frame.view.changesFrom(before.view);
        const changedBricks = frame.bricks?.changesFrom(before.bricks) ?? before.bricks?.changesFrom(null) ?? [];
        geometryDirty = [...intent.regions,...changedBricks];
        dirty = [...geometryDirty,...frame.water.changesFrom(before.water)];
        global = intent.global || before.time !== frame.time;
      }
      const all = global || dirty.length > 4096;
      const shareCarrier = before && (frame.water === before.water || frames.get(frame).carrier && frames.get(before).carrier);
      const horizontal = box => ({ min: [box.min[0], bottom * cell, box.min[2]], max: [box.max[0], top * cell, box.max[2]] });
      const dirtySurfaces = geometryDirty.map(horizontal), cache = (old ?? initial).fork();
      const patch = await cache.update(requests.map(({ index, key, bounds }) => ({
        key, revision: 1, bounds: P.spatial.expand(bounds, halo),
        input: { index, frame, reuseGeometry: Boolean(shareCarrier && !global &&
          !dirtySurfaces.some(box => P.spatial.overlap(P.spatial.expand(bounds, cell), box))) }
      })), {
        changedIds: all ? requests.map(row => row.key) : [],
        regions: all ? [] : dirty.map(horizontal)
      });
      const result = Object.freeze({ sequence: patch.sequence, frame, removed: patch.removed,
        replaced: Object.freeze(patch.replaced.map(row => row.value)),
        chunks: Object.freeze(cache.entries().map(row => row.value)) });
      realizations.set(result, cache);
      return result;
    }
    function update(frame, indices) {
      const pending = queue.then(async () => {
        const result = await realize(frame, indices, { previous: published });
        published = result;
        const { sequence, removed, replaced } = result;
        return Object.freeze({ sequence, frame, removed, replaced });
      });
      queue = pending.catch(() => {});
      return pending;
    }
    const empty = Object.freeze([]);
    return Object.freeze({ prepare, build: (frame, index) => build(frame, index), realize, update, makeWorld,
      frame: () => published?.frame ?? null, chunks: () => published?.chunks ?? empty });
  }

  P.biomeWorld = Object.freeze({ create, pointLighting });
})(KIT);
