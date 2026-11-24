/* View-dependent surface finishes for splats. The shader works on a surface sample
   in world space and is shared by the software renderer and script bundle. */
const SurfaceLook = (() => {
  const optics = typeof SceneOptics === 'undefined' ? require('./scene-optics.js') : SceneOptics;
  const detail = typeof StableDetail === 'undefined' ? require('./stable-detail.js') : StableDetail;
  const kits = typeof SurfaceDetailKits === 'undefined' ? require('./surface-detail-kits.js') : SurfaceDetailKits;
  const effects = typeof SplatEffects === 'undefined' ? require('./splat-effects.js') : SplatEffects;
  const stages = typeof RenderStages === 'undefined' ? require('./render-stages.js') : RenderStages;
  const pixelLook = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  let curves, luts, stacks, colorSpace;
  try {
    curves = ColorCurves;
    luts = ColorLUT;
    stacks = ColorStack;
    colorSpace = ColorSpace;
  } catch {
    curves = require('./color-curves.js');
    luts = require('./color-lut.js');
    stacks = require('./color-stack.js');
    colorSpace = require('./color-space.js');
  }
  const STRIDE = 8; // binding ID (one-based), normal XYZ, visibility, optional tangent XYZ
  const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const WHITE = [1, 1, 1];
  const toLinear = colorSpace.prepare('srgb', 'srgb-linear');
  const toDisplay = colorSpace.prepare('srgb-linear', 'srgb');
  const TAU = Math.PI * 2;
  const specularLayers = new Set(['specular','fiber','sheen','film','diffraction','glints','reflection','planarReflection','localReflection']);
  const colorLayers = new Set(['tint','projected','colorCurve','colorLut','colorStack']);
  const basePaint = layer => layer?.stage === 'material' && colorLayers.has(layer.type);
  const rampLayers = new Set(['diffuse', 'specular', 'fiber', 'sheen', 'glints', 'bevel']);
  const hasBevel = settings => Object.values(settings.layers ?? {}).some(layer =>
    layer?.type === 'bevel' && (layer.strength !== 0 || layer.drive?.strength !== undefined));
  const needsDistance = settings => hasBevel(settings) || kits.needsDistance(settings);
  const crevice = { edge:'concave', minBend:.025, softness:.19 };
  const clamp = n => Math.min(1, Math.max(0, n));
  const mix = (a, b, t) => a + (b - a) * t;
  const unit = (v, fallback = AXES.y) => {
    const length = Math.hypot(...v);
    return length > 1e-8 ? v.map(n => n / length) : fallback;
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vector = (v, fallback = AXES.x) => {
    if (typeof v === 'string' && Object.hasOwn(AXES, v)) return AXES[v];
    if (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) return v;
    return fallback;
  };
  const smooth = (low, high, x) => {
    const t = clamp((x - low) / Math.max(1e-8, high - low));
    return t * t * (3 - 2 * t);
  };
  const fract = x => x - Math.floor(x);
  const positive = (v, fallback) => Math.max(0.001, v ?? fallback);
  const bell = (x, width) => Math.exp(-((x / width) ** 2));

  function prepareLightTrack(keys) {
    if (!Array.isArray(keys) || !keys.length) throw new TypeError('Expected surface light keys [time, x, y, z]');
    const frames = Array.from(keys, (key, i) => {
      if (!Array.isArray(key) || key.length !== 4 || !Array.from(key).every(Number.isFinite) ||
          key[0] < 0 || (i > 0 && key[0] <= keys[i - 1][0]))
        throw new RangeError('Surface light keys need finite values and strictly increasing nonnegative times');
      const direction = key.slice(1);
      const length = Math.hypot(...direction);
      if (length < 1e-8 || !Number.isFinite(length)) throw new RangeError('Surface light directions must be nonzero');
      return { time: key[0], direction: unit(direction) };
    });
    return time => {
      const first = frames[0], last = frames.at(-1);
      if (time <= first.time) return first.direction.slice();
      if (time >= last.time) return last.direction.slice();
      const i = frames.findIndex(frame => frame.time >= time);
      const a = frames[i - 1], b = frames[i];
      const fraction = smooth(0, 1, (time - a.time) / (b.time - a.time));
      const similarity = Math.min(1, Math.max(-1, dot(a.direction, b.direction)));
      const tangent = b.direction.map((value, axis) => value - a.direction[axis] * similarity);
      if (similarity > 0.9999) return unit(a.direction.map((value, axis) => mix(value, b.direction[axis], fraction)));
      // Opposite keys can turn through either half-circle. Pick a stable perpendicular.
      const axis = Math.abs(a.direction[1]) < 0.9 ? AXES.y : AXES.x;
      const perpendicular = unit(tangent, unit(cross(a.direction, axis)));
      const angle = Math.acos(similarity) * fraction;
      return a.direction.map((value, axis) => value * Math.cos(angle) + perpendicular[axis] * Math.sin(angle));
    };
  }

  function hash(x, y, z, key) {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041) ^ Math.imul(key, 1013904223);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function noise(p, scale, seed) {
    const [x, y, z] = p.map(v => v / scale);
    const [i, j, k] = [Math.floor(x), Math.floor(y), Math.floor(z)];
    const [a, b, c] = [x, y, z].map(v => smooth(0, 1, fract(v)));
    const row = (dy, dz) => mix(hash(i, j + dy, k + dz, seed), hash(i + 1, j + dy, k + dz, seed), a);
    return mix(mix(row(0, 0), row(1, 0), b), mix(row(0, 1), row(1, 1), b), c);
  }

  const isRecord = v => v && Object.getPrototypeOf(v) === Object.prototype;
  function merge(base, changes) {
    const a = isRecord(base) ? base : {};
    const b = isRecord(changes) ? changes : {};
    return Object.fromEntries(
      [...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => {
        const value = Object.hasOwn(b, key) ? b[key] : a[key];
        if (key === 'lut' && (b.type ?? a.type) === 'colorLut') return [key, luts.normalize(value)];
        if (key === 'stack' && (b.type ?? a.type) === 'colorStack') return [key, stacks.normalize(value)];
        if (key === 'lightingRamp' && isRecord(value)) return [key, merge({}, value)];
        return [key, isRecord(value) ? merge(a[key], value) : Array.isArray(value) ? value.slice() : value];
      })
    );
  }

  function color(value, palette, fallback = WHITE, roles) {
    if (value === undefined) return fallback;
    if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) return value.map(clamp);
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) value = parseInt(value.slice(1), 16);
    else if (Number.isInteger(value)) value = palette[value];
    else if (typeof value === 'string' && value && !value.startsWith('#') && roles)
      value = pixelLook.roleColor(value, palette, roles);
    else throw new TypeError('Expected a palette role, palette index, #rrggbb or RGB triple for a surface colour');
    if (!Number.isInteger(value)) throw new RangeError('Surface colour is outside the palette');
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  function prepareLightingRamp(definition, palette, roles, id, type) {
    if (!rampLayers.has(type)) throw new RangeError(id + '.lightingRamp is unavailable for ' + type);
    if (!isRecord(definition) ||
        Object.keys(definition).some(key => !['role', 'positions', 'stops', 'interpolation', 'weights'].includes(key)))
      throw new TypeError(id + '.lightingRamp needs a palette role or color stops and optional weights');
    const { role, positions, stops, interpolation, weights } = definition;
    if ((role === undefined) === (stops === undefined) || (positions !== undefined && role === undefined))
      throw new TypeError(id + '.lightingRamp needs either role with optional positions or explicit stops');
    let rows = stops;
    if (role !== undefined) {
      const indices = typeof role === 'string' && role && Object.hasOwn(roles, role) && roles[role];
      if (!Array.isArray(indices) || indices.length < 2 || !Array.from(indices).every(Number.isInteger))
        throw new RangeError(id + '.lightingRamp needs a palette role with at least two swatches');
      if (positions !== undefined && (!Array.isArray(positions) || positions.length !== indices.length))
        throw new RangeError(id + '.lightingRamp.positions must match the palette role length');
      rows = indices.map((index, i) => [positions === undefined ? i / (indices.length - 1) : positions[i], index]);
    }
    if (!Array.isArray(rows) || !Array.from(rows).every(row => Array.isArray(row) && Number.isFinite(row[0]) && row[0] >= 0 && row[0] <= 1))
      throw new RangeError(id + '.lightingRamp stop positions must be in [0, 1]');
    const tint = curves.ramp({ stops: rows, interpolation }, value => color(value, palette, WHITE, roles));
    let amount;
    if (weights !== undefined) {
      if (!Array.isArray(weights) || weights.length !== rows.length)
        throw new RangeError(id + '.lightingRamp.weights must match the color stop count');
      amount = curves.scalar({ stops: rows.map(([at], i) => [at, weights[i]]), interpolation }, true);
      if (type !== 'diffuse' && amount(0) !== 0)
        throw new RangeError(id + '.lightingRamp must give zero weight to an inactive highlight');
    }
    return { tint, amount };
  }

  function lightRamps(definition) {
    if (definition === undefined || definition === false) return null;
    const namedMap = value => isRecord(value) && Object.keys(value).every(key => key.trim() && key.length <= 256);
    if (!namedMap(definition)) throw new TypeError('Surface light ramps need a map of named finishes');
    for (const [finish, layers] of Object.entries(definition)) {
      if (!namedMap(layers)) throw new TypeError('Surface finish ' + finish + ' needs a map of named layer ramps');
      for (const [layer, ramp] of Object.entries(layers)) {
        if (!Array.isArray(ramp?.stops) || ramp.stops.some(stop => Number.isInteger(stop?.[1])))
          throw new TypeError(finish + '.' + layer + ' needs explicit hex or RGB light ramp stops');
        prepareLightingRamp(ramp, [], {}, finish + '.' + layer, 'diffuse');
      }
    }
    return definition;
  }

  function withLightRamps(settings, ramps) {
    if (!ramps || typeof settings.id !== 'string' || !Object.hasOwn(ramps, settings.id)) return settings;
    const entries = ramps[settings.id];
    const layers = Object.fromEntries(Object.entries(settings.layers ?? {}).map(([id, layer]) =>
      [id, layer && Object.hasOwn(entries, id) ? { ...layer, lightingRamp: entries[id] } : layer]));
    return { ...settings, layers };
  }

  function material(base, settings) {
    const source = Array.isArray(base) ? { r: base } : base;
    return Object.assign({}, source, { surface: merge(source?.surface, settings) });
  }

  function maskAt(mask, p, seed, position, frame) {
    if (!mask) return 1;
    if (typeof mask === 'function') {
      const coverage = mask(position[0], position[1], position[2], frame);
      if (!Number.isFinite(coverage)) throw new TypeError('Surface mask must return a finite number');
      return clamp(coverage);
    }
    const scale = positive(mask.scale, 0.2);
    let weight;
    switch (mask.type) {
      case 'noise':
        weight = smooth(mask.low ?? 0.25, mask.high ?? 0.75, noise(p, scale, seed + (mask.seed || 0)));
        break;
      case 'stripes': {
        const phase = fract(dot(p, vector(mask.axis)) / scale + (mask.phase || 0));
        const edge = Math.abs(phase - 0.5) * 2;
        const width = clamp(mask.width ?? 0.45);
        weight = 1 - smooth(width, width + (mask.feather ?? 0.12), edge);
        break;
      }
      case 'checker': {
        const a = Math.floor(dot(p, vector(mask.axis)) / scale);
        const b = Math.floor(dot(p, vector(mask.cross, AXES.y)) / scale);
        weight = (a + b) & 1;
        break;
      }
      default:
        throw new RangeError('Unknown surface mask: ' + mask.type);
    }
    return mask.invert ? 1 - weight : weight;
  }

  function weatherMask(mask) {
    const { channel = 'wetness', low = 0, high = 1, invert = false } = mask;
    if (!['wetness', 'standingWater', 'snow', 'frost'].includes(channel) || !Number.isFinite(low) || !Number.isFinite(high) ||
        low < 0 || high <= low || typeof invert !== 'boolean')
      throw new RangeError('Weather masks need wetness, standingWater, snow or frost and increasing nonnegative bounds');
    return weather => {
      const value = weather?.[channel];
      if (!Number.isFinite(value)) return 0;
      const coverage = smooth(low, high, value);
      return invert ? 1 - coverage : coverage;
    };
  }

  function prepareSignals(definition, context, validateOnly) {
    if (definition !== undefined && !isRecord(definition)) throw new TypeError('Surface signals must be named in an object');
    return new Map(Object.entries(definition ?? {}).map(([id, source]) => {
      if (typeof source === 'function') return [id, { read: source }];
      if (!isRecord(source)) throw new TypeError('Surface signal ' + id + ' needs a source');
      const { type, channel, range = [0, 1], interpolation = 'smooth' } = source;
      if (['weather','time','light'].includes(type)) {
        if (type === 'weather' && !['wetness', 'standingWater', 'snow', 'frost', 'temperature', 'exposure'].includes(channel))
          throw new RangeError('Unknown weather channel on surface signal ' + id);
        if (Object.keys(source).some(key => !['type', 'range', 'interpolation', ...(type === 'weather' ? ['channel'] : [])].includes(key)) ||
            !Array.isArray(range) || range.length !== 2)
          throw new TypeError('Surface signal ' + id + ' needs a valid range');
        const transfer = curves.scalar({ stops: [[range[0], 0], [range[1], 1]], interpolation });
        const read = (sample, weather, light) => {
          const value = type === 'weather' ? weather?.[channel] : type === 'light' ? light : sample.time ?? 0;
          return Number.isFinite(value) ? transfer(value) : 0;
        };
        return [id, { read, weather: type === 'weather', light: type === 'light' }];
      }
      const read = effects.prepareMask(source, context, { validateOnly });
      return [id, { read }];
    }));
  }

  const roughnessPair = value => Array.isArray(value) ? Array.from(value) : [value, value];
  function prepareDrive(definition, layer, signals, resolveColor) {
    if (definition === undefined) return null;
    if (!isRecord(definition)) throw new TypeError(layer.id + '.drive must name finish properties');
    const drive = Object.entries(definition).map(([key, setting]) => {
      if (!isRecord(setting) || Object.keys(setting).some(name => !['signal', 'to'].includes(name)) ||
          !signals.has(setting.signal) || setting.to === undefined)
        throw new TypeError(layer.id + '.drive.' + key + ' needs a named signal and a target value');
      const signal = signals.get(setting.signal);
      let from = layer[key], to = setting.to;
      if (key === 'strength' || key === 'f0' && ['reflection', 'planarReflection', 'localReflection'].includes(layer.type)) {
        if (!Number.isFinite(to) || to < 0 || to > 1)
          throw new RangeError(layer.id + '.drive.' + key + ' target must be in [0, 1]');
        from ??= 0.04;
      } else if (key === 'roughness' && ['specular', 'fiber', 'diffraction', 'glints', 'localReflection'].includes(layer.type)) {
        to = roughnessPair(to);
        const local = layer.type === 'localReflection';
        if (to.length !== 2 || !to.every(value => Number.isFinite(value) && (local ? value >= 0 && value <= 1 : value > 0)))
          throw new RangeError(layer.id + '.drive.roughness needs a valid value or along/across pair');
        if (!local) to = to.map(value => positive(value));
      } else if (key === 'color' && ['tint', 'specular', 'fiber', 'sheen', 'glints', 'bevel', 'planarReflection', 'localReflection', 'transmission'].includes(layer.type)) {
        to = resolveColor(to);
      } else if (key === 'thickness' && layer.type === 'transmission') {
        if (!Number.isFinite(to) || to < 0) throw new RangeError(layer.id + '.drive.thickness must be nonnegative');
      } else throw new RangeError(layer.id + '.drive cannot control ' + key + ' on ' + layer.type);
      return { key, signal, from, to };
    });
    return drive.length ? drive : null;
  }

  function rainMask(mask) {
    const { receiver, channel = 'splash' } = mask;
    if (typeof receiver !== 'string' || !receiver.trim() || !['splash','runoff'].includes(channel))
      throw new RangeError('Rain impact masks need a receiver ID and splash or runoff channel');
    return sample => sample.rain?.mask(receiver, channel, sample.worldPosition ?? sample.position) ?? 0;
  }

  function directionAt(direction, p, normal) {
    if (typeof direction === 'function') return vector(direction(p, normal));
    if (direction?.type === 'circular') {
      return cross(vector(direction.axis, AXES.y), p);
    }
    if (direction?.type === 'weave') {
      const scale = positive(direction.scale, 0.2);
      const a = vector(direction.along),
        b = vector(direction.across, AXES.y);
      return (Math.floor(dot(a, p) / scale) + Math.floor(dot(b, p) / scale)) & 1 ? a : b;
    }
    return vector(direction);
  }

  function tangent(direction, n) {
    const projection = dot(direction, n);
    const t = direction.map((v, i) => v - n[i] * projection);
    const fallback = Math.abs(n[0]) < 0.8 ? AXES.x : AXES.y;
    return unit(t, unit(cross(fallback, n)));
  }

  function bump(settings, n, t, b, p, time, footprint, seed) {
    if (settings?.type === 'rings' && typeof settings.sample === 'function') {
      const slope = settings.sample(p, time, footprint);
      return unit(
        n.map((value, i) => value + slope[i]),
        n
      );
    }
    if (!settings?.amplitude) return n;
    const scale = positive(settings.scale, 0.3);
    const amp = settings.amplitude * (1 - smooth(scale * 0.35, scale * 0.85, footprint));
    if (!amp) return n;
    const u = dot(p, vector(settings.axis)) / scale;
    const v = dot(p, vector(settings.cross, AXES.z)) / scale;
    const phase = time * (settings.speed ?? 0);
    const a = settings.type === 'noise' ? 2 * noise(p, scale, seed) - 1 : Math.sin(TAU * (u + v * 0.23) + phase);
    const c =
      settings.type === 'noise' ? 2 * noise(p, scale, seed + 1) - 1 : Math.sin(TAU * (v - u * 0.33) - phase * 0.7);
    return unit(
      n.map((value, i) => value + amp * (t[i] * a + b[i] * c)),
      n
    );
  }

  function fresnel(cosine, f0, power = 5) {
    return f0 + (1 - f0) * (1 - clamp(cosine)) ** power;
  }

  function bevelCoverage(layer, sample, normal, view, worldReach) {
    const distance = sample.bevelDistance, pixel = sample.artFootprint ?? sample.footprint;
    if (typeof distance !== 'function' || !Number.isFinite(pixel) || pixel <= 0) return 0;
    const [x, y, z] = sample.position;
    const center = distance(x, y, z);
    if (!Number.isFinite(center)) return 0;
    const u = tangent(AXES.x, normal);
    const v = cross(normal, u);
    const diagonal = sign => u.map((value, i) => (value + sign * v[i]) * Math.SQRT1_2);
    let bend = 0;
    for (const direction of [u, v, diagonal(1), diagonal(-1)]) {
      // Use a projected pixel radius across the face, with a limit at grazing angles.
      const foreshortening = Math.sqrt(Math.max(0.16, 1 - dot(direction, view) ** 2));
      const reach = worldReach ?? layer.width * pixel / foreshortening;
      const [dx, dy, dz] = direction.map(value => value * reach);
      // Opposed probes cancel linear slope. A flat face produces no bend.
      const departure = (distance(x + dx, y + dy, z + dz) + distance(x - dx, y - dy, z - dz) - 2 * center) / reach;
      const score = layer.edge === 'both' ? Math.abs(departure) : layer.edge === 'concave' ? -departure : departure;
      if (Number.isFinite(score)) bend = Math.max(bend, score);
    }
    return smooth(layer.minBend, layer.minBend + layer.softness, bend);
  }

  const models = {
    bevel(layer, q) {
      return clamp(q.nl) ** layer.power * q.light;
    },
    diffuse(layer, { nl, light }) {
      return clamp(nl) * light;
    },
    specular(layer, q) {
      const { nt, ht, hb, nl, light } = q;
      if (nl <= 0 || nt <= 0 || light <= 0) return 0;
      return bell(ht / nt, layer.roughness[0]) * bell(hb / nt, layer.roughness[1]) * light;
    },
    fiber(layer, q) {
      const tilt =
        (layer.figure || 0) * Math.sin((dot(q.p, vector(layer.axis, AXES.y)) * TAU) / positive(layer.scale, 0.5));
      const alignment = q.ht + tilt * q.nt - (layer.shift || 0);
      return bell(alignment, layer.roughness[0]) * Math.sqrt(clamp(q.nl * 2)) * q.light;
    },
    reflection(layer, q, col) {
      const source = q.skyReflectionSource ?? layer.source;
      const scene = source === 'scene' && q.sky;
      if (!scene || q.skyOverlay) {
        // A compact three-colour environment reflected in the sample normal.
        const up = q.n[1] * 2 * q.nv - q.v[1];
        const tint = up < 0 ? layer.ground : layer.sky;
        const blend = smooth(0, 0.8, Math.abs(up));
        for (let i = 0; i < 3; i++) col[i] = mix(layer.horizon[i], tint[i], blend);
      }
      if (scene) {
        const normal = q.skyNormal ? unit(q.skyNormal(q.n), q.n) : q.n;
        const view = q.skyView ? unit(q.skyView, normal) : q.v;
        const twice = 2 * dot(normal, view);
        q.sky(normal.map((v, i) => twice * v - view[i]), col);
      }
      return fresnel(q.nv, layer.f0 ?? 0.04, layer.power ?? 5) * (scene ? q.skyAccess : 1);
    },
    transmission(layer, q, col) {
      const scene = q.transmissionSun || q.transmissionLights;
      const normal = scene && q.skyNormal ? unit(q.skyNormal(q.n), q.n) : q.n;
      const view = scene && q.skyView ? q.skyView : q.v;
      const side = dot(normal, view) >= 0 ? -1 : 1;
      const irradiance = [0, 0, 0];
      function transmit(direction, intensity, rgb, visibility) {
        const incident = dot(normal, direction) * side;
        const facing = clamp((incident + layer.wrap) / (1 + layer.wrap));
        if (!facing || !intensity) return;
        const clear = layer.shadow === false ? 1 : visibility?.(layer.shadowBias) ?? 1;
        const amount = facing ** layer.power * Math.exp(-layer.thickness / (0.18 + 0.82 * clamp(incident))) * intensity * clear;
        for (let i = 0; i < 3; i++) irradiance[i] += rgb[i] * amount;
      }
      if (layer.source !== 'local') {
        const sun = q.transmissionSun;
        transmit(sun?.direction ?? q.sun, sun?.intensity ?? 1, sun?.color ?? WHITE,
          sun?.visibility ?? (() => q.light));
      }
      if (layer.source !== 'sun') for (const lamp of q.transmissionLights?.() ?? [])
        transmit(lamp.direction, lamp.intensity, lamp.color, lamp.visibility);
      if (!irradiance.some(Boolean)) return 0;
      toLinear(col, col);
      for (let i = 0; i < 3; i++) col[i] *= irradiance[i];
      return 1;
    },
    localReflection(layer, q, col) {
      if (!q.localReflection) return 0;
      const normal = q.skyNormal ? unit(q.skyNormal(q.n), q.n) : q.n;
      const view = q.skyView ? unit(q.skyView, normal) : q.v;
      const facing = dot(normal, view);
      if (facing <= 0) return 0;
      const ray = normal.map((value,i)=>2*facing*value-view[i]);
      let axis;
      if (layer.roughness[0] !== layer.roughness[1]) {
        const along = layer.roughness[0] > layer.roughness[1];
        const c = layer.cosine, s = layer.sine;
        const grain = q.t.map((value,i)=>along ? value*c+q.b[i]*s : q.b[i]*c-value*s);
        axis = tangent(q.reflectionTangent ? q.reflectionTangent(grain) : grain, ray);
      }
      const reflected = q.localReflection(layer, ray, axis);
      if (!reflected) return 0;
      for (let i=0;i<3;i++) col[i]*=reflected.rgb[i];
      return reflected.coverage*fresnel(facing, layer.f0 ?? 0.04, layer.power ?? 5);
    },
    planarReflection(layer, q, col) {
      const reflected = q.reflection?.(layer, q.n, q.geometricNormal);
      if (!reflected) return 0;
      for (let i = 0; i < 3; i++) col[i] *= reflected.rgb[i];
      return reflected.coverage * fresnel(q.nv, layer.f0 ?? 0.04, layer.power ?? 5);
    },
    sheen(layer, q) {
      const directional = clamp(layer.directional ?? 0);
      return (1 - q.nv) ** (layer.power ?? 2) * mix(1, Math.abs(q.vt), directional);
    },
    film(layer, q, col) {
      const ior = positive(layer.ior, 1.45);
      const cosine = clamp(mix(q.nv, Math.abs(q.vt), layer.axisBias ?? 0));
      const refracted = Math.sqrt(Math.max(0, 1 - (1 - cosine * cosine) / (ior * ior)));
      const thickness =
        (layer.thickness ?? 400) + (layer.variation || 0) * (noise(q.p, positive(layer.scale, 0.35), q.seed) * 2 - 1);
      const path = 2 * ior * thickness * refracted;
      if (layer.colors.length > 1) {
        const u = fract(path / positive(layer.period, 530)) * layer.colors.length;
        const index = Math.floor(u);
        const a = layer.colors[index],
          b = layer.colors[(index + 1) % layer.colors.length];
        for (let i = 0; i < 3; i++) col[i] = mix(a[i], b[i], fract(u));
      } else {
        const contrast = clamp(layer.contrast ?? 0.85);
        for (let i = 0; i < 3; i++) {
          const wave = i === 0 ? 635 : i === 1 ? 530 : 460;
          col[i] = 1 - contrast * (0.5 + 0.5 * Math.cos((TAU * path) / wave));
        }
      }
      const flash = layer.flash ? bell(1 - q.nt, positive(layer.flash, 0.12)) * q.light : 1;
      return fresnel(cosine, layer.f0 ?? 0.25, layer.power ?? 3) * flash;
    },
    diffraction(layer, q, col) {
      if (q.nl <= 0) return 0;
      // The grooves run along T. Only the component across them splits into colours.
      const wavelength = (Math.abs(q.vb + q.lb) * positive(layer.spacing, 1200)) / positive(layer.order, 1);
      const width = positive(layer.bandwidth, 40);
      col[0] = bell(wavelength - 620, width);
      col[1] = bell(wavelength - 530, width);
      col[2] = bell(wavelength - 450, width);
      const peak = Math.max(...col);
      if (peak < 0.004) return 0;
      for (let i = 0; i < 3; i++) col[i] /= peak;
      return peak * bell(q.vt + q.lt, layer.roughness[0]) * q.light;
    },
    directionalColor(layer, q, col) {
      const angle = Math.abs(q.vt) - Math.abs(q.vb);
      const t = smooth(-positive(layer.width, 0.4), positive(layer.width, 0.4), angle + (layer.bias || 0));
      for (let i = 0; i < 3; i++) col[i] = mix(layer.crossColor[i], layer.color[i], t);
      return 1;
    },
    glints(layer, q, col) {
      if (q.nl <= 0 || q.nt <= 0) return 0;
      const cell = positive(layer.scale, 0.12),
        radius = clamp(layer.radius ?? 0.37);
      const p = q.p.map(value => value / cell);
      const [x, y, z] = p.map(Math.floor);
      const hashAt = salt => hash(x, y, z, q.seed + (layer.seed || 0) + salt);
      if (hashAt(17) >= clamp(layer.density ?? 0.45)) return 0;
      const reach = Math.min(0.44, Math.max(radius, (q.footprint / cell) * 0.45));
      const distance = Math.hypot(...p.map((v, i) => fract(v) - mix(0.45, 0.55, hashAt(i + 3))));
      const shape = 1 - smooth(reach * 0.5, reach, distance);
      if (shape <= 0) return 0;
      const tilt = layer.tilt ?? 0.5;
      const ht = q.ht / q.nt - (hashAt(25) * 2 - 1) * tilt;
      const hb = q.hb / q.nt - (hashAt(41) * 2 - 1) * tilt;
      const band = bell(ht, layer.roughness[0]) * bell(hb, layer.roughness[1]);
      if (layer.colors.length) {
        const choice = layer.colors[Math.floor(hashAt(61) * layer.colors.length)];
        for (let i = 0; i < 3; i++) col[i] = choice[i];
      }
      const filter = Math.min(1, (radius * cell) / Math.max(1e-6, q.footprint * 0.5)) ** 2;
      return (shape * band) ** positive(layer.response, 0.65) * filter * q.light;
    }
  };

  function numeric(object, fields, label) {
    for (const field of fields) {
      if (object[field] !== undefined && !Number.isFinite(object[field]))
        throw new TypeError(label + '.' + field + ' must be a number');
    }
  }

  function prepare(settings, palette = [], lightDirection = [-0.55, 0.72, 0.43], context = {},
    { colorCurves = true, colorLut = true, colorStack = true, paletteConstraints = true, paletteRoles, blueNoise, onPaletteClip,
      transmission = true, detailKits = true, validateOnly = false, skipMasks = false, ditherSpaceOverride } = {}) {
    if (!isRecord(settings)) throw new TypeError('Surface settings must be an object');
    const roles = pixelLook.bindRoles(palette, paletteRoles, settings.paletteRoles);
    const resolveColor = value => color(value, palette, WHITE, roles);
    if (validateOnly && settings.renderStages !== undefined) {
      const stages = typeof RenderStages === 'undefined' ? require('./render-stages.js') : RenderStages;
      stages.prepare(settings.renderStages, { palette, roles, blueNoise, context, validateOnly });
    }
    numeric(settings, ['scale', 'seed', 'steps'], 'surface');
    if (settings.rainRipple !== undefined && (typeof settings.rainRipple !== 'string' || !settings.rainRipple.trim()))
      throw new TypeError('Surface rainRipple must be a water receiver ID');
    if (settings.layers !== undefined && !isRecord(settings.layers))
      throw new TypeError('Surface layers must be named in an object');
    if (
      settings.origin !== undefined &&
      (!Array.isArray(settings.origin) || settings.origin.length !== 3 || !settings.origin.every(Number.isFinite))
    )
      throw new TypeError('Surface origin must be an XYZ position');
    if (settings.opacity) {
      if (!isRecord(settings.opacity)) throw new TypeError('Surface opacity must be an object');
      numeric(settings.opacity, ['facing', 'grazing', 'power'], 'surface.opacity');
    }
    let normal = settings.normal;
    if (settings.normal) {
      if (!isRecord(settings.normal)) throw new TypeError('Surface normal variation must be an object');
      numeric(settings.normal, ['amplitude', 'scale', 'speed'], 'surface.normal');
      if (normal.cadence !== undefined && !['water','scene'].includes(normal.cadence))
        throw new TypeError('Surface normal cadence must be water or scene');
      if (settings.normal.type && !['noise', 'waves', 'rings'].includes(settings.normal.type))
        throw new RangeError('Unknown surface normal pattern: ' + settings.normal.type);
      if (settings.normal.type === 'rings' && typeof settings.normal.sample !== 'function') {
        numeric(settings.normal, ['width', 'damping'], 'surface.normal');
        if (!Array.isArray(settings.normal.drops) || settings.normal.drops.length > 64)
          throw new TypeError('Ripple rings need a list of up to 64 drops');
        for (const drop of settings.normal.drops) {
          if (!isRecord(drop) || !Array.isArray(drop.at) || drop.at.length !== 3 || !drop.at.every(Number.isFinite))
            throw new TypeError('Each ripple drop needs a finite XYZ position');
          numeric(drop, ['start', 'repeat', 'strength'], 'ripple drop');
          if (drop.repeat !== undefined && drop.repeat <= 0) throw new RangeError('Ripple repeat must be positive');
        }
        const scale = positive(normal.scale, 0.3);
        normal = {
          type: 'rings', cadence: normal.cadence,
          sample: optics.ringSampler(() => settings.normal.drops, {
            along: unit(vector(normal.axis)),
            across: unit(vector(normal.cross, AXES.z)),
            amplitude: normal.amplitude || 0,
            scale,
            speed: positive(normal.speed, 1),
            width: positive(normal.width, scale * 2.5),
            damping: Math.max(0, normal.damping ?? 0.3)
          })
        };
      }
    }
    const signals = prepareSignals(settings.signals, context, validateOnly);
    const sourceLayers = settings.layers ?? {};
    const layers = Object.entries(settings.lookAssetId && sourceLayers.lookAssetRamp ?
      {lookAssetRamp:sourceLayers.lookAssetRamp,...sourceLayers} : sourceLayers)
      .filter(([, layer]) => layer && (layer.strength !== 0 || layer.drive?.strength !== undefined) &&
        (colorCurves || layer.type !== 'colorCurve') && (colorLut || layer.type !== 'colorLut') &&
        (colorStack || layer.type !== 'colorStack') && (transmission || layer.type !== 'transmission') &&
        (detailKits || layer.type !== 'detailKit'))
      .map(([id, layer]) => {
        const colorLayer = colorLayers.has(layer.type);
        if (colorLayer && layer.stage !== undefined && !['material','lit'].includes(layer.stage))
          throw new RangeError(id + '.stage must be material or lit for a surface color layer');
        const kit = layer.type === 'detailKit' && kits.prepare(layer.pattern, resolveColor);
        if (!colorLayer && !kit && !Object.hasOwn(models, layer.type))
          throw new RangeError('Unknown surface layer: ' + layer.type);
        const lightingRamp = layer.lightingRamp === undefined || layer.lightingRamp === false ? null :
          prepareLightingRamp(layer.lightingRamp, palette, roles, id, layer.type);
        if (layer.type === 'diffuse' && !lightingRamp) throw new TypeError(id + ' diffuse layer needs a lightingRamp');
        numeric(
          layer,
          [
            'strength',
            'detailSize',
            'steps',
            'rotation',
            'scale',
            'power',
            'f0',
            'directional',
            'seed',
            'shift',
            'figure',
            'ior',
            'thickness',
            'variation',
            'period',
            'contrast',
            'flash',
            'axisBias',
            'spacing',
            'order',
            'bandwidth',
            'width',
            'bias',
            'density',
            'radius',
            'tilt',
            'response',
            'distortion',
            'blur',
            ...(layer.type === 'bevel' ? ['minBend', 'softness'] : []),
            ...(layer.type === 'transmission' ? ['wrap', 'shadowBias'] : [])
          ],
          id
        );
        if (layer.detailSize !== undefined && layer.detailSize <= 0)
          throw new RangeError(id + '.detailSize must be positive');
        if (layer.type === 'reflection' && layer.source !== undefined && !['scene', 'material'].includes(layer.source))
          throw new RangeError(id + '.source must be scene or material');
        if (layer.type === 'planarReflection') {
          if (typeof layer.plane !== 'string' || !layer.plane.trim())
            throw new TypeError(id + '.plane must be a reflection plane ID');
          if ((layer.blur ?? 0) < 0 || (layer.distortion ?? 0) < 0)
            throw new RangeError(id + ' needs nonnegative blur and distortion');
        }
        const fieldMask = layer.mask?.type === 'field' ? effects.fieldMask(layer.mask, context) : null;
        const retainedMask = layer.mask?.type === 'weather' ? weatherMask(layer.mask) : null;
        const spatialMask = layer.mask?.type === 'rainImpact' ? rainMask(layer.mask) :
          ['axis', 'texture', 'query'].includes(layer.mask?.type)
          ? effects.prepareMask(layer.mask, context, { validateOnly }) : fieldMask;
        if (layer.mask && typeof layer.mask !== 'function' && !spatialMask && !retainedMask) {
          if (!isRecord(layer.mask)) throw new TypeError(id + '.mask must be an object');
          if (!['noise', 'stripes', 'checker'].includes(layer.mask.type))
            throw new RangeError('Unknown surface mask: ' + layer.mask.type);
          numeric(layer.mask, ['scale', 'low', 'high', 'seed', 'phase', 'width', 'feather'], id + '.mask');
        }
        if (colorLayer) {
          const blend = layer.blend ?? 'mix';
          if (!['mix', 'add', 'multiply'].includes(blend)) throw new RangeError('Unknown surface color blend: ' + blend);
          let effect;
          if (layer.type === 'tint') {
            const result = [0, 0, 0, 1, 1, 0];
            effect = { sample(sample, output, tint) {
              for (let i = 0; i < 3; i++) result[i] = tint.color[i];
              return result;
            } };
          }
          else if (layer.type === 'colorLut' || layer.type === 'colorStack') effect = effects[layer.type](layer, resolveColor);
          else if (layer.type === 'projected') effect = effects.layer(layer, context, resolveColor, roles, signals);
          else effect = effects.colorCurve(layer, context, resolveColor);
          const compiled = { ...layer, id, blend, strength: clamp(layer.strength ?? 1), effect, spatialMask, retainedMask };
          if (layer.type === 'tint') compiled.color = resolveColor(layer.color);
          return { ...compiled, drive: prepareDrive(layer.drive, compiled, signals, resolveColor) };
        }
        if (layer.colors !== undefined && !Array.isArray(layer.colors))
          throw new TypeError(id + '.colors must be a list');
        if (
          layer.roughness !== undefined &&
          !Number.isFinite(layer.roughness) &&
          !(Array.isArray(layer.roughness) && layer.roughness.length === 2 && layer.roughness.every(Number.isFinite))
        ) {
          throw new TypeError(id + '.roughness must be a number or an along/across pair');
        }
        let bevel;
        if (layer.type === 'bevel') {
          const { width = 1.5, minBend = 0.13, softness = 0.42, edge = 'convex', power = 0.65 } = layer;
          if (width < 0.25 || width > 8 || !(minBend > 0 && minBend < 2) ||
              !(softness > 0 && softness <= 2) || !['convex', 'concave', 'both'].includes(edge) || power <= 0)
            throw new RangeError(id + ' bevel needs width in 0.25–8 art pixels, positive minBend, softness and power, and a valid edge');
          bevel = { width, minBend, softness, edge, power };
        }
        let thin;
        if (layer.type === 'transmission') {
          const { source = 'both', thickness = 0.24, wrap = 0.12, power = 0.65, shadowBias = 0.08 } = layer;
          if (!['sun', 'local', 'both'].includes(source) || thickness < 0 || wrap < 0 || wrap > 1 ||
              power <= 0 || shadowBias < 0)
            throw new RangeError(id + ' transmission needs a source, nonnegative thickness and shadowBias, wrap in [0, 1], and positive power');
          thin = { source, thickness, wrap, power, shadowBias };
        }
        const roughness = roughnessPair(layer.roughness);
        const local = layer.type === 'localReflection';
        if (local && (typeof layer.probe !== 'string' || !layer.probe.trim() ||
          roughness.some(n=>n !== undefined && (n < 0 || n > 1)) ||
          (layer.f0 ?? .04) < 0 || (layer.f0 ?? .04) > 1 || (layer.power ?? 5) < 0))
          throw new RangeError(id + ' needs a probe ID, roughness and f0 in [0, 1], and nonnegative power');
        const compiled = {
          ...layer,
          id,
          kit,
          ...bevel,
          ...thin,
          spatialMask,
          retainedMask,
          model: models[layer.type],
          lightingRamp,
          strength: clamp(layer.strength ?? 1),
          roughness: [roughness[0], roughness[1] ?? roughness[0]].map(v =>
            local ? v ?? 0.22 : positive(v, layer.type === 'glints' ? 0.085 : 0.22)
          ),
          color: resolveColor(layer.color),
          crossColor: resolveColor(layer.crossColor),
          colors: (layer.colors || []).map(resolveColor),
          sky: color(layer.sky, palette, [0.6, 0.78, 0.97], roles),
          horizon: color(layer.horizon, palette, [0.86, 0.91, 0.97], roles),
          ground: color(layer.ground, palette, [0.21, 0.23, 0.28], roles),
          cosine: Math.cos(layer.rotation || 0),
          sine: Math.sin(layer.rotation || 0)
        };
        return { ...compiled, drive: prepareDrive(layer.drive, compiled, signals, resolveColor) };
      });
    const paintsBase = layers.some(basePaint);
    if (paintsBase) layers.sort((a,b)=>Number(basePaint(b))-Number(basePaint(a)));
    const thin = layers.some(layer => layer.type === 'transmission');
    const thinLocal = layers.some(layer => layer.type === 'transmission' && layer.source !== 'sun');
    const driven = layers.some(layer => layer.drive || layer.effect?.boundAxes);
    const weather = layers.some(layer => layer.retainedMask || layer.effect?.weather || layer.drive?.some(entry => entry.signal.weather));
    const hasKits = layers.some(layer=>layer.kit);
    const kitExposure = layers.some(layer=>layer.kit?.exposure);
    return {
      settings, normal, layers, driven, weather, thin, thinLocal, hasKits, kitExposure, paintsBase,
      needsDistance: layers.some(layer=>layer.type==='bevel' || layer.kit?.recipe==='crevice-moss' && layer.kit.crevices!=='joints'),
      finishBeforeFog: thin || driven || hasKits || paintsBase || layers.some(layer => layer.type === 'tint'), sun: unit(vector(lightDirection, AXES.y)),
      paletteConstraint: paletteConstraints && settings.paletteConstraint !== undefined
        ? pixelLook.prepareLookPolicy(settings.paletteConstraint, { palette, roles, blueNoise, context, validateOnly, onPaletteClip,
          skipMaskedStacks: !colorStack, skipMasks, ditherSpaceOverride }) : null,
      projected: Boolean(settings.rainRipple) || driven || weather || hasKits || layers.some(layer => layer.effect || layer.spatialMask),
      depth: layers.some(layer => layer.effect?.depth),
      reveals: layers.some(layer => layer.effect?.reveals)
    };
  }

  /* Inputs are RGB in 0..1 and a world-space sample. Output packs RGB, the opacity
     multiplier, a glint mask and, for projected paint, an optional local palette.
     Supply a normal Array when you want to retain the palette reference. */
  function shade(prepared, sample, base, output = [0, 0, 0, 1, 0], trace, visit, onClip, reflected, paint) {
    const { settings, layers } = prepared;
    const sun = sample.lightDirection ?? prepared.sun;
    const { position, normal, view } = sample;
    const origin = settings.origin || [0, 0, 0],
      scale = positive(settings.scale, 1);
    const p = position.map((v, i) => (v - origin[i]) / scale);
    const footprint = (sample.footprint || 0) / scale;
    const seed = settings.seed || 0;
    let n = unit(normal),
      t = tangent(sample.tangent ?? directionAt(settings.direction, p, n), n);
    const geometricNormal = n, geometricTangent = t;
    const normalClock = prepared.normal?.cadence ?? (prepared.normal?.type === 'rings' ? 'water' : 'scene');
    const normalTime = normalClock === 'water' ? sample.waterTime ?? sample.time ?? 0 : sample.time ?? 0;
    const geometric = bump(prepared.normal, n, t, cross(n, t), p, normalTime, footprint, seed);
    const reshape = normalClock === 'water' && sample.waterWind?.(...(sample.worldPosition ?? position));
    n = reshape ? unit(geometric.map((value,i) => value + reshape*(value-n[i])), n) : geometric;
    if (settings.rainRipple && sample.rainSlope) n = unit(n.map((value, i) => value + sample.rainSlope[i]), n);
    t = tangent(t, n);
    const b = cross(n, t),
      v = unit(view, n),
      half = unit(
        v.map((value, i) => value + sun[i]),
        n
      );
    const visibility = clamp(sample.visibility ?? 1);
    const nv = clamp(dot(n, v));
    const shading = {
      p,
      n,
      v,
      t,
      b,
      nv,
      footprint,
      seed,
      geometricNormal,
      sun,
      transmissionSun: sample.transmissionSun,
      transmissionLights: sample.transmissionLights,
      reflection: sample.reflection,
      localReflection: sample.localReflection,
      reflectionTangent: sample.reflectionTangent,
      sky: sample.sky, skyOverlay: sample.skyOverlay, skyReflectionSource: sample.skyReflectionSource,
      skyNormal: sample.skyNormal, skyView: sample.skyView, skyAccess: sample.skyAccess ?? 1,
      nt: dot(n, half),
      nl: dot(n, sun),
      light: visibility
    };
    const tx = dot(t, half),
      bx = dot(b, half),
      tv = dot(t, v),
      bv = dot(b, v);
    const tl = dot(t, sun),
      bl = dot(b, sun);
    const rgb = [0, 0, 0];
    reflected?.fill(0);
    let unlit = prepared.paintsBase;
    const shaded = unlit && output === base ? Array.from(base).slice(0,3) : base;
    const albedo = unlit && (sample.albedo ?? shaded);
    for (let i = 0; i < 3; i++) output[i] = unlit ? albedo[i] : shaded[i];
    const reapplyLight = unlit && (() => {
      if (paint) for (let i=0;i<3;i++) paint[i]=output[i];
      const lit = stages.repaint(shaded,albedo,output);
      for (let i=0;i<3;i++) output[i] = lit[i];
      unlit = false;
    });
    output[3] = settings.opacity
      ? clamp(
          mix(settings.opacity.facing ?? 1, settings.opacity.grazing ?? 1, (1 - nv) ** (settings.opacity.power ?? 3))
        )
      : 1;
    output[4] = 0;
    if (prepared.projected || output.length > 5) output[5] = undefined;
    const detailScale = sample.detailFootprint ?? sample.footprint ?? 0, stableDetail = sample.stableDetail;
    const kitFrame = prepared.hasKits && { position:p, normal:geometricNormal, seed, hash, noise, visibility,
      lambert:Math.max(0,dot(geometricNormal,sun)), reflected, exposure:sample.exposure,
      footprint:(sample.artFootprint ?? sample.footprint ?? 0)/scale/Math.max(.24,Math.abs(dot(geometricNormal,v))),
      concavity:width=>bevelCoverage(crevice,sample,geometricNormal,v,width*scale) };
    let joints = 0;
    const weatherPosition = sample.worldPosition ?? position;
    const weather = prepared.weather && sample.weather?.(weatherPosition[0], weatherPosition[2]);
    const signals = prepared.driven ? new Map() : null;
    const readSignal = signals && (signal => {
      if (!signals.has(signal)) {
        const value = signal.light ? signal.read(sample,weather,clamp(dot(geometricNormal,sun))*visibility) :
          signal.read(sample,weather);
        signals.set(signal,Number.isFinite(value) ? clamp(value) : 0);
      }
      return signals.get(signal);
    });
    let maskFrame;
    for (let layer of layers) {
      if (unlit && !basePaint(layer)) reapplyLight();
      if (typeof layer.mask === 'function' && !maskFrame) maskFrame = {
        normal: geometricNormal, tangent: geometricTangent, bitangent: cross(geometricNormal, geometricTangent),
        footprint: sample.footprint || 0, time: sample.time || 0
      };
      const maskWeight = layer.retainedMask ? layer.retainedMask(weather) :
        layer.spatialMask ? layer.spatialMask(sample) : maskAt(layer.mask, p, seed, position, maskFrame);
      if (maskWeight && layer.drive) {
        layer = { ...layer };
        for (const { key, signal, from, to } of layer.drive) {
          const amount = readSignal(signal);
          layer[key] = Array.isArray(from) ? from.map((value, i) => mix(value, to[i], amount)) : mix(from, to, amount);
        }
      }
      const strength = layer.strength * maskWeight;
      if (layer.kit) {
        joints = kits.shade(layer.kit,kitFrame,output,strength,joints,layer.shadow!==false);
        if (strength && visit) visit(layer,layer.mask ? maskWeight : null,strength,settings);
        continue;
      }
      const step = trace && layer.effect && { layer: layer.id, type: layer.type, ...(unlit && { stage:'material' }),
        ...(layer.stack?.name && { stack: layer.stack.name }), maskWeight, input: output.slice(0, 3) };
      if (step) trace.push(step);
      if (!strength) {
        if (step) Object.assign(step, { applied: false, effectiveWeight: 0, output: step.input });
        continue;
      }
      if (layer.effect) {
        const result = layer.effect.sample(sample, output, layer, readSignal);
        const size = layer.detailSize ?? layer.effect.detailSize;
        const detailGain = stableDetail?.texture && size && detailScale ?
          detail.weight(stableDetail.texture,size/detailScale) : 1;
        const amount = clamp(result[3] * strength) * detailGain;
        if (!amount && layer.type === 'colorCurve') {
          if (step) Object.assign(step, { applied: false, effectiveWeight: 0, output: step.input });
          continue;
        }
        output[3] *= mix(1, clamp(result[4]), strength);
        output[4] = Math.max(output[4], clamp(result[5] * strength) * detailGain);
        if (!unlit && amount >= 0.5) output[5] = layer.effect.paletteAt?.(sample.time ?? 0) ?? layer.effect.palette;
        let clipped;
        for (let i = 0; i < 3; i++) {
          const next = layer.blend === 'add' ? output[i] + result[i] :
            layer.blend === 'multiply' ? output[i] * result[i] : result[i];
          const value = mix(output[i], next, amount);
          if (onClip && (value < 0 || value > 1)) (clipped ??= [0, 0, 0])[i] = value;
          output[i] = clamp(value);
          if (reflected && layer.blend !== 'add') reflected[i] *= mix(1, layer.blend === 'multiply' ? result[i] : 0, amount);
        }
        if (clipped) onClip(...clipped);
        if (step) Object.assign(step, { applied: amount > 0, effectiveWeight: amount, output: output.slice(0, 3) });
        if (amount && visit) visit(layer, layer.mask ? maskWeight : null, amount, settings);
        continue;
      }
      const { cosine: c, sine: s } = layer;
      shading.ht = tx * c + bx * s;
      shading.hb = bx * c - tx * s;
      shading.vt = tv * c + bv * s;
      shading.vb = bv * c - tv * s;
      shading.lt = tl * c + bl * s;
      shading.lb = bl * c - tl * s;
      shading.light = layer.shadow === false ? 1 : visibility;
      for (let i = 0; i < 3; i++) rgb[i] = layer.color[i];
      let response = layer.model(layer, shading, rgb);
      if (layer.lightingRamp) {
        const level = clamp(response);
        layer.lightingRamp.tint(level, rgb);
        response = layer.lightingRamp.amount ? layer.lightingRamp.amount(level) : layer.type === 'diffuse' ? 1 : level;
      }
      if (layer.type === 'bevel') {
        if (!response) continue;
        response *= bevelCoverage(layer, sample, geometricNormal, v);
      }
      const weight = clamp(response * strength);
      const spark = layer.type === 'glints';
      const size = layer.detailSize ?? (spark ? 2 * clamp(layer.radius ?? .37) * positive(layer.scale,.12) * scale : 0);
      const range = stableDetail && (specularLayers.has(layer.type) ? stableDetail.specular : stableDetail.texture);
      const detailGain = range && size && detailScale ? detail.weight(range,size/detailScale) : 1;
      if (spark) output[4] = Math.max(output[4], weight * detailGain);
      const steps = layer.steps ?? settings.steps ?? 0;
      const amount = (steps > 1 ? Math.round(weight * steps) / steps : weight) * detailGain;
      if (layer.type === 'transmission') {
        if (!amount) continue;
        toLinear(output, output);
        for (let i = 0; i < 3; i++) output[i] += rgb[i] * amount;
        toDisplay(output, output);
        continue;
      }
      for (let i = 0; i < 3; i++) output[i] = mix(output[i], rgb[i], amount);
      if (reflected && amount) {
        const reflection = layer.type === 'reflection' || layer.type === 'planarReflection' || layer.type === 'localReflection';
        for (let i = 0; i < 3; i++) reflected[i] = mix(reflected[i], reflection ? rgb[i] : 0, amount);
      }
    }
    if (prepared.paletteConstraint) output[5] = prepared.paletteConstraint.swatches;
    if (unlit) reapplyLight();
    return output;
  }

  return { basePaint, STRIDE, hasBevel, needsDistance, material, merge, prepare, shade, prepareLightTrack, lightRamps, withLightRamps };
})();
if (typeof module !== 'undefined') module.exports = SurfaceLook;
