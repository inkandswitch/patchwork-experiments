/* One bounded density can be rendered, used as a placement mask or turned into a mesh. */
(function (K) {
  const P = K.procedural;
  const { bounded, fromSdf, sparse } = VolumeField;

  function level(value) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Density threshold must be positive');
    return value;
  }

  function toMesh(field, { iso = .5, time = 0, resolution = .12, ...options } = {}) {
    level(iso);
    const extent = VolumeField.bounds(field?.bounds);
    if (typeof field?.sample !== 'function' || !Number.isFinite(time) || !Number.isFinite(resolution) || resolution <= 0)
      throw new RangeError('Density meshing needs a field, time and positive pitch');
    const bounds = { min: extent.min.map(v => v - resolution), max: extent.max.map(v => v + resolution) };
    return K.sdf.toMesh((x, y, z) => iso - field.sample(x, y, z, time), { ...options, bounds, resolution });
  }

  function scatter(field, { minDensity = .15, time = 0, mask, radius = .18, ...options } = {}) {
    level(minDensity);
    if (typeof field?.sample !== 'function' || !Number.isFinite(time) || (mask !== undefined && typeof mask !== 'function'))
      throw new TypeError('Density scattering needs a field, time and optional mask function');
    const bounds = VolumeField.bounds(field.bounds);
    const accept = p => field.sample(...p, time) >= minDensity && (!mask || mask(p));
    const center = bounds.min.map((v, i) => (v + bounds.max[i]) * .5);
    return P.sampling.poisson({ reseed: 128, ...(accept(center) && { seeds: [center] }), ...options,
      bounds, radius, mask: accept });
  }

  P.density = Object.freeze({ bounded, fromSdf, fromPath: GeometryDensity.fromPath,
    fromTerrain: GeometryDensity.fromTerrain, sparse, toMesh, scatter });
})(KIT);
