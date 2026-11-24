/* Bounded post effects on the native art grid. All inputs use top-down rows. */
const ArtEffects = (() => {
  const channels = Object.freeze(['depth', 'materialId', 'emission', 'emissionDepth']);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const modulo = (x, n) => ((x % n) + n) % n;
  const strength = (rgb, p) => Math.max(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
  const packed = (rgb, p) => (rgb[p * 3] << 16) | (rgb[p * 3 + 1] << 8) | rgb[p * 3 + 2];
  function write(rgb, p, color) {
    rgb[p * 3] = color >> 16;
    rgb[p * 3 + 1] = (color >> 8) & 255;
    rgb[p * 3 + 2] = color & 255;
  }

  function numeric(value, lo, hi, name, integer = false) {
    if (!Number.isFinite(value) || value < lo || value > hi || (integer && !Number.isSafeInteger(value)))
      throw new RangeError(name + ' must be in [' + lo + ', ' + hi + ']');
    return value;
  }

  function colors(values, palette) {
    if (!Array.isArray(values) || !values.length || values.length > 64)
      throw new RangeError('Effect palettes need between one and 64 colors');
    return values.map(value => {
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return parseInt(value.slice(1), 16);
      return palette[numeric(value, 0, palette.length - 1, 'Effect color index', true)];
    });
  }

  function timing(value) {
    return { rate: numeric(value.rate ?? 0, 0, 240, 'Effect rate'),
      phase: numeric(value.phase ?? 0, -1e6, 1e6, 'Effect phase') };
  }

  function paletteLayer(value, palette, fallback) {
    return { ...timing(value), colors: colors(value.colors || fallback, palette),
      threshold: numeric(value.threshold ?? .18, 0, 1, 'Emission threshold') };
  }

  function prepare(definition, palette) {
    if (!definition) return null;
    const options = definition === true ? { glow: true } : definition;
    if (typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Expected art effects options');
    const { glow, heat, emitter, reflection, cycle, trail, smear } = options;
    if (![glow, heat, emitter, reflection, cycle, trail, smear].some(Boolean)) return null;
    const halo = glow && {
      ...paletteLayer(glow, palette, ['#683327', '#aa6743']),
      radius: numeric(glow.radius ?? 2, 1, 6, 'Glow radius', true),
      bands: numeric(glow.bands ?? 2, 1, 2, 'Glow bands', true),
      depthBias: numeric(glow.depthBias ?? .06, 0, 100, 'Glow depth bias')
    };
    const haze = heat && {
      ...timing({ rate: heat.rate ?? 4, phase: heat.phase }),
      radius: numeric(heat.radius ?? 6, 1, 12, 'Heat radius', true),
      up: numeric(heat.up ?? 4, 0, 24, 'Heat rise', true),
      pixels: numeric(heat.pixels ?? 1, 1, 4, 'Heat displacement', true),
      threshold: numeric(heat.threshold ?? .18, 0, 1, 'Heat emission threshold'),
      depthBias: numeric(heat.depthBias ?? .06, 0, 100, 'Heat depth bias')
    };
    const feedback = (value, defaults) => value && {
      ...paletteLayer(value, palette, defaults),
      frames: numeric(value.frames ?? 4, 1, 24, 'Feedback frames', true),
      duration: numeric(value.duration ?? .4, .001, 5, 'Feedback duration'),
      steps: numeric(value.steps ?? 4, 1, 12, 'Smear steps', true),
      reach: numeric(value.reach ?? 16, 1, 64, 'Smear reach', true),
      depthBias: numeric(value.depthBias ?? .08, 0, 100, 'Feedback depth bias')
    };
    const cycles = cycle ? (Array.isArray(cycle) ? cycle : [cycle]).map(rule => ({
      ...timing({ rate: rule.rate ?? 6, phase: rule.phase }),
      colors: colors(rule.colors, palette),
      material: rule.material === undefined ? null : String(rule.material)
    })) : [];
    return { halo, haze, cycles, emitter: emitter && paletteLayer(emitter, palette, ['#ecad60', '#fff2c7']),
      reflection: reflection && paletteLayer(reflection, palette, ['#895b54', '#e0b579']),
      trail: feedback(trail, ['#32243a', '#74395a']), smear: feedback(smear, ['#724563', '#de8c78']) };
  }

  function phase(layer, time) {
    return Math.floor(time * layer.rate + layer.phase);
  }
  function ranked(layer, value, time) {
    const rank = Math.min(layer.colors.length - 1, Math.max(0, Math.floor(value * layer.colors.length)));
    return layer.colors[modulo(rank + phase(layer, time), layer.colors.length)];
  }

  function history({ frames = 12 } = {}) {
    numeric(frames, 1, 24, 'History frames', true);
    const items = [];
    return {
      push(frame) {
        const last = items.at(-1);
        if (last && (frame.time < last.time || frame.w !== last.w || frame.h !== last.h ||
            frame.world !== last.world)) items.length = 0;
        if (items.at(-1)?.time === frame.time) items.pop();
        items.push(frame);
        if (items.length > frames) items.shift();
      },
      previous(time, w, h, world) {
        return items.filter(frame => frame.time < time && frame.w === w && frame.h === h && frame.world === world);
      },
      clear() { items.length = 0; }
    };
  }

  function walkSources(passes, threshold, visit) {
    const { w, h, emission, emissionDepth } = passes;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, intensity = strength(emission, p);
      if (intensity > threshold && Number.isFinite(emissionDepth[p])) visit(x, y, intensity, emissionDepth[p], p);
    }
  }

  function sourceSpread(passes, layer, up = 0, sourceAllowed) {
    const { w, h, depth } = passes, radius = layer.radius;
    const scores = new Float32Array(w * h);
    const sourceDepth = new Float32Array(w * h).fill(Infinity);
    const rings = new Uint8Array(w * h);
    walkSources(passes, layer.threshold, (x, y, intensity, z, p) => {
      if (sourceAllowed && !sourceAllowed(p)) return;
      for (let v = -radius - up; v <= radius; v++) {
        const row = y + v;
        if (row < 0 || row >= h) continue;
        for (let u = -radius; u <= radius; u++) {
          const column = x + u, distance = Math.max(Math.abs(u), Math.abs(v + up));
          if (column < 0 || column >= w || distance > radius) continue;
          const p = row * w + column;
          if (depth[p] + layer.depthBias < z) continue;
          const score = intensity / (1 + distance);
          if (score <= scores[p]) continue;
          scores[p] = score;
          sourceDepth[p] = z;
          rings[p] = distance;
        }
      }
    });
    return { scores, sourceDepth, rings };
  }

  function apply(frame, passes, settings, time, context = {}) {
    const { w, h, rgb, alpha } = frame, { depth, emission, emissionDepth, materialId, materials } = passes;
    const { halo, haze, emitter, cycles, trail, smear } = settings;
    const size = w * h, mask = new Uint8Array(size);
    const earlier = context.history && (trail || smear) ? context.history.previous(time, w, h, context.world) : [];
    if (trail || smear) {
      const visible = new Float32Array(size);
      const put = (x, y, z, value, layer, age) => {
        if (x < 0 || x >= w || y < 0 || y >= h) return;
        const p = y * w + x;
        if (strength(emission, p) > .16 || depth[p] + layer.depthBias < z) return;
        const weight = value * (1 - age);
        if (weight <= visible[p]) return;
        visible[p] = weight;
        mask[p] = 3;
        if (alpha) alpha[p] = Math.max(alpha[p], Math.round(clamp(weight, 0, 1) * 255));
        write(rgb, p, ranked(layer, weight, time));
      };
      if (trail) for (const prior of earlier.slice(-trail.frames)) {
        const age = (time - prior.time) / trail.duration;
        if (age >= 1) continue;
        walkSources(prior.passes, trail.threshold, (x, y, v, z) => put(x, y, z, v, trail, age));
      }
      if (smear && earlier.length) {
        const last = earlier[Math.max(0, earlier.length - smear.frames)];
        const age = (time - last.time) / smear.duration;
        if (age < 1) walkSources(passes, smear.threshold, (x, y, v, z, p) => {
          const dx = passes.emissionMotion?.[p * 2] || 0, dy = passes.emissionMotion?.[p * 2 + 1] || 0;
          const length = Math.hypot(dx, dy);
          if (length < 1 || length > smear.reach) return;
          for (let step = 1; step <= smear.steps; step++) {
            const k = step / smear.steps;
            put(Math.round(x - dx * k), Math.round(y - dy * k), z, v, smear, age + (1 - age) * k * .65);
          }
        });
      }
      context.history?.push({ time, w, h, passes: { w, h, emission, emissionDepth },
        motionReference: context.motionReference, world: context.world });
    }
    if (haze) {
      const spread = sourceSpread(passes, haze, haze.up), source = rgb.slice(), tick = phase(haze, time);
      for (let p = 0; p < size; p++) {
        if (!spread.scores[p] || strength(emission, p) >= haze.threshold) continue;
        const y = Math.floor(p / w), x = p % w;
        const shift = Math.round(Math.sin(y * .71 + x * .39 + tick * 1.27) * haze.pixels);
        const q = y * w + clamp(x + shift, 0, w - 1);
        if (q === p || depth[q] + haze.depthBias < spread.sourceDepth[p]) continue;
        write(rgb, p, packed(source, q));
        mask[p] = 2;
      }
    }
    if (halo) {
      const spread = sourceSpread(passes, halo, 0, context.haloSource);
      for (let p = 0; p < size; p++) {
        if (!spread.scores[p] || strength(emission, p) >= halo.threshold) continue;
        const band = Math.min(halo.bands - 1, Math.floor((spread.rings[p] - 1) * halo.bands / halo.radius));
        const level = (halo.bands - Math.max(0, band) - .5) / halo.bands;
        const color = ranked(halo, level, time);
        write(rgb, p, color);
        if (alpha) alpha[p] = Math.max(alpha[p], Math.round((.2 + level * .46) * 255));
        mask[p] = 1;
      }
    }
    if (emitter) walkSources(passes, emitter.threshold, (x, y, amount, z, p) => {
      write(rgb, p, ranked(emitter, amount, time));
      mask[p] = 4;
    });
    for (const rule of cycles) {
      const shift = phase(rule, time), indices = new Map(rule.colors.map((value, i) => [value, i]));
      if (!shift) continue;
      for (let p = 0; p < size; p++) {
        if (mask[p] || (rule.material !== null && String(materials[materialId[p]] ?? materialId[p]) !== rule.material)) continue;
        const i = indices.get(packed(rgb, p));
        if (i === undefined) continue;
        const color = rule.colors[modulo(i + shift, rule.colors.length)];
        write(rgb, p, color);
        mask[p] = 5;
      }
    }
    return paletteUse({ ...frame, effectsMask: mask }, context.palette);
  }

  function paletteUse(frame, fallback) {
    const palette = Array.from(frame.palette ?? fallback);
    const counts = new Map(palette.map(color => [color, 0]));
    for (let p = 0; p < frame.w * frame.h; p++) {
      const color = packed(frame.rgb, p);
      counts.set(color, (counts.get(color) || 0) + 1);
    }
    return { ...frame, palette: Array.from(counts.keys()), use: Uint32Array.from(counts.values()) };
  }

  function tintReflection(rgb, coverage, emission, w, h, layer, time) {
    for (let p = 0; p < w * h; p++) {
      if (strength(emission, p) <= layer.threshold) continue;
      const q = (h - 1 - Math.floor(p / w)) * w + p % w;
      const color = ranked(layer, strength(emission, p), time);
      rgb[q * 3] = (color >> 16) / 255 * coverage[q];
      rgb[q * 3 + 1] = ((color >> 8) & 255) / 255 * coverage[q];
      rgb[q * 3 + 2] = (color & 255) / 255 * coverage[q];
    }
  }

  return Object.freeze({ prepare, apply, history, channels, tintReflection, paletteUse });
})();
if (typeof module !== 'undefined') module.exports = ArtEffects;
