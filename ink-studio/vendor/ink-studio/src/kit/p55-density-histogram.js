/* Shared bounded visit histogram with an independent mass-weighted attribute. */
const DensityHistogram = (() => {
  const P = KIT.procedural, clamp = KIT.clamp,
    integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    finite = (n, max) => Number.isFinite(n) && Math.abs(n) <= max;

  function build({ dimension, bounds, resolution = dimension === 2 ? [256, 256] : [64, 64, 64],
    exposure = 1, channel, maxAttribute = Infinity }, feed) {
    const lo = bounds?.min, hi = bounds?.max;
    if (![lo, hi].every(row => Array.isArray(row) && row.length === dimension &&
        Array.from(row).every(x => finite(x, 1e7))))
      throw new RangeError('Density needs finite bounds matching its dimension');
    const res = typeof resolution === 'number' ? Array(dimension).fill(resolution) : resolution;
    if (!Array.isArray(res) || res.length !== dimension || !Array.from(res).every(n => integer(n, 1, 512)) ||
        res.reduce((a, b) => a * b, 1) > 2000000 || !finite(exposure, 1e6) || exposure < 0 ||
        lo.some((v, i) => hi[i] - v < 1e-8))
      throw new RangeError('Density needs ordered bounds, a bounded resolution and nonnegative exposure');

    const [nx, ny, nz = 1] = res, count = nx * ny * nz, xy = nx * ny,
      size = lo.map((v, i) => (hi[i] - v) / res[i]), [dx, dy, dz = 1] = size,
      [x0, y0, z0 = 0] = lo, [x1, y1, z1 = 0] = hi,
      weights = new Uint32Array(count), attributes = new Float64Array(count);
    let clipped = 0, deposited = 0, peak = 0;
    const empty = Object.freeze({ mass: 0, density: 0, [channel]: null });
    const within = (x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && (dimension === 2 || (z >= z0 && z <= z1));
    const stats = feed((x, y, z, attribute) => {
      if (!within(x, y, z)) { clipped++; return; }
      const i = Math.min(nx - 1, Math.floor((x - x0) / dx)),
        j = Math.min(ny - 1, Math.floor((y - y0) / dy)),
        k = dimension === 2 ? 0 : Math.min(nz - 1, Math.floor((z - z0) / dz)),
        at = i + nx * j + xy * k;
      deposited++;
      peak = Math.max(peak, ++weights[at]);
      attributes[at] += attribute;
    });

    const displayMax = exposure ? Math.log1p(exposure * peak) : peak;
    const display = mass => displayMax ? (exposure ? Math.log1p(exposure * mass) : mass) / displayMax : 0;
    function probe(x, y, z, withAttribute) {
      if (!within(x, y, z)) return withAttribute ? empty : 0;
      const u = clamp((x - x0) / dx - .5, 0, nx - 1), v = clamp((y - y0) / dy - .5, 0, ny - 1),
        w = dimension === 2 ? 0 : clamp((z - z0) / dz - .5, 0, nz - 1),
        i = Math.floor(u), j = Math.floor(v), k = Math.floor(w), at = i + nx * j + xy * k,
        e = i + 1 < nx ? 1 : 0, n = j + 1 < ny ? nx : 0, h = k + 1 < nz ? xy : 0,
        a = u - i, b = v - j, c = w - k;
      function value(data) {
        const north = data[at] + (data[at + e] - data[at]) * a,
          south = data[at + n] + (data[at + n + e] - data[at + n]) * a,
          bottom = north + (south - north) * b;
        if (!c) return bottom;
        const upperNorth = data[at + h] + (data[at + h + e] - data[at + h]) * a,
          upperSouth = data[at + h + n] + (data[at + h + n + e] - data[at + h + n]) * a;
        return bottom + (upperNorth + (upperSouth - upperNorth) * b - bottom) * c;
      }
      const mass = value(weights);
      if (!mass) return withAttribute ? empty : 0;
      const density = display(mass);
      return withAttribute ? { mass, density, [channel]: clamp(value(attributes) / mass, 0, maxAttribute) } : density;
    }
    function bin(i, j, k = 0) {
      if (!integer(i, 0, nx - 1) || !integer(j, 0, ny - 1) || !integer(k, 0, nz - 1))
        throw new RangeError('Density bin is outside the grid');
      const at = i + nx * j + xy * k, mass = weights[at];
      return mass ? { mass, density: display(mass), [channel]: clamp(attributes[at] / mass, 0, maxAttribute) } : empty;
    }
    return Object.freeze({ ...stats, clipped, deposited, peak, dimension, bounds: P.data.freeze({ min: lo.slice(), max: hi.slice() }),
      resolution: Object.freeze(res.slice()), cellSize: Object.freeze(size), bin,
      at: (x, y, z = 0) => probe(x, y, z, true), sample: (x, y, z = 0) => probe(x, y, z, false) });
  }

  return Object.freeze({ build });
})();
