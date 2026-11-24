/* Stable names shared by look authors, render ownership, and scene queries. */
const TargetSelectors = (() => {
  const keys = ['entity', 'object', 'material', 'surface', 'prefab', 'tag', 'medium', 'mediumKind', 'mark', 'markLayer'];
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
  function prepare(selector) {
    if (!record(selector) || !Object.keys(selector).length) throw new TypeError('Expected a nonempty target selector');
    for (const [key, value] of Object.entries(selector)) {
      if (!keys.includes(key) || !(name(value) || (['object', 'entity', 'material'].includes(key) && Number.isSafeInteger(value))))
        throw new TypeError('Invalid target selector field: ' + key);
    }
    return Object.freeze({ ...selector });
  }

  function matches(selector, target) {
    return Object.entries(selector).every(([key, value]) => {
      if (key === 'tag') return target.tags?.includes(value);
      if (key === 'prefab') return target.prefabs?.includes(value);
      return target[key] === value;
    });
  }

  function describe(target) {
    if (!record(target)) throw new TypeError('Expected named target metadata');
    const keys = ['entity', 'surface', 'prefabs', 'tags', 'medium', 'mediumKind', 'mark', 'markLayer'];
    for (const [key, value] of Object.entries(target)) {
      const valid = key === 'tags' || key === 'prefabs' ?
        Array.isArray(value) && Array.from(value).every(name) : name(value) || key === 'entity' && Number.isSafeInteger(value);
      if (!keys.includes(key) || !valid) throw new TypeError('Invalid target metadata field: ' + key);
    }
    return target;
  }

  const namedGlass = (world, i) => (Math.round(world.data?.[i * 16 + 11]) & 256) !== 0;
  function index(world) {
    const { objectIds, materialIds, targetIds, objects, materials, targets } = world.renderMetadata ?? {};
    const cache = new Map();
    const stride = 8; // SurfaceLook.STRIDE
    const dims = [objects?.length ?? 1, materials?.length ?? 1, (world.surfaces?.length ?? 0) + 1];
    const packedKey = Number.isSafeInteger(dims.reduce((n, size) => n * size, 2 * (targets?.length ?? 1)));
    function row(i) {
      const objectId = objectIds?.[i] || 0, materialId = materialIds?.[i] || 0, targetId = targetIds?.[i] || 0;
      const glass = namedGlass(world, i);
      const surfaceSlot = world.surfaceData?.[i * stride] || 0;
      const surfaceName = world.surfaces?.[surfaceSlot - 1]?.settings?.id;
      const group = packedKey ? (((targetId * dims[0] + objectId) * dims[1] + materialId) * dims[2] + surfaceSlot) * 2 + Number(glass) :
        [objectId, materialId, targetId, surfaceSlot, Number(glass)].join('/');
      if (!cache.has(group)) {
        const object = objects?.[objectId], material = materials?.[materialId], extra = targets?.[targetId];
        const surface = extra?.surface ?? surfaceName;
        cache.set(group, { kind: 'splat', ...(object != null && { object, entity: object }),
          ...(material != null && { material }), ...(name(surface) && { surface }),
          ...(glass && { mediumKind: 'glass', ...(name(surface ?? object) && { medium: surface ?? object }) }), ...extra });
      }
      return cache.get(group);
    }
    function groups(selector, { includeUnnamed = false } = {}) {
      const result = new Map();
      for (let i = 0; i < world.count; i++) {
        const target = row(i);
        if (!result.has(target)) result.set(target, !selector || matches(selector, target) ? { target, first: i, count: 0 } : null);
        const group = result.get(target);
        if (group) group.count++;
      }
      return [...result.values()].filter(group => group && (includeUnnamed || selector || Object.keys(group.target).length > 1));
    }
    return { row, groups };
  }

  const medium = (id, kind, tags) => ({ kind: 'medium', ...(name(id) && { medium: id }), mediumKind: kind,
    ...(tags?.length && { tags }) });
  function media(world) {
    return [
      ...(world.atmosphere ?? []).map(volume => medium(volume.id, volume.mediumKind ?? volume.type, volume.tags)),
      ...(world.atmosphereDepthBands || []).map(band => medium(band.id, 'fog', band.tags)),
      ...(world.water?.media ?? []).map(item => medium(item.id, item.kind)),
      ...(world.reflections ?? []).map(item => medium(item.id, 'reflection', item.tags))
    ];
  }
  return Object.freeze({ prepare, matches, describe, index, name, medium, media, isGlass: namedGlass });
})();
if (typeof module !== 'undefined') module.exports = TargetSelectors;
