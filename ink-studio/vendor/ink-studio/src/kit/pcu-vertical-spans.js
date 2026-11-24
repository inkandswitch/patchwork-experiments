/* Immutable, vertically layered world occupancy on a shared XZ grid. */
(function (K) {
  const P = K.procedural, { freeze } = P.data;
  const finite = Number.isFinite;
  const vector = (v, n, test = finite) => Array.isArray(v) && v.length === n && Array.from(v).every(test);
  const scalar = v => finite(v) && finite(Math.fround(v));
  const name = v => typeof v === 'string' && v.length > 0;
  const empty = Object.freeze([]);
  const grids = new WeakMap();
  const tileBakes = new WeakMap();
  const zero = Object.freeze([0, 0, 0]);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const kindOK = kind => kind === 'air' || kind === 'solid' || kind === 'water';

  function domain(raw, resolution) {
    if (!vector(raw?.min, 3, scalar) || !vector(raw?.max, 3, scalar) ||
        !vector(resolution, 2, n => Number.isSafeInteger(n) && n > 0) ||
        resolution[0] * resolution[1] > 65536)
      throw new RangeError('Vertical spans need finite XYZ bounds and a grid of up to 65536 columns');
    const min = raw.min.map(Math.fround), max = raw.max.map(Math.fround), [nx, nz] = resolution;
    const dx = Math.fround((max[0] - min[0]) / nx), dz = Math.fround((max[2] - min[2]) / nz);
    if (max.some((v, i) => v <= min[i] || !scalar(v - min[i])) || !dx || !dz ||
        min[0] + dx === min[0] || min[2] + dz === min[2])
      throw new RangeError('Vertical spans need positive, representable extents');
    return { min, max, nx, nz, dx, dz, center: (x, z) => [min[0] + (x + 0.5) * dx, min[2] + (z + 0.5) * dz] };
  }

  function tag(raw) {
    const { kind = 'air', id = null, material = null, current = zero } = raw;
    if (!kindOK(kind) || !(id === null || name(id)) || !(material === null || name(material)) ||
        !vector(current, 3, scalar) || (kind !== 'water' && current.some(v => v !== 0)))
      throw new TypeError('A span needs a kind, optional ID and material, and finite XYZ water current');
    return { kind, id, material, current: current.map(Math.fround) };
  }

  function create({ bounds, resolution = [1, 1], sample, maxSpans = 524288 } = {}) {
    if (typeof sample !== 'function' || !Number.isSafeInteger(maxSpans) || maxSpans < 1 || maxSpans > 4000000)
      throw new TypeError('Vertical spans need a column sampler and a bounded span budget');
    const grid = domain(bounds, resolution), { min, max, nx, nz, dx, dz, center } = grid;
    const offsets = new Uint32Array(nx * nz + 1), limits = [], labels = [], palette = [], byTag = new Map();
    const tagIndex = raw => {
      const item = tag(raw), key = JSON.stringify(item);
      if (!byTag.has(key)) {
        byTag.set(key, palette.length);
        palette.push(freeze(item));
      }
      return byTag.get(key);
    };
    const air = tagIndex({});
    for (let z = 0, i = 0; z < nz; z++) for (let x = 0; x < nx; x++, i++) {
      offsets[i] = labels.length;
      const column = sample(...center(x, z), x, z);
      if (!Array.isArray(column) || column.length > maxSpans)
        throw new TypeError('Column sampler must return a bounded span array');
      let last = min[1];
      function push(low, high, label) {
        if (high <= low) return;
        if (labels.length > offsets[i] && labels.at(-1) === label) limits[limits.length - 1] = high;
        else {
          if (labels.length >= maxSpans) throw new RangeError('Vertical span grid exceeds its span budget');
          limits.push(low, high);
          labels.push(label);
        }
      }
      for (const row of column) {
        if (!scalar(row?.min) || !scalar(row?.max)) throw new TypeError('Span endpoints must be finite');
        const low = Math.fround(row.min), high = Math.fround(row.max);
        if (low < last || high <= low || high > max[1]) throw new RangeError('Column spans must be ordered, disjoint and in bounds');
        push(last, low, air);
        push(low, high, tagIndex(row));
        last = high;
      }
      push(last, max[1], air);
    }
    offsets[nx * nz] = labels.length;
    const heights = Float32Array.from(limits), ids = Uint32Array.from(labels);
    const shape = freeze({ min, max });
    function locate(x, z) {
      if (!finite(x) || !finite(z) || x < min[0] || x >= max[0] || z < min[2] || z >= max[2]) return null;
      return [Math.min(nx - 1, Math.floor((x - min[0]) / dx)), Math.min(nz - 1, Math.floor((z - min[2]) / dz))];
    }
    const rowAt = i => ({ min: heights[i * 2], max: heights[i * 2 + 1], ...palette[ids[i]] });
    function column(x, z) {
      if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x >= nx || z < 0 || z >= nz) return empty;
      const index = x + z * nx;
      return Array.from({ length: offsets[index + 1] - offsets[index] }, (_, k) => rowAt(offsets[index] + k));
    }
    function at(x, y, z) {
      const p = locate(x, z);
      if (!p || !finite(y) || y < min[1] || y >= max[1]) return null;
      const index = p[0] + p[1] * nx;
      let lo = offsets[index], hi = offsets[index + 1];
      while (lo < hi) {
        const middle = (lo + hi) >>> 1;
        if (y >= heights[middle * 2 + 1]) lo = middle + 1;
        else hi = middle;
      }
      return rowAt(lo);
    }
    const result = Object.freeze({ bounds: shape, resolution: freeze([nx, nz]), cell: freeze([dx, dz]), center, locate, column, at,
      hasWater: palette.some(row => row.kind === 'water'),
      hasNamedAir: palette.some(row => row.kind === 'air' && row.id !== null),
      count: ids.length, pack: () => ({ offsets: offsets.slice(), heights: heights.slice(), labels: ids.slice(), palette: palette.slice() }) });
    grids.set(result, { offsets, heights, ids, palette });
    return result;
  }

  function bake({ bounds, resolution = [1, 1], solid, volumes = [], step = 0.25, refine = 18, maxSamples = 4000000, maxSpans } = {}) {
    const grid = domain(bounds, resolution), { min, max, nx, nz } = grid;
    if (typeof solid !== 'function' || !Array.isArray(volumes) || volumes.length > 64 ||
        !finite(step) || step <= 0 || !Number.isSafeInteger(refine) || refine < 1 || refine > 32 ||
        !Number.isSafeInteger(maxSamples) || maxSamples < 1)
      throw new TypeError('Span baking requires a solid SDF, bounded volume fields and sample controls');
    const seen = new Set();
    const rules = Array.from(volumes, raw => {
      if (!name(raw?.id) || seen.has(raw.id) || raw.kind !== 'air' && raw.kind !== 'water' ||
          typeof raw.field !== 'function' || !Number.isSafeInteger(raw.priority ?? 0) ||
          raw.current !== undefined && typeof raw.current !== 'function' && !vector(raw.current, 3, scalar))
        throw new TypeError('Volume rules need unique IDs, signed fields and medium priorities');
      seen.add(raw.id);
      return { ...raw, priority: raw.priority ?? 0 };
    }).sort((a, b) => b.priority - a.priority || compare(a.id, b.id));
    const depth = max[1] - min[1], steps = Math.ceil(depth / step);
    if (nx * nz * (steps + 1) * (rules.length + 1) > maxSamples)
      throw new RangeError('Vertical span bake exceeds its sample budget');
    const fields = [solid, ...rules.map(row => row.field)];
    let work = 0;
    function probe(field, x, y, z) {
      if (++work > maxSamples) throw new RangeError('Vertical span bake exceeds its sample budget');
      const value = field(x, y, z);
      if (!finite(value)) throw new TypeError('Span fields must return finite signed distances');
      return value < 0;
    }
    return create({ bounds, resolution, maxSpans, sample(x, z) {
      const events = [];
      const inside = fields.map(field => probe(field, x, min[1], z)), current = inside.slice();
      let last = min[1];
      for (let j = 1; j <= steps; j++) {
        const y = j === steps ? max[1] : min[1] + j * depth / steps;
        for (let i = 0; i < fields.length; i++) {
          const state = probe(fields[i], x, y, z);
          if (state === current[i]) continue;
          let a = last, b = y;
          for (let k = 0; k < refine; k++) {
            const mid = (a + b) / 2;
            if (probe(fields[i], x, mid, z) === state) b = mid;
            else a = mid;
          }
          events.push({ y: Math.fround((a + b) / 2), i, state });
          current[i] = state;
        }
        last = y;
      }
      events.sort((a, b) => a.y - b.y || a.i - b.i);
      const spans = [];
      function emit(low, high) {
        if (high <= low) return;
        const selected = inside.indexOf(true, 1), rule = selected < 0 ? null : rules[selected - 1];
        if (inside[0]) spans.push({ min: low, max: high, kind: 'solid' });
        else if (rule) spans.push({ min: low, max: high, kind: rule.kind, id: rule.id, material: rule.material,
          current: typeof rule.current === 'function' ? rule.current(x, (low + high) / 2, z) : rule.current });
      }
      last = min[1];
      for (const event of events) {
        emit(last, event.y);
        inside[event.i] = event.state;
        last = event.y;
      }
      emit(last, max[1]);
      return spans;
    } });
  }

  const same = (a, b) => a.every((v, i) => v === b[i]);
  const intersects = (a, b) => a.min.every((v, i) => v <= b.max[i] && a.max[i] >= b.min[i]);
  const boundsOK = box => vector(box?.min, 3) && vector(box?.max, 3) && box.min.every((v, i) => v <= box.max[i]);
  function sameGrid(a, b) {
    const first = grids.get(a), second = grids.get(b);
    return same(a.resolution, b.resolution) && same(a.bounds.min, b.bounds.min) && same(a.bounds.max, b.bounds.max) &&
      first.ids.length === second.ids.length && first.palette.length === second.palette.length &&
      same(first.offsets, second.offsets) && same(first.heights, second.heights) && same(first.ids, second.ids) &&
      first.palette.every((row, i) => {
        const other = second.palette[i];
        return row.kind === other.kind && row.id === other.id && row.material === other.material && same(row.current, other.current);
      });
  }

  function bakeTiles({ tiles, previous, dirtyBounds, solid, volumes, step, refine, maxSamples, maxSpans } = {}) {
    const old = tileBakes.get(previous);
    if (!Array.isArray(tiles) || tiles.length > 4096 || typeof solid !== 'function' ||
        previous !== undefined && !old || dirtyBounds !== undefined &&
        (!Array.isArray(dirtyBounds) || !Array.from(dirtyBounds).every(boundsOK)))
      throw new TypeError('A tiled span bake needs tile descriptions, a solid field and optional dirty bounds');
    const controls = [step, refine, maxSamples, maxSpans, volumes];
    const incremental = old && dirtyBounds && same(controls, old.controls);
    const byId = new Map(), rebuilt = [], changed = [];
    let samples = 0;
    for (const tile of tiles) {
      if (!name(tile?.id) || byId.has(tile.id)) throw new TypeError('Span tiles need unique IDs');
      const shape = domain(tile.bounds, tile.resolution ?? [1, 1]), cached = incremental ? old.byId.get(tile.id) : null;
      if (cached && same(cached.resolution, [shape.nx, shape.nz]) &&
          same(cached.bounds.min, shape.min) && same(cached.bounds.max, shape.max) &&
          !dirtyBounds.some(box => intersects(cached.bounds, box))) {
        byId.set(tile.id, cached);
        continue;
      }
      const grid = bake({ bounds: tile.bounds, resolution: tile.resolution, volumes, step, refine, maxSamples, maxSpans,
        solid(x, y, z) {
          samples++;
          return solid(x, y, z);
        }
      });
      const retained = cached && sameGrid(cached, grid);
      byId.set(tile.id, retained ? cached : grid);
      rebuilt.push(tile.id);
      if (!retained) changed.push(tile.id);
    }
    const result = freeze({ ids: [...byId.keys()], tiles: Object.freeze([...byId.values()]),
      work: { samples, rebuilt, changed, removed: old ? [...old.byId.keys()].filter(id => !byId.has(id)) : [] } });
    tileBakes.set(result, { byId, controls });
    return result;
  }

  function layout(tiles, origin) {
    if (!Array.isArray(tiles) || !tiles.length || tiles.length > 4096 ||
        !Array.from(tiles).every(tile => grids.has(tile) &&
          [...tile.bounds.min, ...tile.bounds.max].every(v => Math.abs(v) <= 1e6)) ||
        origin !== undefined && !vector(origin, 2, v => finite(v) && Math.abs(v) <= 1e6))
      throw new TypeError('Expected span tiles with finite, bounded coordinates and an optional XZ origin');
    const [dx, dz] = tiles[0].cell;
    const phase = origin ? origin.slice() : [0, 2].map((axis, i) => {
      const v = Math.min(...tiles.map(tile => tile.bounds.min[axis])), size = i === 0 ? dx : dz;
      const offset = v - Math.floor(v / size) * size;
      return Math.min(offset, size - offset) < size * 1e-6 ? 0 : offset;
    });
    const aligned = (a, b, scale) => Math.abs(a - b) <= scale * 1e-5;
    const entries = tiles.map(grid => {
      const [nx, nz] = grid.resolution, [x0, z0] = phase.map((v, i) => {
        const size = i === 0 ? dx : dz, min = grid.bounds.min[i * 2], n = Math.round((min - v) / size);
        if (!Number.isSafeInteger(n) || !aligned(v + n * size, min, size) ||
            !aligned(min + grid.resolution[i] * size, grid.bounds.max[i * 2], size))
          throw new RangeError('Span tiles must share an aligned XZ lattice');
        return n;
      });
      if (!aligned(grid.cell[0], dx, dx) || !aligned(grid.cell[1], dz, dz))
        throw new RangeError('Span tiles must share the same cell size');
      return { grid, nx, nz, x0, z0, key: x0 + '/' + z0 };
    });
    return { dx, dz, phase, entries };
  }

  P.verticalSpans = Object.freeze({ create, bake, bakeTiles, layout, isGrid: value => grids.has(value) });
})(KIT);
