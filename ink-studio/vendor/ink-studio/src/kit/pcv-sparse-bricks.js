/* Copy-on-write XYZ samples for local edits to an analytical field. */
(function (K) {
  const P = K.procedural, { freeze } = P.data;
  const states = new WeakMap();
  const finite = Number.isFinite, integer = Number.isSafeInteger;
  const coordinate = (v, test) => Array.isArray(v) && v.length === 3 && Array.from(v).every(test);
  const field = v => finite(v) && finite(Math.fround(v));
  const label = v => v === null || (typeof v === 'string' && v.length > 0);
  const empty = Object.freeze({ offset: 0, material: null, medium: null });
  const channels = ['offset', 'material', 'medium'];
  const entry = (channel, index) => channel === null || typeof channel !== 'object' ? channel : channel[index];
  const compress = channel => channel.every(value => value === channel[0]) ? channel[0] : channel;
  const mix = (a, b, t) => a + (b - a) * t;
  const keyOf = index => index.join('/');

  function smoothMin(a, b, amount) {
    if (amount === 0) return Math.min(a, b);
    const h = Math.max(0, amount - Math.abs(a - b)) / amount;
    return Math.min(a, b) - h * h * amount / 4;
  }

  function create({ cell = 0.25, brickSize = 8, base = () => 1 } = {}) {
    if (!finite(cell) || cell < 1e-6 || !integer(brickSize) || brickSize < 2 || brickSize > 32 ||
        !finite(cell * brickSize) || typeof base !== 'function')
      throw new TypeError('Sparse bricks need a positive cell size, 2–32 samples per axis and a base field');
    const length = brickSize ** 3;
    const pointOK = v => finite(v) && Math.abs(v / cell) < 2 ** 40 - brickSize;
    const lattice = value => {
      const q = value / cell, near = Math.round(q);
      return Math.abs(q - near) <= Number.EPSILON * 4 * Math.max(1, Math.abs(q)) ? near : q;
    };
    const checked = v => {
      if (!field(v)) throw new RangeError('Sparse brick distances must be finite and representable');
      return v;
    };
    function sameChannel(p, q) {
      return p === q || (p != null && q != null && typeof p === 'object' && typeof q === 'object' &&
        p.every((value, i) => value === q[i]));
    }
    const equal = (a,b) => a === b || channels.every(channel => sameChannel(a[channel],b[channel]));
    function box(index) {
      const first = index.map(v => v * brickSize);
      return { min: first.map(v => (v - 1) * cell), max: first.map(v => (v + brickSize) * cell) };
    }
    function snapshot(map) {
      let result;
      function location(i, j, k) {
        const bx = Math.floor(i / brickSize), by = Math.floor(j / brickSize), bz = Math.floor(k / brickSize);
        const index = (i - bx * brickSize) + brickSize * (j - by * brickSize + brickSize * (k - bz * brickSize));
        return [bx + '/' + by + '/' + bz, index];
      }
      function get(i, j, k, channel) {
        const [key, index] = location(i, j, k);
        return entry((map.get(key) ?? empty)[channel], index);
      }
      function queries(x, y, z) {
        if (![x, y, z].every(pointOK)) throw new RangeError('Sparse brick queries need bounded finite XYZ coordinates');
        return [lattice(x), lattice(y), lattice(z)];
      }
      function distance(x, y, z, fallback = base) {
        const p = queries(x, y, z), value = checked(fallback(x, y, z));
        if (!affectsColumn(x, z)) return value;
        const [i, j, k] = p.map(Math.floor), [u, v, w] = [p[0] - i, p[1] - j, p[2] - k];
        const row = (dy, dz) => {
          const a = get(i, j + dy, k + dz, 'offset');
          return u === 0 ? a : mix(a, get(i + 1, j + dy, k + dz, 'offset'), u);
        };
        const plane = dz => v === 0 ? row(0, dz) : mix(row(0, dz), row(1, dz), v);
        return checked(value + (w === 0 ? plane(0) : mix(plane(0), plane(1), w)));
      }
      function attributes(x, y, z) {
        const [i, j, k] = queries(x, y, z).map(Math.round), [key, index] = location(i, j, k);
        const brick = map.get(key) ?? empty;
        return { material: entry(brick.material, index), medium: entry(brick.medium, index) };
      }
      function mediumField(id) {
        if (!label(id) || id === null) throw new TypeError('A medium field needs a nonempty ID');
        return (x, y, z) => attributes(x, y, z).medium === id ? -1 : 1;
      }
      function publish(next, key, brick) {
        if (equal(brick, empty)) next.delete(key);
        else next.set(key, brick);
      }
      function setBrick(index, { offset, material, medium } = {}) {
        if (!coordinate(index, v => integer(v) && pointOK(v * brickSize * cell)) ||
            offset !== undefined && !field(offset) || material !== undefined && !label(material) ||
            medium !== undefined && !label(medium))
          throw new TypeError('A uniform brick needs integer XYZ indices and valid channels');
        const key = keyOf(index), old = map.get(key) ?? empty;
        const brick = { offset: offset === undefined ? old.offset : Math.fround(offset),
          material: material === undefined ? old.material : material, medium: medium === undefined ? old.medium : medium };
        if (equal(old, brick)) return result;
        const next = new Map(map);
        publish(next, key, brick);
        return snapshot(next);
      }
      function edit({ bounds, sdf, operation = 'paint', smooth = 0, material, medium, maxSamples = 524288 } = {}) {
        if (!coordinate(bounds?.min, pointOK) || !coordinate(bounds?.max, pointOK) ||
            bounds.min.some((v, axis) => v > bounds.max[axis]) ||
            !['paint', 'union', 'subtract'].includes(operation) ||
            (sdf !== undefined || operation !== 'paint') && typeof sdf !== 'function' ||
            !field(smooth) || smooth < 0 || material !== undefined && !label(material) ||
            medium !== undefined && !label(medium) || !integer(maxSamples) || maxSamples < 1 || maxSamples > 4000000)
          throw new TypeError('Invalid bounded sparse brush');
        const low = bounds.min.map(v => Math.ceil(lattice(v))), high = bounds.max.map(v => Math.floor(lattice(v)));
        const counts = high.map((v, p) => v - low[p] + 1);
        if (counts.some(n => n < 1)) return result;
        if (counts.reduce((a, b) => a * b, 1) > maxSamples) throw new RangeError('Sparse brush exceeds its sample budget');
        const touched = new Map();
        for (let k = low[2]; k <= high[2]; k++) for (let j = low[1]; j <= high[1]; j++) for (let i = low[0]; i <= high[0]; i++) {
          const xyz = [i * cell, j * cell, k * cell], brush = sdf ? checked(sdf(...xyz)) : -1;
          const [key, index] = location(i, j, k), previous = map.get(key) ?? empty;
          const old = entry(previous.offset, index);
          let offset = old;
          if (operation !== 'paint') {
            const baseline = checked(base(...xyz)), value = baseline + old;
            const edited = operation === 'union' ? smoothMin(value, brush, smooth) : -smoothMin(-value, brush, smooth);
            offset = Math.fround(checked(edited - baseline));
          }
          const m = brush <= 0 && material !== undefined ? material : entry(previous.material, index);
          const water = brush <= 0 && medium !== undefined ? medium : entry(previous.medium, index);
          if (offset === old && m === entry(previous.material, index) && water === entry(previous.medium, index)) continue;
          if (!touched.has(key)) {
            const unpack = (channel, Type) => channel != null && typeof channel === 'object' ?
              channel.slice() : new Type(length).fill(channel);
            touched.set(key, { offset: unpack(previous.offset, Float32Array),
              material: unpack(previous.material, Array), medium: unpack(previous.medium, Array) });
          }
          const brick = touched.get(key);
          brick.offset[index] = offset;
          brick.material[index] = m;
          brick.medium[index] = water;
        }
        if (touched.size === 0) return result;
        const next = new Map(map);
        for (const [key, brick] of touched) publish(next, key, {
          offset: compress(brick.offset), material: compress(brick.material), medium: compress(brick.medium)
        });
        return snapshot(next);
      }
      function changesFrom(previous, {channel} = {}) {
        if (channel !== undefined && !channels.includes(channel)) throw new TypeError('Unknown sparse brick channel');
        if (previous === result) return [];
        const old = previous == null ? null : states.get(previous);
        if (previous != null && !old) throw new TypeError('Expected a sparse brick snapshot');
        const at = key => key.split('/').map(Number);
        if (old && (old.cell !== cell || old.brickSize !== brickSize))
          return freeze([...old.map.keys()].map(key => old.box(at(key))).concat([...map.keys()].map(key => box(at(key)))));
        const previousMap = old?.map ?? new Map();
        return freeze([...new Set([...previousMap.keys(), ...map.keys()])].sort().filter(key => {
          const a = previousMap.get(key) ?? empty, b = map.get(key) ?? empty;
          return channel === undefined ? !equal(a,b) : !sameChannel(a[channel],b[channel]);
        }).map(key => box(at(key))));
      }
      let uniform = 0, sculpted = 0;
      const columns = new Set();
      for (const [key, brick] of map) {
        if (channels.every(c => brick[c] === null || typeof brick[c] !== 'object')) uniform++;
        if (brick.offset !== 0) {
          sculpted++;
          const [x, , z] = key.split('/');
          columns.add(x + '/' + z);
        }
      }
      function affectsColumn(x, z) {
        if (columns.size === 0) return false;
        const i = Math.floor(lattice(x)), k = Math.floor(lattice(z));
        const bx = Math.floor(i / brickSize), bz = Math.floor(k / brickSize);
        const nx = Math.floor((i + 1) / brickSize), nz = Math.floor((k + 1) / brickSize);
        return columns.has(bx + '/' + bz) || columns.has(nx + '/' + bz) ||
          columns.has(bx + '/' + nz) || columns.has(nx + '/' + nz);
      }
      result = Object.freeze({ cell, brickSize, distance, attributes, mediumField, setBrick, edit, changesFrom, affectsColumn,
        stats: freeze({ bricks: map.size, uniform, dense: map.size - uniform, sculpted }) });
      states.set(result, { map, cell, brickSize, box });
      return result;
    }
    return snapshot(new Map());
  }

  P.sparseBricks = Object.freeze({ create, isSnapshot: value => states.has(value) });
})(KIT);
