/* Color operations ordered by their place in the render pipeline. */
const RenderStages = (() => {
  const stability = typeof ArtStability === 'undefined' ? require('./art-stability.js') : ArtStability;
  let stacks, space, pixels, targets, effects, inputs;
  try {
    stacks = ColorStack;
    space = ColorSpace;
    pixels = PixelLook;
    targets = TargetSelectors;
    effects = SplatEffects;
    inputs = LookInputs;
  } catch {
    stacks = require('./color-stack.js');
    space = require('./color-space.js');
    pixels = require('./pixel-look.js');
    targets = require('./target-selectors.js');
    effects = require('./splat-effects.js');
    inputs = require('./look-inputs.js');
  }
  const names = Object.freeze(['material', 'lit', 'frame', 'palette']);
  const linear = space.prepare('srgb', 'srgb-linear'), encode = space.prepare('srgb-linear', 'srgb');
  const unpack = n => [n >> 16, n >> 8 & 255, n & 255].map(value => value / 255);
  const luma = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  const byte = n => Math.round(Math.max(0, Math.min(1, n)) * 255);
  const pack = rgb => byte(rgb[0]) * 65536 + byte(rgb[1]) * 256 + byte(rgb[2]);

  function stage(value) {
    if (!names.includes(value)) throw new RangeError('Render stage must be material, lit, frame or palette');
    return value;
  }

  function blend({ order = 0, weight = 1 } = {}) {
    if (!Number.isSafeInteger(order)) throw new TypeError('Look order must be a safe integer');
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError('Look weight must be in [0, 1]');
    return { order, weight };
  }

  function albedo(value, palette, roles) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return parseInt(value.slice(1), 16);
    if (Array.isArray(value) && value.length === 3 && Array.from(value).every(n => Number.isFinite(n) && n >= 0 && n <= 1))
      return pack(value);
    if (Number.isSafeInteger(value) && value >= 0 && Number.isSafeInteger(palette?.[value])) return palette[value];
    if (typeof value === 'string' && value && !value.startsWith('#') && palette)
      return pixels.roleColor(value, palette, roles);
    throw new TypeError('Material albedo must be a palette role, palette index, #rrggbb or normalized RGB triple');
  }

  function prepare(entries, options = {}) {
    if (entries === undefined || entries === false) return [];
    if (!Array.isArray(entries) || entries.length > 64) throw new TypeError('Expected up to 64 render stage rules');
    return Array.from(entries, (entry, i) => {
      if (!entry || Object.getPrototypeOf(entry) !== Object.prototype ||
          Object.keys(entry).some(key => !['stage', 'stack', 'palette', 'select', 'mask', 'assetId', 'order', 'weight', 'driver'].includes(key)))
        throw new TypeError('Invalid render stage rule at index ' + i);
      const name = stage(entry.stage), usePalette = entry.palette !== undefined;
      const sampled = entry.driver && !options.validateOnly && inputs.resolve(entry.driver, options.lookInputs);
      const { order, weight } = blend(entry);
      const strengthWeight = usePalette && entry.driver?.inputs?.strength !== undefined ? sampled?.strength ?? entry.driver.strength : 1;
      if (sampled) entry = { ...entry, ...(usePalette ? { palette: sampled.palette } : { stack: sampled.stack }), mask: sampled.mask };
      if (options.optical && entry.mask) throw new TypeError('Optical look inputs need a uniform binding');
      if (usePalette ? !entry.palette || entry.stack !== undefined : !entry.stack || name === 'palette')
        throw new TypeError(name === 'palette' ? 'The palette stage needs a palette policy' :
          'A render stage needs one color stack or palette policy');
      if (!usePalette && Object.getPrototypeOf(entry.stack) !== Object.prototype)
        throw new TypeError('A render stage color stack must be an object');
      if (Array.isArray(entry.stack?.steps) && entry.stack.steps.some(step => step?.type === 'paletteRemap'))
        throw new TypeError('Render stage stacks operate on RGB and require RGB color transforms');
      if (usePalette && entry.palette.source !== undefined)
        throw new TypeError('A stage palette samples the RGB entering its stage');
      const { amount: stackAmount = 1 } = entry.stack ?? {};
      if (!Number.isFinite(stackAmount) || stackAmount < 0 || stackAmount > 1)
        throw new RangeError('Color stack amount must be in [0, 1]');
      const mask = effects.prepareMask(entry.mask, options.context, { validateOnly: options.validateOnly || options.skipMasks });
      return {
        name, order, weight: weight * strengthWeight, stackAmount,
        ...(sampled && { inputValues: { strength: sampled.strength, params: sampled.params } }), mask, disabled: Boolean(options.skipMasks && mask),
        select: entry.select === undefined ? null : targets.prepare(entry.select),
        ...(options.surface && { scope: 'surface' }),
        assetId: entry.assetId,
        stack: usePalette ? null : stacks.prepare({ ...entry.stack, amount: 1 }, {
          resolveColor: value => unpack(albedo(value, options.palette, options.roles))
        }),
        palette: usePalette ? pixels.preparePalette(entry.palette, options) : null
      };
    });
  }

  function optics(entries, options = {}) {
    if (entries === undefined || entries === false || Array.isArray(entries) && !entries.length) return null;
    if (!Array.isArray(entries) || entries.length > 32) throw new TypeError('Expected up to 32 optical look rules');
    const definitions = Array.from(entries).flatMap(entry => {
      if (!entry || Object.getPrototypeOf(entry) !== Object.prototype || !entry.select ||
          Object.keys(entry).some(key => !['select', 'stack', 'palette', 'order', 'weight', 'assetId', 'driver'].includes(key)) ||
          (!entry.stack && !entry.palette)) throw new TypeError('An optical look needs a selector and a stack or palette');
      const { stack, palette, ...scope } = entry;
      return [...(stack ? [{ ...scope, stage: 'lit', stack }] : []),
        ...(palette ? [{ ...scope, stage: 'palette', palette: Array.isArray(palette) ? { palette } : palette }] : [])];
    });
    const lookInputs = options.lookInputs ?? (options.time === undefined ? undefined : inputs.session(options.time, options.query));
    const rules = prepare(definitions, { ...options, lookInputs, optical: true }).sort((a, b) => a.order - b.order);
    function matching(target) {
      return rules.filter(rule => targets.matches(rule.select, target));
    }
    const palettes = [...new Set(rules.flatMap(rule => rule.palette?.packed ?? []))];
    return Object.freeze({ matching, palettes, transform(target) {
      const layers = matching(target);
      if (layers.length) return (rgb, visit, inspect) =>
        apply(layers, rgb, undefined, visit, inspect).map(value => Math.max(0, Math.min(1, value)));
    } });
  }

  function plan(world, options = {}) {
    const entries = options.sceneRules ?? world.look?.renderStages;
    const paint = world.surfaces?.some(({settings})=>Object.values(settings.layers ?? {}).some(layer=>layer?.stage === 'material'));
    if (!paint && (entries === undefined || entries === false || Array.isArray(entries) && !entries.length) &&
        !world.surfaces?.some(({ settings }) => settings.renderStages !== undefined && settings.renderStages !== false)) return null;
    const context = { palette: world.pal, roles: world.paletteRoles, context: world.surfaceEffects, ...options };
    const scene = prepare(entries, context);
    const surfaces = world.surfaces?.map(({ settings }) => settings.renderStages === undefined || settings.renderStages === false
      ? [] : prepare(settings.renderStages, { ...context, roles: pixels.bindRoles(context.palette, context.roles, settings.paletteRoles),
        surface: true })) ?? [];
    const rules = [...scene, ...surfaces.flat()];
    if (!rules.length && !paint) return null;
    const all = rules.filter(rule => !rule.disabled);
    const lookup = all.some(rule => rule.select) ? targets.index(world) : null;
    const cache = new Map();
    const group = (rules, target) => {
      const slots = {};
      for (const rule of rules) {
        if (rule.disabled || rule.select && (!target || !targets.matches(rule.select, target))) continue;
        (slots[rule.name] ??= []).push(rule);
      }
      for (const list of Object.values(slots)) list.sort((a, b) => a.order - b.order);
      return slots;
    };
    const global = group(scene);
    function at(i) {
      if (i < 0) return global;
      if (!lookup && !surfaces.length) return global;
      const surface = surfaces[(world.surfaceData?.[i * 8] || 0) - 1];
      const target = lookup?.row(i);
      const key = surface ?? null;
      if (!cache.has(key)) cache.set(key, new Map());
      const rows = cache.get(key);
      if (!rows.has(target)) rows.set(target, surface?.length ? group([...scene, ...surface], target) : group(scene, target));
      return rows.get(target);
    }
    const post = rule => !rule.disabled && (rule.name === 'frame' || rule.name === 'palette');
    const postMask = all.some(rule => post(rule) && rule.mask);
    const anchorSpaces = new Set(all.filter(post).map(rule => rule.palette?.anchor?.dither)
      .filter(Boolean));
    const owner = postMask || scene.some(rule => post(rule) && rule.select) || surfaces.some(rules => rules.some(post));
    return {
      at, post: all.some(post), postMask, owner, anchorSpaces,
      ditherRegions: all.some(rule => post(rule) && rule.palette?.tuning?.regions.length),
      ditherFade: all.some(rule => post(rule) && rule.palette?.tuning?.fade),
      palettes: [...new Set(all.flatMap(rule => rule.palette?.packed ?? []))],
      outputPalettes: [...new Set(all.filter(post).flatMap(rule => rule.palette?.packed ?? []))],
      surfaceMask: all.some(rule => !post(rule) && rule.mask)
    };
  }

  const coverage = (rule, sample) => rule.mask ? sample ? rule.mask(sample) : null : 1;

  function describe(rule, sample, maskWeight = coverage(rule, sample)) {
    return {
      asset: rule.assetId ?? null, select: rule.select, order: rule.order, weight: rule.weight,
      ...(rule.inputValues && { inputs: rule.inputValues }),
      ...(rule.stack && { stack: rule.stack.name, stackAmount: rule.stackAmount }),
      ...(rule.mask && { maskWeight }),
      effectiveWeight: maskWeight === null ? null : rule.weight * rule.stackAmount * maskWeight,
      ...(rule.palette && { palette: rule.palette.packed, ...(rule.palette.matchId && { match: rule.palette.match }) })
    };
  }

  function evaluate(rules, rgb, sample, x, y, contributions, visit, anchorAt, placement, skipPalettes, inspect) {
    if (!rules) return rgb;
    let result = rgb;
    for (const rule of rules) {
      if (skipPalettes && rule.palette) continue;
      const maskWeight = coverage(rule, sample);
      const amount = rule.weight * rule.stackAmount * (maskWeight ?? 0);
      const input = result;
      const applied = rule.palette ? amount >= .5 : amount > 0;
      let transformed;
      if (applied && rule.palette) {
        const dither = x !== undefined && (rule.name === 'frame' || rule.name === 'palette');
        const anchor = dither && rule.palette.anchor;
        const [dx, dy] = anchor ? anchorAt ? anchorAt(anchor) :
          stability.sampleCoordinates(anchor, sample, x, y) : [x, y];
        const site = rule.palette.tuning && (placement?.() ?? { pixel: [x, y], sample });
        const trace = inspect && {};
        const index = rule.palette.index(input, dx, dy, dither, site, trace);
        transformed = result = rule.palette.swatches[index];
        inspect?.(rule,input,index,trace,amount);
      } else if (applied) {
        transformed = rule.stack.sample(input);
        result = amount === 1 ? transformed : transformed.map((n, i) => input[i] + (n - input[i]) * amount);
      }
      if (contributions) contributions.push({
        ...describe(rule, sample, maskWeight), applied, input, ...(transformed && { transformed }), output: result
      });
      if (applied && visit) visit(rule, rule.mask ? maskWeight : null, amount);
    }
    return result;
  }

  function apply(rules, rgb, sample, visit, inspect) {
    return evaluate(rules, rgb, sample, undefined, undefined, undefined, visit, undefined, undefined, false, inspect);
  }

  function trace(rules, rgb, sample, pixel = [0, 0]) {
    const [x, y] = pixel ?? [];
    const contributions = [];
    const output = evaluate(rules, rgb, sample, x, y, contributions);
    return { rgb: output, contributions };
  }

  function material(rules, shaded, reference, sample, contributions, visit, paintedAlbedo, inspect) {
    const base = reference === undefined ? shaded : unpack(reference);
    const painted = evaluate(rules, base, sample, undefined, undefined, contributions, visit, undefined, undefined, false, inspect);
    if (paintedAlbedo) for (let i=0;i<3;i++) paintedAlbedo[i] = painted[i];
    return reference === undefined ? painted : repaint(shaded,base,painted);
  }

  function repaint(shaded, base, painted) {
    if (base[0] === painted[0] && base[1] === painted[1] && base[2] === painted[2]) return shaded;
    const unlit = linear(base), lit = linear(shaded), changed = linear(painted);
    const baseLuma = luma(unlit);
    const fallback = baseLuma > 0 ? Math.min(1, luma(lit) / baseLuma) : 1;
    for (let i = 0; i < 3; i++) {
      // The bake stores a selected ramp swatch. Recover its attenuation and any additive highlight.
      const gain = unlit[i] > 0 ? Math.min(1, lit[i] / unlit[i]) : fallback;
      changed[i] = changed[i] * gain + Math.max(0, lit[i] - unlit[i]);
    }
    return encode(changed, changed);
  }

  function quantize(rules, rgb, x, y, sample) {
    return evaluate(rules, rgb, sample, x, y);
  }

  function finish(frame, plan, passes, time, visitPixel, audit, ditherAt, stable, beforePalette, inspect, frameGrade) {
    const { w, h, rgb } = frame;
    const swatches = new Map(plan.outputPalettes.map((color, i) => [color, i]));
    const use = new Uint32Array(swatches.size);
    for (let p = 0; p < w * h; p++) {
      const owner = (passes?.splatId?.[p] || 0) - 1;
      const rules = plan.at(owner);
      const offset = p * 3;
      if (!rules.frame && !rules.palette) {
        if (beforePalette) beforePalette.set(rgb.subarray(offset, offset + 3), offset);
        if (frameGrade) frameGrade.set(rgb.subarray(offset,offset+3),offset);
        const index = swatches.get(rgb[offset] * 65536 + rgb[offset + 1] * 256 + rgb[offset + 2]);
        if (index !== undefined) use[index]++;
        continue;
      }
      const sample = plan.postMask && owner >= 0 ? {
        position: Array.from(passes.objectPosition.subarray(offset, offset + 3)),
        worldPosition: Array.from(passes.position.subarray(offset, offset + 3)),
        normal: Array.from(passes.normal.subarray(offset, offset + 3)), time
      } : null;
      const original = [rgb[offset] / 255, rgb[offset + 1] / 255, rgb[offset + 2] / 255];
      const visit = visitPixel && visitPixel(p);
      const x = p % w, y = Math.floor(p / w);
      const palette = rules.palette || rules.frame?.some(rule => rule.palette);
      const [dx,dy] = palette && ditherAt ? ditherAt(x,y) : [x,y];
      const anchorAt = plan.anchorSpaces?.size ? anchor => stability.ditherCoordinates(null, passes, p, x, y, anchor) : undefined;
      const placement = () => stability.placement(stable, passes, p, x, y, time);
      const record = inspect?.pixel === p ? inspect.stage : undefined;
      const graded = evaluate(rules.frame, original, sample, dx, dy, undefined, visit, anchorAt, placement, false, record);
      if (frameGrade) for (let k=0;k<3;k++) frameGrade[offset+k]=byte(graded[k]);
      if (beforePalette) {
        const reference = rules.frame?.some(rule => rule.palette) ?
          evaluate(rules.frame, original, sample, dx, dy, undefined, undefined, undefined, undefined, true) : graded;
        for (let k = 0; k < 3; k++) beforePalette[offset + k] = byte(reference[k]);
      }
      const color = evaluate(rules.palette, graded, sample, dx, dy, undefined, visit, anchorAt, placement, false, record);
      if (audit) audit.pixel('frame', p, color[0], color[1], color[2]);
      const index = swatches.get(pack(color));
      if (index !== undefined) use[index]++;
      if (color !== original) for (let k = 0; k < 3; k++) rgb[offset + k] = byte(color[k]);
    }
    if (swatches.size) {
      frame.palette = plan.outputPalettes;
      frame.use = use;
    }
    return frame;
  }

  return Object.freeze({ names, stage, blend, albedo, prepare, optics, plan, describe, trace, apply, material, repaint, unpack, quantize, finish });
})();
if (typeof module !== 'undefined') module.exports = RenderStages;
