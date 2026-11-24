/* Fixed-grid, palette-aware resolve using coverage and cluster voting.
   No per-frame palette fitting, camera movement or black ink. */
const PixelLook = (() => {
  const stability = typeof ArtStability === 'undefined' ? require('./art-stability.js') : ArtStability;
  const detail = typeof StableDetail === 'undefined' ? require('./stable-detail.js') : StableDetail;
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  let curves, luts, stacks, spaces;
  try {
    curves = ColorCurves;
    luts = ColorLUT;
    stacks = ColorStack;
    spaces = ColorSpace;
  } catch {
    curves = require('./color-curves.js');
    luts = require('./color-lut.js');
    stacks = require('./color-stack.js');
    spaces = require('./color-space.js');
  }
  const weights = Object.freeze([0.30, 0.55, 0.15]);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const stipple = Object.freeze({
    cutoff: 0.19,
    stops: Object.freeze([
      [0, '#000000'], [0.14, '#176bfa'], [0.37, '#44c73d'],
      [0.57, '#e85dc9'], [0.77, '#ff8d27'], [1, '#fff1cd']
    ].map(Object.freeze)),
    pattern: 'bayer',
    amount: 1,
    seed: 0,
    preserveDots: true
  });
  const presets = Object.freeze({ stipple });
  const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const bayerRanks = Float32Array.from(bayer, rank => (rank + 0.5) / bayer.length);
  const bayerRank = (x, y) => bayerRanks[(x & 3) + ((y & 3) << 2)];
  const isColor = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffff;
  const isSwatch = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const unpack = color => [color >> 16, (color >> 8) & 255, color & 255].map(n => n / 255);
  const clamp = n => Math.max(0, Math.min(1, n));
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const swatchValue = value => typeof value === 'string' && value.trim() || Number.isSafeInteger(value) && value >= 0 ||
    Array.isArray(value) && value.length === 3 && Array.from(value).every(fraction);
  const packedRgb = ([r, g, b]) => (Math.round(clamp(r) * 255) << 16) |
    (Math.round(clamp(g) * 255) << 8) | Math.round(clamp(b) * 255);

  function paletteSelector(colors, roles) {
    const index = value => {
      if (!Number.isSafeInteger(value) || value < 0 || value >= colors.length)
        throw new RangeError('Palette index out of range: ' + value);
      return value;
    };
    return from => {
      if (typeof from === 'number') return [index(from)];
      if (typeof from !== 'string' || !from) throw new TypeError('Expected a palette index, #rrggbb swatch or role');
      if (isSwatch(from)) {
        const color = parseInt(from.slice(1), 16), indices = [];
        colors.forEach((entry, i) => { if (entry === color) indices.push(i); });
        if (!indices.length) throw new RangeError('Swatch is missing from the palette: ' + from);
        return indices;
      }
      const at = from.lastIndexOf('.'), whole = Object.hasOwn(roles, from) || at < 0;
      const name = whole ? from : from.slice(0, at), ramp = Object.hasOwn(roles, name) && roles[name];
      if (!Array.isArray(ramp) || !ramp.length) throw new RangeError('Unknown or empty palette role: ' + name);
      if (whole) return Array.from(ramp, index);
      const stop = from.slice(at + 1);
      const step = stop === 'shadow' ? 0 : stop === 'midtone' ? Math.floor((ramp.length - 1) / 2) :
        stop === 'highlight' ? ramp.length - 1 : /^(0|[1-9]\d*)$/.test(stop) ? Number(stop) : -1;
      if (step < 0 || step >= ramp.length) throw new RangeError('Unknown palette ramp stop: ' + from);
      return [index(ramp[step])];
    };
  }

  function bindRoles(palette, roles, aliases) {
    const scene = roles ?? {};
    if (aliases === undefined) return scene;
    if (!record(aliases) || Object.keys(aliases).length > 64)
      throw new TypeError('Surface paletteRoles needs a map of up to 64 local names');
    const select = paletteSelector(palette, scene);
    const bindings = Object.entries(aliases).map(([name, value]) => {
      if (!name.trim() || name.startsWith('#'))
        throw new TypeError('Surface paletteRoles needs named aliases');
      return [name, select(value)];
    });
    return { ...scene, ...Object.fromEntries(bindings) };
  }

  function roleColor(name, palette, roles = {}) {
    const slots = paletteSelector(palette, roles)(name);
    if (slots.length !== 1) throw new RangeError('Palette role ' + name + ' needs a specific stop for a single color');
    const color = palette[slots[0]];
    if (!isColor(color)) throw new RangeError('Palette role ' + name + ' needs a packed RGB swatch');
    return color;
  }

  function prepareRemap(definition, palette, roles = {}, override, { deferTargets = false } = {}) {
    if (definition === undefined || definition === false) return null;
    if (!record(definition) || Object.keys(definition).some(key => !['rules', 'protect', 'color'].includes(key)))
      throw new TypeError('Palette remap needs a settings object with rules and optional protect');
    const colors = Array.isArray(palette) || ArrayBuffer.isView(palette) ? Array.from(palette) : [];
    if (!deferTargets && (!colors.length || !colors.every(isColor)))
      throw new TypeError('Palette remap needs a palette of packed RGB colors');
    const { rules, protect = [] } = definition;
    const contract = spaces.settings(override === undefined ? definition.color : override);
    const encodeTarget = contract && spaces.prepare(undefined, { ...contract.output, outOfRange: 'preserve' });
    const applyTarget = contract && spaces.wrap((rgb, out, target) => {
      for (let i = 0; i < 3; i++) out[i] = target[i];
    }, contract);
    if (!Array.isArray(rules) || rules.length > 1024 || !Array.isArray(protect) || protect.length > 1024)
      throw new TypeError('Palette remap rules and protect must be lists of at most 1024 entries');
    const select = deferTargets ? value => {
      if (!(typeof value === 'string' && value.trim() || Number.isSafeInteger(value) && value >= 0))
        throw new TypeError('Expected a palette index, #rrggbb swatch or role');
      return [];
    } : paletteSelector(colors, roles);
    const overrides = new Map();
    for (const rule of rules) {
      if (!rule || Object.getPrototypeOf(rule) !== Object.prototype ||
          Object.keys(rule).some(key => key !== 'from' && key !== 'to'))
        throw new TypeError('Expected a palette remap rule with from and to');
      let color = rule.to;
      if (isSwatch(color)) color = parseInt(color.slice(1), 16);
      else if (typeof color === 'string' && color.trim() && !color.startsWith('#'))
        color = deferTargets ? 0 : roleColor(color, colors, roles);
      let output;
      if (isColor(color)) output = encodeTarget ? encodeTarget(unpack(color)) : unpack(color);
      else if (contract && Array.isArray(color) && color.length === 3 && Array.from(color).every(Number.isFinite)) output = color.slice();
      else throw new TypeError('Palette remap output needs a role stop, hex swatch, packed RGB or a declared numeric RGB triple');
      for (const i of select(rule.from)) overrides.set(i, Object.freeze(output));
    }
    const locked = new Set();
    for (const from of protect) for (const i of select(from)) {
      locked.add(i);
      overrides.set(i, Object.freeze(unpack(colors[i])));
    }
    const base = Float32Array.from(colors.flatMap(unpack));
    function target(index, rgb) {
      const value = overrides.get(index);
      return value && applyTarget && !locked.has(index) ? applyTarget(rgb ?? unpack(colors[index]), undefined, value) : value;
    }
    return Object.freeze({
      target,
      protects: index => locked.has(index),
      grade(prior, amount = 1, onClip) {
        if (!fraction(amount)) throw new RangeError('Palette remap strength must be in [0, 1]');
        const output = base.slice();
        if (prior) output.set(prior.subarray ? prior.subarray(0, output.length) : prior.slice(0, output.length));
        for (const i of overrides.keys()) {
          const input = applyTarget && prior?.length >= i * 3 + 3 ? prior.slice(i * 3, i * 3 + 3) : undefined;
          const rgb = target(i, input);
          if (onClip) onClip(i, ...rgb.map((n, k) => base[i * 3 + k] + (n - base[i * 3 + k]) * amount));
          for (let channel = 0; channel < 3; channel++) {
            const key = i * 3 + channel;
            output[key] = clamp(base[key] + (rgb[channel] - base[key]) * amount);
          }
        }
        return output;
      }
    });
  }

  function gradePalette(grade) {
    const byte = n => Math.round(Math.max(0, Math.min(1, n)) * 255);
    return Array.from({ length: grade.length / 3 }, (_, i) =>
      (byte(grade[i * 3]) << 16) | (byte(grade[i * 3 + 1]) << 8) | byte(grade[i * 3 + 2]));
  }

  function prepareColorStack(stack, palette, roles) {
    return stacks.prepare(stack, { palette, roles,
      paletteRemap: (definition, color) => prepareRemap(definition, palette, roles, color) });
  }

  function colorGrade(palette, roles, prior, remap, definition, lut, stack, onClip) {
    const transfer = curves.prepare(definition), plan = prepareRemap(remap, palette, roles);
    const lookup = lut === undefined || lut === false ? null : luts.prepare(lut);
    const ordered = prepareColorStack(stack, palette, roles);
    if (!transfer && !lookup && !ordered) return plan ? plan.grade(prior, 1, onClip) : null;
    const grade = new Float32Array(palette.length * 3), result = [0, 0, 0], protectedSlots = [];
    for (let i = 0; i < palette.length; i++) {
      const offset = i * 3;
      if (ordered?.protects(i)) {
        protectedSlots.push(i);
        grade.set(unpack(palette[i]), offset);
        continue;
      }
      const base = prior?.length >= offset + 3 ? prior.slice(offset, offset + 3) : unpack(palette[i]);
      let shaped = transfer ? transfer(base, result) : base;
      if (lookup) shaped = lookup.apply(shaped, result);
      if (ordered) shaped = ordered.sample(shaped, result, i);
      grade.set(shaped, offset);
    }
    const resolved = plan ? plan.grade(grade, 1, onClip) : grade;
    if (plan) for (const i of protectedSlots) resolved.set(grade.subarray(i * 3, i * 3 + 3), i * 3);
    for (let i = 0; i < resolved.length; i += 3) {
      if (onClip) onClip(i / 3, resolved[i], resolved[i + 1], resolved[i + 2]);
      for (let channel = 0; channel < 3; channel++) resolved[i + channel] = clamp(resolved[i + channel]);
    }
    return resolved;
  }

  function framePalette(world, frame, { grading = true, tone = true, onClip } = {}) {
    const look = world.look ?? {};
    const toneDefinition = tone ? frame.tone ?? look.tone : null;
    const animationGrade = frame.ignoreLookGrade ? undefined : world.anim?.grade;
    const colors = grading && !toneDefinition ? colorGrade(world.pal, world.paletteRoles, animationGrade,
      frame.paletteRemap ?? look.paletteRemap, frame.colorCurves ?? look.colorCurves,
      frame.colorLut ?? look.colorLut, frame.colorStack ?? look.colorStack, onClip) : null;
    return { toneDefinition, colorGrade: colors, grade: colors || animationGrade };
  }

  function toneSettings(definition) {
    if (definition === undefined || definition === false) return null;
    const overrides = typeof definition === 'string' ? { preset: definition } : definition;
    if (!overrides || Object.getPrototypeOf(overrides) !== Object.prototype)
      throw new TypeError('Expected a tone preset name or settings object');
    const { preset = 'stipple', ...changes } = overrides;
    if (!Object.hasOwn(presets, preset)) throw new RangeError('Unknown tone preset: ' + preset);
    for (const key of Object.keys(changes)) {
      if (!Object.hasOwn(stipple, key)) throw new TypeError('Unknown tone setting: ' + key);
    }
    const settings = { ...presets[preset], ...changes };
    const { cutoff, stops, pattern, amount, seed, preserveDots } = settings;
    if (!fraction(cutoff) || cutoff === 1) throw new RangeError('Tone cutoff must be in [0, 1)');
    if (!fraction(amount)) throw new RangeError('Tone dither amount must be in [0, 1]');
    if (pattern !== 'bayer' && pattern !== 'blue-noise')
      throw new RangeError('Tone pattern must be bayer or blue-noise');
    if (!Number.isSafeInteger(seed)) throw new RangeError('Tone seed must be a safe integer');
    if (typeof preserveDots !== 'boolean') throw new TypeError('Tone preserveDots must be a boolean');
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > 48 ||
        !Array.from(stops).every((stop, i) => Array.isArray(stop) && stop.length === 2 &&
          fraction(stop[0]) && typeof stop[1] === 'string' && /^#[\da-f]{6}$/i.test(stop[1]) &&
          (i === 0 || stop[0] > stops[i - 1][0])) ||
        stops[0][0] !== 0 || stops[0][1] !== '#000000' || stops.at(-1)[0] !== 1)
      throw new RangeError('Use 2 to 48 increasing [position, #rrggbb] tone stops from [0, "#000000"] to position 1');
    return settings;
  }

  function prepareTone(definition, blueNoise) {
    const settings = toneSettings(definition);
    if (!settings) return null;
    let width = 4, height = 4, thresholds = bayerRanks.slice();
    if (settings.pattern === 'blue-noise') {
      if (typeof blueNoise !== 'function') throw new TypeError('Pass materials.blueNoise to prepare this tone pattern');
      const tile = blueNoise({ seed: settings.seed });
      width = tile.width;
      height = tile.height;
      thresholds = Float32Array.from(tile.ranks, rank => (rank + 0.5) / tile.ranks.length);
    }
    return {
      ...settings, width, height, thresholds,
      palette: settings.stops.map(stop => parseInt(stop[1].slice(1), 16))
    };
  }

  // Coordinates are top-left art pixels. Each band mixes its two adjacent palette entries.
  function toneIndex(tone, r, g, b, x, y, trace) {
    if (trace) trace.method = 'tone';
    const luma = r * weights[0] + g * weights[1] + b * weights[2];
    if (luma <= tone.cutoff) {
      if (trace) trace.method = 'cutoff';
      return 0;
    }
    const value = (luma - tone.cutoff) / (1 - tone.cutoff);
    const stops = tone.stops;
    let low = 0;
    while (low < stops.length - 2 && value > stops[low + 1][0]) low++;
    const share = (value - stops[low][0]) / (stops[low + 1][0] - stops[low][0]);
    const rank = tone.thresholds[((y % tone.height + tone.height) % tone.height) * tone.width + (x % tone.width + tone.width) % tone.width];
    const threshold = 0.5 + (rank - 0.5) * tone.amount;
    if (trace && tone.amount) trace.dither = { mode:'tone', pattern:tone.pattern, coordinates:[x,y], pair:tone.palette.slice(low,low+2),
      rank, threshold, strength:tone.amount, share };
    return low + Number(share >= threshold);
  }

  function nearest(c, palette, solid) {
    let best = solid && palette.length > 1 ? 1 : 0, distance = Infinity;
    for (let i = best; i < palette.length; i++) {
      const d = c.reduce((sum, v, k) => sum + (v - palette[i][k]) ** 2 * weights[k], 0);
      if (d < distance) { distance = d; best = i; }
    }
    return best;
  }

  const matchModes = Object.freeze(['rgb','perceptual','brightness','chroma','hue']);
  function labPoint(rgb) {
    const lab = spaces.toOKLab(rgb);
    return [...lab,Math.hypot(lab[1],lab[2])];
  }
  function hueWeight(chroma) {
    const t = clamp((chroma-.02)/.04);
    return .49*t*t*(3-2*t);
  }
  function matchDistance(a,b,mode,hue) {
    if (mode === 0) return weights[0]*(a[0]-b[0])**2+weights[1]*(a[1]-b[1])**2+weights[2]*(a[2]-b[2])**2;
    let distance = (mode === 2 ? 25 : 1)*(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
    if (mode === 3) distance += 25*(a[3]-b[3])**2;
    if (hue) {
      const ca = Math.max(.04,a[3]), cb = Math.max(.04,b[3]);
      distance += hue*((a[1]/ca-b[1]/cb)**2+(a[2]/ca-b[2]/cb)**2);
    }
    return distance;
  }

  function prepareDitherTuning(dither, { context, validateOnly, skipMasks }) {
    const { scale = 1, fade, regions = [] } = dither;
    const validScale = value => Number.isFinite(value) && value >= 1/64 && value <= 64;
    if (!validScale(scale)) throw new RangeError('Dither scale must be in [1/64, 64]');
    if (fade !== undefined && (!Array.isArray(fade) || fade.length !== 2 ||
        !Array.from(fade).every(Number.isFinite) || fade[0] < 0 || fade[0] >= fade[1]))
      throw new RangeError('Dither fade needs an increasing nonnegative art-pixel range');
    if (!Array.isArray(regions) || regions.length > 32) throw new TypeError('Dither accepts up to 32 regional rules');
    const effects = regions.length && (typeof SplatEffects === 'undefined' ? require('./splat-effects.js') : SplatEffects);
    const rules = Array.from(regions, rule => {
      if (!record(rule) || Object.keys(rule).some(key => !['mask', 'scale', 'strength'].includes(key)) ||
          !record(rule.mask) || rule.scale === undefined && rule.strength === undefined)
        throw new TypeError('A dither region needs a mask and a scale or strength');
      if (rule.scale !== undefined && !validScale(rule.scale) || rule.strength !== undefined && !fraction(rule.strength))
        throw new RangeError('Dither region scale must be in [1/64, 64] and strength in [0, 1]');
      return { scale: rule.scale, strength: rule.strength,
        mask: effects.prepareMask(rule.mask, context, { validateOnly: validateOnly || skipMasks }) };
    });
    if (dither.scale === undefined && fade === undefined && !rules.length) return undefined;
    return { scale, fade: fade?.slice(), regions: skipMasks ? [] : rules, screenGain: detail.weight(fade, scale) };
  }

  function reserveEntries(entries) {
    if (!Array.isArray(entries) || entries.length > 48) throw new RangeError('Reserved list needs up to 48 swatches');
    return Array.from(entries, entry => {
      const row = record(entry) ? entry : { color: entry };
      const { color, match = false, dither = false } = row;
      if (Object.keys(row).some(key => !['color', 'match', 'dither'].includes(key)) ||
          typeof match !== 'boolean' || typeof dither !== 'boolean' || !swatchValue(color))
        throw new TypeError('A reserved swatch needs a color and optional match and dither booleans');
      return { color, match, dither };
    });
  }

  function preparePalette(definition, { palette = [], roles = {}, blueNoise, deferDitherColors = false, prepareDitherTile = false,
    context, validateOnly, skipMasks, skipDitherRegions, ditherSpaceOverride } = {}) {
    if (!record(definition) || Object.keys(definition).some(key => !['palette', 'reserved', 'dither', 'source', 'match'].includes(key)))
      throw new TypeError('A palette constraint accepts palette, reserved, dither, source and match settings');
    const { source = 'lit', match = 'rgb' } = definition;
    const matchId = matchModes.indexOf(match);
    if (matchId < 0) throw new RangeError('Palette match must be rgb, perceptual, brightness, chroma or hue');
    if (!['lit', 'graded'].includes(source)) throw new RangeError('Palette source must be lit or graded');
    const select = paletteSelector(palette, roles);
    function colors(values, name) {
      if (!Array.isArray(values) || values.length > 48)
        throw new RangeError(name + ' needs up to 48 swatches');
      return [...new Set(Array.from(values).flatMap(value => {
        if (isSwatch(value)) return parseInt(value.slice(1), 16);
        if (Array.isArray(value) && value.length === 3 && Array.from(value).every(fraction)) return packedRgb(value);
        return select(value).map(index => {
          const color = palette[index];
          if (!isColor(color)) throw new RangeError('Palette constraints require packed RGB scene swatches');
          return color;
        });
      }))];
    }
    const reserved = new Map();
    for (const { color, match, dither } of reserveEntries(definition.reserved ?? [])) {
      const access = Number(match) | (Number(dither) << 1);
      for (const swatch of colors([color], 'Reserved list')) {
        if (reserved.has(swatch) && reserved.get(swatch) !== access)
          throw new RangeError('A reserved swatch cannot have conflicting match or dither settings');
        reserved.set(swatch, access);
      }
    }
    const candidates = colors(definition.palette ?? Array.from(palette, (_, i) => i), 'Output palette')
      .filter(color => !reserved.has(color));
    const count = candidates.length, packed = [...candidates, ...reserved.keys()];
    const reserveAccess = [...reserved.values()];
    const matchSlots = [...candidates.keys()], mixSlots = candidates.map((_, slot) => ({ slot }));
    reserveAccess.forEach((access, i) => {
      if (access & 1) matchSlots.push(count + i);
      if (access & 2) mixSlots.push({ slot: count + i });
    });
    if (!matchSlots.length || packed.length > 48)
      throw new RangeError('Use 1 to 48 swatches with at least one swatch enabled for matching');
    const swatches = packed.map(unpack), exact = new Map([...reserved.keys()].map((color, i) => [color, count + i]));
    const canMix = slot => slot >= 0 && (slot < count || (reserveAccess[slot - count] & 2) !== 0);
    const lab = matchId ? swatches.map(labPoint) : undefined;
    const dither = definition.dither ?? {};
    if (!record(dither) || Object.keys(dither).some(key => !['pattern', 'strength', 'seed', 'pairs', 'space', 'spacing', 'origin', 'scale', 'fade', 'regions'].includes(key)))
      throw new TypeError('Invalid palette dither settings');
    const { pattern = 'bayer', strength = 0, seed = 0 } = dither;
    if (!['none', 'checker', 'bayer', 'blue-noise'].includes(pattern) || !fraction(strength) || !Number.isSafeInteger(seed))
      throw new RangeError('Palette dither requires a valid pattern, strength in [0, 1] and integer seed');
    if (dither.space === undefined && (dither.spacing !== undefined || dither.origin !== undefined))
      throw new TypeError('Set a dither space to use spacing or origin');
    const authoredAnchor = dither.space === undefined ? undefined :
      stability.pattern({ dither: dither.space, spacing: dither.spacing, origin: dither.origin });
    const anchor = authoredAnchor && ditherSpaceOverride !== undefined ?
      stability.pattern({ ...authoredAnchor, dither:ditherSpaceOverride }) : authoredAnchor;
    const tuning = prepareDitherTuning(dither, { context, validateOnly, skipMasks: skipMasks || skipDitherRegions });
    let pairs, partners;
    if (dither.pairs !== undefined) {
      if (!Array.isArray(dither.pairs) || dither.pairs.length > 256)
        throw new TypeError('Palette dither accepts up to 256 authorized pairs');
      partners = packed.map(() => []);
      const rules = Array.from(dither.pairs, rule => {
        if (!record(rule) || Object.keys(rule).some(key => !['colors', 'lightness'].includes(key)) ||
            !Array.isArray(rule.colors) || rule.colors.length !== 2)
          throw new TypeError('A dither pair needs two swatches and an optional lightness range');
        const { lightness } = rule;
        if (lightness !== undefined && (!Array.isArray(lightness) || lightness.length !== 2 ||
            !Array.from(lightness).every(fraction) || lightness[0] > lightness[1]))
          throw new RangeError('Dither lightness must be an ordered range in [0, 1]');
        for (const value of rule.colors) {
          if (!swatchValue(value))
            throw new TypeError('A dither pair needs palette swatches, indices or named stops');
        }
        return rule;
      });
      pairs = deferDitherColors ? [] : rules.map(rule => {
        const slots = rule.colors.map(value => {
          const swatches = colors([value], 'Dither pair');
          const slot = swatches.length === 1 ? packed.indexOf(swatches[0]) : -1;
          if (!canMix(slot))
            throw new RangeError('Dither pair colors must identify single unreserved palette candidates or reserved swatches with dithering enabled');
          return slot;
        });
        const [a, b] = slots;
        if (a === b) throw new RangeError('A dither pair needs two distinct palette colors');
        const range = rule.lightness?.slice();
        partners[a].push({ slot: b, range });
        partners[b].push({ slot: a, range });
        return { slots, lightness: range };
      });
    }
    const amount = pattern === 'none' ? 0 : strength;
    let width = 4, height = 4, ranks = bayerRanks;
    if (pattern === 'checker') {
      width = height = 2;
      ranks = Float32Array.of(.25, .75, .75, .25);
    } else if (pattern === 'blue-noise' && (amount || prepareDitherTile)) {
      if (typeof blueNoise !== 'function') throw new TypeError('Pass materials.blueNoise to prepare this palette pattern');
      const tile = blueNoise({ seed });
      ({ width, height } = tile);
      ranks = Float32Array.from(tile.ranks, rank => (rank + .5) / tile.ranks.length);
    }
    const mod = (n, size) => ((Math.floor(n) % size) + size) % size;
    const reservedIndex = rgb => exact.size ? exact.get(packedRgb(rgb)) : undefined;
    const sites = lab ?? swatches;
    function closest(input, hue) {
      let best = matchSlots[0], distance = Infinity;
      for (const slot of matchSlots) {
        const next = matchDistance(input, sites[slot], matchId, hue);
        if (next < distance) {
          best = slot;
          distance = next;
        }
      }
      return best;
    }
    function diffusionIndex(original, adjusted) {
      const locked = reservedIndex(original);
      if (locked !== undefined) return locked;
      const base = lab ? labPoint(original) : original;
      const best = closest(base, matchId === 4 ? hueWeight(base[3]) : 0);
      if (!canMix(best)) return best;
      const input = lab ? labPoint(adjusted) : adjusted;
      const hue = matchId === 4 ? hueWeight(input[3]) : 0;
      let result = best, distance = matchDistance(input, sites[best], matchId, hue), lightness;
      for (const {slot,range} of partners?.[best] ?? mixSlots) {
        if (range) {
          lightness ??= clamp(lab ? base[0] : spaces.toOKLab(original)[0]);
          if (lightness < range[0] || lightness > range[1]) continue;
        }
        const next = matchDistance(input, sites[slot], matchId, hue);
        if (next < distance || next === distance && slot < result) {
          result = slot;
          distance = next;
        }
      }
      return result;
    }
    function index(rgb, x = 0, y = 0, useDither = true, placement, trace) {
      const locked = reservedIndex(rgb);
      if (locked !== undefined) {
        if (trace) trace.method = 'reserved';
        return locked;
      }
      const input = lab ? labPoint(rgb) : rgb;
      const hue = matchId === 4 ? hueWeight(input[3]) : 0;
      const best = closest(input,hue);
      if (!amount || !useDither || mixSlots.length < 2 || !canMix(best)) return best;
      let gain = 1;
      if (tuning) {
        const { sample, pixel = [x, y], inherited } = placement ?? {};
        let scale = tuning.scale;
        if (sample) for (const region of tuning.regions) {
          const weight = region.mask(sample);
          if (region.scale !== undefined) scale += (region.scale - scale) * weight;
          if (region.strength !== undefined) gain += (region.strength - gain) * weight;
        }
        const rule = anchor ?? inherited, point = stability.samplePoint(rule, sample);
        if (tuning.fade) {
          const footprint = point && sample.footprint?.(rule.dither);
          const pixels = point ? footprint ? rule.spacing * scale / footprint : Infinity : scale;
          gain *= detail.weight(tuning.fade, pixels);
        }
        if (gain <= 0) return best;
        [x, y] = stability.coordinates(rule, point, ...pixel, scale);
      }
      const rank = ranks[mod(y, height) * width + mod(x, width)] / gain;
      if (rank >= .5 && !trace) return best;
      let second = best, secondDistance = Infinity, lightness;
      for (const { slot, range } of partners?.[best] ?? mixSlots) {
        if (slot === best) continue;
        if (range) {
          lightness ??= clamp(lab ? input[0] : spaces.toOKLab(rgb)[0]);
          if (lightness < range[0] || lightness > range[1]) continue;
        }
        const distance = matchDistance(input, sites[slot], matchId, hue);
        if (distance < secondDistance || distance === secondDistance && slot < second) {
          second = slot;
          secondDistance = distance;
        }
      }
      if (second === best) return best;
      const threshold = .5 + (rank-.5)*amount;
      if (trace) trace.dither = { mode:'pair', pattern, coordinates:[x,y], pair:[packed[best],packed[second]],
        authorized:Boolean(partners), rank, threshold, strength:amount };
      let projection, length;
      if (lab) {
        length = matchDistance(sites[best],sites[second],matchId,hue);
        // Recover the projection using distances in the same metric used to rank the pair.
        if (length <= 0) return best;
        projection = .5*(matchDistance(input,sites[best],matchId,hue)+length-secondDistance);
      } else {
        projection = 0;
        length = 0;
        for (let k = 0; k < 3; k++) {
          const delta = swatches[second][k] - swatches[best][k];
          projection += weights[k] * delta * (rgb[k] - swatches[best][k]);
          length += weights[k] * delta * delta;
        }
      }
      const mixed = rank < .5 && projection >= threshold * length;
      if (trace) {
        trace.dither.share = length ? projection / length : 0;
        if (mixed) trace.method = 'dither-pair';
      }
      return mixed ? second : best;
    }
    return { packed, swatches, count, reserveAccess, matchSlots, width, height, ranks, amount, source, match, matchId, lab,
      pairs, anchor, tuning, reservedIndex, index, diffusionIndex, canMix };
  }

  function prepareLookPolicy(definition, options = {}) {
    if (!record(definition)) throw new TypeError('Expected a look palette policy');
    const { stack, assetId, mask, ...policy } = definition;
    const active = options.skipMaskedStacks && mask ? undefined : stack;
    if (stack && !active && !Object.keys(policy).length) return null;
    const grade = active && colorGrade(options.palette, options.roles, undefined, false, false, false, active,
      options.onPaletteClip && ((i, r, g, b) => options.onPaletteClip({ assetId, stack: active.name }, i, r, g, b)));
    const mapOnly = Boolean(grade && !Object.keys(policy).length);
    const plan = preparePalette(mapOnly ? { palette: ['#000000'] } : policy, options);
    if (mapOnly) {
      plan.packed = gradePalette(grade);
      plan.swatches = plan.packed.map(unpack);
    }
    const effects = mask !== undefined && mask !== false ?
      (typeof SplatEffects === 'undefined' ? require('./splat-effects.js') : SplatEffects) : null;
    return Object.assign(plan, { grade, mapOnly, assetId, stackName: active?.name, maskSource: mask || undefined,
      sourceSwatches: grade ? Array.from(options.palette, unpack) : undefined,
      mask: effects?.prepareMask(mask, options.context, { validateOnly: options.validateOnly }) });
  }

  function preparePaletteConstraints(definition, options) {
    if (definition === undefined || definition === false) return null;
    if (!record(definition) || Object.keys(definition).some(key => key !== 'default' && key !== 'targets'))
      throw new TypeError('Palette constraints accept default and targets');
    const { default: fallback, targets = [] } = definition;
    if (!Array.isArray(targets) || targets.length > 63)
      throw new RangeError('Palette constraints accept up to 63 targets');
    const rules = [], palettes = [];
    const skipMask = policy => Boolean(policy?.mask && (options?.skipMasks ||
      options?.maskSupported && !options.maskSupported(policy.mask)));
    const defaultPolicy = fallback === undefined || skipMask(fallback) ? null :
      prepareLookPolicy(fallback, options);
    const defaultSlot = defaultPolicy ? palettes.push(defaultPolicy) : 0;
    for (const target of targets) {
      if (!record(target)) throw new TypeError('Expected a palette target');
      const { select, object, material, ...policy } = target;
      if (select !== undefined && (object !== undefined || material !== undefined))
        throw new TypeError('Use select or legacy object and material fields on a target');
      const filter = selectors.prepare(select ?? { ...(object !== undefined && { object }), ...(material !== undefined && { material }) });
      const prepared = skipMask(policy) ? null : prepareLookPolicy(policy, options);
      if (prepared) rules.push({ select: filter, slot: palettes.push(Object.assign(prepared, { select: filter })) });
    }
    if (!palettes.length) return null;

    const match = target => rules.findLast(rule => selectors.matches(rule.select, target))?.slot ?? 0;
    function slots(world) {
      const index = selectors.index(world);
      const matches = new Map(), result = new Uint8Array(world.count);
      if (!rules.length) return result;
      for (let i = 0; i < world.count; i++) {
        const target = index.row(i);
        let slot = matches.get(target);
        if (slot === undefined) {
          slot = match(target);
          matches.set(target, slot);
        }
        result[i] = slot;
      }
      return result;
    }
    return { palettes, defaultSlot, slots, match, rules };
  }

  function outputPalettes(base, locals) {
    const packed = base.slice();
    const indices = new Map(packed.map((color, index) => [color, index]));
    const rows = locals.map(palette => palette.map(([r, g, b]) => {
      const color = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
      if (!indices.has(color)) {
        indices.set(color, packed.length);
        packed.push(color);
      }
      return indices.get(color);
    }));
    return { packed, rows };
  }

  function paletteIndex(policy, rgb, x, y, { scene, grade, useDither, placement, trace } = {}) {
    const input = policy.sourceSwatches ?? scene;
    const mapping = policy.grade || (policy.source === 'graded' ? grade : undefined);
    if (input && mapping) {
      const reserved = policy.reservedIndex(rgb);
      if (reserved !== undefined) {
        if (trace) trace.method = 'reserved';
        return reserved;
      }
      const at = nearest(rgb, input, false);
      if (policy.mapOnly) {
        if (trace) trace.method = 'indexed-grade';
        return at;
      }
      rgb = mapping.slice(at * 3, at * 3 + 3);
      if (trace) trace.matchInput = Array.from(rgb);
    }
    return policy.index(rgb, x, y, useDither, placement, trace);
  }

  function localIndex(local, id, rgb, x, y, useDither, screenX, screenY, trace) {
    const row = id - 1, policy = local.constraints?.[row];
    const slot = policy ? paletteIndex(policy, rgb, x, y, { scene: local.scene, grade: local.grade, useDither,
      placement: policy.tuning && local.placement?.(screenX, screenY), trace }) :
      nearest(rgb, local.palettes[row], false);
    if (trace) trace.slot = slot;
    return local.output.rows[row][slot];
  }

  function mediumTransform(plan, medium) {
    const slot = plan?.match(medium);
    if (!slot) return undefined;
    const policy = plan.palettes[slot - 1];
    if (policy.mask) return undefined;
    return rgb => unpack(policy.packed[paletteIndex(policy, rgb, 0, 0, { useDither: false })]);
  }

  function ink(body) {
    const shade = body.map(v => v * 0.64), luma = shade.reduce((n, v, k) => n + v * weights[k], 0);
    return shade.map(v => Math.min(1, v * Math.max(1, 0.12 / Math.max(luma, 0.001))));
  }
  function resolve({ color, depth, w, h, palette, grade, interiorColor, dither = 0, local, contour = true, ditherAt, localDitherAt, inspect }) {
    const width = w / 2, height = h / 2, rgb = new Uint8Array(width * height * 3), use = new Uint32Array(local?.output.packed.length ?? palette.length);
    const mapped = i => grade ? grade.slice(i * 3, i * 3 + 3) : palette[i];
    const at = (x, y) => Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x));
    const z = (x, y) => Math.min(...[at(x * 2, y * 2), at(x * 2 + 1, y * 2), at(x * 2, y * 2 + 1), at(x * 2 + 1, y * 2 + 1)].map(i => depth[i]));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const ids = [at(x * 2, y * 2), at(x * 2 + 1, y * 2), at(x * 2, y * 2 + 1), at(x * 2 + 1, y * 2 + 1)];
      const samples = ids.map(i => [color[i * 3] / 255, color[i * 3 + 1] / 255, color[i * 3 + 2] / 255]);
      const average = [0, 1, 2].map(k => samples.reduce((s, c) => s + c[k], 0) / 4);
      const base = (y * width + x) * 3;
      const native = interiorColor ? [0, 1, 2].map(k => interiorColor[base + k] / 255) : average;
      const pixel = (height - 1 - y) * width + x, trace = inspect?.pixel === pixel ? {} : undefined;
      const anchor = ditherAt?.(x, y);
      const localId = local?.at[y * width + x];
      if (localId) {
        const rule = local.constraints?.[localId - 1]?.anchor;
        const [dx, dy] = (rule ? localDitherAt?.(rule, x, y) : anchor) ?? [x, height - 1 - y];
        const index = localIndex(local, localId, native, dx, dy, true, x, height - 1 - y, trace);
        if (trace) inspect.local(local,localId,native,trace);
        const tone = local.output.packed[index], q = ((height - 1 - y) * width + x) * 3;
        rgb[q] = tone >> 16;
        rgb[q + 1] = (tone >> 8) & 255;
        rgb[q + 2] = tone & 255;
        use[index]++;
        continue;
      }
      const rank = anchor ? bayerRank(...anchor) : bayerRank(x, y);
      const noise = interiorColor ? (rank - 0.5) * dither : 0;
      let selected = nearest(native.map(v => Math.max(0, Math.min(1, v + noise))), palette, false);
      let c = Array.from(mapped(selected));
      const votes = new Map(); let best = -1, bestSample = 0, score = 0, coverage = 0;
      ids.forEach((id, j) => {
        if (depth[id] >= 0.995) return;
        coverage++;
        const label = nearest(samples[j], palette, true), n = (votes.get(label) || 0) + 1;
        votes.set(label, n);
      });
      ids.forEach((id, j) => {
        if (depth[id] >= 0.995) return;
        const label = nearest(samples[j], palette, true), n = votes.get(label);
        if (n > score) { best = label; score = n; bestSample = j; }
      });
      if (best >= 0) {
        const outer = coverage < 4 || [z(x - 1, y), z(x + 1, y), z(x, y - 1), z(x, y + 1)].some(d => d >= 0.995);
        if (outer && contour) {
          selected = best;
          if (trace) trace.method = 'contour-vote';
          const body = mapped(best), tone = ink(Array.from(body)), background = mapped(0), a = coverage / 4;
          c = body.map((v, k) => background[k] * (1 - a) + (v * 0.35 + tone[k] * 0.65) * a);
        }
      }
      if (trace) {
        if (!trace.method && dither && interiorColor) trace.dither = {mode:'ordered-bias',pattern:'bayer',
          coordinates:anchor ?? [x,y],rank,strength:dither,bias:noise};
        inspect.scene(trace.method === 'contour-vote' ? samples[bestSample] : native,
          inspect.colors,selected,trace.method,trace);
      }
      use[selected]++;
      const q = ((height - 1 - y) * width + x) * 3;
      c.forEach((v, k) => { rgb[q + k] = Math.round(Math.max(0, Math.min(1, v)) * 255); });
    }
    return { w: width, h: height, rgb, use, ...(local && { palette: local.output.packed }) };
  }
  const glsl = `
int pixelNearest(vec3 c, bool solid) {
  int best = solid && u_n > 1 ? 1 : 0; float bd = 1e9;
  for (int i = 0; i < 48; i++) {
    if (i >= u_n) break; if (solid && i == 0 && u_n > 1) continue;
    vec3 df = c - u_pal[i]; float d = dot(df * df, vec3(0.30, 0.55, 0.15));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
vec3 pixelMapped(int i) { return u_grade > 0.5 ? u_out[i] : u_pal[i]; }
ivec2 pixelAt(ivec2 p) { return clamp(p, ivec2(0), textureSize(u_depth, 0) - 1); }
float pixelDepth(ivec2 p) {
  ivec2 q = p * 2; float d = 1.0;
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) d = min(d, texelFetch(u_depth, pixelAt(q + ivec2(x, y)), 0).r);
  return d;
}
#ifndef PIXEL_NATIVE
vec3 pixelNative(ivec2 p) { return texelFetch(u_crispScene, p, 0).rgb; }
#endif
vec3 pixelResolve(ivec2 p) {
  vec3 samples[4]; int labels[4]; bool solid[4]; float coverage = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 q = pixelAt(p * 2 + ivec2(i & 1, i >> 1));
    samples[i] = texelFetch(u_scene, q, 0).rgb;
    solid[i] = texelFetch(u_depth, q, 0).r < 0.995;
    labels[i] = pixelNearest(samples[i], solid[i]); if (solid[i]) coverage += 0.25;
  }
  vec3 native = pixelNative(p);   // (a page may define PIXEL_NATIVE and its own pixelNative, to work on the native picture first: glass, contact shade)
  float noise = ((BAYER[(p.x & 3) + ((p.y & 3) << 2)] + 0.5) / 16.0 - 0.5) * u_dither;
  vec3 c = pixelMapped(pixelNearest(clamp(native + noise, 0.0, 1.0), false)); int best = -1, score = 0;
  for (int i = 0; i < 4; i++) {
    if (!solid[i]) continue; int n = 0;
    for (int j = 0; j < 4; j++) if (solid[j] && labels[j] == labels[i]) n++;
    if (n > score) { best = labels[i]; score = n; }
  }
  if (best >= 0) {
    bool outer = coverage < 1.0 || max(max(pixelDepth(p - ivec2(1, 0)), pixelDepth(p + ivec2(1, 0))),
      max(pixelDepth(p - ivec2(0, 1)), pixelDepth(p + ivec2(0, 1)))) >= 0.995;
    if (outer) {
      vec3 body = pixelMapped(best);
      vec3 tone = body * 0.64; tone = min(vec3(1.0), tone * max(1.0, 0.12 / max(dot(tone, vec3(0.30, 0.55, 0.15)), 0.001)));
      c = mix(pixelMapped(0), mix(body, tone, 0.65), coverage);
    }
  }
  return c;
}`;
  const toneGlsl = `
uniform int u_inkToneCount;
uniform float u_inkToneCutoff;
uniform float u_inkToneAmount;
uniform vec4 u_inkToneStops[48]; // RGB color and stop position
uniform highp sampler2D u_inkToneRanks; // normalized threshold tile

vec3 inkToneResolve(vec3 color, ivec2 pixel) {
  float luma = dot(color, vec3(0.30, 0.55, 0.15));
  if (luma <= u_inkToneCutoff) return u_inkToneStops[0].rgb;
  float value = (luma - u_inkToneCutoff) / (1.0 - u_inkToneCutoff);
  int low = 0;
  for (int i = 1; i < 47; i++) {
    if (i >= u_inkToneCount - 1 || value <= u_inkToneStops[i].a) break;
    low = i;
  }
  vec4 a = u_inkToneStops[low], b = u_inkToneStops[low + 1];
  float share = (value - a.a) / (b.a - a.a);
  float rank = texelFetch(u_inkToneRanks, pixel % textureSize(u_inkToneRanks, 0), 0).r;
  return share >= mix(0.5, rank, u_inkToneAmount) ? b.rgb : a.rgb;
}`;
  return { nearest, rgbWeights:weights, ink, resolve, glsl, presets, toneSettings, prepareTone, toneIndex, toneGlsl, bayerRank, outputPalettes, localIndex,
    bindRoles, roleColor, paletteSelector, reserveEntries, preparePalette, prepareLookPolicy, preparePaletteConstraints, paletteIndex, mediumTransform,
    prepareRemap, gradePalette, prepareColorStack, colorGrade, framePalette };
})();
if (typeof module !== 'undefined') module.exports = PixelLook;
