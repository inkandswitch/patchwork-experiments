/* Ordered height contributions and their ownership. The caller supplies the
   bounded masks and spatial index used to select layers for each point. */
(function (K) {
  function sample(layers, x, z) {
    let delta = 0, owner = null, coverage = 0;
    for (const layer of layers) {
      const { min, max } = layer.bounds;
      if (x < min[0] || x > max[0] || z < min[2] || z > max[2]) continue;
      const w = layer.weight(x, z);
      if (w <= 0) continue;

      const { operation, height } = layer.parameters;
      if (operation === 'erase') {
        if (w === 1) {
          delta = 0;
          coverage = 0;
          owner = null;
        } else {
          delta *= 1 - w;
          coverage *= 1 - w;
        }
        continue;
      }

      const h = height * w;
      if (operation === 'add') delta += h;
      else if (operation === 'max') delta = Math.max(delta, h);
      else if (operation === 'min') delta = Math.min(delta, h);
      else delta = delta * (1 - w) + h;
      owner = layer.entity.id;
      coverage = Math.max(coverage, w);
    }
    return { delta, owner, coverage };
  }

  function distance(layers, x, z, id) {
    let d = Infinity, found = false;
    for (const layer of layers) {
      const erased = layer.parameters.operation === 'erase';
      if (id !== undefined && !found) {
        if (!erased && layer.entity.id === id) {
          found = true;
          d = layer.support(x, z);
        }
        continue;
      }
      if (id === undefined && !erased) d = Math.min(d, layer.support(x, z));
      else if (d < Infinity) d = Math.max(d, -layer.support(x, z));
    }
    return d;
  }

  // Edit the coverage of one layer before evaluating the ordered height stack.
  function mask(layer, edits) {
    if (!layer || typeof layer.weight !== 'function' || typeof layer.support !== 'function' ||
        !Array.isArray(edits) || !Array.from(edits).every(edit =>
          ['cut', 'repair'].includes(edit?.operation) &&
          typeof edit.weight === 'function' && typeof edit.support === 'function'))
      throw Error('Layer masks need a height layer and ordered cut or repair fields');
    if (!edits.length) return layer;
    const strokes = edits.slice();
    function weight(x, z) {
      const base = layer.weight(x, z);
      if (base <= 0) return base;
      let keep = 1;
      for (const edit of strokes) {
        const w = edit.weight(x, z);
        keep = edit.operation === 'cut' ? keep * (1 - w) : keep + (1 - keep) * w;
      }
      return base * keep;
    }
    function support(x, z) {
      let erased = Infinity;
      for (const edit of strokes) {
        const dist = edit.support(x, z);
        erased = edit.operation === 'cut' ? Math.min(erased, dist) : Math.max(erased, -dist);
      }
      return Math.max(layer.support(x, z), -erased);
    }
    return { ...layer, weight, support };
  }

  const compareOrder = (a,b) => a.order-b.order || a.id.localeCompare(b.id);

  function reorder(records,id,toIndex) {
    if (!Array.isArray(records) || !records.every(record => typeof record?.id === 'string' && record.id &&
      Number.isSafeInteger(record.order) && record.order >= 0) ||
      new Set(records.map(record => record.id)).size !== records.length)
      throw Error('Layer order needs distinct IDs and nonnegative integer ranks');
    const ordered = records.slice().sort(compareOrder);
    const from = ordered.findIndex(record => record.id === id);
    if (from < 0 || !Number.isSafeInteger(toIndex) || toIndex < 0 || toIndex >= ordered.length)
      throw Error('Layer order needs an existing ID and valid destination index');
    if (from === toIndex) return [];

    const result = ordered.slice(), [moved] = result.splice(from,1);
    result.splice(toIndex,0,moved);
    const prev = result[toIndex-1], next = result[toIndex+1];
    const min = prev ? prev.order + (id.localeCompare(prev.id) <= 0 ? 1 : 0) : 0;
    const max = next ? next.order - (id.localeCompare(next.id) >= 0 ? 1 : 0) : Number.MAX_SAFE_INTEGER;
    if (min <= max) return [{ id, order: Math.max(min,Math.min(max,moved.order)) }];

    // Reuse the ranks in the moved range before compacting legacy tied ranks.
    const assigned = result.map((record,i) => ({ id: record.id, order: ordered[i].order }));
    const ranks = assigned.every((record,i) => !i || compareOrder(assigned[i-1],record) < 0)
      ? assigned : result.map((record,order) => ({ id: record.id, order }));
    return ranks.filter((record,i) => record.order !== result[i].order);
  }

  K.heightLayers = Object.freeze({ sample, distance, mask, compareOrder, reorder });
})(KIT);
