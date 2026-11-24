/* Reservations keep surface animation, destruction and kinematic writers from fighting. */
(function (K) {
  const registries = new WeakMap();
  K.geometryOwnership = stage => {
    if (registries.has(stage)) return registries.get(stage);
    if (!Number.isSafeInteger(stage?.N) || stage.N < 0 || !(stage.D instanceof Float32Array))
      throw new TypeError('Geometry ownership needs a stage');
    const mask = stage.physicsOwned ?? new Uint8Array(stage.N);
    if (!(mask instanceof Uint8Array) || mask.length < stage.N) throw new RangeError('Invalid geometry ownership mask');
    stage.geometryOwned = stage.physicsOwned = mask;
    const owners = new Map(),
      sets = new Map();
    function list(ids) {
      if (!Array.isArray(ids) && !ArrayBuffer.isView(ids)) throw new TypeError('Geometry IDs must be an array');
      const result = Array.from(ids);
      if (
        !result.length ||
        result.some(i => !Number.isSafeInteger(i) || i < 0 || i >= stage.N) ||
        new Set(result).size !== result.length
      )
        throw new RangeError('Geometry IDs must be distinct and in range');
      return result;
    }
    function owned(owner, ids) {
      const result = ids === undefined ? [...(sets.get(owner) ?? [])] : list(ids);
      if (!sets.has(owner) || result.some(i => owners.get(i) !== owner))
        throw new Error('Geometry reservation belongs to another system');
      return result;
    }
    function active(owner, ids, value) {
      if (typeof ids === 'number') {
        if (!Number.isSafeInteger(ids) || ids < 0 || ids >= stage.N)
          throw new RangeError('Geometry IDs must be distinct and in range');
        if (owners.get(ids) !== owner || !sets.has(owner))
          throw new Error('Geometry reservation belongs to another system');
        mask[ids] = value;
      } else for (const i of owned(owner, ids)) mask[i] = value;
    }
    const api = Object.freeze({
      owner: i => owners.get(i),
      reserve(owner, ids) {
        if (owner === undefined || owner === null) throw new TypeError('Geometry needs an owner token');
        const selected = list(ids);
        if (selected.some(i => (owners.has(i) && owners.get(i) !== owner) || (mask[i] && owners.get(i) !== owner)))
          throw new Error('Geometry is already reserved or active in another system');
        const set = sets.get(owner) ?? new Set();
        for (const i of selected) {
          owners.set(i, owner);
          set.add(i);
        }
        sets.set(owner, set);
      },
      activate(owner, ids) {
        active(owner, ids, 1);
      },
      deactivate(owner, ids) {
        active(owner, ids, 0);
      },
      release(owner) {
        if (!sets.has(owner)) return;
        for (const i of owned(owner)) {
          mask[i] = 0;
          owners.delete(i);
        }
        sets.delete(owner);
      }
    });
    registries.set(stage, api);
    return api;
  };
})(KIT);
