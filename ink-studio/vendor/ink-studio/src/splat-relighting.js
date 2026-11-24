/* Relative illumination applied to finished surface colors, including authored detail. */
const SplatRelighting = (() => {
  const Target = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const Celestial = typeof CelestialTracks === 'undefined' ? require('./celestial-tracks.js') : CelestialTracks;
  const white = [1, 1, 1];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const vector = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const record = v => v && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const fields = (v, keys, label) => {
    if (!record(v) || Object.keys(v).some(k => !keys.includes(k))) throw new TypeError('Invalid ' + label + ' settings');
  };
  function range(value, lo, hi, label) {
    if (!Number.isFinite(value) || value < lo || value > hi) throw new RangeError(label + ' must be in ' + lo + '..' + hi);
    return value;
  }
  function tint(value = '#ffffff') {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
      throw new TypeError('A relight color needs #rrggbb');
    return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  }
  function directional(raw) {
    if (raw === false || raw === 'environment') return raw;
    fields(raw, ['direction', 'color', 'intensity'], 'relight sun');
    const { direction, color, intensity = 1 } = raw;
    const length = vector(direction) && Math.hypot(...direction);
    if (!(length > 1e-8 && Number.isFinite(length))) throw new TypeError('A relight sun needs a nonzero XYZ direction');
    return { direction: direction.map(n => n / length), color: tint(color), intensity: range(intensity, 0, 8, 'Sun intensity') };
  }
  function point(raw) {
    fields(raw, ['at', 'range', 'color', 'intensity', 'enabled', 'select'], 'point light');
    const { at, range: reach = 4, color, intensity = 1, enabled = true, select } = raw;
    if (!vector(at) || typeof enabled !== 'boolean') throw new TypeError('A point light needs XYZ and a boolean enabled flag');
    range(reach, .001, 1024, 'Point light range');
    return { at, reach, reach2: reach * reach, color: tint(color),
      intensity: range(intensity, 0, 8, 'Point light intensity'), enabled,
      select: select === undefined ? undefined : Target.prepare(select) };
  }
  function definition(input) {
    if (input === undefined || input === false || input === true) return {};
    fields(input, ['ambient', 'sun', 'referenceTime', 'strength', 'lights', 'select'], 'splat relighting');
    if (input.lights !== undefined && !record(input.lights)) throw new TypeError('Relight lights need a table of named lights');
    return input;
  }

  function settings(authored, override) {
    if (override === false || override === undefined && (authored === undefined || authored === false)) return null;
    const base = definition(authored), update = definition(override);
    const { ambient = .45, sun = 'environment', referenceTime = 0, strength = 1, select } = { ...base, ...update };
    const lights = new Map(Object.entries(base.lights ?? {}));
    for (const [id, patch] of Object.entries(update.lights ?? {})) {
      if (patch === null) lights.delete(id);
      else {
        if (!record(patch)) throw new TypeError('Point light edits need a settings object or null');
        lights.set(id, { ...lights.get(id), ...patch });
      }
    }
    if (lights.size > 32) throw new RangeError('A relight rig supports up to 32 point lights');
    const lamps = [];
    for (const [id, raw] of lights) {
      if (!Target.name(id)) throw new TypeError('A point light needs a name');
      const light = point(raw);
      if (light.enabled && light.intensity) lamps.push(light);
    }
    return { ambient: range(ambient, .02, 4, 'Relight ambient'), sun: directional(sun),
      referenceAmbient: range(base.ambient ?? .45, .02, 4, 'Reference ambient'),
      referenceSun: directional(base.sun ?? 'environment'), lamps,
      referenceTime: range(referenceTime, -1e9, 1e9, 'Relight reference time'),
      strength: range(strength, 0, 1, 'Relight strength'),
      select: select === undefined ? undefined : Target.prepare(select) };
  }

  function environmentSun(clock, celestial, time, profiles) {
    const tracks = celestial?.frame(time);
    if (tracks?.sun) return { direction: tracks.sun.direction, color: tracks.sun.color ?? white, intensity: tracks.sun.gain };
    if (tracks?.replacesSun) return null;
    const sampled = clock?.frame(time, profiles), sky = sampled?.sky;
    return sky && { direction: sky.sun, color: sky.sunColor, intensity: (sampled.parameters.daylight ?? 1) * sky.sunStrength };
  }

  function frame(world, options, timeline) {
    const config = settings(world.relighting, options.relighting);
    if (!config?.strength) return null;
    const tracks = config.sun === 'environment' || config.referenceSun === 'environment' ?
      Celestial.settings(world.celestialTracks, options.celestialTracks) : null;
    const at = time => environmentSun(timeline?.clock, tracks, time, options.skyProfiles);
    const sun = config.sun === 'environment' ? at(timeline?.skyTime ?? 0) : config.sun;
    const reference = config.referenceSun === 'environment' ? at(config.referenceTime) : config.referenceSun;
    const same = !sun?.intensity && !reference?.intensity ||
      sun?.intensity === reference?.intensity && sun.direction.every((v, i) => v === reference.direction[i]) &&
      sun.color.every((v, i) => v === reference.color[i]);
    if (same && config.ambient === config.referenceAmbient && !config.lamps.length) return null;
    return { ...config, sun, reference };
  }

  function rows(world, rig, sample, pose, output) {
    if (!rig || !world.count) return null;
    const table = output?.length === world.count * 4 ? output : new Float32Array(world.count * 4);
    table.fill(0);
    const { data, count } = world, { lamps, sun, reference, strength } = rig;
    const index = rig.select || lamps.some(light => light.select) ? Target.index(world) : null;
    const local = [0, 0, 0];
    let active = false;
    for (let i = 0; i < count; i++) {
      const q = i * 16, p = i * 4, target = index?.row(i);
      if ((pose?.alpha[i] ?? data[q + 3]) <= 0 || (Math.round(data[q + 11]) & (32 | 64 | 256)) ||
          rig.select && !Target.matches(rig.select, target)) continue;
      const { normal, position } = sample(i);
      if (!normal) continue;
      const [x, y, z] = pose ? [pose.x[i], pose.y[i], pose.z[i]] : position();
      if (y < -30) continue;
      const direct = sun ? Math.max(0, dot(normal, sun.direction)) * sun.intensity : 0;
      const baked = reference ? Math.max(0, dot(normal, reference.direction)) * reference.intensity : 0;
      local.fill(0);
      for (const light of lamps) {
        if (light.select && !Target.matches(light.select, target)) continue;
        const dx = light.at[0] - x, dy = light.at[1] - y, dz = light.at[2] - z;
        const distance2 = dx * dx + dy * dy + dz * dz;
        if (distance2 >= light.reach2) continue;
        const distance = Math.sqrt(distance2);
        const facing = distance < 1e-7 ? 1 : Math.max(0, (normal[0] * dx + normal[1] * dy + normal[2] * dz) / distance);
        const gain = (1 - distance / light.reach) ** 2 * facing * light.intensity;
        for (let k = 0; k < 3; k++) local[k] += gain * light.color[k];
      }
      let changed = false;
      for (let k = 0; k < 3; k++) {
        const before = rig.referenceAmbient + baked * (reference?.color[k] ?? 1);
        const after = rig.ambient + direct * (sun?.color[k] ?? 1) + local[k];
        const factor = 1 + strength * (clamp(Math.sqrt(after / before), 0, 4) - 1);
        table[p + k] = factor;
        changed ||= Math.abs(factor - 1) > 1e-6;
      }
      if (changed) table[p + 3] = 1;
      active ||= changed;
    }
    return active ? table : null;
  }

  return Object.freeze({ settings, frame, rows });
})();
if (typeof module !== 'undefined') module.exports = SplatRelighting;
