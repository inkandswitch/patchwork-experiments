/* World-space biome weights and exact medium membership. */
(function (K) {
  const P = K.procedural;
  const { pointIndex } = P.spatial;
  const finite = Number.isFinite;
  const name = value => typeof value === 'string' && value.trim().length > 0;
  const vector = value => Array.isArray(value) && value.length === 3 &&
    finite(value[0]) && finite(value[1]) && finite(value[2]);
  const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const zero = Object.freeze([0, 0, 0]);
  const empty = Object.freeze({});
  const dryMedium = (kind, id = null) => Object.freeze({ kind, id, surface: null, depth: 0, current: zero });
  const air = dryMedium('air');
  const rock = dryMedium('solid');

  function compileRows(rows, type, prepare) {
    if (!Array.isArray(rows)) throw new TypeError('Biome ' + type + ' must be an array');
    const ids = new Set();
    return pointIndex(Array.from(rows, raw => {
      const id = raw?.id;
      if (!name(id) || ids.has(id)) throw new TypeError('Biome ' + type + ' need unique nonempty IDs');
      ids.add(id);
      if (!vector(raw.bounds?.min) || !vector(raw.bounds?.max))
        throw new TypeError('Biome ' + type + ' need finite XYZ bounds');
      return { id, bounds: raw.bounds, ...prepare(raw) };
    }));
  }

  const validWeight = weight => finite(weight) && weight >= 0 && weight <= 1;
  const optionalField = field => field === undefined || typeof field === 'function';

  function create({ fallback = 'default', regions = [], media = [], solid, conditions } = {}) {
    if (!name(fallback) || !optionalField(solid) || !optionalField(conditions))
      throw new TypeError('Biomes need a fallback ID and optional solid and conditions samplers');
    const regionIndex = compileRows(regions, 'regions', ({ id, biome = id, weight = 1 }) => {
      if (!name(biome) || !(typeof weight === 'function' || validWeight(weight)))
        throw new TypeError('Biome regions need a biome ID and weight in [0, 1] or a weight sampler');
      return { biome, weight };
    });
    const mediumIndex = compileRows(media, 'media', ({ id, kind, priority = 0, sdf, surface, surfaceAt, current }) => {
      if ((kind !== 'air' && kind !== 'water') || !Number.isSafeInteger(priority) || !optionalField(sdf))
        throw new TypeError('Biome media need an air or water kind, integer priority and optional SDF');
      if (kind === 'air') {
        if (surface !== undefined || surfaceAt !== undefined || current !== undefined)
          throw new TypeError('Only water has a surface and current');
        return { priority, sdf, fixed: dryMedium(kind, id) };
      }
      if (!(surfaceAt === undefined ? typeof surface === 'function' || finite(surface) :
        typeof surfaceAt === 'function' && surface === undefined) ||
          !(optionalField(current) || vector(current)))
        throw new TypeError('Biome water needs a finite surface height and optional XYZ current');
      return { priority, sdf, surface, surfaceAt, current: vector(current) ? Object.freeze(current.slice()) : current ?? zero };
    });

    function pointAt(x, y, z, time) {
      if (!finite(x) || !finite(y) || !finite(z) || !finite(time))
        throw new RangeError('Biome queries need finite XYZ coordinates and time');
      return [x, y, z];
    }

    function inside(sdf, x, y, z, time) {
      const distance = sdf(x, y, z, time);
      if (!finite(distance)) throw new RangeError('Biome SDF samples must be finite');
      return distance < 0;
    }

    function resolveMedium(point, time) {
      const [x, y, z] = point;
      if (solid && inside(solid, x, y, z, time)) return rock;
      let winner, surfaceY;
      mediumIndex(point, row => {
        const { id, priority, sdf, fixed, surface, surfaceAt } = row;
        if (sdf && !inside(sdf, x, y, z, time)) return;
        let height = null;
        if (!fixed) {
          height = surfaceAt ? surfaceAt(x, y, z, time) : typeof surface === 'function' ? surface(x, z, time) : surface;
          if (!finite(height)) throw new RangeError('Biome water surface samples must be finite');
          if (y >= height) return;
        }
        if (winner && (priority < winner.priority || (priority === winner.priority && id > winner.id))) return;
        winner = row;
        surfaceY = height;
      });
      if (!winner) return air;
      if (winner.fixed) return winner.fixed;
      const { id, current } = winner;
      const depth = surfaceY - y;
      if (!finite(depth)) throw new RangeError('Biome water depth must be finite');
      let flow = current;
      if (typeof current === 'function') {
        flow = current(x, y, z, time);
        if (!vector(flow)) throw new RangeError('Biome water current samples must be finite XYZ vectors');
        flow = Object.freeze(flow.slice());
      }
      return Object.freeze({ kind: 'water', id, surface: surfaceY, depth, current: flow });
    }

    function mediumAt(x, y, z, time = 0) {
      return resolveMedium(pointAt(x, y, z, time), time);
    }

    function evaluate(x, y, z, time, trace) {
      const point = pointAt(x, y, z, time);
      const medium = resolveMedium(point, time);
      let local = empty;
      if (conditions) {
        const values = conditions(x, y, z, time, medium);
        if (values != null) {
          if (typeof values !== 'object' || Array.isArray(values))
            throw new TypeError('Biome conditions must be a record of finite scalar samples');
          const snapshot = { ...values };
          if (!Object.values(snapshot).every(finite))
            throw new TypeError('Biome conditions must be a record of finite scalar samples');
          local = Object.freeze(snapshot);
        }
      }

      const byBiome = new Map(), regions = trace ? [] : null;
      regionIndex(point, ({ id, biome, weight }) => {
        const value = typeof weight === 'function' ? weight(x, y, z, time, local, medium) : weight;
        if (!validWeight(value)) throw new RangeError('Biome weight samples must be in [0, 1]');
        if (value > (byBiome.get(biome) ?? 0)) byBiome.set(biome, value);
        if (trace) regions.push({ id, biome, weight: value });
      });
      const entries = [...byBiome].sort(([a], [b]) => compareIds(a, b));
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      if (total < 1) {
        const index = entries.findIndex(([id]) => id === fallback);
        if (index === -1) entries.push([fallback, 1 - total]);
        else entries[index][1] += 1 - total;
      }
      entries.sort(([a, w], [b, v]) => v - w || compareIds(a, b));
      const weights = entries.map(([id, weight]) => ({ id, weight: weight / Math.max(1, total) }));
      const result = { biome: weights[0].id, weights, medium, conditions: local };
      return trace ? { ...result, regions: regions.sort((a, b) => compareIds(a.id, b.id)) } : result;
    }

    return Object.freeze({
      sample: (x, y, z, time = 0) => evaluate(x, y, z, time, false),
      inspect: (x, y, z, time = 0) => evaluate(x, y, z, time, true),
      mediumAt
    });
  }

  P.biomes = Object.freeze({ create });
})(KIT);
