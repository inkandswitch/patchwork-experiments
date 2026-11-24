/* Finite density shared by volume rendering, scattering and surface extraction. */
const VolumeField = (() => {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function bounds(value) {
    const { min, max } = value || {};
    if (![min, max].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) ||
        min.some((n, i) => n >= max[i])) throw new RangeError('Density needs finite XYZ bounds with positive extent');
    return { min: min.slice(), max: max.slice() };
  }

  function bounded({ bounds: extent, sample, skip } = {}) {
    const { min, max } = bounds(extent);
    if (typeof sample !== 'function' || (skip !== undefined && typeof skip !== 'function'))
      throw new TypeError('Density needs a sample function and an optional conservative skip function');
    return Object.freeze({
      bounds: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }),
      sample(x, y, z, time = 0, context) {
        if (x < min[0] || x > max[0] || y < min[1] || y > max[1] || z < min[2] || z > max[2]) return 0;
        const value = sample(x, y, z, time, context);
        if (!Number.isFinite(value) || value < 0) throw new RangeError('Density samples must be finite and nonnegative');
        return value;
      },
      skip
    });
  }

  function fromSdf({ bounds: extent, field, feather = .18, noise, breakup = .5, drift = [0, 0], windInfluence = 0, conservative = false } = {}) {
    const sdf = typeof field === 'function' ? field : field?.sdf?.bind(field) || field?.sd?.bind(field);
    if (typeof sdf !== 'function' || (noise !== undefined && typeof noise !== 'function') ||
        !Number.isFinite(feather) || feather < 0 || !Number.isFinite(breakup) || breakup < 0 || breakup > 1 ||
        !Array.isArray(drift) || drift.length !== 2 || !drift.every(Number.isFinite) || !Number.isFinite(windInfluence))
      throw new TypeError('Shape density needs an SDF, nonnegative feather and optional noise');
    return bounded({
      bounds: extent,
      sample(x, y, z, time, context) {
        const distance = sdf(x, y, z, time);
        if (!Number.isFinite(distance)) throw new RangeError('The shape SDF must return finite distances');
        if (distance >= 0) return 0;
        const t = feather ? clamp(-distance / feather, 0, 1) : 1;
        const local = noise && windInfluence && context?.windOffset?.(x,y,z);
        const wx = local ? drift[0]*time + local[0]*windInfluence : (drift[0] + (context?.wind?.[0] || 0)*windInfluence)*time;
        const wz = local ? drift[1]*time + local[1]*windInfluence : (drift[1] + (context?.wind?.[1] || 0)*windInfluence)*time;
        const variation = noise ? clamp(noise(x - wx, y, z - wz, time), 0, 1) : 1;
        return t * t * (3 - 2 * t) * (1 - breakup + breakup * variation);
      },
      skip: conservative ? (x, y, z, direction, time) => Math.max(0, sdf(x, y, z, time)) : undefined
    });
  }

  function sparse(field, { resolution = [48, 32, 48], brick = 4, time = 0, maxCells = 2e6 } = {}) {
    const { min, max } = bounds(field?.bounds);
    if (typeof field?.sample !== 'function' || !Array.isArray(resolution) || resolution.length !== 3 ||
        !resolution.every(n => Number.isSafeInteger(n) && n > 0 && n <= 256) ||
        !Number.isSafeInteger(brick) || brick < 2 || brick > 16 || !Number.isFinite(time) ||
        !Number.isSafeInteger(maxCells) || maxCells < 1 || resolution.reduce((a, b) => a * b) > maxCells)
      throw new RangeError('Invalid sparse density resolution, brick size or cell budget');
    const [nx, ny, nz] = resolution;
    const [bx, by] = resolution.map(n => Math.ceil(n / brick));
    const step = min.map((v, i) => (max[i] - v) / resolution[i]);
    const data = new Map(), allocated = new Set();
    const key = (x, y, z) => x + bx * (y + by * z);
    const index = (x, y, z) => x % brick + brick * (y % brick + brick * (z % brick));
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const value = field.sample(min[0] + (x + .5) * step[0], min[1] + (y + .5) * step[1], min[2] + (z + .5) * step[2], time);
      if (!value) continue;
      const id = key(Math.floor(x / brick), Math.floor(y / brick), Math.floor(z / brick));
      if (!data.has(id)) data.set(id, new Float32Array(brick ** 3));
      data.get(id)[index(x, y, z)] = value;
      // Mark neighboring bricks when there is a trilinear sample on the shared border.
      const x0 = Math.floor(Math.max(0, x - 1) / brick), x1 = Math.floor(Math.min(nx - 1, x + 1) / brick);
      const y0 = Math.floor(Math.max(0, y - 1) / brick), y1 = Math.floor(Math.min(ny - 1, y + 1) / brick);
      const z0 = Math.floor(Math.max(0, z - 1) / brick), z1 = Math.floor(Math.min(nz - 1, z + 1) / brick);
      for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++)
        allocated.add(key(i, j, k));
    }
    const value = (x, y, z) => data.get(key(Math.floor(x / brick), Math.floor(y / brick), Math.floor(z / brick)))?.[index(x, y, z)] || 0;
    function exit(axis, block, at, dir) {
      if (Math.abs(dir) < 1e-9) return Infinity;
      const lo = min[axis], unit = step[axis];
      const face = dir > 0 ? Math.min(max[axis],lo+(block+1)*unit*brick) : lo+block*unit*brick;
      return Math.max(0,(face-at)/dir);
    }
    const out = bounded({
      bounds: { min, max },
      sample(x, y, z) {
        const fx = clamp((x - min[0]) / step[0] - .5, 0, nx - 1);
        const fy = clamp((y - min[1]) / step[1] - .5, 0, ny - 1);
        const fz = clamp((z - min[2]) / step[2] - .5, 0, nz - 1);
        const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
        const ax = fx - ix, ay = fy - iy, az = fz - iz;
        let density = 0;
        for (let k = 0; k <= 1; k++) for (let j = 0; j <= 1; j++) for (let i = 0; i <= 1; i++) {
          const weight = (i ? ax : 1 - ax) * (j ? ay : 1 - ay) * (k ? az : 1 - az);
          if (weight) density += weight * value(ix + i, iy + j, iz + k);
        }
        return density;
      },
      skip(x, y, z, direction) {
        const ix = Math.floor(clamp(Math.floor((x-min[0])/step[0]),0,nx-1)/brick);
        const iy = Math.floor(clamp(Math.floor((y-min[1])/step[1]),0,ny-1)/brick);
        const iz = Math.floor(clamp(Math.floor((z-min[2])/step[2]),0,nz-1)/brick);
        if (allocated.has(key(ix,iy,iz))) return 0;
        const dist = Math.min(exit(0,ix,x,direction[0]),exit(1,iy,y,direction[1]),exit(2,iz,z,direction[2]));
        return Math.max(0, dist - 1e-7);
      }
    });
    return Object.freeze({ ...out, bricks: data.size, resolution: resolution.slice(), brick });
  }

  return Object.freeze({ bounds, bounded, fromSdf, sparse });
})();
if (typeof module !== 'undefined') module.exports = VolumeField;
