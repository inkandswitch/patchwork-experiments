/* Shared optical coefficients for surface slabs and participating media. */
const OpticalMaterials = (() => {
  const STRIDE = 12;
  const packed = new WeakMap();
  const bounded = (value, min, max, name) => {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new RangeError(name + ' must be between ' + min + ' and ' + max);
    return value;
  };
  const record = (value, keys, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !keys.includes(key)))
      throw new TypeError('Invalid ' + name);
  };
  function color(value, name) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
      value = value.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
    if (!Array.isArray(value) || value.length !== 3)
      throw new TypeError(name + ' must be a hex color or an RGB triple');
    return Object.freeze(Array.from(value, channel => bounded(channel, 0, 1, name)));
  }
  function material(options = {}) {
    if (packed.has(options)) return options;
    record(options, ['absorption', 'reflection', 'scattering', 'scatteringColor', 'reflectionColor', 'depth', 'coverage'], 'optical material');
    const { absorption = 0, reflection = 0, scattering = 0, scatteringColor, reflectionColor = '#ffffff', depth = {} } = options;
    record(depth, ['thickness', 'scale'], 'optical depth');
    const result = Object.freeze({
      absorption: bounded(absorption, 0, 32, 'Absorption'),
      reflection: bounded(reflection, 0, 1, 'Reflection'),
      scattering: bounded(scattering, 0, 32, 'Scattering'),
      coverage: bounded(options.coverage ?? 0, 0, 1, 'Slab coverage'),
      ...(scatteringColor !== undefined && { scatteringColor: color(scatteringColor, 'Scattering color') }),
      reflectionColor: color(reflectionColor, 'Reflection color'),
      depth: Object.freeze({
        thickness: bounded(depth.thickness ?? 1, 0.0001, 1024, 'Optical thickness'),
        scale: bounded(depth.scale ?? 1, 0, 32, 'Optical depth scale')
      })
    });
    packed.set(result, Object.freeze([result.absorption, result.scattering, result.reflection, result.depth.thickness,
      ...(result.scatteringColor ?? [-1, -1, -1]), result.depth.scale, ...result.reflectionColor, result.coverage]));
    return result;
  }

  function fresnel(reflection, cosine) {
    return reflection ? reflection + (1 - reflection) * (1 - Math.min(1, Math.abs(cosine))) ** 5 : 0;
  }

  function medium(profile, fallback, backscatter = false, transform) {
    const p = material(profile);
    const bounce = backscatter ? p.reflection : 0;
    const extinction = p.absorption + p.scattering + bounce;
    const tint = p.scatteringColor ? transform?.(p.scatteringColor) ?? p.scatteringColor : fallback;
    const reflected = bounce ? transform?.(p.reflectionColor) ?? p.reflectionColor : p.reflectionColor;
    return { extinction: extinction * p.depth.scale, scatter: extinction ? p.scattering / extinction : 0,
      tint: tint.map((value, channel) => extinction ? (value * p.scattering + reflected[channel] * bounce) / extinction : 0) };
  }

  const pack = value => packed.get(material(value));

  function slabLoss(rows, j, cosine) {
    const extinction = rows[j] + rows[j + 1];
    return rows[j + 11] + (1 - rows[j + 11]) * -Math.expm1(-extinction * rows[j + 3] * rows[j + 7] / Math.max(0.15, Math.abs(cosine)));
  }
  function slabOpacity(rows, j, cosine) {
    const reflection = fresnel(rows[j + 2], cosine);
    return reflection + (1 - reflection) * slabLoss(rows, j, cosine);
  }
  function waterReflection(style, y, dy, t, surface) {
    return style.optical && Math.abs(dy) >= 1e-8 && Math.abs(y + t * dy - surface) <= 1e-6 ?
      fresnel(style.surface, dy) : 0;
  }

  // Bake a camera-dependent slab response per dab. The color gains are normalized
  // for the existing premultiplied compositors, which apply opacity afterwards.
  function frame(world, camera, sample, positions, out) {
    const input = world.opticalSplats;
    if (!input) return null;
    if (!out || out.length !== input.length) out = new Float32Array(input.length);
    else out.fill(0);
    const { view, eye, ortho } = camera;
    for (let j = 0; j < input.length; j += STRIDE) {
      if (!input[j + 3]) continue;
      const row = j / STRIDE, pose = sample(row), normal = pose.normal;
      let cosine = 1;
      if (normal) {
        if (ortho) cosine = Math.abs(normal[0] * view[2] + normal[1] * view[6] + normal[2] * view[10]);
        else {
          const p = positions ? [positions.x[row], positions.y[row], positions.z[row]] : pose.position();
          const x = eye[0] - p[0], y = eye[1] - p[1], z = eye[2] - p[2];
          cosine = Math.abs(normal[0] * x + normal[1] * y + normal[2] * z) / (Math.hypot(x, y, z) || 1);
        }
      }
      const reflection = fresnel(input[j + 2], cosine);
      const extinction = input[j] + input[j + 1];
      const loss = slabLoss(input, j, cosine);
      const opacity = reflection + (1 - reflection) * loss;
      const intrinsic = input[j + 11];
      const scattering = (1 - reflection) * (intrinsic + (extinction ? (loss - intrinsic) * input[j + 1] / extinction : 0));
      out[j] = opacity;
      out[j + 1] = opacity ? scattering / opacity : 0;
      out[j + 2] = opacity ? reflection / opacity : 0;
      out[j + 3] = 1;
      out.set(input.subarray(j + 4, j + 11), j + 4);
    }
    return out;
  }
  return Object.freeze({ STRIDE, material, medium, pack, frame, slabOpacity, waterReflection });
})();
if (typeof module !== 'undefined') module.exports = OpticalMaterials;
