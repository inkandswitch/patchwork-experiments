/* Ordered color operations for palette resolve and lit surface samples. */
const ColorStack = (() => {
  let curves, luts, spaces;
  try {
    curves = ColorCurves;
    luts = ColorLUT;
    spaces = ColorSpace;
  } catch {
    curves = require('./color-curves.js');
    luts = require('./color-lut.js');
    spaces = require('./color-space.js');
  }
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const vector = row => Array.isArray(row) && row.length === 3 && Array.from(row).every(Number.isFinite);
  const copy = (from, to) => { for (let i = 0; i < 3; i++) to[i] = from[i]; };
  const fields = {
    exposure: ['stops'], contrast: ['factor', 'pivot'], saturation: ['factor'],
    hue: ['degrees'], channelMix: ['matrix', 'offset'], curves: ['curves'],
    lut: ['lut'], paletteRemap: ['remap']
  };

  function validateStack(definition, depth = 0) {
    if (!record(definition) || Object.keys(definition).some(key => !['name', 'steps', 'amount', 'baked'].includes(key)) ||
        typeof definition.name !== 'string' || !definition.name.trim() ||
        !Array.isArray(definition.steps) || definition.steps.length > 64)
      throw new TypeError('A color stack needs a name and an array of up to 64 steps');
    if (definition.amount !== undefined && !unit(definition.amount))
      throw new RangeError('Color stack amount must be in [0, 1]');
    if (definition.baked !== undefined) {
      const { baked, steps: [step] } = definition;
      if (depth >= 8 || !record(baked) || Object.keys(baked).some(key => !['source', 'palette', 'roles', 'error'].includes(key)) ||
          definition.steps.length !== 1 || !['lut', 'paletteRemap'].includes(step?.type) ||
          step.enabled === false || (step.amount ?? 1) !== 1)
        throw new TypeError('A baked color stack needs one compiled step and an editable source');
      if (step.type === 'paletteRemap' ? !Array.isArray(baked.palette) || !baked.palette.length ||
          baked.palette.length > 48 || !Array.from(baked.palette).every(color => Number.isSafeInteger(color) && color >= 0 && color <= 0xffffff)
        : baked.palette !== undefined || baked.roles !== undefined)
        throw new TypeError('A baked palette needs up to 48 ordered RGB swatches');
      if (baked.roles !== undefined && (!record(baked.roles) || !Object.values(baked.roles).every(indices =>
        Array.isArray(indices) && indices.length && Array.from(indices).every(i =>
          Number.isSafeInteger(i) && i >= 0 && i < baked.palette.length))))
        throw new TypeError('Baked palette roles must reference the ordered swatches');
      if (!record(baked.error) || !['exact', 'sampled'].includes(baked.error.mode) ||
          !['maxChannelError', 'rmse'].every(key => Number.isFinite(baked.error[key]) && baked.error[key] >= 0))
        throw new TypeError('A baked color stack needs finite approximation metrics');
      validateStack(baked.source, depth + 1);
    }
    const ids = new Set();
    for (const step of definition.steps) {
      if (!record(step) || typeof step.type !== 'string' || !Object.hasOwn(fields, step.type))
        throw new TypeError('Unknown color stack operation: ' + step?.type);
      const allowed = fields[step.type];
      if (Object.keys(step).some(key => !allowed.includes(key) && !['type', 'id', 'amount', 'enabled', 'color'].includes(key)))
        throw new TypeError('Unknown property on a ' + step.type + ' color step');
      if (step.id !== undefined) {
        if (typeof step.id !== 'string' || !step.id.trim() || ids.has(step.id))
          throw new TypeError('Color stack step IDs must be distinct nonempty strings');
        ids.add(step.id);
      }
      if ((step.amount !== undefined && !unit(step.amount)) ||
          (step.enabled !== undefined && typeof step.enabled !== 'boolean'))
        throw new TypeError('Color stack steps need an amount in [0, 1] and a boolean enabled');
    }
  }

  function normalize(definition) {
    if (definition === undefined || definition === false) return definition;
    validateStack(definition);
    return { ...definition, steps: definition.steps.map(step =>
      step.type === 'lut' ? { ...step, lut: luts.normalize(step.lut) } : step),
      ...(definition.baked && { baked: { ...definition.baked, source: normalize(definition.baked.source) } }) };
  }

  function hue({ degrees }) {
    if (!Number.isFinite(degrees)) throw new TypeError('Hue rotation needs degrees');
    const shift = (degrees % 360) / 60;
    if (!shift) return copy;
    return (rgb, out) => {
      const [r, g, b] = rgb, max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
      if (!chroma) { copy(rgb, out); return; }
      const h = max === r ? (g - b) / chroma : max === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma;
      const rotation = ((h + shift) % 6 + 6) % 6;
      const middle = chroma * (1 - Math.abs(rotation % 2 - 1));
      const sector = Math.floor(rotation);
      out[0] = min + (sector === 0 || sector === 5 ? chroma : sector === 1 || sector === 4 ? middle : 0);
      out[1] = min + (sector === 1 || sector === 2 ? chroma : sector === 0 || sector === 3 ? middle : 0);
      out[2] = min + (sector === 3 || sector === 4 ? chroma : sector === 2 || sector === 5 ? middle : 0);
    };
  }

  function channelMix({ matrix, offset = [0, 0, 0] }) {
    if (!Array.isArray(matrix) || matrix.length !== 3 || !Array.from(matrix).every(vector) || !vector(offset))
      throw new TypeError('Channel mixing needs a finite 3×3 matrix and optional RGB offset');
    const rows = matrix.map(row => row.slice()), shifts = offset.slice();
    return (rgb, out) => {
      for (let i = 0; i < 3; i++) {
        const [r, g, b] = rows[i];
        out[i] = r * rgb[0] + g * rgb[1] + b * rgb[2] + shifts[i];
      }
    };
  }

  function transfer(step, resolveColor) {
    const { type, factor, pivot = .5 } = step;
    switch (type) {
      case 'exposure': {
        if (!Number.isFinite(step.stops)) throw new RangeError('Exposure needs finite stops');
        const gain = 2 ** step.stops;
        if (!Number.isFinite(gain)) throw new RangeError('Exposure gain must be finite');
        return (rgb, out) => { for (let i = 0; i < 3; i++) out[i] = rgb[i] * gain; };
      }
      case 'contrast':
      case 'saturation': {
        if (!Number.isFinite(factor) || factor < 0 || (type === 'contrast' && !unit(pivot)))
          throw new RangeError(type + ' needs a nonnegative factor and contrast pivot in [0, 1]');
        if (factor === 1) return copy;
        return (rgb, out) => {
          const center = type === 'contrast' ? pivot : .30 * rgb[0] + .55 * rgb[1] + .15 * rgb[2];
          for (let i = 0; i < 3; i++) out[i] = center + (rgb[i] - center) * factor;
        };
      }
      case 'hue': return hue(step);
      case 'channelMix': return channelMix(step);
      case 'curves': {
        const plan = curves.prepare(step.curves, resolveColor, step.color);
        if (!plan) throw new TypeError('A curves step needs a color transfer');
        return plan;
      }
      case 'lut': {
        const plan = luts.prepare(step.lut);
        return step.color === undefined ? plan.apply : spaces.wrap(plan.sample, step.color);
      }
    }
  }

  const same = (actual, expected) => actual?.length === expected.length && expected.every((n, i) => actual[i] === n);
  function prepare(definition, options = {}) {
    if (definition === undefined || definition === false) return null;
    validateStack(definition);
    const { paletteRemap, resolveColor, palette, roles } = options;
    const steps = [], locks = [];
    const strength = definition.amount ?? 1;
    const { baked } = definition;
    let sampleFallback, inDomain;
    if (baked) {
      let sourcePlan;
      const source = () => sourcePlan ??= prepare({ ...baked.source, amount: (baked.source.amount ?? 1) * strength }, options);
      if (baked.palette) {
        if (!same(palette, baked.palette) || !Object.entries(baked.roles ?? {}).every(([key, ramp]) => same(roles?.[key], ramp)))
          return source();
        inDomain = (rgb, index) => {
          const color = baked.palette[index];
          return color !== undefined && rgb[0] === (color >> 16) / 255 &&
            rgb[1] === (color >> 8 & 255) / 255 && rgb[2] === (color & 255) / 255;
        };
      } else {
        const { domainMin, domainMax } = luts.normalize(definition.steps[0].lut);
        inDomain = rgb => rgb[0] >= domainMin[0] && rgb[0] <= domainMax[0] &&
          rgb[1] >= domainMin[1] && rgb[1] <= domainMax[1] && rgb[2] >= domainMin[2] && rgb[2] <= domainMax[2];
      }
      sampleFallback = (rgb, out, index) => source().sample(rgb, out, index);
    }
    let indexed = false;
    for (const step of definition.steps) {
      const amount = step.amount ?? 1, active = strength !== 0 && step.enabled !== false && amount !== 0;
      if (step.type === 'paletteRemap') {
        if (!paletteRemap) throw new TypeError('Palette remap steps require a scene palette');
        const plan = paletteRemap(step.remap, step.color);
        if (!plan) throw new TypeError('A palette remap step needs a remap definition');
        if (active) {
          indexed = true;
          locks.push(plan);
          steps.push({ amount, run(rgb, out, index) { copy(plan.target(index, rgb) ?? rgb, out); } });
        }
      } else {
        const op = transfer(step, resolveColor);
        const run = step.type === 'curves' || step.type === 'lut' ? op : spaces.wrap(op, step.color, { normalized: true });
        if (active) steps.push({ amount, run: (rgb, out) => run(rgb, out) });
      }
    }
    const changed = [0, 0, 0];
    const protectedBy = index => locks.find(plan => plan.protects(index));
    return Object.freeze({
      name: definition.name,
      requiresIndex: indexed,
      protects: index => Boolean(protectedBy(index)),
      sample(rgb, out = [0, 0, 0], index) {
        if (!rgb || !Number.isFinite(rgb[0]) || !Number.isFinite(rgb[1]) || !Number.isFinite(rgb[2]))
          throw new TypeError('A color stack needs finite RGB input');
        if (indexed && (!Number.isSafeInteger(index) || index < 0))
          throw new TypeError('This color stack needs a palette index');
        if (inDomain && !inDomain(rgb, index)) return sampleFallback(rgb, out, index);
        const locked = protectedBy(index);
        if (locked) { copy(locked.target(index), out); return out; }
        const r = rgb[0], g = rgb[1], b = rgb[2];
        copy(rgb, out);
        for (const { amount, run } of steps) {
          run(out, changed, index);
          for (let i = 0; i < 3; i++) {
            if (!Number.isFinite(changed[i])) throw new RangeError('A color stack step produced nonfinite RGB');
            out[i] = amount === 1 ? changed[i] : out[i] * (1 - amount) + changed[i] * amount;
          }
        }
        if (strength !== 1 && steps.length) {
          out[0] = r * (1 - strength) + out[0] * strength;
          out[1] = g * (1 - strength) + out[1] * strength;
          out[2] = b * (1 - strength) + out[2] * strength;
        }
        return out;
      }
    });
  }

  return Object.freeze({ normalize, prepare });
})();
if (typeof module !== 'undefined') module.exports = ColorStack;
