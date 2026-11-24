/* Exact squared Euclidean distance on 2D or 3D voxel-center lattices. */
(function (K) {
  const P = K.procedural,
    integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

  function sweep(field, owners, size, spacings) {
    const capacity = Math.max(...size), source = new Float64Array(capacity),
      sourceOwners = owners ? new Int32Array(capacity) : null,
      sites = new Int32Array(capacity), boundaries = new Float64Array(capacity + 1);
    let stride = 1;
    for (const [axis, count] of size.entries()) {
      const step = spacings[axis] ** 2, block = count * stride;
      for (let start = 0; start < field.length; start += block) for (let lane = 0; lane < stride; lane++) {
        const base = start + lane;
        let last = -1;
        for (let p = 0; p < count; p++) {
          const i = base + p * stride, level = field[i];
          source[p] = level;
          if (sourceOwners) sourceOwners[p] = owners[i];
          if (!Number.isFinite(level)) continue;
          let border = -Infinity;
          while (last >= 0) {
            const q = sites[last];
            border = (p + q) * 0.5 + (level - source[q]) / (2 * step * (p - q));
            if (border > boundaries[last]) break;
            last--;
          }
          sites[++last] = p;
          boundaries[last] = last ? border : -Infinity;
          boundaries[last + 1] = Infinity;
        }
        if (last < 0) continue;
        let selected = 0;
        for (let p = 0; p < count; p++) {
          while (boundaries[selected + 1] < p) selected++;
          const q = sites[selected], i = base + p * stride;
          field[i] = source[q] + step * (p - q) ** 2;
          if (sourceOwners) owners[i] = sourceOwners[q];
        }
      }
      stride *= count;
    }
  }

  function distanceTransform(mask, {
    size, spacing = 1, signed = false, indices = true, maxCells = 3000000
  } = {}) {
    const dimensions = size?.length, spacings = typeof spacing === 'number' ? Array(dimensions || 0).fill(spacing) : spacing,
      cells = Array.isArray(size) ? size.reduce((product, n) => product * n, 1) : Infinity;
    if (
      !Array.isArray(size) || (dimensions !== 2 && dimensions !== 3) || !size.every(n => integer(n, 1, 8192)) ||
      !Array.isArray(spacings) || spacings.length !== dimensions ||
      !spacings.every(v => Number.isFinite(v) && v >= 1e-6 && v <= 1e6) ||
      !integer(maxCells, 1, 6000000) || !Number.isSafeInteger(cells) || cells > maxCells ||
      (!Array.isArray(mask) && !ArrayBuffer.isView(mask)) || mask.length !== cells ||
      typeof signed !== 'boolean' || typeof indices !== 'boolean'
    ) throw new Error('Distance transform needs a bounded binary 2D or 3D domain');
    const occupied = new Uint8Array(cells),
      outside = new Float64Array(cells), nearest = indices ? new Int32Array(cells) : null,
      inside = signed ? new Float64Array(cells) : null, secondary = signed && indices ? new Int32Array(cells) : null;
    for (let i = 0; i < cells; i++) {
      const v = mask[i];
      if (v !== true && v !== false && v !== 0 && v !== 1) throw new Error('Distance transform masks need binary values');
      const on = Number(v);
      occupied[i] = on;
      outside[i] = on ? 0 : Infinity;
      if (nearest) nearest[i] = on ? i : -1;
      if (inside) inside[i] = on ? Infinity : 0;
      if (secondary) secondary[i] = on ? -1 : i;
    }
    sweep(outside, nearest, size, spacings);
    if (inside) sweep(inside, secondary, size, spacings);
    const distance = new Float64Array(cells);
    for (let i = 0; i < cells; i++) {
      if (inside && occupied[i]) {
        outside[i] = inside[i];
        if (nearest) nearest[i] = secondary[i];
        distance[i] = -Math.sqrt(inside[i]);
      } else distance[i] = Math.sqrt(outside[i]);
    }
    const shape = Object.freeze(size.slice());
    function at(...point) {
      if (point.length !== dimensions || !point.every((v, axis) => integer(v, 0, shape[axis] - 1))) return null;
      let index = point.at(-1);
      for (let axis = dimensions - 2; axis >= 0; axis--) index = index * shape[axis] + point[axis];
      return { distance: distance[index], squared: outside[index], nearest: nearest?.[index] ?? null };
    }
    return Object.freeze({ size: shape, spacing: Object.freeze(spacings.slice()), distance, squared: outside, nearest, at });
  }
  P.geometry.distanceTransform = distanceTransform;
})(KIT);
