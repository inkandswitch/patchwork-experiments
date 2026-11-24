/* Choose bake spacing by the departure of the surface from its tangent plane. */
const SculptSampling = (() => {
  function prepare(value) {
    if (value === undefined || value === false) return null;
    if (value === true) value = {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(key => !['coarse', 'fine', 'curvature', 'views', 'silhouetteBand'].includes(key)))
      throw new TypeError('Adaptive sampling needs a boolean or sampling settings');
    const { coarse = 1.8, fine = .7, curvature = .15, views = [], silhouetteBand = .22 } = value;
    const ranges = [[coarse, 1, 4, 'coarse'], [fine, .25, 1, 'fine'],
      [curvature, .02, .6, 'curvature'], [silhouetteBand, 0, .75, 'silhouetteBand']];
    for (const [n, low, high, key] of ranges)
      if (!Number.isFinite(n) || n < low || n > high)
        throw new RangeError('Adaptive sampling ' + key + ' must be between ' + low + ' and ' + high);
    if (!Array.isArray(views) || views.length > 16)
      throw new TypeError('Adaptive sampling views need up to 16 XYZ directions');
    const directions = Array.from(views, view => {
      if (!Array.isArray(view) || view.length !== 3 || !Array.from(view).every(Number.isFinite))
        throw new TypeError('Adaptive sampling view must be a finite XYZ direction');
      const length = Math.hypot(...view);
      if (!length || !Number.isFinite(length)) throw new RangeError('Adaptive sampling view must have a finite nonzero length');
      return view.map(n => n / length);
    });
    return { coarse, fine, curvature, directions, silhouetteBand };
  }

  function surface(material) {
    return (material.a === undefined || material.a >= 1) && !material.glass && !material.optical && !material.surface?.opacity &&
      !material.em && !material.fur && !material.leaf && !material.blade && !material.fiber &&
      (!material.top || surface(material.top));
  }

  function detail(settings, field, step, distance, x, y, z, nx, ny, nz) {
    const length = Math.hypot(nx, nz);
    const ux = length > 1e-5 ? -nz / length : 1, uz = length > 1e-5 ? nx / length : 0;
    const vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux;
    let bend = Math.max(
      Math.abs(field(x + ux * step, y, z + uz * step) - distance),
      Math.abs(field(x - ux * step, y, z - uz * step) - distance),
      Math.abs(field(x + vx * step, y + vy * step, z + vz * step) - distance),
      Math.abs(field(x - vx * step, y - vy * step, z - vz * step) - distance)
    ) / step;
    if (!Number.isFinite(bend)) return Infinity;
    // A flat plane stays coarse even when the camera sees it edge-on.
    if (bend > settings.curvature * .25 && settings.directions.some(([dx, dy, dz]) =>
      Math.abs(nx * dx + ny * dy + nz * dz) < settings.silhouetteBand)) bend *= 1.75;
    return bend / settings.curvature;
  }

  return Object.freeze({ prepare, surface, detail });
})();
if (typeof module !== 'undefined') module.exports = SculptSampling;
