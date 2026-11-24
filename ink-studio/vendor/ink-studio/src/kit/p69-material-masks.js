/* Object-anchored projections, filtered thresholds and distance ink. */
(function (K) {
  const P = K.procedural, V = K.V,
    EPS = 1e-8,
    unitY = [0,1,0], unitX = [1,0,0], unitZ = [0,0,1],
    vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
    positive = n => Number.isFinite(n) && n > EPS,
    pair = p => Array.isArray(p) && p.length === 2 && p.every(positive),
    clamp = n => Math.max(0, Math.min(1, n));
  function smooth(low, high, value) {
    if (high <= low) return Number(value >= low);
    const u = clamp((value - low) / (high - low));
    return u * u * (3 - 2 * u);
  }
  function basis(frame) {
    const n = vector(frame?.normal) && V.len(frame.normal) > EPS ? V.norm(frame.normal) : unitY,
      raw = vector(frame?.tangent) ? frame.tangent : Math.abs(n[0]) < 0.8 ? unitX : unitZ,
      t = V.mad(raw, n, -V.dot(raw, n)),
      direction = V.len(t) > EPS ? V.norm(t) : V.norm(V.cross(Math.abs(n[0]) < 0.8 ? unitX : unitZ, n));
    return { n, t: direction, b: V.cross(n, direction) };
  }
  const width = frame => Number.isFinite(frame?.footprint) && frame.footprint > 0 ? frame.footprint : 0;

  function triplanar(sample, { scale = 1, origin = [0,0,0], sharpness = 4 } = {}) {
    const sizes = typeof scale === 'number' ? [scale,scale,scale] : scale,
      samplers = typeof sample === 'function' ? [sample,sample,sample] : sample;
    if (!vector(sizes) || !sizes.every(positive) || !vector(origin) ||
      !Array.isArray(samplers) || samplers.length !== 3 || !samplers.every(fn => typeof fn === 'function') ||
      !Number.isFinite(sharpness) || sharpness < 0.25 || sharpness > 32)
      throw new Error('Triplanar mapping needs planar samplers, positive scales and valid weights');
    const pos = origin.slice(), stretch = sizes.slice(), inputs = samplers.slice(),
      planes = [[2,1],[0,2],[0,1]];
    return function (x, y, z, frame) {
      const n = vector(frame?.normal) && V.len(frame.normal) > EPS ? V.norm(frame.normal) : unitY,
        p = [x,y,z].map((v, i) => (v - pos[i]) / stretch[i]),
        strengths = n.map(v => Math.abs(v) ** sharpness),
        sum = strengths.reduce((a,b) => a + b, 0), footprint = width(frame);
      let scalar = 0, type, rgb;
      for (const [axis, [u,v]] of planes.entries()) {
        const weight = strengths[axis] / sum;
        if (!weight) continue;
        const value = inputs[axis](p[u],p[v],{ axis, sign: Math.sign(n[axis]), footprint: [footprint / stretch[u], footprint / stretch[v]] }),
          kind = Number.isFinite(value) ? 'scalar' : vector(value) ? 'rgb' : null;
        if (!kind || (type && type !== kind)) throw new Error('Triplanar samples must all share a scalar or RGB format');
        type = kind;
        if (type === 'scalar') scalar += value * weight;
        else {
          rgb ??= [0,0,0];
          for (let i = 0; i < 3; i++) rgb[i] += value[i] * weight;
        }
      }
      return rgb ?? scalar;
    };
  }

  function tangent(sample, { scale = [1,1], origin = [0,0,0], angle = 0, coordinates } = {}) {
    if (typeof sample !== 'function' || !vector(origin) || !pair(scale) || !Number.isFinite(angle) ||
      (coordinates !== undefined && typeof coordinates !== 'function'))
      throw new Error('Tangent mapping needs a planar sampler, world origin and two scales');
    const pos = origin.slice(), sizes = scale.slice(), c = Math.cos(angle), s = Math.sin(angle);
    return function (x, y, z, frame) {
      const { t, b } = basis(frame), p = V.sub([x,y,z], pos),
        uv = coordinates ? coordinates(x,y,z,frame) : [V.dot(p,t),V.dot(p,b)];
      if (!Array.isArray(uv) || uv.length !== 2 || !uv.every(Number.isFinite))
        throw new Error('Tangent coordinates must be two finite numbers');
      const f = width(frame);
      return sample((uv[0] * c + uv[1] * s) / sizes[0], (-uv[0] * s + uv[1] * c) / sizes[1],
        { footprint: sizes.map(v => f / v) });
    };
  }

  function threshold(field, { level = 0.5, feather = 0, samples = 5, seed = 0, invert = false } = {}) {
    if (typeof field !== 'function' || !Number.isFinite(level) || !Number.isFinite(feather) || feather < 0 ||
      !Number.isSafeInteger(samples) || samples < 1 || samples > 11 ||
      !Number.isSafeInteger(seed) || typeof invert !== 'boolean')
      throw new Error('Threshold masks need a field, finite level and bounded sample count');
    const dice = K.grow.dice(P.data.hash('threshold-footprint', seed)), strata = [],
      lo = level - feather * 0.5, hi = level + feather * 0.5;
    for (let v = 0; v < samples; v++) for (let u = 0; u < samples; u++) {
      strata.push([(u + 0.27 + 0.46 * dice()) / samples - 0.5, (v + 0.27 + 0.46 * dice()) / samples - 0.5]);
    }
    function evaluate(x, y, z, frame) {
      const value = field(x,y,z,frame);
      if (!Number.isFinite(value)) throw new Error('Threshold masks must sample a finite scalar field');
      return smooth(lo,hi,value);
    }
    return function (x, y, z, frame) {
      const f = width(frame);
      let cover = 0;
      if (!f || samples === 1) cover = evaluate(x,y,z,frame);
      else {
        const { t, b } = basis(frame), subframe = { ...frame, footprint: f / samples };
        for (const [u, v] of strata) cover += evaluate(
          x + f * (t[0] * u + b[0] * v), y + f * (t[1] * u + b[1] * v), z + f * (t[2] * u + b[2] * v), subframe);
        cover /= strata.length;
      }
      return invert ? 1 - cover : cover;
    };
  }

  function outline(mask, {
    size, spacing = 1, outer = 1, inner = 0, feather = 0, maxCells
  } = {}) {
    if (![outer,inner,feather].every(v => Number.isFinite(v) && v >= 0))
      throw new Error('Distance outlines need nonnegative widths');
    const result = P.geometry.distanceTransform(mask, { size, spacing, signed: true, indices: false, maxCells }),
      outside = new Float32Array(result.distance.length), inside = new Float32Array(outside.length);
    for (const [i, signed] of result.distance.entries()) {
      const d = Math.abs(signed), edge = signed > 0 ? outer : inner,
        value = edge ? feather ? 1 - smooth(edge - feather * 0.5, edge + feather * 0.5, d) : Number(d <= edge) : 0;
      if (signed > 0) outside[i] = value;
      else inside[i] = value;
    }
    return Object.freeze({ size: result.size, distance: result.distance, outside, inside });
  }

  P.materials = { triplanar, tangent, threshold, outline };
})(KIT);
