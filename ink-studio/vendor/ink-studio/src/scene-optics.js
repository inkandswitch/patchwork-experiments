/* Core scene optics descriptors and samplers shared by browser hosts and the CLI. */
const SceneOptics = (() => {
  const reflection = typeof ReflectionPlane === 'undefined' ? require('./reflection-plane.js') : ReflectionPlane;
  const { planeDistance, reflectedView, captureView } = reflection;
  const ripples = typeof RippleField === 'undefined' ? require('./ripple-field.js') : RippleField;
  const { field: ripple, ringSampler } = ripples;
  const densities = typeof VolumeField === 'undefined' ? require('./volume-field.js') : VolumeField;
  const geometry = typeof GeometryDensity === 'undefined' ? require('./geometry-density.js') : GeometryDensity;
  let volumeLight;
  try{volumeLight=VolumeLight;}catch{volumeLight=require('./volume-light.js');}
  const palettes = typeof AtmospherePalette === 'undefined' ? require('./atmosphere-palette.js') : AtmospherePalette;
  const fieldBands = typeof FieldBands === 'undefined' ? require('./field-bands.js') : FieldBands;
  const opticalMaterials = typeof OpticalMaterials === 'undefined' ? require('./optical-materials.js') : OpticalMaterials;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const length = v => Math.hypot(...v);
  const point = (value, name) => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
      throw new TypeError(name + ' must be a finite XYZ vector');
    return value.slice();
  };
  function unit(value, name) {
    const v = point(value, name),
      size = length(v);
    if (!(size > 1e-9)) throw new RangeError(name + ' must be nonzero');
    return v.map(n => n / size);
  }
  const positive = (n, name) => {
    if (!(Number.isFinite(n) && n > 0)) throw new RangeError(name + ' must be positive');
    return n;
  };
  const nonnegative = (n, name) => {
    if (!(Number.isFinite(n) && n >= 0)) throw new RangeError(name + ' must be nonnegative');
    return n;
  };

  function plane({ id, at = [0, 0, 0], normal = [0, 1, 0], bias = 0.001, select, tags } = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('A reflection plane needs an ID');
    if (select !== undefined && typeof select !== 'function')
      throw new TypeError('Reflection selection must be a function');
    return {
      id,
      at: point(at, 'Reflection origin'),
      normal: unit(normal, 'Reflection normal'),
      bias: nonnegative(bias, 'Reflection bias'),
      select,
      ...(tags !== undefined && { tags })
    };
  }

  function volumeColor(value, palette) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) value = parseInt(value.slice(1), 16);
    else if (Number.isInteger(value)) value = palette[value];
    else if (Array.isArray(value)) return point(value, 'Volume colour').map(n => Math.max(0, Math.min(1, n)));
    if (!Number.isInteger(value))
      throw new TypeError('Volume colour must be a palette index, hex colour or RGB triple');
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  const common = ({ density = 0.2, color = '#99b1c4', near = 0, far, id, tags, mediumKind, optical,lit,step=.2,anisotropy=0,paletteField } = {}) => {
    if((lit!==undefined||paletteField)&&(lit!==undefined&&typeof lit!=='boolean'||!Number.isFinite(step)||step<=0||!Number.isFinite(anisotropy)||Math.abs(anisotropy)>=1))throw new RangeError('Invalid lit volume settings');
    nonnegative(near, 'Volume near distance');
    if (far !== undefined && (!Number.isFinite(far) || far <= near))
      throw new RangeError('Volume far distance must exceed near');
    return { density: nonnegative(density, 'Volume density'), color, near, far, ...(id !== undefined && { id }),
      ...(tags !== undefined && { tags }), ...(mediumKind !== undefined && { mediumKind }),
      ...(optical !== undefined && { optical: opticalMaterials.material(optical) }),...(lit!==undefined&&{lit,step,anisotropy}),
      ...(paletteField !== undefined && { paletteField, step }) };
  };
  function fog(options = {}) {
    const { bottom, top, depthBand } = options;
    if (
      (bottom !== undefined && !Number.isFinite(bottom)) ||
      (top !== undefined && !Number.isFinite(top)) ||
      (bottom !== undefined && top !== undefined && bottom >= top)
    )
      throw new RangeError('Invalid height-fog range');
    if (depthBand !== undefined && (!depthBand || !Array.isArray(depthBand.axis) || depthBand.axis.length !== 3 ||
      !depthBand.axis.every(Number.isFinite) || !Number.isFinite(depthBand.low) || !Number.isFinite(depthBand.high) ||
      depthBand.high <= depthBand.low || !Number.isFinite(depthBand.step) || depthBand.step <= 0 ||
      depthBand.sample !== undefined && typeof depthBand.sample !== 'function'))
      throw new TypeError('Invalid bound atmosphere depth band');
    return { type: 'fog', ...common(options), bottom, top, ...(depthBand && {depthBand}) };
  }
  function sphere(options) {
    return {
      type: 'sphere',
      ...common(options),
      at: point(options.at, 'Mist centre'),
      radius: positive(options.radius, 'Mist radius')
    };
  }
  function box(options) {
    const min = point(options.min, 'Volume minimum'),
      max = point(options.max, 'Volume maximum');
    if (min.some((n, i) => n >= max[i])) throw new RangeError('Volume bounds must have positive extent');
    return { type: 'box', ...common(options), min, max };
  }
  function shaft(options) {
    const from = point(options.from, 'Shaft start'),
      to = point(options.to, 'Shaft end');
    unit(sub(to, from), 'Shaft direction');
    return { type: 'shaft', ...common(options), from, to, radius: positive(options.radius, 'Shaft radius') };
  }

  function field(options = {}) {
    const { field, step = .16, lit = true, anisotropy = .15, ramp, bands, emissive = '#000000', emissiveGain = 0 } = options;
    if (typeof field?.sample !== 'function') throw new TypeError('Expected a bounded density field');
    const { min, max } = densities.bounds(field.bounds);
    if (!Number.isFinite(step) || step <= 0 || step > 100 || typeof lit !== 'boolean' ||
        !Number.isFinite(anisotropy) || Math.abs(anisotropy) > .85 ||
        !Number.isFinite(emissiveGain) || emissiveGain < 0 || emissiveGain > 64 ||
        (ramp !== undefined && (bands !== undefined || !Array.isArray(ramp) || !ramp.length || ramp.length > 32)))
      throw new RangeError('Invalid density march or optical settings');
    return { type: 'field', ...common(options), field, min, max, step, lit, anisotropy, ramp, emissive, emissiveGain,
      ...(bands !== undefined && { bands: fieldBands.settings(bands) }) };
  }

  function shaped(options) {
    const { source, ...optics } = options ?? {};
    return field({ ...optics, field:geometry.resolve(source) });
  }
  function shapedVolumes(authored, override) {
    const source=override===true ? authored : override??authored;
    if (source===false || source===undefined) return [];
    if (!Array.isArray(source)) throw new TypeError('Shaped atmosphere must be a list of volumes');
    return source.map(v=>v?.type==='field' ? field(v) : shaped(v));
  }

  const volumeKinds = { fog, sphere, box, shaft, field };
  function prepareVolumes(list, palette = [], colorFor, densityGain, time = 0) {
    if (!Array.isArray(list)) throw new TypeError('Atmosphere must be a list of volumes');
    return list
      .map(d => {
        if (!d || !Object.hasOwn(volumeKinds, d.type)) throw new TypeError('Unknown atmosphere volume');
        const volume = volumeKinds[d.type](d);
        if (densityGain) {
          const gain = densityGain(volume);
          if (gain && typeof gain.sample === 'function' && Number.isFinite(gain.step) && gain.step > 0)
            volume.densityField = gain;
          else volume.density = nonnegative(volume.density * gain, 'Volume density');
        }
        const transform = colorFor?.(volume);
        const color = value => {
          const rgb = volumeColor(value, palette);
          return transform ? transform(rgb) : rgb;
        };
        volume.rgb = color(volume.color);
        if (volume.type === 'field') {
          volume.ramp = volume.ramp?.map(color);
          volume.emissiveRgb = color(volume.emissive);
        }
        if (volume.optical) {
          const response = opticalMaterials.medium(volume.optical, volume.rgb, true, transform);
          volume.density = nonnegative(volume.density * response.extinction, 'Optical volume extinction');
          volume.rgb = response.tint;
          // An authored field ramp supplies the scattering color at each height.
          volume.ramp = volume.ramp?.map(rgb => opticalMaterials.medium(volume.optical, rgb, true, transform).tint);
        }
        const field = palettes.compile(volume.paletteField, palettes.volumeDomains, color);
        if (field?.strength) volume.paletteField = field.frame?.(time) ?? field;
        else delete volume.paletteField;
        if (volume.bands) volume.bands = fieldBands.bind(volume.bands, swatch => {
          const rgb = color(swatch);
          return volume.optical ? opticalMaterials.medium(volume.optical, rgb, true, transform).tint : rgb;
        });
        if (volume.type === 'shaft') {
          const span = sub(volume.to, volume.from);
          volume.height = length(span);
          volume.axis = span.map(n => n / volume.height);
        }
        return volume;
      })
      .filter(d => d.density > 0);
  }

  // Intersect one slab of a ray with a [min,max] interval along an axis.
  function slab(range, position, direction, low, high) {
    if (Math.abs(direction) < 1e-10) return position > low && position < high;
    const a = (low - position) / direction,
      b = (high - position) / direction;
    range[0] = Math.max(range[0], Math.min(a, b));
    range[1] = Math.min(range[1], Math.max(a, b));
    return range[1] > range[0];
  }
  function radial(range, a, b, c) {
    if (a < 1e-10) return c < 0;
    const d = b * b - a * c;
    if (d <= 0) return false;
    const width = Math.sqrt(d);
    range[0] = Math.max(range[0], (-b - width) / a);
    range[1] = Math.min(range[1], (-b + width) / a);
    return range[1] > range[0];
  }

  function interval(volume, from, dir, stop, start) {
    const range = [Math.max(start, volume.near), Math.min(stop, volume.far ?? stop)];
    if (range[1] <= range[0]) return null;
    const band=volume.depthBand;
    if (band && !slab(range,dot(from,band.axis),dot(dir,band.axis),band.low,band.high)) return null;
    switch (volume.type) {
      case 'fog':
        return slab(range, from[1], dir[1], volume.bottom ?? -Infinity, volume.top ?? Infinity) ? range : null;
      case 'box':
      case 'field':
        return [0, 1, 2].every(i => slab(range, from[i], dir[i], volume.min[i], volume.max[i])) ? range : null;
      case 'sphere': {
        const delta = sub(from, volume.at);
        return radial(range, 1, dot(delta, dir), dot(delta, delta) - volume.radius ** 2) ? range : null;
      }
      case 'shaft': {
        const delta = sub(from, volume.from);
        const p = dot(delta, volume.axis),
          d = dot(dir, volume.axis);
        if (!slab(range, p, d, 0, volume.height)) return null;
        return radial(range, 1 - d * d, dot(delta, dir) - p * d, dot(delta, delta) - p * p - volume.radius ** 2)
          ? range
          : null;
      }
    }
  }

  // A fragment changes the end of the view ray, never its intersection with a volume.
  function rayBounds(volumes, origin, direction, horizon, counters) {
    const ranges = [];
    let near = Infinity, far = -Infinity;
    if (counters) counters.boundsTests += volumes.length;
    for (const volume of volumes) {
      const range = interval(volume,origin,direction,horizon,0);
      if (!range) continue;
      ranges.push([range[0],range[1],volume]);
      near = Math.min(near,range[0]);
      far = Math.max(far,range[1]);
    }
    return { ranges, near, far };
  }

  // Integrate overlapping constant-density media in front-to-back depth order.
  function trace(volumes, origin, direction, stop, result = [0, 0, 0, 1], options) {
    const scale = options?.fogScale ?? 1, counters = options?.counters;
    if (counters) counters.traces++;
    if (scale === 0) {
      result[0] = result[1] = result[2] = 0;
      result[3] = 1;
      return result;
    }
    const hits = [], start = options?.start ?? 0, bounds = options?.rayBounds;
    if (bounds) {
      if (counters) counters.boundsCacheHits++;
      for (const [near,far,volume] of bounds.ranges) {
        const from = Math.max(start,near), to = Math.min(stop,far);
        if (to > from) hits.push([from,volume,1],[to,volume,-1]);
      }
    } else {
      if (counters) counters.boundsTests += volumes.length;
      for (const volume of volumes) {
        const range = interval(volume,origin,direction,stop,start);
        if (range) hits.push([range[0],volume,1],[range[1],volume,-1]);
      }
    }
    if (!hits.length) {
      result[0] = result[1] = result[2] = 0;
      result[3] = 1;
      return result;
    }
    hits.sort((a, b) => a[0] - b[0]);
    if (options?.cloudShadow || options?.flash || options?.exposure?.fog || options?.cutouts?.fog || hits.some(([, volume]) =>
      volume.type === 'field' || volume.densityField || volume.depthBand?.sample || volume.paletteField ||
      (volume.lit && options?.media?.paletteLocals)))
      return volumeLight.integrate(hits, origin, direction, stop, result, options);
    result[0] = result[1] = result[2] = 0;
    result[3] = 1;
    const rgb = [0, 0, 0];
    let density = 0,
      last = 0;
    for (const [t, volume, sign] of hits) {
      if (density > 1e-10 && t > last) {
        if (counters) counters.analyticSegments++;
        const alpha = -Math.expm1(-density * (t - last) * scale);
        for (let i = 0; i < 3; i++) result[i] += (result[3] * alpha * rgb[i]) / density;
        result[3] *= 1 - alpha;
      }
      density += volume.density * sign;
      for (let i = 0; i < 3; i++) rgb[i] += volume.rgb[i] * volume.density * sign;
      last = t;
    }
    return result;
  }

  return { plane, planeDistance, reflectedView, captureView, fog, sphere, box, shaft, field, shaped, shapedVolumes, prepareVolumes,
    trace, rayBounds, slab, lighting: (settings, palette, options) => volumeLight.lighting(settings, volumeColor, palette, options),
    addLocalLight: volumeLight.addLocal, occluder: volumeLight.occluder, volumeHistory: volumeLight.history, ripple, ringSampler };
})();
if (typeof module !== 'undefined') module.exports = SceneOptics;
