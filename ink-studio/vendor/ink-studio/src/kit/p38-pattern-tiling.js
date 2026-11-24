/* Overlapping sample synthesis and world-stable Wang tiling. */
(function (K) {
  const P = K.procedural,
    { compile, solve } = P.tiles,
    learned = new WeakMap(),
    limit = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    scalar = s => s === null || typeof s === 'string' && s.length <= 120 || typeof s === 'boolean' || Number.isFinite(s),
    signature = sockets => JSON.stringify([sockets.north, sockets.east, sockets.south, sockets.west]);

  function learn(input, { size = 2, periodic = false, symmetry = false, maxPatterns = 256 } = {}) {
    if (!Array.isArray(input) || !limit(input.length, 1, 256) || !limit(size, 2, 5) ||
      typeof periodic !== 'boolean' || typeof symmetry !== 'boolean' || !limit(maxPatterns, 1, 256))
      throw new Error('Invalid swatch dimensions, overlap size or pattern budget');
    const rows = input.map(row => typeof row === 'string' ? [...row] : row),
      height = rows.length,
      width = rows[0]?.length;
    if (
      !limit(width, 1, 256) || (!periodic && (width < size || height < size)) ||
      rows.some(row => !Array.isArray(row) || row.length !== width || !row.every(scalar))
    ) throw new Error('Swatch rows must use equally sized arrays of finite primitive values');

    const patterns = new Map(),
      blank = () => Array.from({ length: size }, () => new Array(size));
    function record(patch) {
      const key = JSON.stringify(patch),
        prior = patterns.get(key);
      if (prior) prior.weight++;
      else {
        if (patterns.size >= maxPatterns) throw new Error('Swatch exceeds its distinct pattern budget');
        patterns.set(key, { id: 'pattern-' + patterns.size, patch, weight: 1 });
      }
    }
    function rotate(patch) {
      const out = blank();
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) out[x][size - 1 - y] = patch[y][x];
      return out;
    }
    const rowsToRead = periodic ? height : height - size + 1,
      colsToRead = periodic ? width : width - size + 1;
    for (let z = 0; z < rowsToRead; z++) {
      for (let x = 0; x < colsToRead; x++) {
        let patch = blank();
        for (let j = 0; j < size; j++)
          for (let i = 0; i < size; i++) patch[j][i] = rows[(z + j) % height][(x + i) % width];
        record(patch);
        if (symmetry) {
          for (let i = 0; i < 4; i++) {
            if (i) record(patch);
            record(patch.map(row => row.slice().reverse()));
            patch = rotate(patch);
          }
        }
      }
    }
    const definitions = P.data.freeze([...patterns.values()]),
      model = compile(definitions.map(({ id, patch, weight }) => ({
        id, weight,
        sockets: {
          north: JSON.stringify(patch.slice(0, -1)), south: JSON.stringify(patch.slice(1)),
          west: JSON.stringify(patch.map(row => row.slice(0, -1))), east: JSON.stringify(patch.map(row => row.slice(1)))
        }
      }))),
      bank = Object.freeze({ size, patterns: definitions });
    learned.set(bank, { model, byId: new Map(definitions.map(p => [p.id, p.patch])) });
    return bank;
  }

  function overlap(bank, {
    width, height, wrap = false, pins = [], seed, maxCells, maxWork, maxBacktracks
  } = {}) {
    const state = learned.get(bank);
    if (
      !state || !limit(width, 1, 65536) || !limit(height, 1, 65536) || width * height > 65536 ||
      !(typeof wrap === 'boolean' || (Array.isArray(wrap) && wrap.length === 2 && wrap.every(value => typeof value === 'boolean'))) ||
      !Array.isArray(pins) || pins.length > 4 * width * height
    ) throw new Error('Overlapping synthesis needs a learned swatch, bounded output and valid pins');
    const [wrapX, wrapZ] = Array.isArray(wrap) ? wrap : [wrap, wrap],
      size = bank.size,
      cols = wrapX ? width : width - size + 1,
      rows = wrapZ ? height : height - size + 1;
    if (cols < 1 || rows < 1) throw new Error('Unwrapped overlapping output must be at least the pattern size');
    const anchors = pins.map(pin => {
      if (!limit(pin?.x, 0, width - 1) || !limit(pin?.z, 0, height - 1) || !scalar(pin?.value))
        throw new Error('Overlapping pins need an output coordinate and a swatch value');
      const x = Math.min(pin.x, cols - 1),
        z = Math.min(pin.z, rows - 1),
        tiles = bank.patterns.filter(p => p.patch[pin.z - z][pin.x - x] === pin.value).map(p => p.id);
      return { x, z, tiles, original: pin };
    });
    const unsupported = anchors.find(pin => !pin.tiles.length);
    if (unsupported)
      return Object.freeze({
        status: 'contradiction', width, height,
        conflict: Object.freeze({ x: unsupported.original.x, z: unsupported.original.z }),
        work: Object.freeze({ decisions: 0, backtracks: 0, checks: 0 })
      });
    const result = solve(state.model, { width: cols, height: rows, wrap, seed, maxCells, maxWork, maxBacktracks, pins: anchors });
    if (result.status !== 'ok') return Object.freeze({ ...result, width, height });
    const values = [];
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const a = Math.min(x, cols - 1),
          b = Math.min(z, rows - 1);
        values.push(state.byId.get(result.at(a, b))[z - b][x - a]);
      }
    }
    return Object.freeze({
      status: 'ok', width, height, values: Object.freeze(values), patterns: result.tiles, work: result.work,
      at: (x, z) => limit(x, 0, width - 1) && limit(z, 0, height - 1) ? values[z * width + x] : undefined
    });
  }

  function hash01(key, seed) {
    let h = P.data.hash(key, seed);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function wang(model, { width, height, origin = [0, 0], labels, seed = 0, maxCells = 16000 } = {}) {
    if (
      !Array.isArray(model?.tiles) || !limit(width, 1, 65536) || !limit(height, 1, 65536) ||
      !limit(maxCells, 1, 65536) || width * height > maxCells ||
      !Array.isArray(origin) || origin.length !== 2 || !origin.every(n => limit(n, -1e9, 1e9)) ||
      !Array.isArray(labels) || !limit(labels.length, 1, 32) || !labels.every(scalar) || new Set(labels).size !== labels.length ||
      !Number.isSafeInteger(seed)
    ) throw new Error('Wang tiling needs a tile model, bounded region and distinct edge labels');
    const choices = new Map();
    for (const tile of model.tiles) {
      const key = signature(tile.sockets);
      if (!choices.has(key)) choices.set(key, []);
      choices.get(key).push(tile);
    }
    const edge = (axis, x, z) => labels[Math.floor(labels.length * hash01(axis + ':' + x + ':' + z, seed))],
      assigned = [];
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const x = origin[0] + i, z = origin[1] + j,
          sockets = { north: edge('x', x, z), south: edge('x', x, z + 1), west: edge('z', x, z), east: edge('z', x + 1, z) },
          variants = choices.get(signature(sockets));
        if (!variants) return P.data.freeze({ status: 'missing', width, height, conflict: { x, z, sockets } });
        let pick = hash01('tile:' + x + ':' + z, seed) * variants.reduce((sum, tile) => sum + tile.weight, 0),
          selected = variants.at(-1);
        for (const tile of variants) {
          pick -= tile.weight;
          if (pick >= 0) continue;
          selected = tile;
          break;
        }
        assigned.push(selected.id);
      }
    }
    return Object.freeze({
      status: 'ok', width, height, origin: Object.freeze(origin.slice()), tiles: Object.freeze(assigned),
      at: (x, z) => limit(x, origin[0], origin[0] + width - 1) && limit(z, origin[1], origin[1] + height - 1)
        ? assigned[(z - origin[1]) * width + x - origin[0]]
        : null
    });
  }

  function refine(coarse, model, { size = 2, template, pins = [], mask, maxCells = 16000, ...options } = {}) {
    if (
      coarse?.status !== 'ok' || !limit(coarse.width, 1, 65536) || !limit(coarse.height, 1, 65536) ||
      !Array.isArray(coarse.tiles) || coarse.tiles.length !== coarse.width * coarse.height ||
      !limit(size, 2, 32) || typeof template !== 'function' ||
      !limit(maxCells, 1, 65536) || coarse.tiles.length * size * size > maxCells ||
      !Array.isArray(pins) || (mask !== undefined && typeof mask !== 'function')
    ) throw new Error('Hierarchical tiling needs a coarse placement, bounded size and a fine template callback');
    const width = coarse.width * size,
      height = coarse.height * size,
      active = (x, z) => coarse.tiles[Math.floor(z / size) * coarse.width + Math.floor(x / size)] !== null && (!mask || mask(x, z)),
      constraints = pins.slice();
    for (const [index, id] of coarse.tiles.entries()) {
      if (id === null) continue;
      const cx = index % coarse.width,
        cz = Math.floor(index / coarse.width),
        pattern = template(id, cx, cz);
      if (pattern == null) continue;
      if (!Array.isArray(pattern) || pattern.length !== size * size)
        throw new Error('Each fine template needs one entry per sample in its block');
      for (const [i, entry] of pattern.entries()) {
        if (entry == null) continue;
        const x = cx * size + i % size,
          z = cz * size + Math.floor(i / size);
        if (!active(x, z)) continue;
        constraints.push(typeof entry === 'string' ? { x, z, tile: entry } : { x, z, tiles: entry });
      }
    }
    return solve(model, { ...options, width, height, maxCells, pins: constraints, mask: active });
  }

  Object.assign(P.tiles, { learn, overlap, wang, refine });
})(KIT);
