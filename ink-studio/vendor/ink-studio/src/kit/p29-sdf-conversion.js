/* Convert a bounded signed distance function using the same mesh and sculpt paths as imported geometry. */
(function (K) {
  function inputs(field, options) {
    const sd = typeof field === 'function' ? field : field?.sd;
    if (typeof sd !== 'function') throw new TypeError('Expected a signed distance function or a field with sd');
    const evaluate = typeof field === 'function' ? sd : sd.bind(field);
    const bounds = options.bounds ?? (field.lo && field.hi ? { min: field.lo, max: field.hi } : null);
    const resolution = options.resolution ?? field.h ?? 0.12;
    return { sd: evaluate, bounds, resolution };
  }

  function polygonize({ sd, bounds, resolution }, { maxCells = 30000, color = [0.7, 0.7, 0.7] }) {
    const geometry = K.procedural.geometry;
    const surface = geometry.implicitSurface(p => sd(...p), bounds, { resolution, maxCells });
    if (!surface.positions.length) throw new RangeError('No zero surface found within the supplied bounds');
    return geometry.toKitMesh(surface, () => color);
  }

  function sculpt(S, mesh, sd, material, options) {
    return K.mesh.solid(S, mesh, material, { ...options, field: { sd, thick: 0, open: false } });
  }

  K.sdf.toMesh = (field, options = {}) => polygonize(inputs(field, options), options);
  K.sdf.solid = (S, field, material, options = {}) => {
    const input = inputs(field, options);
    return sculpt(S, polygonize(input, options), input.sd, material, options);
  };
  K.sdf.toSplats = (field, options = {}) => {
    const input = inputs(field, options);
    const mesh = polygonize(input, options);
    const look = K.mesh.look(mesh, { pal: options.palette, bg: options.background });
    const B = makeBuilder(options.seed ?? 1, look.pal);
    const S = makeSculpt(B);
    const { lo, hi } = K.mesh.box(mesh);
    const target = lo.map((v, i) => (v + hi[i]) / 2);
    const radius = Math.hypot(...hi.map((v, i) => (v - lo[i]) / 2));
    const res = options.res ?? input.resolution;
    sculpt(S, mesh, input.sd, options.material ?? { r: look.ramps[0] }, { ...options, res });
    S.bake();
    return B.finish({
      cam: { target, dist: Math.max(1, radius * 3.65), yaw: 0.42, pitch: 0.28, ...options.cam },
      radius: Math.max(radius, 1),
      detail: 1 / res
    });
  };
})(KIT);
