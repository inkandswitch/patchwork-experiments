/* Scalar patterns, bounded simulation grids and sampling adapters. */
(function (K) {
  const P = K.procedural, G = P.generator;
  const { vector, wrap, unit, raster, validRaster, dimensions, clock, range, integer, sampleField, maskReader } = P.generatorSupport;

  function noise(definition = { type: 'simplex', axes: ['x', 'y'] }, { seed = 0 } = {}) {
    return P.fields.compile(definition, { seed });
  }

  const patterns = {
    checker: (x, y) => wrap(Math.floor(x) + Math.floor(y), 2),
    stripes: (x, _y, fill) => +(wrap(x, 1) < fill),
    dots: (x, y, fill) => +(Math.hypot(wrap(x, 1) - .5, wrap(y, 1) - .5) < fill * .5),
    rings: (x, y, fill) => +(wrap(Math.hypot(x, y), 1) < fill),
    brick: (x, y, fill) => +(wrap(x + wrap(Math.floor(y), 2) * .5, 1) < fill && wrap(y, 1) < fill),
    chevrons: (x, y, fill) => +(wrap(y + Math.abs(wrap(x, 1) - .5), 1) < fill)
  };

  function pattern({ kind = 'checker', size = 8, axes = 'xy', fill = .5, angle = 0, offset = [0, 0], velocity = [0, 0] } = {}) {
    const cell = typeof size === 'number' ? [size, size] : size;
    if (!Object.hasOwn(patterns, kind) || !['xy', 'xz', 'yz'].includes(axes) ||
        !vector(cell, 2) || cell.some(n => !range(n, 1e-7, 1e7)) || !range(fill, 0, 1) ||
        !Number.isFinite(angle) || !vector(offset, 2) || !vector(velocity, 2))
      throw new RangeError('Invalid procedural pattern, dimensions or motion');
    const c = Math.cos(angle), s = Math.sin(angle), evaluate = patterns[kind];
    return (x, y, z, time = 0) => {
      const u = (axes === 'yz' ? y : x) - offset[0] - time * velocity[0];
      const v = (axes === 'xy' ? y : z) - offset[1] - time * velocity[1];
      return evaluate((c * u + s * v) / cell[0], (c * v - s * u) / cell[1], fill);
    };
  }

  function sample(source, { origin = [0, 0, 0], u = [1, 0, 0], v = [0, 1, 0], time = 0, ...size } = {}) {
    const { width, height } = dimensions(size);
    if (!P.graphTypes.validator('field')(source) || ![origin, u, v].every(axis => vector(axis, 3)))
      throw new TypeError('Field sampling needs a scalar field and finite plane vectors');
    clock(time, 0);
    const data = new Float64Array(width * height);
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      const a = (x + .5) / width, b = (y + .5) / height;
      data[i] = sampleField(source, origin[0] + a * u[0] + b * v[0], origin[1] + a * u[1] + b * v[1],
        origin[2] + a * u[2] + b * v[2], time);
    }
    return raster(width, height, data);
  }

  function scatter({ bounds = { min: [0, 0], max: [1, 1] }, radius = .08, mask, maskChannel, threshold = 0, time = 0,
    seed = 0, reseed = mask === undefined ? 0 : 32, ...options } = {}) {
    clock(time, seed);
    if (!Number.isFinite(threshold) || ![2, 3].includes(bounds?.min?.length) || !vector(bounds.min, bounds.min.length) ||
        !vector(bounds.max, bounds.min.length) || bounds.min.some((n, i) => n >= bounds.max[i]))
      throw new RangeError('Scatter needs increasing planar or spatial bounds and a finite mask threshold');
    const vertical = bounds.min.length - 1;
    let gate;
    if (validRaster(mask)) {
      const read = maskReader(mask, maskChannel);
      const pixel = (value, axis, size) =>
        Math.min(size - 1, Math.floor(unit((value - bounds.min[axis]) / (bounds.max[axis] - bounds.min[axis])) * size));
      gate = point => read(pixel(point[0], 0, mask.width), pixel(point[vertical], vertical, mask.height)) > threshold;
    } else if (P.graphTypes.validator('field')(mask)) {
      gate = ([x, y, z = 0]) => sampleField(mask, x, y, z, time) > threshold;
    } else if (mask !== undefined) {
      throw new TypeError('Scatter mask needs a scalar field or raster');
    }
    const { samples, ...report } = P.sampling.poisson({ ...options, bounds, radius, mask: gate, seed, reseed });
    return { value: samples.map(row => row.point), samples: samples.map((row, id) => ({ id, ...row })), report };
  }

  function reaction({ width = 64, height = 48, steps = 400, spots, seed = 0, mask, maskChannel, threshold = 0, ...options } = {}) {
    dimensions({ width, height });
    clock(0, seed);
    if (!Number.isFinite(threshold) ||
        (spots !== undefined && (!Array.isArray(spots) || spots.length > width * height ||
          !Array.from(spots).every(i => integer(i, 0, width * height - 1)))))
      throw new RangeError('Reaction needs valid row-major spot indices and mask threshold');
    let gate;
    if (mask !== undefined) {
      const read = maskReader(mask, maskChannel);
      if (mask.width !== width || mask.height !== height) throw new RangeError('Reaction mask must match the grid');
      gate = (x, y) => read(x, y) > threshold;
    }
    const { u, v, work } = P.growth.grayScottGrid({ ...options, width, height, steps, spots, seed, mask: gate });
    return { value: raster(width, height, v), u: raster(width, height, u), report: work };
  }

  Object.assign(G, { noise, pattern, sample, scatter, reaction });
})(KIT);
