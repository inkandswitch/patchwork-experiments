/* Height-grid edits driven by the drainage graph, with authored water retained. */
(function (K) {
  const P = K.procedural,
    EPS = 1e-8,
    budget = (n, max) => Number.isSafeInteger(n) && n >= 1 && n <= max,
    positive = n => Number.isFinite(n) && n > 0,
    clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function grid(basin) {
    const source = basin?.grid, fields = basin?.fields,
      { origin, cell, columns, rows } = source ?? {},
      count = columns * rows;
    if (
      !Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isFinite) || !positive(cell) ||
      !budget(columns, 250000) || !budget(rows, 250000) || columns < 2 || rows < 2 || count > 250000 ||
      !['elevation', 'terrainHeight', 'drainageHeight', 'receiver', 'accumulation'].every(k => fields?.[k]?.length === count) ||
      typeof basin?.sample !== 'function'
    ) throw new Error('Terrain analysis needs a complete watershed result');
    const [x0, z0] = origin,
      point = i => [x0 + (i % columns) * cell, z0 + Math.floor(i / columns) * cell],
      span = (a, b) => (a % columns !== b % columns && Math.floor(a / columns) !== Math.floor(b / columns)) ? cell * Math.SQRT2 : cell,
      lake = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const id = fields.lakeIds ? fields.lakeIds[i] : basin.sample(...point(i))?.lakeId;
      lake[i] = id ? 1 : 0;
    }
    function neighbors(i, visit) {
      const x = i % columns, z = Math.floor(i / columns);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dz) || x + dx < 0 || x + dx >= columns || z + dz < 0 || z + dz >= rows) continue;
          visit((z + dz) * columns + x + dx);
        }
    }
    function lookup(field) {
      return (x, z) => {
        const s = (x - x0) / cell, t = (z - z0) / cell;
        if (!Number.isFinite(s) || !Number.isFinite(t) || s < -EPS || t < -EPS || s > columns - 1 + EPS || t > rows - 1 + EPS) return null;
        const i = clamp(Math.floor(s), 0, columns - 2), j = clamp(Math.floor(t), 0, rows - 2),
          dx = clamp(s - i, 0, 1), dz = clamp(t - j, 0, 1),
          a = j * columns + i, b = a + columns,
          lo = field[a] + (field[a + 1] - field[a]) * dx,
          hi = field[b] + (field[b + 1] - field[b]) * dx;
        return lo + (hi - lo) * dz;
      };
    }
    return { count, cell, columns, rows, fields, lake, point, span, neighbors, lookup };
  }

  function breach(basin, { grade = 0.002, maxDepth = 1.25, maxLength = 25, maxPaths = 4000, maxVisits = 1500000 } = {}) {
    if (
      !positive(grade) || grade > 1 || !positive(maxDepth) || !positive(maxLength) ||
      !budget(maxPaths, 40000) || !budget(maxVisits, 10000000)
    ) throw new Error('Breaching needs positive grade, cut limits and a work budget');
    const G = grid(basin),
      { count, fields, lake, point, span, neighbors, lookup } = G,
      { elevation, drainageHeight, receiver } = fields,
      result = new Float64Array(elevation),
      seen = new Uint8Array(count),
      regions = new Int32Array(count),
      channels = [],
      work = { visits: 0, depressionCount: 0 };
    const depressed = index => !lake[index] && drainageHeight[index] - elevation[index] > EPS;
    function check() {
      if (++work.visits > maxVisits) throw new Error('Breaching exceeds its traversal budget');
    }
    for (let i = 0; i < count; i++) {
      if (seen[i] || !depressed(i)) continue;
      if (++work.depressionCount > maxPaths) throw new Error('Breaching exceeds its path budget');
      const region = work.depressionCount, queue = [i];
      seen[i] = 1;
      regions[i] = region;
      let pit = i;
      for (let q = 0; q < queue.length; q++) {
        const index = queue[q];
        check();
        if (elevation[index] < elevation[pit] || (elevation[index] === elevation[pit] && index < pit)) pit = index;
        neighbors(index, next => {
          if (seen[next] || !depressed(next)) return;
          seen[next] = 1;
          regions[next] = region;
          queue.push(next);
        });
      }
      let at = pit, y = result[pit], distance = 0, reason = null;
      const edits = [{ at, y }];
      while (receiver[at] >= 0) {
        check();
        const next = receiver[at], run = span(at, next), bottom = y - grade * run;
        distance += run;
        if (distance > maxLength || edits.length >= 4097) {
          reason = 'length';
          break;
        }
        if (lake[next]) {
          const level = basin.sample(...point(next)).lakeLevel ?? result[next];
          if (level > bottom + EPS) reason = 'lake';
          else edits.push({ at: next, y: level });
          break;
        }
        const natural = result[next];
        y = Math.min(natural, bottom);
        if (elevation[next] - y > maxDepth + EPS) {
          reason = 'depth';
          break;
        }
        edits.push({ at: next, y });
        if (regions[next] !== region && !depressed(next) && natural <= bottom) break;
        at = next;
      }
      const [x, z] = point(pit), from = [x, elevation[pit], z];
      if (reason || edits.length < 2) {
        channels.push(Object.freeze({ status: 'blocked', reason: reason ?? 'outlet', from: Object.freeze(from) }));
        continue;
      }
      let volume = 0;
      for (const { at, y } of edits) {
        if (lake[at]) continue;
        volume += Math.max(0, result[at] - y) * G.cell * G.cell;
        result[at] = y;
      }
      const points = edits.map(({ at, y }) => {
        const [x, z] = point(at);
        return [x, y, z];
      });
      channels.push(Object.freeze({ status: 'ok', from: Object.freeze(from), volume, route: P.routes.polyline(points) }));
    }
    return Object.freeze({ elevation: result, height: lookup(result), channels: Object.freeze(channels), work: Object.freeze(work) });
  }

  function incise(basin, { strength = 0.2, areaExponent = 0.45, slopeExponent = 1,
    areaUnit = 1, maxDepth = 1, steps = 3, minArea = 0, allow, maxWork = 10000000 } = {}) {
    if (
      ![strength, areaExponent, slopeExponent, minArea].every(n => Number.isFinite(n) && n >= 0) ||
      strength > 1000 || areaExponent > 8 || slopeExponent > 8 ||
      !positive(areaUnit) || !positive(maxDepth) || !budget(steps, 128) ||
      !budget(maxWork, 32000000) || (allow !== undefined && typeof allow !== 'function')
    ) throw new Error('Stream-power incision needs finite rates, exponents and limits');
    const { count, fields, lake, point, span, lookup } = grid(basin),
      { terrainHeight, receiver, accumulation } = fields,
      depth = new Float64Array(count),
      valid = new Uint8Array(count);
    if (count * steps > maxWork) throw new Error('Stream-power incision exceeds its cell budget');
    let current = new Float64Array(terrainHeight), next = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const [x, z] = point(i);
      valid[i] = Number(!lake[i] && receiver[i] >= 0 && accumulation[i] >= minArea && (!allow || allow(x, z, current[i])));
    }
    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < count; i++) {
        const old = current[i];
        next[i] = old;
        if (!strength || !valid[i]) continue;
        const j = receiver[i], drop = old - current[j];
        if (drop <= 0) continue;
        const slope = drop / span(i, j),
          erosion = (strength / steps) * (accumulation[i] / areaUnit) ** areaExponent * slope ** slopeExponent,
          delta = Math.min(erosion, drop, Math.max(0, maxDepth - depth[i]));
        next[i] -= delta;
        depth[i] += delta;
      }
      [current, next] = [next, current];
    }
    return Object.freeze({ elevation: current, depth, height: lookup(current), incision: lookup(depth) });
  }

  function habitat(basin, {
    wind = [1, 0], sun = [0.35, 0.8, 0.48], humidity = 0.75, rain = 0.025, uplift = 0.65,
    temperature = 0.7, lapse = 0.08, insolation = 0.2, vaporGain = 0.22,
    waterDistance, waterRange = 1.5
  } = {}) {
    if (
      !Array.isArray(wind) || wind.length !== 2 || !wind.every(Number.isFinite) || !positive(Math.hypot(...wind)) ||
      !Array.isArray(sun) || sun.length !== 3 || !sun.every(Number.isFinite) || !positive(Math.hypot(...sun)) ||
      ![humidity, rain, vaporGain].every(n => Number.isFinite(n) && n >= 0 && n <= 1) ||
      ![uplift, lapse, insolation].every(n => Number.isFinite(n) && n >= 0 && n <= 100) ||
      !Number.isFinite(temperature) || !positive(waterRange) ||
      (waterDistance !== undefined && typeof waterDistance !== 'function')
    ) throw new Error('Habitat fields need wind, a sun direction, and finite climate controls');
    const G = grid(basin),
      { count, cell, columns, rows, fields, lake, point, lookup } = G,
      heights = fields.terrainHeight,
      breezes = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
      alignment = ([x, z]) => (x * wind[0] + z * wind[1]) / Math.hypot(x, z),
      [dx, dz] = breezes.reduce((a, b) => alignment(a) >= alignment(b) ? a : b),
      sunlight = K.V.norm(sun),
      vapor = new Float64Array(count), precipitation = new Float64Array(count),
      moisture = new Float64Array(count), warmth = new Float64Array(count),
      exposure = new Float64Array(count), proximity = new Float64Array(count);
    const range = Math.hypot(dx, dz) * cell,
      zFirst = dz < 0 ? rows - 1 : 0, zStep = dz < 0 ? -1 : 1,
      xFirst = dx < 0 ? columns - 1 : 0, xStep = dx < 0 ? -1 : 1;
    for (let row = 0; row < rows; row++) {
      const z = zFirst + row * zStep;
      for (let col = 0; col < columns; col++) {
        const x = xFirst + col * xStep, i = z * columns + x,
          u = x - dx, v = z - dz,
          prior = u >= 0 && u < columns && v >= 0 && v < rows ? v * columns + u : -1,
          [px, pz] = point(i),
          distance = lake[i] ? 0 : waterDistance ? waterDistance(px, pz) : Infinity;
        if (typeof distance !== 'number' || Number.isNaN(distance)) throw new Error('Water distance must be numeric');
        proximity[i] = Math.exp(-Math.max(0, distance) / waterRange);
        const incoming = prior >= 0 ? vapor[prior] : humidity,
          recharge = 1 - Math.exp(-range * vaporGain * proximity[i]),
          available = incoming + (1 - incoming) * recharge,
          rising = prior < 0 ? 0 : Math.max(0, (heights[i] - heights[prior]) / range),
          loss = 1 - Math.exp(-range * (rain + uplift * rising));
        precipitation[i] = available * loss;
        vapor[i] = available - precipitation[i];
        const dx0 = Math.max(0, x - 1), dx1 = Math.min(columns - 1, x + 1),
          dz0 = Math.max(0, z - 1), dz1 = Math.min(rows - 1, z + 1),
          sx = (heights[z * columns + dx1] - heights[z * columns + dx0]) / ((dx1 - dx0) * cell),
          sz = (heights[dz1 * columns + x] - heights[dz0 * columns + x]) / ((dz1 - dz0) * cell),
          normal = K.V.norm([-sx, 1, -sz]);
        exposure[i] = Math.max(0, K.V.dot(normal, sunlight));
        warmth[i] = temperature - heights[i] * lapse + exposure[i] * insolation;
        moisture[i] = clamp(precipitation[i] * 1.4 + vapor[i] * 0.28 +
          proximity[i] * 0.42 + (fields.wetness?.[i] ?? 0) * 0.22, 0, 1);
      }
    }
    const arrays = { precipitation, vapor, moisture, temperature: warmth, exposure, waterProximity: proximity },
      scalar = Object.entries(arrays).map(([key, data]) => [key, lookup(data)]);
    return Object.freeze({
      fields: Object.freeze(arrays),
      sample(x, z) {
        const first = scalar[0][1](x, z);
        if (first === null) return null;
        return Object.fromEntries(scalar.map(([key, get], i) => [key, i ? get(x, z) : first]));
      }
    });
  }

  Object.assign(P.hydrology, { breach, incise, habitat });
})(KIT);
