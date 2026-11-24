/* A planar level masked into an existing height carrier. The bed and inside
   bank are one continuous cut; the retained source is never raised or mutated.
   Water is a consumer, not a requirement of the operation. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    clamp = x => Math.max(0, Math.min(1, x)),
    smooth = x => {
      x = clamp(x);
      return x * x * (3 - 2 * x);
    };
  function parameters(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Basins need configuration');
    const p = Object.assign({ level: -0.18, depth: 0.55, shore: 0.45 }, A.data.clone(raw));
    if (
      !['level', 'depth', 'shore'].every(k => Number.isFinite(p[k])) ||
      Math.abs(p.level) > 24 ||
      p.depth < 0.05 ||
      p.depth > 12 ||
      p.shore < 0.08 ||
      p.shore > 8
    )
      throw new Error('Basins need a finite level, depth .05..12 and shore .08..8');
    return A.data.freeze(p);
  }
  function surface(base, mask, raw) {
    const p = parameters(raw);
    if (
      !base ||
      typeof base.height !== 'function' ||
      typeof base.normal !== 'function' ||
      typeof base.inside !== 'function' ||
      ![base.bounds?.min, base.bounds?.max].every(
        v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
      ) ||
      base.bounds.min.some((v, i) => v > base.bounds.max[i]) ||
      (base.slopeBound !== undefined && (!Number.isFinite(base.slopeBound) || base.slopeBound < 0)) ||
      typeof mask !== 'function'
    )
      throw new Error('Basins need a bounded height carrier and signed mask distance');
    function sample(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Basin queries need finite XZ coordinates');
      const d = mask(x, z),
        h = base.height(x, z);
      if ((!Number.isFinite(d) && d !== Infinity) || !Number.isFinite(h))
        throw new Error('Basin masks and heights must be finite (an empty mask may return Infinity)');
      const weight = smooth(-d / p.shore),
        height = h - weight * Math.max(0, h - p.level + p.depth);
      return { height, raw: h, distance: d, wet: d < 0 && height < p.level - 1e-6, affected: height < h - 1e-8 };
    }
    const height = (x, z) => sample(x, z).height,
      normal = (x, z) => {
        const e = 0.002;
        return V.norm([height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)]);
      },
      bound =
        (base.slopeBound || 0) +
        (1.5 * (Math.max(Math.abs(base.bounds.min[1] - p.level), Math.abs(base.bounds.max[1] - p.level)) + p.depth)) /
          p.shore;
    return {
      base,
      parameters: p,
      height,
      normal,
      sample,
      inside: base.inside,
      slopeBound: bound,
      distanceScale: () => 1 / Math.sqrt(1 + bound * bound),
      minimumDistanceScale: 1 / Math.sqrt(1 + bound * bound),
      bounds: {
        min: [base.bounds.min[0], Math.min(base.bounds.min[1], p.level - p.depth), base.bounds.min[2]],
        max: base.bounds.max.slice()
      }
    };
  }
  A.basins = { parameters, surface };
})(KIT);
