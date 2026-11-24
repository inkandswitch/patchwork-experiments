/* Shared authoring controls compiled to Ink's stylized native finishes. */
const MaterialControls = (() => {
  let surface, optics;
  try {
    surface = SurfaceLook;
  } catch {
    surface = require('./surface-look.js');
  }
  try {
    optics = OpticalMaterials;
  } catch {
    optics = require('./optical-materials.js');
  }
  const normalized = new WeakSet();
  const record = (v, keys, name) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
      throw new TypeError('Invalid ' + name + ' controls');
  };
  const number = (v, lo, hi, name) => {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(name + ' must be in ' + lo + '..' + hi);
    return v;
  };
  function color(v, name = 'Material color') {
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
      const h = parseInt(v.slice(1), 16);
      return [h >>> 16, (h >> 8) & 255, h & 255].map(n => n / 255);
    }
    if (!Array.isArray(v) || v.length !== 3) throw new TypeError(name + ' needs #rrggbb or normalized RGB');
    return v.map(n => number(n, 0, 1, name));
  }
  const pair = (v, name) => {
    if (!Array.isArray(v)) return [number(v, 0, 1, name), v];
    if (v.length !== 2) throw new TypeError(name + ' needs a number or along/across pair');
    return v.map(n => number(n, 0, 1, name));
  };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const clamp = v => Math.max(0, Math.min(1, v));
  const f0 = ior => ((ior - 1) / (ior + 1)) ** 2;
  function describe(input = {}) {
    if (normalized.has(input)) return input;
    record(
      input,
      ['roughness', 'metalness', 'ior', 'transmission', 'thickness', 'absorption', 'color', 'coating'],
      'material'
    );
    const { roughness = 0.45, metalness = 0, ior = 1.5, transmission = 0, thickness = 0.1, absorption = 0 } = input;
    pair(roughness, 'Roughness');
    const value = {
      roughness: Array.isArray(roughness) ? Object.freeze(roughness.slice()) : roughness,
      metalness: number(metalness, 0, 1, 'Metalness'),
      ior: number(ior, 1, 4, 'IOR'),
      transmission: number(transmission, 0, 1, 'Transmission'),
      thickness: number(thickness, 0.0001, 1024, 'Thickness'),
      absorption: number(absorption, 0, 32, 'Absorption'),
      ...(input.color !== undefined && { color: Object.freeze(color(input.color)) })
    };
    const c =
      input.coating === undefined || input.coating === false
        ? { weight: 0 }
        : typeof input.coating === 'number'
          ? { weight: input.coating }
          : input.coating;
    record(c, ['weight', 'roughness', 'ior', 'color'], 'coating');
    value.coating = Object.freeze({
      weight: number(c.weight ?? 1, 0, 1, 'Coating weight'),
      roughness: number(c.roughness ?? 0.12, 0, 1, 'Coating roughness'),
      ior: number(c.ior ?? 1.5, 1, 4, 'Coating IOR'),
      color: Object.freeze(color(c.color ?? '#ffffff', 'Coating color'))
    });
    Object.freeze(value);
    normalized.add(value);
    return value;
  }
  function apply(base, controls) {
    if (Array.isArray(base)) base = { r: base };
    if (!base || typeof base !== 'object') throw new TypeError('A controlled material needs a base material or ramp');
    return { ...base, controls: describe(controls) };
  }
  function resolve(input, { palette, packed = false } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const top = input.top && resolve(input.top, { palette, packed });
    if (input.controls === undefined) return top !== input.top ? { ...input, top } : input;
    const c = describe(input.controls),
      roughness = pair(c.roughness, 'Roughness'),
      average = (roughness[0] + roughness[1]) / 2,
      dielectric = f0(c.ior),
      metal = c.metalness,
      transmission = c.transmission * (1 - metal);
    let tint = c.color;
    if (!tint && input.albedo !== undefined && (typeof input.albedo === 'string' || Array.isArray(input.albedo)))
      tint = color(input.albedo);
    if (!tint && palette) {
      const i = Number.isInteger(input.albedo) ? input.albedo : input.r?.at(-1),
        h = palette[i];
      if (Number.isInteger(h))
        tint = packed
          ? [h & 255, (h >> 8) & 255, (h >>> 16) & 255].map(v => v / 255)
          : [(h >>> 16) & 255, (h >> 8) & 255, h & 255].map(v => v / 255);
      else if (Array.isArray(h) && h.length === 3)
        tint = packed ? h.map(v => number(v, 0, 255, 'Palette byte') / 255) : color(h);
    }
    tint ??= input.surface?.materialBaseColor ?? [1, 1, 1];
    const gain = 1 - 0.6 * metal,
      specular = {
        type: 'specular',
        roughness: roughness.map(v => Math.max(0.001, v)),
        color: mix([1, 1, 1], tint, metal),
        strength: clamp((Math.sqrt(dielectric) * (1 - metal) + 0.96 * metal) * (1 - 0.55 * average))
      },
      reflection = {
        type: 'reflection',
        f0: dielectric + (1 - dielectric) * metal * 0.85,
        power: 5,
        strength: dielectric > 0 || metal > 0 ? (0.22 + 0.5 * metal) * (1 - 0.65 * average) : 0,
        sky: mix([0.6, 0.78, 0.97], tint, metal * 0.8),
        horizon: mix([0.86, 0.91, 0.97], tint, metal * 0.8),
        ground: mix([0.21, 0.23, 0.28], tint, metal * 0.65)
      },
      coat = {
        type: 'specular',
        roughness: Math.max(0.001, c.coating.roughness),
        color: c.coating.color,
        strength: c.coating.weight * Math.sqrt(f0(c.coating.ior)) * (1 - 0.35 * c.coating.roughness)
      };
    const authored = input.surface?.materialControls ? input.surface.materialOverrides : input.surface;
    const settings = surface.merge(
      {
        layers: {
          'control-diffuse': { type: 'tint', blend: 'multiply', color: [gain, gain, gain], strength: 1 },
          'control-reflection': reflection,
          'control-specular': specular,
          'control-coating': coat
        }
      },
      authored
    );
    settings.materialControls = c;
    settings.materialOverrides = surface.merge({}, authored);
    settings.materialBaseColor = Array.from(tint);
    const override = input.surface?.materialControls ? input.surface.materialOpticalOverride : input.optical;
    if (override) settings.materialOpticalOverride = override;
    const optical =
      transmission > 0
        ? optics.material({
            coverage: 1 - transmission,
            reflection: dielectric,
            absorption: c.absorption,
            ...override,
            depth: { thickness: c.thickness, ...override?.depth }
          })
        : override
          ? optics.material(override)
          : undefined;
    return {
      ...input,
      ...(top && { top }),
      controls: c,
      surface: settings,
      ...(optical && { optical, a: input.a ?? 2.6 }),
      model: { ...input.model, roughness: average, metallic: metal }
    };
  }
  function inspect(input, options) {
    const material = input?.controls === undefined ? { controls: input } : input,
      mapped = resolve(material, options),
      c = describe(material.controls);
    return {
      controls: c,
      dielectricF0: f0(c.ior),
      effectiveTransmission: c.transmission * (1 - c.metalness),
      layers: mapped.surface.layers,
      optical: mapped.optical ?? null,
      model: mapped.model
    };
  }
  function update(world, binding, patch, options = {}) {
    record(options, ['replace'], 'material update');
    if (options.replace !== undefined && typeof options.replace !== 'boolean')
      throw new TypeError('Material replacement must be boolean');
    const entry = world?.surfaces?.[binding - 1];
    if (
      !Number.isSafeInteger(binding) ||
      binding < 1 ||
      !entry?.settings?.materialControls ||
      !(world.data instanceof Float32Array) ||
      !(world.surfaceData instanceof Float32Array)
    )
      throw new TypeError('Material update needs a controlled one-based surface binding');
    record(
      patch,
      ['roughness', 'metalness', 'ior', 'transmission', 'thickness', 'absorption', 'color', 'coating'],
      'material'
    );
    const previous = entry.settings.materialControls,
      controls = describe(
        options.replace
          ? patch
          : {
              ...previous,
              ...patch,
              ...(patch.coating &&
                typeof patch.coating === 'object' && { coating: { ...previous.coating, ...patch.coating } })
            }
      ),
      next = resolve({ controls, surface: entry.settings, albedo: entry.settings.materialBaseColor }),
      profile = next.optical && optics.pack(next.optical),
      rows = world.opticalSplats ? world.opticalSplats.slice() : profile ? new Float32Array(world.count * 12) : null;
    let count = 0;
    for (let i = 0; i < world.count; i++)
      if (world.surfaceData[i * 8] === binding) {
        count++;
        if (rows) {
          rows.fill(0, i * 12, i * 12 + 12);
          if (profile) rows.set(profile, i * 12);
        }
      }
    if (!count) throw new RangeError('Material binding has no carrier splats');
    entry.settings = next.surface;
    if (rows) {
      if (rows.some((v, i) => i % 12 === 3 && v > 0)) world.opticalSplats = rows;
      else delete world.opticalSplats;
    }
    for (let i = 0; i < world.count; i++)
      if (world.surfaceData[i * 8] === binding && world.anim?.rows) world.anim.rows[i >> 9] = 1;
    world.materialRevision = (world.materialRevision ?? 0) + 1;
    return { binding, count, controls };
  }
  return Object.freeze({ describe, apply, resolve, inspect, update, f0 });
})();
if (typeof module !== 'undefined') module.exports = MaterialControls;
