/* Fixed-head flooding through free vertical intervals, with retained tile topology. */
(function (K) {
  const P = K.procedural, { freeze } = P.data;
  const states = new WeakMap(), finite = Number.isFinite, integer = Number.isSafeInteger;
  const name = (i, j) => i + '/' + j;
  const vector = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(n => finite(n) && finite(Math.fround(n)));
  const same = (a, b) => a.every((v, i) => v === b[i]);
  const directions = [[-1, 0], [0, -1], [0, 1], [1, 0]];

  function create({ tiles, sources = [], previous, origin, opening = 0.02, maxChecks = 4000000 } = {}) {
    const old = states.get(previous);
    if (!Array.isArray(sources) || sources.length > 64 || (previous !== undefined && !old) ||
        !finite(opening) || opening <= 0 || !integer(maxChecks) || maxChecks < 1 || maxChecks > 30000000)
      throw new TypeError('Span flooding needs bounded source and portal controls');
    const { dx, dz, phase, entries } = P.verticalSpans.layout(tiles, origin);
    const controls = [dx, dz, ...phase, opening];
    const cache = old && same(controls, old.controls) ? old : null;
    const labels = new Set(), topology = new Map(), columns = new Map();
    let checks = 0, visited = 0;
    function check() {
      if (++checks > maxChecks) throw new RangeError('Span flooding exceeds its work budget');
    }
    const sourceList = Array.from(sources, raw => {
      const { id, point, level, current = [0, 0, 0] } = raw ?? {};
      if (typeof id !== 'string' || !id.trim() || labels.has(id) || !vector(point) || !vector(current) ||
          !finite(level) || !finite(Math.fround(level)) || point[1] >= Math.fround(level))
        throw new TypeError('Flood sources need unique IDs, an XYZ point below a finite head and optional XYZ current');
      labels.add(id);
      return { id, point: point.slice(), level: Math.fround(level), current: current.map(Math.fround) };
    }).sort((a, b) => b.level - a.level || (a.id < b.id ? -1 : 1));

    function portals(left, right, link) {
      let i = 0, j = 0;
      while (i < left.length && j < right.length) {
        check();
        const a = left[i], b = right[j], low = Math.max(a.min, b.min), high = Math.min(a.max, b.max);
        if (high - low >= opening) link(a, b, low);
        if (a.max <= b.max) i++;
        if (b.max <= a.max) j++;
      }
    }
    function build(entry) {
      const { grid, nx, nz, x0, z0 } = entry, local = new Map();
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        check();
        const i = x + x0, j = z + z0, rows = grid.column(x, z);
        const border = directions.filter(([a, b]) => x + a < 0 || x + a >= nx || z + b < 0 || z + b >= nz)
          .map(([a, b]) => name(i + a, j + b));
        const column = { rows, open: [], border };
        for (let start = 0; start < rows.length;) {
          check();
          if (rows[start].kind === 'solid') {
            start++;
            continue;
          }
          let stop = start;
          for (; stop < rows.length && rows[stop].kind !== 'solid'; stop++) {
            if (rows[stop].kind === 'water') throw new TypeError('Flooding requires dry geometry tiles and explicit water sources');
          }
          column.open.push({ tile: entry.key, column, min: rows[start].min, max: rows[stop - 1].max,
            start, stop, links: [] });
          start = stop;
        }
        local.set(name(i, j), column);
      }
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        const col = local.get(name(x + x0, z + z0));
        for (const [a, b] of [[1, 0], [0, 1]]) {
          const neighbor = local.get(name(x + x0 + a, z + z0 + b));
          if (neighbor) portals(col.open, neighbor.open, (from, to, low) => {
            from.links.push({ to, low });
            to.links.push({ to: from, low });
          });
        }
      }
      return { grid, columns: local };
    }

    const topologyTiles = [];
    for (const entry of entries) {
      const cached = cache?.topology.get(entry.key);
      if (topology.has(entry.key)) throw new RangeError('Flood tiles cannot cover the same column');
      const state = cached?.grid === entry.grid ? cached : build(entry);
      if (state !== cached) topologyTiles.push(entry.key);
      topology.set(entry.key, state);
      for (const [key, column] of state.columns) {
        if (columns.has(key)) throw new RangeError('Flood tiles cannot cover the same column');
        columns.set(key, column);
      }
    }

    const wet = new Map(), sourceWork = [];
    for (const source of sourceList) {
      const [x, y, z] = source.point, pointColumn = columns.get(name(
        Math.floor((x - phase[0]) / dx), Math.floor((z - phase[1]) / dz)));
      const start = pointColumn?.open.find(row => row.min <= y && y < row.max);
      const queue = [];
      function enter(row) {
        if (!wet.has(row)) {
          wet.set(row, source);
          queue.push(row);
        }
      }
      if (start) enter(start);
      for (let i = 0; i < queue.length; i++) {
        const row = queue[i];
        check();
        for (const { to, low } of row.links) {
          check();
          if (source.level - low >= opening) enter(to);
        }
        for (const key of row.column.border) {
          const neighbor = columns.get(key);
          if (neighbor) portals([row], neighbor.open, (_, to, low) => {
            if (source.level - low >= opening) enter(to);
          });
        }
      }
      visited += queue.length;
      sourceWork.push({ id: source.id, located: Boolean(start), intervals: queue.length });
    }
    const assigned = new Map();
    for (const [row, source] of wet) {
      if (!assigned.has(row.tile)) assigned.set(row.tile, new Map());
      assigned.get(row.tile).set(row, { top: Math.min(row.max, source.level), id: source.id, current: source.current });
    }

    const outputs = new Map(), changedTiles = [], waterTiles = [];
    const output = entries.map(({ key, grid, x0, z0 }) => {
      const local = topology.get(key), water = assigned.get(key) ?? new Map(), cached = cache?.outputs.get(key);
      let filled = grid;
      if (cached?.local === local && cached.water.size === water.size && [...water].every(([row, next]) => {
        const a = cached.water.get(row);
        return a?.top === next.top && a.id === next.id && same(a.current, next.current);
      })) filled = cached.filled;
      else {
        changedTiles.push(key);
        if (water.size) waterTiles.push(key);
        if (water.size) filled = P.verticalSpans.create({ bounds: grid.bounds, resolution: grid.resolution, sample(x, z, i, j) {
          const column = local.columns.get(name(i + x0, j + z0)), rows = [];
          let at = 0;
          for (const row of column.open) {
            if (at < row.start) rows.push(...column.rows.slice(at, row.start));
            const waterline = water.get(row);
            if (waterline) rows.push({ min: row.min, max: waterline.top, kind: 'water', id: waterline.id, current: waterline.current });
            for (let k = row.start; k < row.stop; k++) {
              const original = column.rows[k], min = Math.max(original.min, waterline?.top ?? original.min);
              if (min < original.max) rows.push({ ...original, min });
            }
            at = row.stop;
          }
          return rows.concat(column.rows.slice(at));
        } });
      }
      outputs.set(key, { local, water, filled });
      return filled;
    });
    const result = freeze({ tiles: output, work: { checks, visited, topologyTiles, changedTiles, waterTiles, sources: sourceWork } });
    states.set(result, { controls, topology, outputs });
    return result;
  }

  P.spanFlood = Object.freeze({ create });
})(KIT);
