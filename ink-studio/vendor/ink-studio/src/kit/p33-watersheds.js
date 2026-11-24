/* Priority-Flood conditioning, D8 drainage, and channel routes on a world-aligned height lattice. */
(function (K) {
  const P = K.procedural;
  const neighbors = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const vector = (p, size) => Array.isArray(p) && p.length === size && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 120;

  function lattice(bounds, origin, cell, limit) {
    const [i0, j0] = [0, 2].map((axis, i) => Math.ceil((bounds.min[axis] - origin[i]) / cell - 1e-9)),
      [i1, j1] = [0, 2].map((axis, i) => Math.floor((bounds.max[axis] - origin[i]) / cell + 1e-9)),
      columns = i1 - i0 + 1,
      rows = j1 - j0 + 1,
      count = columns * rows;
    if (columns < 2 || rows < 2 || count > limit) throw new Error('Watershed lattice needs at least two samples per axis within its cell budget');
    const x0 = origin[0] + i0 * cell,
      z0 = origin[1] + j0 * cell;
    const coordinates = i => [origin[0] + (i0 + i % columns) * cell, origin[1] + (j0 + Math.floor(i / columns)) * cell];
    const key = i => (i0 + i % columns) + ':' + (j0 + Math.floor(i / columns));
    function forNeighbors(i, visit) {
      const col = i % columns,
        row = Math.floor(i / columns);
      for (const [direction, [x, z]] of neighbors.entries()) {
        const c = col + x,
          r = row + z;
        if (c >= 0 && c < columns && r >= 0 && r < rows) visit(r * columns + c, x === 0 || z === 0 ? cell : cell * Math.SQRT2, direction);
      }
    }
    return { columns, rows, count, x0, z0, coordinates, key, forNeighbors };
  }

  function priorityFlood(grid, elevation) {
    const { count, columns, rows, forNeighbors } = grid;
    const filled = new Float64Array(elevation),
      parent = new Int32Array(count).fill(-1),
      order = new Int32Array(count),
      rank = new Int32Array(count),
      found = new Uint8Array(count),
      queue = new ProceduralHeap((a, b) => filled[a] < filled[b] || (filled[a] === filled[b] && a < b));
    for (let i = 0; i < count; i++) {
      const col = i % columns,
        row = Math.floor(i / columns);
      if (col > 0 && col < columns - 1 && row > 0 && row < rows - 1) continue;
      found[i] = 1;
      queue.push(i);
    }
    let next = 0;
    while (queue.size) {
      const i = queue.pop();
      rank[i] = next;
      order[next++] = i;
      forNeighbors(i, j => {
        if (found[j]) return;
        found[j] = 1;
        parent[j] = i;
        filled[j] = Math.max(filled[i], elevation[j]);
        queue.push(j);
      });
    }
    return { filled, parent, order, rank };
  }

  function flowD8(grid, { filled, parent, order, rank }, rainfall) {
    const { count, forNeighbors } = grid;
    const receiver = new Int32Array(count).fill(-1),
      outlet = new Int32Array(count),
      area = new Float64Array(rainfall),
      slope = new Float64Array(count);
    for (const i of order) {
      let best = -1,
        steepest = 0;
      forNeighbors(i, (j, run) => {
        const grade = (filled[i] - filled[j]) / run;
        if (grade > steepest || (grade > 0 && grade === steepest && rank[j] < rank[best])) {
          steepest = grade;
          best = j;
        }
      });
      // The flood parent gives flat cells a path down without modifying their elevations.
      const next = best >= 0 ? best : parent[i];
      receiver[i] = next;
      outlet[i] = next < 0 ? i : outlet[next];
      slope[i] = steepest;
    }
    for (let k = count - 1; k >= 0; k--) {
      const i = order[k],
        next = receiver[i];
      if (next >= 0) area[next] += area[i];
    }
    return { receiver, outlet, area, slope };
  }

  function flowDInfinity(grid, { filled, order }, rainfall, d8) {
    const { count, forNeighbors } = grid,
      receiver = new Int32Array(d8.receiver),
      secondary = new Int32Array(count).fill(-1),
      share = new Float64Array(count),
      accumulation = new Float64Array(rainfall),
      adjacent = new Int32Array(8),
      run = new Float64Array(8),
      wedge = Math.PI / 4;
    for (const i of order) {
      adjacent.fill(-1);
      forNeighbors(i, (j, distance, direction) => {
        adjacent[direction] = j;
        run[direction] = distance;
      });
      let bestGrade = d8.slope[i];
      for (let a = 0; a < 8; a++) {
        const b = (a + 1) % 8,
          first = adjacent[a],
          second = adjacent[b];
        if (first < 0 || second < 0 || !(filled[i] > filled[first] && filled[i] > filled[second])) continue;
        const along = (filled[i] - filled[first]) / run[a],
          across = ((filled[i] - filled[second]) / run[b]) * Math.SQRT2 - along,
          angle = Math.atan2(across, along),
          grade = Math.hypot(along, across);
        if (angle <= 0 || angle >= wedge || grade <= bestGrade) continue;
        bestGrade = grade;
        receiver[i] = first;
        secondary[i] = second;
        share[i] = angle / wedge;
      }
    }
    for (let k = count - 1; k >= 0; k--) {
      const i = order[k];
      if (receiver[i] >= 0) accumulation[receiver[i]] += accumulation[i] * (1 - share[i]);
      if (secondary[i] >= 0) accumulation[secondary[i]] += accumulation[i] * share[i];
    }
    return Object.freeze({ receiver, secondary, secondaryShare: share, accumulation });
  }

  function channelNetwork(grid, order, { receiver, area }, terrain, lakes, lakeIds, threshold) {
    const { count, coordinates, key } = grid;
    const edge = new Uint8Array(count),
      inCount = new Uint8Array(count),
      streamOrder = new Uint8Array(count),
      largestIn = new Uint8Array(count),
      largestCount = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const next = receiver[i];
      if (next < 0 || area[i] < threshold || (lakeIds[i] && lakeIds[i] === lakeIds[next])) continue;
      edge[i] = 1;
      inCount[next]++;
    }
    for (let k = count - 1; k >= 0; k--) {
      const i = order[k],
        value = Math.max(1, largestIn[i] + (largestCount[i] >= 2 ? 1 : 0));
      if (largestIn[i] || (receiver[i] >= 0 && area[i] >= threshold)) streamOrder[i] = value;
      const next = receiver[i];
      if (next < 0 || area[i] < threshold) continue;
      if (value > largestIn[next]) {
        largestIn[next] = value;
        largestCount[next] = 1;
      } else if (value === largestIn[next]) largestCount[next]++;
    }
    function point(i) {
      const [x, z] = coordinates(i),
        level = lakes.get(lakeIds[i])?.level;
      return [x, level ?? terrain[i], z];
    }
    const nodeId = i => lakeIds[i] ? JSON.stringify(['lake', lakeIds[i]]) : 'drain:' + key(i),
      nodes = new Map(),
      reaches = [];
    function node(i) {
      const id = nodeId(i);
      if (!nodes.has(id)) {
        const lake = lakeIds[i] || null;
        nodes.set(id, { id, lake, point: lake ? null : point(i), incoming: [], outgoing: [] });
      }
      return nodes.get(id);
    }
    function trace(start) {
      let from = start;
      while (edge[from] === 1) {
        const first = receiver[from],
          id = 'reach:' + key(from) + '>' + key(first),
          indices = [from];
        let i = from;
        do {
          edge[i] = 2;
          i = receiver[i];
          indices.push(i);
        } while (edge[i] === 1 && inCount[i] === 1 && !lakeIds[i] && indices.length < 4097);
        const a = node(from),
          b = node(i),
          route = P.routes.polyline(indices.map(point));
        a.outgoing.push(id);
        b.incoming.push(id);
        reaches.push(Object.freeze({
          id, from: a.id, to: b.id, route,
          order: streamOrder[from], upstreamArea: area[from], downstreamArea: area[i]
        }));
        if (inCount[i] !== 1 || lakeIds[i]) break;
        from = i;
      }
    }
    for (let i = 0; i < count; i++) {
      if (edge[i] === 1 && (inCount[i] !== 1 || lakeIds[i])) trace(i);
    }
    return { nodes: P.data.freeze([...nodes.values()]), reaches: Object.freeze(reaches), streamOrder };
  }

  function samples(grid, cell, data) {
    const { x0, z0, columns, rows, key } = grid;
    return (x, z) => {
      const u = (x - x0) / cell,
        v = (z - z0) / cell;
      if (!Number.isFinite(u) || !Number.isFinite(v) || u < -1e-9 || v < -1e-9 || u > columns - 1 + 1e-9 || v > rows - 1 + 1e-9) return null;
      const i = clamp(Math.floor(u), 0, columns - 2),
        j = clamp(Math.floor(v), 0, rows - 2),
        a = j * columns + i,
        b = a + columns,
        s = clamp(u - i, 0, 1),
        t = clamp(v - j, 0, 1),
        near = j * columns + i + (s >= 0.5 ? 1 : 0) + (t >= 0.5 ? columns : 0);
      const lerp = (arr, k) => arr[k] + (arr[k + 1] - arr[k]) * s,
        mix = arr => lerp(arr, a) + (lerp(arr, b) - lerp(arr, a)) * t,
        lakeId = data.lakeIds[near] || null;
      return {
        elevation: mix(data.elevation), terrainHeight: mix(data.terrain), drainageHeight: mix(data.filled),
        accumulation: mix(data.area), wetness: mix(data.wet),
        catchmentId: 'catchment:' + key(data.outlet[near]), streamOrder: data.streamOrder[near], lakeId,
        lakeLevel: data.lakes.get(lakeId)?.level ?? null
      };
    };
  }

  function analyze(height, options = {}) {
    const {
      bounds, origin = [0, 0], cell = 0.5, lakeAt, rain, maxCells = 80000,
      channelArea = 12 * cell * cell, wetnessArea = channelArea, distributed = false
    } = options;
    if (
      typeof height !== 'function' || !vector(origin, 2) || !vector(bounds?.min, 3) || !vector(bounds?.max, 3) ||
      bounds.min[0] >= bounds.max[0] || bounds.min[2] >= bounds.max[2] ||
      !Number.isFinite(cell) || cell < 1e-5 || cell > 1e5 ||
      ![channelArea, wetnessArea].every(n => Number.isFinite(n) && n > 0) ||
      !Number.isSafeInteger(maxCells) || maxCells < 4 || maxCells > 250000 || typeof distributed !== 'boolean' ||
      [lakeAt, rain].some(fn => fn !== undefined && typeof fn !== 'function')
    ) throw new Error('Invalid watershed field, lattice, callbacks or budget');

    const grid = lattice(bounds, origin, cell, maxCells),
      { count, coordinates, key } = grid,
      elevation = new Float64Array(count),
      terrain = new Float64Array(count),
      rainArea = new Float64Array(count),
      wet = new Float64Array(count),
      lakes = new Map(),
      lakeIds = new Array(count).fill(null);
    for (let i = 0; i < count; i++) {
      const [x, z] = coordinates(i),
        y = height(x, z),
        source = rain?.(x, z, y) ?? 1,
        lake = lakeAt?.(x, z, y);
      if (!Number.isFinite(y) || Math.abs(y) > 1e6 || !Number.isFinite(source) || source < 0 || source > 1e6)
        throw new Error('Watershed height and rainfall must be finite and within range');
      elevation[i] = y;
      rainArea[i] = source * cell * cell;
      if (lake == null) continue;
      const { id, level = null } = typeof lake === 'string' ? { id: lake } : lake;
      if (!validId(id) || (level !== null && (!Number.isFinite(level) || Math.abs(level) > 1e6)))
        throw new Error('Lake samples need an ID and an optional finite level');
      const prior = lakes.get(id);
      if (prior && prior.level !== level) throw new Error('Lake samples with the same ID need one level');
      if (!prior) lakes.set(id, { id, level, samples: 0 });
      lakeIds[i] = id;
      lakes.get(id).samples++;
    }
    const flood = priorityFlood(grid, elevation),
      { filled, order } = flood,
      flow = flowD8(grid, flood, rainArea);
    for (let i = 0; i < count; i++) {
      terrain[i] = lakeIds[i] ? elevation[i] : filled[i];
      const pooling = Math.max(0, filled[i] - elevation[i]) / cell,
        supply = flow.area[i] / wetnessArea;
      wet[i] = lakeIds[i] ? 1 : clamp(1 - Math.exp(-pooling - supply / (1 + 4 * flow.slope[i])), 0, 1);
    }
    const network = channelNetwork(grid, order, flow, terrain, lakes, lakeIds, channelArea),
      sample = samples(grid, cell, { elevation, terrain, filled, wet, lakeIds, lakes, streamOrder: network.streamOrder, ...flow });
    const catchments = [];
    for (let i = 0; i < count; i++) {
      if (flow.receiver[i] >= 0) continue;
      catchments.push({ id: 'catchment:' + key(i), outlet: coordinates(i), accumulation: flow.area[i] });
    }
    return Object.freeze({
      grid: P.data.freeze({ origin: [grid.x0, grid.z0], cell, columns: grid.columns, rows: grid.rows }),
      sample,
      wetness: (x, z) => sample(x, z)?.wetness ?? 0,
      reaches: network.reaches,
      nodes: network.nodes,
      lakes: P.data.freeze([...lakes.values()]),
      catchments: P.data.freeze(catchments),
      distributed: distributed ? flowDInfinity(grid, flood, rainArea, flow) : null,
      fields: Object.freeze({
        elevation, terrainHeight: terrain, drainageHeight: filled, accumulation: flow.area, receiver: flow.receiver,
        outlet: flow.outlet, slope: flow.slope, wetness: wet, streamOrder: network.streamOrder, lakeIds: Object.freeze(lakeIds)
      })
    });
  }

  P.hydrology = { analyze };
})(KIT);
