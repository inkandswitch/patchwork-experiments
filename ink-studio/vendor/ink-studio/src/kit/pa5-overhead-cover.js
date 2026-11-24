/* Rasterize opaque geometry into a vertical exposure field for precipitation,
   ground effects or any other downward projection. Heights are sampled at cell centers. */
(function (K) {
  const P = K.procedural || K.authoring;
  const empty = -3.4028234663852886e38;
  const between = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const vector = (value, size) => (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    value.length === size && Array.from(value).every(Number.isFinite);
  const clamp = n => Math.max(0, Math.min(1, n));

  function rasterize({ meshes = [], surfaces = [] } = {},
    { spacing = .12, maxSize = 192, clearance = .12, softness = .08 } = {}) {
    if (!Array.isArray(meshes) || !Array.isArray(surfaces) || !Number.isFinite(spacing) || spacing <= 0 ||
        !Number.isInteger(maxSize) || maxSize < 2 || maxSize > 1024 ||
        !Number.isFinite(clearance) || clearance < 0 || !Number.isFinite(softness) || softness <= 0)
      throw Error('Overhead cover needs meshes and a bounded raster configuration');
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const mesh of meshes) {
      const { positions, triangles } = mesh || {};
      const indexed = triangles !== undefined;
      if (!(Array.isArray(positions) || ArrayBuffer.isView(positions)) || positions.length % (indexed ? 3 : 9) !== 0)
        throw Error('Overhead cover needs XYZ triangles');
      if (indexed && (!(Array.isArray(triangles) || ArrayBuffer.isView(triangles)) ||
          triangles.length % 3 !== 0 || !Array.from(triangles).every(i => Number.isInteger(i) && i >= 0 && i < positions.length / 3)))
        throw Error('Overhead cover has invalid triangle indices');
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (!between(x, empty / 2, -empty / 2) ||
            !between(y, empty / 2, -empty / 2) || !between(z, empty / 2, -empty / 2))
          throw Error('Overhead cover vertices must be finite float coordinates');
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }
    for (const surface of surfaces) {
      const { min, max, heightAt } = surface || {};
      if (!vector(min, 2) || !vector(max, 2) || min[0] >= max[0] || min[1] >= max[1] ||
          typeof heightAt !== 'function' || ![...min, ...max].every(v => between(v, empty / 2, -empty / 2)))
        throw Error('Overhead cover needs finite XZ bounds and a height function');
      minX = Math.min(minX, min[0]); maxX = Math.max(maxX, max[0]);
      minZ = Math.min(minZ, min[1]); maxZ = Math.max(maxZ, max[1]);
    }
    if (minX === Infinity || minX === maxX || minZ === maxZ) return null;
    const step = Math.max(spacing, (maxX - minX) / maxSize, (maxZ - minZ) / maxSize);
    const width = Math.min(maxSize, Math.ceil((maxX - minX) / step));
    const height = Math.min(maxSize, Math.ceil((maxZ - minZ) / step));
    const samples = new Float32Array(width * height).fill(empty);
    for (const { positions, triangles } of meshes) {
      const count = triangles ? triangles.length : positions.length / 3;
      for (let i = 0; i < count; i += 3) {
        const a = (triangles ? triangles[i] : i) * 3;
        const b = (triangles ? triangles[i + 1] : i + 1) * 3;
        const c = (triangles ? triangles[i + 2] : i + 2) * 3;
        const ax = (positions[a] - minX) / step - .5, az = (positions[a + 2] - minZ) / step - .5;
        const bx = (positions[b] - minX) / step - .5, bz = (positions[b + 2] - minZ) / step - .5;
        const cx = (positions[c] - minX) / step - .5, cz = (positions[c + 2] - minZ) / step - .5;
        const ex = bx - ax, ez = bz - az, fx = cx - ax, fz = cz - az, area = ex * fz - ez * fx;
        if (Math.abs(area) < 1e-10) continue;
        const firstX = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-8));
        const lastX = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx) + 1e-8));
        const firstZ = Math.max(0, Math.ceil(Math.min(az, bz, cz) - 1e-8));
        const lastZ = Math.min(height - 1, Math.floor(Math.max(az, bz, cz) + 1e-8));
        const ay = positions[a + 1], dy = positions[b + 1] - ay, ey = positions[c + 1] - ay;
        for (let z = firstZ; z <= lastZ; z++) for (let x = firstX; x <= lastX; x++) {
          const u = ((x - ax) * fz - (z - az) * fx) / area;
          const v = (ex * (z - az) - ez * (x - ax)) / area;
          if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
          const cell = z * width + x;
          samples[cell] = Math.max(samples[cell], ay + u * dy + v * ey);
        }
      }
    }
    for (const { min, max, heightAt } of surfaces) {
      const firstX = Math.max(0, Math.ceil((min[0] - minX) / step - .5));
      const firstZ = Math.max(0, Math.ceil((min[1] - minZ) / step - .5));
      const lastX = Math.min(width - 1, Math.floor((max[0] - minX) / step - .5));
      const lastZ = Math.min(height - 1, Math.floor((max[1] - minZ) / step - .5));
      for (let z = firstZ; z <= lastZ; z++) for (let x = firstX; x <= lastX; x++) {
        const y = heightAt(minX + (x + .5) * step, minZ + (z + .5) * step);
        if (y === null || y === undefined) continue;
        if (!between(y, empty / 2, -empty / 2)) throw Error('Overhead heights must be finite float coordinates');
        const cell = z * width + x;
        samples[cell] = Math.max(samples[cell], y);
      }
    }
    return Object.freeze({ origin: Object.freeze([minX, minZ]), step, width, height, samples, clearance, softness });
  }

  function exposure(field, point, normal = [0, 1, 0]) {
    if (!vector(point, 3) || !vector(normal, 3)) throw Error('Overhead exposure needs finite point and normal vectors');
    if (!field) return 1;
    const { origin, step, width, height, samples, clearance, softness } = field;
    const ix = (point[0] - origin[0]) / step - .5, iz = (point[2] - origin[1]) / step - .5;
    const x = Math.floor(ix), z = Math.floor(iz), fx = ix - x, fz = iz - z;
    const lift = normal[1] > .25 * Math.hypot(...normal) ? -step / normal[1] : 0;
    function occlusion(col, row) {
      if (col < 0 || col >= width || row < 0 || row >= height) return 0;
      const y = point[1] + lift * (normal[0] * (col - ix) + normal[2] * (row - iz));
      const t = clamp((samples[row * width + col] - y - clearance) / softness);
      return t * t * (3 - 2 * t);
    }
    return 1 - ((occlusion(x, z) * (1 - fx) + occlusion(x + 1, z) * fx) * (1 - fz) +
      (occlusion(x, z + 1) * (1 - fx) + occlusion(x + 1, z + 1) * fx) * fz);
  }

  const glsl = `
float overheadOcclusion(sampler2D heights, ivec2 cell, ivec2 size, float y, vec2 ramp) {
  if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, size))) return 0.0;
  return smoothstep(0.0, ramp.y, texelFetch(heights, cell, 0).r - y - ramp.x);
}
float overheadExposure(sampler2D heights, vec3 p, vec3 n, vec3 grid, vec2 ramp) {
  vec2 index = (p.xz - grid.xy) / grid.z - .5;
  ivec2 size = textureSize(heights, 0);
  if (any(lessThan(index, vec2(-1.0))) || any(greaterThanEqual(index, vec2(size)))) return 1.0;
  ivec2 cell = ivec2(floor(index));
  vec2 f = fract(index), slope = n.y > .25 ? -grid.z * n.xz / n.y : vec2(0.0);
  float y = p.y - dot(slope, f);
  float a = overheadOcclusion(heights, cell, size, y, ramp);
  float b = overheadOcclusion(heights, cell + ivec2(1,0), size, y + slope.x, ramp);
  float c = overheadOcclusion(heights, cell + ivec2(0,1), size, y + slope.y, ramp);
  float d = overheadOcclusion(heights, cell + ivec2(1,1), size, y + slope.x + slope.y, ramp);
  return 1.0 - mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

  P.overheadCover = Object.freeze({ rasterize, exposure, glsl });
})(KIT);
