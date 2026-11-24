/* Keep stable labels alongside native splats when copying or assembling buffers. */
const SplatProvenance = (() => {
  const tables = [['objectIds', 'objects'], ['materialIds', 'materials'], ['targetIds', 'targets']];
  const channels = [['normals', 3, Float32Array], ['muteEmission', 1, Uint8Array]];
  const perSplat = [['data', 16, Float32Array], ['attr', 4, Float32Array], ['fine', 12, Float32Array],
    ['pix', 8, Float32Array], ['surfaceData', 8, Float32Array], ['materialAlbedo', 1, Uint32Array],
    ['opticalSplats', 12, Float32Array], ['materialPixelStyles', 4, Float32Array], ['shadowLod', 6, Float32Array]];
  function targetKey(target) {
    const labels = [target.entity, target.surface, target.prefabs, target.tags, target.medium, target.mediumKind];
    if (target.mark !== undefined || target.markLayer !== undefined) labels.push(target.mark, target.markLayer);
    return JSON.stringify(labels);
  }

  function dictionary(key = value => value) {
    const names = [null], ids = new Map();
    function add(value, anonymous = false) {
      if (value == null) return anonymous ? names.push(null) - 1 : 0;
      const id = key(value);
      if (!ids.has(id)) ids.set(id, names.push(value) - 1);
      return ids.get(id);
    }
    return { names, add };
  }

  function fromRecords(records) {
    const result = { normals: new Float32Array(records.length * 3) };
    const objects = dictionary(), materials = dictionary(), targets = dictionary(targetKey);
    const objectIds = new Uint32Array(records.length), materialIds = new Uint32Array(records.length);
    const targetIds = new Uint32Array(records.length);
    for (let i = 0; i < records.length; i++) {
      const { owner, material, surface, target, normal } = records[i];
      objectIds[i] = objects.add(owner === '' ? null : owner);
      materialIds[i] = materials.add(material === '' ? null : material);
      if (surface || target) targetIds[i] = targets.add({ ...(surface && { surface }), ...target });
      if (normal) result.normals.set(normal, i * 3);
    }
    if (objects.names.length > 1) Object.assign(result, { objectIds, objects: objects.names });
    if (materials.names.length > 1) Object.assign(result, { materialIds, materials: materials.names });
    if (targets.names.length > 1) Object.assign(result, { targetIds, targets: targets.names });
    return result;
  }

  function combineMetadata(parts, count) {
    if (!parts.some(part => part.renderMetadata)) return undefined;
    const result = {};
    for (const [rows, names] of tables) {
      if (!parts.some(part => part.renderMetadata?.[rows])) continue;
      const out = new Uint32Array(count), table = dictionary(names === 'targets' ? targetKey : undefined);
      let offset = 0;
      for (const part of parts) {
        const source = part.renderMetadata?.[rows];
        if (source) {
          const index = (part.renderMetadata[names] ?? []).map((name, i) => i ? table.add(name, true) : 0);
          for (let i = 0; i < part.count; i++) out[offset + i] = index[source[i]] ?? 0;
        }
        offset += part.count;
      }
      result[rows] = out;
      result[names] = table.names;
    }
    for (const [key, stride, Type] of channels) {
      if (!parts.some(part => part.renderMetadata?.[key])) continue;
      const out = new Type(count * stride);
      let offset = 0;
      for (const part of parts) {
        const input = part.renderMetadata?.[key];
        if (input) out.set(input.subarray(0, part.count * stride), offset * stride);
        offset += part.count;
      }
      result[key] = out;
    }
    return result;
  }

  function join(parts, options = {}) {
    if (!Array.isArray(parts) || parts.some(part => !Number.isSafeInteger(part?.count) || part.count < 0 ||
        !(part.data instanceof Float32Array) || part.data.length < part.count * 16 || part.anim || part.rest ||
        part.pixAnchors || part.effectParticles?.length || part.sortRanges?.length))
      throw new TypeError('Expected native splat chunks without external per-splat animation or draw ranges');
    const { pal = parts.find(part => part.pal)?.pal, ...meta } = options;
    if (pal && parts.some(part => part.pal && (part.pal.length !== pal.length || part.pal.some((color, i) => color !== pal[i]))))
      throw new RangeError('Joined splat chunks must share a palette');
    const count = parts.reduce((n, part) => n + part.count, 0);
    const result = { ...meta, ...(pal && { pal }), count };
    for (const [key, stride, Type] of perSplat) {
      if (key !== 'data' && !parts.some(part => part[key])) continue;
      const out = result[key] = new Type(count * stride);
      let offset = 0;
      for (const part of parts) {
        if (part[key]) out.set(part[key].subarray(0, part.count * stride), offset * stride);
        offset += part.count;
      }
    }

    const moving = [], back = [], splatIds = [], surfaces = [], ramps = [], rampOff = [], pats = [], paintRows = [], paintDecals = [];
    const withIds = parts.some(part => part.splatIds ?? part.ids);
    const rampIds = new Map(), patternIds = new Map();
    let offset = 0;
    for (const part of parts) {
      const base = surfaces.length;
      for (const surface of part.surfaces ?? []) surfaces.push(surface);
      const remapRamps = part.ramps?.map((ramp, i) => {
        const off = part.rampOff?.[i] ?? false, key = JSON.stringify([off, ramp]);
        if (!rampIds.has(key)) {
          rampOff.push(off);
          rampIds.set(key, ramps.push(ramp));
        }
        return rampIds.get(key);
      });
      const remapPatterns = part.pats?.map(pattern => {
        if (!patternIds.has(pattern)) patternIds.set(pattern, pats.push(pattern));
        return patternIds.get(pattern);
      });
      for (let i = 0; i < part.count; i++) {
        const at = (offset + i) * 8;
        const alternateRamp = (offset + i) * 6 + 3;
        if (result.shadowLod?.[alternateRamp])
          result.shadowLod[alternateRamp] = remapRamps?.[result.shadowLod[alternateRamp] - 1] ?? 0;
        if (result.surfaceData?.[at]) result.surfaceData[at] += base;
        if (result.pix?.[at]) {
          result.pix[at] = remapRamps?.[result.pix[at] - 1] ?? 0;
          result.pix[at + 2] = remapPatterns?.[result.pix[at + 2] - 1] ?? 0;
        }
        if (withIds) splatIds.push((part.splatIds ?? part.ids)?.[i] ?? null);
      }
      for (const i of part.moving ?? []) moving.push(offset + i);
      for (const i of part.back ?? []) back.push(offset + i);
      for (const row of part.paintDecals ?? []) paintDecals.push({ ...row, index: offset + row.index });
      for (const row of part.paintCorrections?.rows ?? []) paintRows.push({ ...row, index: offset + row.index });
      offset += part.count;
    }
    if (result.surfaceData) result.surfaces = surfaces;
    if (result.pix) Object.assign(result, { ramps, rampOff, pats });
    if (withIds) result.splatIds = Object.freeze(splatIds);
    if (paintDecals.length) result.paintDecals = paintDecals;
    if (paintRows.length) result.paintCorrections = bindPaint(paintRows);
    return Object.assign(result, { renderMetadata: combineMetadata(parts, count),
      moving: Int32Array.from(moving), back: Int32Array.from(back) });
  }

  function subset(world, selection) {
    const indices = Array.from(selection);
    if (indices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= world.count) || new Set(indices).size !== indices.length)
      throw new RangeError('A splat subset needs distinct indices from the world');
    const result = { ...world, count: indices.length };
    if (result.renderSdfs && (indices.length !== world.count || indices.some((index,i)=>index !== i)))
      delete result.renderSdfs;
    const remap = new Map(indices.map((source, i) => [source, i]));
    function take(source, stride, Type) {
      const out = new Type(indices.length * stride);
      for (let i = 0; i < indices.length; i++) out.set(source.subarray(indices[i] * stride, (indices[i] + 1) * stride), i * stride);
      return out;
    }
    for (const [key, stride, Type] of perSplat) if (world[key]) result[key] = take(world[key], stride, Type);
    if (world.renderMetadata) {
      const source = world.renderMetadata, meta = result.renderMetadata = { ...source };
      for (const [key, stride, Type] of channels) if (source[key]) meta[key] = take(source[key], stride, Type);
      for (const [key] of tables) if (source[key]) meta[key] = take(source[key], 1, Uint32Array);
    }
    for (const key of ['moving', 'back']) result[key] = Int32Array.from(Array.from(world[key] ?? []).filter(i => remap.has(i)), i => remap.get(i));
    if (world.splatIds) result.splatIds = Object.freeze(indices.map(i => world.splatIds[i]));
    if (world.paintDecals) result.paintDecals = world.paintDecals.filter(row => remap.has(row.index))
      .map(row => ({ ...row, index: remap.get(row.index) }));
    if (world.paintCorrections) {
      const paintRows = world.paintCorrections.rows.filter(row => remap.has(row.index))
        .map(row => ({ ...row, index: remap.get(row.index) }));
      result.paintCorrections = bindPaint(paintRows);
    }
    return result;
  }

  function bindPaint(rows) {
    const api = typeof PaintCorrections === 'undefined' ? require('./paint-corrections.js') : PaintCorrections;
    return api.bind(rows);
  }

  return Object.freeze({ join, subset, fromRecords, targetKey });
})();
if (typeof module !== 'undefined') module.exports = SplatProvenance;
