(function(K) {
  const revision = 1;
  const channels = ['data', 'count', 'renderMetadata', 'attr', 'pix', 'ramps', 'rampOff', 'pats',
    'surfaceData', 'surfaces', 'fine', 'moving', 'back', 'materialAlbedo', 'opticalSplats',
    'materialPixelStyles', 'shadowLod', 'precipitationRanges', 'fallingSnowRanges'];
  const globals = ['INK_FINE', 'INK_PIXEL', 'INK_BOUNCE', 'INK_FOCUS', 'INK_FOLLOW', 'INK_ADAPTIVE_SAMPLING', 'INK_LOOK_ALBEDO'];

  // Entry order affects sculpt grouping and palette recipes. Preserve it in the key.
  function signature(value) {
    const seen = new Set();
    function encode(input) {
      if (input === null) return ['null'];
      if (typeof input === 'number') return ['number', Object.is(input, -0) ? '-0' : String(input)];
      if (typeof input === 'string' || typeof input === 'boolean') return [typeof input, input];
      if (input === undefined) return ['undefined'];
      if (typeof input !== 'object' || seen.has(input)) throw new TypeError('Unsupported bake cache input');
      if (ArrayBuffer.isView(input) && !(input instanceof DataView))
        return ['view', input.constructor.name, Array.from(input, item => Object.is(item, -0) ? '-0' : String(item))];
      if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
        throw new TypeError('Unsupported bake cache object');
      seen.add(input);
      const result = Array.isArray(input) ? ['array', input.map(encode)] :
        ['object', Object.entries(input).map(([key, item]) => [key, encode(item)])];
      seen.delete(input);
      return result;
    }
    try {
      return JSON.stringify([revision, encode(value)]);
    } catch {
      return undefined;
    }
  }

  // Keep exact-length buffers and isolate stored results from live world edits.
  function snapshot(value, seen = new Set()) {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Unsupported baked value');
      return value;
    }
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return value.slice();
    if (seen.has(value) || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new TypeError('Unsupported baked object');
    seen.add(value);
    const result = Array.isArray(value) ? value.map(item => snapshot(item, seen)) :
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, seen)]));
    seen.delete(value);
    return result;
  }

  function sizeOf(value) {
    if (typeof value === 'string') return value.length * 2;
    if (value === null || typeof value !== 'object') return 8;
    if (ArrayBuffer.isView(value)) return value.byteLength + 48;
    return Object.entries(value).reduce((sum, [key, item]) => sum + key.length * 2 + 16 + sizeOf(item), 32);
  }

  function create({ maxBytes = 64 * 1024 * 1024, storage } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid bake cache byte limit');
    const entries = new Map(), totals = new Map();
    let bytes = 0;
    function counter(kind) {
      if (!totals.has(kind)) totals.set(kind, { hits: 0, misses: 0, stored: 0 });
      return totals.get(kind);
    }
    function remember(key, value) {
      const size = key.length * 2 + sizeOf(value);
      if (size > maxBytes) return false;
      if (entries.has(key)) {
        bytes -= entries.get(key).size;
        entries.delete(key);
      }
      while (bytes + size > maxBytes) {
        const oldest = entries.keys().next().value;
        bytes -= entries.get(oldest).size;
        entries.delete(oldest);
      }
      entries.set(key, { size, value });
      bytes += size;
      return true;
    }
    return Object.freeze({
      read(kind, inputs, validate = () => true) {
        const result = counter(kind);
        if (inputs === undefined) { result.misses++; return undefined; }
        const key = kind + '\n' + inputs, entry = entries.get(key);
        if (entry) {
          entries.delete(key);
          entries.set(key, entry);
          result.hits++;
          return snapshot(entry.value);
        }
        const value = storage?.read(kind, inputs);
        if (value !== undefined && validate(value)) {
          remember(key, value);
          result.hits++;
          return snapshot(value);
        }
        result.misses++;
      },
      write(kind, inputs, value) {
        if (inputs === undefined) return;
        let copy;
        try { copy = snapshot(value); } catch { return; }
        const written = storage?.write(kind, inputs, copy);
        if (remember(kind + '\n' + inputs, copy) || written) counter(kind).stored++;
      },
      stats: () => ({ entries: entries.size, bytes,
        byKind: Object.fromEntries([...totals].map(([kind, value]) => [kind, { ...value }])) }),
      clear() {
        entries.clear();
        totals.clear();
        bytes = 0;
      }
    });
  }

  function sceneKey(spec, style, meshes) {
    const { camera, name, blurb, ...geometry } = spec;
    return signature([geometry, style, meshes, globals.map(name => globalThis[name])]);
  }
  function pack(world) {
    return Object.fromEntries(channels.filter(key => Object.hasOwn(world, key)).map(key => [key, world[key]]));
  }
  function isPacked(value) {
    return Number.isSafeInteger(value?.count) && value.count >= 0 && value.data instanceof Float32Array &&
      value.data.length === value.count * 16 && value.moving instanceof Int32Array && value.back instanceof Int32Array;
  }
  function compareRows(before, after, stride) {
    if (!(before instanceof Float32Array) || !(after instanceof Float32Array) || before.length !== after.length) return;
    const a = new Uint32Array(before.buffer, before.byteOffset, before.length);
    const b = new Uint32Array(after.buffer, after.byteOffset, after.length);
    const rows = [];
    for (let start = 0; start < b.length; start += stride) {
      const end = Math.min(start + stride, b.length);
      for (let i = start; i < end; i++) if (a[i] !== b[i]) {
        rows.push(start / stride);
        break;
      }
    }
    return rows;
  }
  function frameDiff(previousWorld, world) {
    const previous = previousWorld;
    if (!isPacked(previous) || previous.count !== world.count || previous.anim || world.anim ||
        previous.paintCorrections || world.paintCorrections) return {};
    const changedRows = compareRows(previous.data, world.data, 512 * 16);
    if (!changedRows) return {};
    return { previousWorld, changedRows,
      changedFineRows: compareRows(previous.fine, world.fine, 512 * 12),
      changedPatternRows: compareRows(previous.pix, world.pix, 1024 * 8) };
  }

  K.authoring.bakeCache = Object.freeze({ create, signature, sceneKey, pack, isPacked, frameDiff });
})(KIT);
