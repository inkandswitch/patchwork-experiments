/* Shared shaped emitters: deterministic sampling, projected transmission and native shadow queries. */
const AreaLights = (() => {
  let cookies, colorSpace;
  try {
    cookies = LightCookies;
  } catch {
    cookies = require('./light-cookies.js');
  }
  try {
    colorSpace = ColorSpace;
  } catch {
    colorSpace = require('./color-space.js');
  }
  const linear = colorSpace.prepare('srgb', 'srgb-linear');
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = [
    'id',
    'at',
    'normal',
    'up',
    'shape',
    'size',
    'color',
    'intensity',
    'radius',
    'sampleGrid',
    'twoSided',
    'visible',
    'reflection',
    'shadows',
    'shadowSteps',
    'bias',
    'cookie',
    'volumeIntensity'
  ];
  const vector = a => Array.isArray(a) && a.length === 3 && Array.from(a).every(Number.isFinite);
  const cross = ([x, y, z], [a, b, c]) => [y * c - z * b, z * a - x * c, x * b - y * a];
  const unit = (vector, label) => {
    const length = Math.hypot(...vector);
    if (!Number.isFinite(length) || length < 1e-8) throw new RangeError(label + ' needs a nonzero direction');
    return vector.map(n => n / length);
  };
  const between = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
  function disk(x, y) {
    if (!x && !y) return [0, 0];
    const wide = Math.abs(x) > Math.abs(y),
      radius = wide ? x : y;
    const angle = (Math.PI / 4) * (wide ? y / x : 2 - x / y);
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  }

  function prepare(value, { time = 0 } = {}) {
    if (!Number.isFinite(time)) throw new RangeError('Area light time must be finite');
    if (value === undefined || value === false) return [];
    if (!Array.isArray(value) || value.length > 16)
      throw new TypeError('Area lights need an array of up to 16 emitters');
    const ids = new Set();
    return Array.from(value, light => {
      if (!record(light) || Object.keys(light).some(key => !fields.includes(key)))
        throw new TypeError('Invalid area light fields');
      const atTime = v => (typeof v === 'function' ? v(time) : v);
      const {
        id,
        normal: rawFacing = [0, 0, 1],
        shape = 'rectangle',
        size,
        color: rawColor = '#fff2dd',
        intensity: rawIntensity = 2,
        radius = 6,
        sampleGrid = 4,
        shadowSteps,
        bias = 0.025,
        twoSided = shape === 'line',
        visible = true,
        reflection = true,
        shadows = true
      } = light;
      const at = atTime(light.at),
        facing = atTime(rawFacing),
        intensity = atTime(rawIntensity),
        color = atTime(rawColor),
        up = atTime(light.up),
        volumeIntensity = atTime(light.volumeIntensity ?? intensity);
      if (!between(volumeIntensity, 0, 64)) throw new RangeError('Invalid volume intensity');
      if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new TypeError('Area lights need unique IDs');
      ids.add(id);
      if (
        !vector(at) ||
        !vector(facing) ||
        (up !== undefined && !vector(up)) ||
        !Array.isArray(size) ||
        size.length !== 2 ||
        !Array.from(size).every(n => between(n, 0.001, 1000)) ||
        !['rectangle', 'disk', 'line'].includes(shape)
      )
        throw new RangeError('Area lights need a position, orientation and positive rectangle or disk size');
      if (
        !between(intensity, 0, 64) ||
        !between(radius, 0.001, 1000) ||
        !between(bias, 0.001, 0.25) ||
        !Number.isInteger(sampleGrid) ||
        !between(sampleGrid, 1, 8) ||
        (shadowSteps !== undefined && (!Number.isInteger(shadowSteps) || !between(shadowSteps, 2, 16))) ||
        [twoSided, visible, reflection, shadows].some(value => typeof value !== 'boolean') ||
        typeof color !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(color)
      )
        throw new RangeError('Invalid area light intensity, radius, sampling, shadow or color settings');
      if (shape === 'line' && size[0] < size[1])
        throw new RangeError('Line light length must be at least its diameter');
      const normal = unit(facing, 'Area light normal');
      const u = unit(cross(up ?? (Math.abs(normal[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]), normal), 'Area light up');
      const v = cross(normal, u),
        half = size.map(n => n * 0.5),
        points = [];
      for (let y = 0; y < (shape === 'line' ? 1 : sampleGrid); y++)
        for (let x = 0; x < sampleGrid; x++) {
          const a = (2 * (x + 0.5)) / sampleGrid - 1,
            b = (2 * (y + 0.5)) / sampleGrid - 1;
          const [s, t] = shape === 'disk' ? disk(a, b) : shape === 'line' ? [a, 0] : [a, b];
          points.push(
            at.map(
              (p, k) =>
                p + s * (shape === 'line' ? Math.max(0, half[0] - half[1]) : half[0]) * u[k] + t * half[1] * v[k]
            )
          );
        }
      const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
      return {
        id,
        at: at.slice(),
        normal,
        u,
        v,
        half,
        shape,
        rgb,
        linearRGB: linear(rgb),
        intensity,
        radius,
        points,
        twoSided,
        visible,
        reflection,
        shadows,
        shadowSteps,
        bias,
        volumeIntensity,
        cookie:
          light.cookie === undefined || light.cookie === false
            ? null
            : cookies.projection(light.cookie, normal, 45, time)
      };
    });
  }
  function transmission(light, point, out = [1, 1, 1]) {
    if (!light.cookie) {
      out.fill(1);
      return out;
    }
    const delta = light.at.map((n, k) => n - point[k]),
      length = Math.hypot(...delta);
    return light.cookie.sample(
      delta.map(n => n / (length || 1)),
      -dot(delta, light.normal) / (length || 1),
      out
    );
  }
  function evaluate(
    lights,
    point,
    normal,
    out = [0, 0, 0],
    { shadow, volume = false, direction = [0, 0, 1], anisotropy = 0 } = {}
  ) {
    out.fill(0);
    const transmissionRGB = [1, 1, 1];
    for (const light of lights) {
      const intensity = volume ? light.volumeIntensity : light.intensity;
      if (!intensity) continue;
      if (Math.hypot(...point.map((n, k) => n - light.at[k])) >= light.radius + Math.hypot(...light.half)) continue;
      transmission(light, point, transmissionRGB);
      if (!transmissionRGB.some(Boolean)) continue;
      const origin = point.map((n, k) => n + (volume ? 0 : normal[k] * light.bias));
      let total = 0,
        lit = 0;
      for (const sample of light.points) {
        const delta = sample.map((n, k) => n - point[k]),
          distance = Math.hypot(...delta);
        if (distance <= light.bias || distance >= light.radius) continue;
        const toLight = delta.map(n => n / distance),
          facing = -dot(toLight, light.normal),
          receive = volume ? 1 : Math.max(0, dot(normal, toLight));
        const phase =
          volume && anisotropy
            ? (1 - anisotropy ** 2) / Math.pow(1 + anisotropy ** 2 - 2 * anisotropy * dot(direction, toLight), 1.5)
            : 1;
        const amount =
          receive *
          (light.shape === 'line' ? 1 : Math.max(0, light.twoSided ? Math.abs(facing) : facing)) *
          (1 - distance / light.radius) ** 2 *
          phase;
        if (!amount) continue;
        total += amount;
        if (light.shadows && shadow) {
          const ray = sample.map((n, k) => n - origin[k]),
            stop = Math.hypot(...ray);
          if (
            shadow(
              origin,
              ray.map(n => n / stop),
              stop - light.bias,
              light
            )
          )
            continue;
        }
        lit += amount;
      }
      if (!total) continue;
      const steps = light.shadowSteps && light.shadowSteps - 1,
        visibility = steps ? Math.round((steps * lit) / total) / steps : lit / total,
        level = (total * visibility * intensity) / light.points.length;
      for (let k = 0; k < 3; k++) out[k] += (volume ? light.rgb[k] : light.linearRGB[k]) * level * transmissionRGB[k];
    }
    return out;
  }
  function staticSources(world, data = world.data, alpha) {
    const sources = [],
      boned = new Set(world.anim?.boned ?? []),
      backdrop = new Set(world.back ?? []),
      owned = world.anim?.geometryOwned;
    for (const source of world.renderSdfs ?? []) {
      if (!(source.rows instanceof Map) || !source.rows.size || !source.bounds || typeof source.distance !== 'function')
        continue;
      let current = true;
      for (const ranges of source.rows.values())
        for (const [start, end, points] of ranges) {
          if (end > world.count) current = false;
          for (let i = start; i < end && current; i++) {
            const q = i * 16,
              k = (i - start) * 3;
            current =
              !owned?.[i] &&
              data[q] === points[k] &&
              data[q + 1] === points[k + 1] &&
              data[q + 2] === points[k + 2] &&
              (alpha?.[i] ?? data[q + 3]) >= 1 &&
              !backdrop.has(i) &&
              !(Math.round(data[q + 11]) & (15 | 512 | 32768)) &&
              !boned.has(i) &&
              !world.anim?.rig?.bid?.[i];
          }
        }
      if (current) sources.push(source);
    }
    return sources;
  }
  function occludes(sources, origin, direction, stop) {
    for (const source of sources) {
      const { min, max } = source.bounds;
      let low = 0,
        high = stop,
        hit = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(direction[k]) < 1e-12) {
          if (origin[k] < min[k] || origin[k] > max[k]) hit = false;
        } else {
          const a = (min[k] - origin[k]) / direction[k],
            b = (max[k] - origin[k]) / direction[k];
          low = Math.max(low, Math.min(a, b));
          high = Math.min(high, Math.max(a, b));
        }
      }
      if (!hit || high <= low) continue;
      let depth = low;
      for (let i = 0; i < 96 && depth < high; i++) {
        const p = origin.map((n, k) => n + depth * direction[k]),
          d = source.distance(...p);
        if (!Number.isFinite(d)) break;
        if (d < 0.0015 && (!source.accepts || source.accepts(...p))) return true;
        depth += Math.max(0.004, d * 0.8);
      }
    }
    return false;
  }
  function shadowField(sources, { resolution = 48 } = {}) {
    if (!Number.isSafeInteger(resolution) || resolution < 8 || resolution > 128)
      throw new RangeError('Shadow field resolution must be 8..128');
    if (!sources.length) return null;
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const s of sources)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], s.bounds.min[k]);
        max[k] = Math.max(max[k], s.bounds.max[k]);
      }
    const step = Math.max(...max.map((n, k) => n - min[k])) / (resolution - 3);
    if (!(step > 0)) return null;
    for (let k = 0; k < 3; k++) {
      min[k] -= step;
      max[k] += step;
    }
    const size = max.map((n, k) => Math.max(3, Math.ceil((n - min[k]) / step - 1e-9) + 1)),
      data = new Float32Array(size[0] * size[1] * size[2]);
    for (let z = 0, i = 0; z < size[2]; z++)
      for (let y = 0; y < size[1]; y++)
        for (let x = 0; x < size[0]; x++, i++) {
          const p = [min[0] + x * step, min[1] + y * step, min[2] + z * step];
          let d = 1e3;
          for (const s of sources) {
            const q = s.distance(...p);
            if (Number.isFinite(q) && (!s.accepts || s.accepts(...p))) d = Math.min(d, q);
          }
          data[i] = d;
        }
    return { min, size, step, data };
  }
  return Object.freeze({ prepare, transmission, evaluate, staticSources, occludes, shadowField });
})();
if (typeof module !== 'undefined') module.exports = AreaLights;
