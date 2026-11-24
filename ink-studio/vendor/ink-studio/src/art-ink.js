/* Art-pixel line classification and palettes. The inputs are top-down render passes. */
const ArtInk = (() => {
  const selectors = typeof TargetSelectors === 'undefined' ? require('./target-selectors.js') : TargetSelectors;
  const defaults = Object.freeze({
    silhouette: { steps: 1, litSteps: 0 },
    crease: { steps: 1, litSteps: 0 },
    boundary: { steps: 1, litSteps: 0 }
  });
  const kinds = Object.keys(defaults);
  const luma = (r, g, b) => .30 * r + .55 * g + .15 * b;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;

  function packed(value, palette) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return Number.parseInt(value.slice(1), 16);
    if (Number.isSafeInteger(value) && value >= 0 && value < palette.length) return palette[value];
    throw new TypeError('Ink colors must be #rrggbb or scene palette indices');
  }

  function colors(values, palette) {
    if (!Array.isArray(values) || !values.length || values.length > 64)
      throw new RangeError('Ink palettes need between one and 64 colors');
    return values.map(value => packed(value, palette));
  }

  function depthRange(value) {
    if (value === undefined || value === false) return value;
    if (!record(value) || Object.keys(value).some(key => key !== 'near' && key !== 'far') ||
        !Number.isFinite(value.near) || !Number.isFinite(value.far) || value.near < 0 || value.far < value.near)
      throw new RangeError('Ink distance needs finite scene units with 0 <= near <= far');
    return { near:value.near, far:value.far };
  }

  function lineRule(rule, palette) {
    if (rule === false) return null;
    if (rule === true) return {};
    if (!record(rule))
      throw new TypeError('Ink line rules must be true, false, or an object');
    const { color, highlight, shadow, steps, litSteps, distance } = rule;
    if (![steps, litSteps].every(value => value === undefined || Number.isSafeInteger(value) && Math.abs(value) <= 64))
      throw new RangeError('Ink steps must be integers between -64 and 64');
    return {
      ...(steps !== undefined && { steps }), ...(litSteps !== undefined && { litSteps }),
      ...(color !== undefined && { color:packed(color, palette) }),
      ...(highlight !== undefined && { highlight:packed(highlight, palette) }),
      ...(shadow !== undefined && { shadow:packed(shadow, palette) }),
      ...(distance !== undefined && { distance:depthRange(distance) })
    };
  }

  function stylePatch(style, palette, ramps) {
    if (!record(style)) throw new TypeError('Ink styles must be objects');
    const patch = {};
    for (const kind of kinds) if (style[kind] !== undefined) patch[kind] = lineRule(style[kind],palette);
    if (style.distance !== undefined) patch.distance = depthRange(style.distance);
    if (style.ramp !== undefined) patch.ramp = colors(style.ramp,palette);
    if (style.palette !== undefined) {
      if (!ramps.has(style.palette)) throw new RangeError('Unknown reserved palette ' + style.palette);
      patch.palette = style.palette;
    }
    return patch;
  }

  function applyStyle(base, patch) {
    const result = { ...base, ...patch };
    for (const kind of kinds) if (patch[kind]) result[kind] = { ...defaults[kind], ...base[kind], ...patch[kind] };
    return result;
  }

  function prepare(definition, palette) {
    if (!definition) return null;
    const settings = definition === true ? {} : definition;
    if (typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Expected an ink settings object');
    const {
      depthGap = .09, creaseCosine = .72, litAt = .38, suppressSameMaterial = true,
      light = [-.5, .8, .45], emissionThreshold = .25, fogThreshold = .25, materials = {}, reserved = {},
      occlusionSilhouettes = false, targets = []
    } = settings;
    if (!Number.isFinite(depthGap) || depthGap <= 0 ||
        ![creaseCosine, litAt].every(value => Number.isFinite(value) && Math.abs(value) <= 1) ||
        ![emissionThreshold, fogThreshold].every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
        !Array.isArray(light) || light.length !== 3 || !light.every(Number.isFinite) || !Math.hypot(...light) ||
        typeof suppressSameMaterial !== 'boolean' || typeof occlusionSilhouettes !== 'boolean')
      throw new RangeError('Invalid selective ink thresholds or light direction');
    if (!Array.isArray(targets) || targets.length > 128) throw new TypeError('Use an array of up to 128 ink targets');
    const length = Math.hypot(...light);
    const ramps = new Map(Object.entries(reserved).map(([key, value]) => [key, colors(value, palette)]));
    const base = applyStyle(defaults, stylePatch(settings,palette,ramps));
    const styles = new Map(Object.entries(materials).map(([name, style]) => [name, applyStyle(base,stylePatch(style,palette,ramps))]));
    const scoped = Array.from(targets, target => {
      if (!record(target) || Object.keys(target).some(key => !['select','distance','ramp','palette',...kinds].includes(key)))
        throw new TypeError('Ink targets need a selector and line settings');
      return { select:selectors.prepare(target.select), patch:stylePatch(target,palette,ramps) };
    });
    return { base, styles, scoped, ramps, depthGap, creaseCosine, litAt, suppressSameMaterial, occlusionSilhouettes,
      light: light.map(value => value / length), emissionThreshold, fogThreshold };
  }

  function bind(settings, world) {
    if (!world || !settings.scoped.length) return null;
    const { row } = selectors.index(world), cache = new WeakMap();
    return (i, base) => {
      if (i < 0 || i >= world.count) return base;
      const target = row(i);
      if (!cache.has(target)) {
        let style = base;
        for (const { select, patch } of settings.scoped) if (selectors.matches(select,target)) style = applyStyle(style,patch);
        cache.set(target,style);
      }
      return cache.get(target);
    };
  }

  function opacity(rule, shared, depth) {
    if (!rule) return 0;
    const range = rule.distance ?? shared;
    if (!range) return 1;
    if (depth >= range.far) return 0;
    return depth <= range.near ? 1 : (range.far-depth)/(range.far-range.near);
  }

  function closest(ramp, r, g, b) {
    let best = 0, score = Infinity;
    for (let i = 0; i < ramp.length; i++) {
      const color = ramp[i], dr = r - (color >> 16), dg = g - ((color >> 8) & 255), db = b - (color & 255);
      const candidate = .30 * dr * dr + .55 * dg * dg + .15 * db * db;
      if (candidate < score) {
        best = i;
        score = candidate;
      }
    }
    return best;
  }

  function apply(frame, passes, settings, palette, signals, { world, depthOffset = 0, inspect } = {}) {
    const { w, h, rgb } = frame;
    const { depth, normal, objectId, materialId, materials, emission, splatId } = passes;
    const mask = new Uint8Array(w * h);
    const { base, styles, ramps, depthGap, creaseCosine, litAt, light, suppressSameMaterial, occlusionSilhouettes } = settings;
    const scopedStyle = bind(settings,world);
    const byId = materials.map((label, id) => styles.get(String(label ?? id)) || base);
    const source = rgb.slice();
    const outputPalette = Array.from(frame.palette || palette);
    const known = new Map(outputPalette.map((color, index) => [color, index]));
    const counts = new Uint32Array(outputPalette.length);
    const additions = [];

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, q = p * 3;
      const id = objectId[p], material = materialId[p], materialStyle = byId[material] || base;
      const style = scopedStyle ? scopedStyle(splatId[p]-1,materialStyle) : materialStyle;
      let hasSilhouette = false, hasBoundary = false, hasCrease = false;
      if (Number.isFinite(depth[p])) {
        for (let i = 0; i < 4; i++) {
          const z = i === 0 ? (x > 0 ? p - 1 : -1) : i === 1 ? (x + 1 < w ? p + 1 : -1) :
            i === 2 ? (y > 0 ? p - w : -1) : (y + 1 < h ? p + w : -1);
          if (z < 0 || !Number.isFinite(depth[z])) {
            hasSilhouette = true;
            continue;
          }
          const dz = depth[z] - depth[p], sameMaterial = material > 0 && materialId[z] === material;
          const differentObject = id !== objectId[z] && (id || objectId[z]);
          if (occlusionSilhouettes && differentObject && dz > depthGap) {
            hasSilhouette = true;
            continue;
          }
          const split = differentObject || (material !== materialId[z] && (material || materialId[z]));
          if (split) {
            if ((!suppressSameMaterial || !sameMaterial) &&
                (dz > depthGap || (dz >= -depthGap && p < z))) hasBoundary = true;
            continue;
          }
          if (splatId[p] === splatId[z]) continue;
          const a = z * 3;
          const dot = normal[q] * normal[a] + normal[q + 1] * normal[a + 1] + normal[q + 2] * normal[a + 2];
          const aLength = Math.abs(normal[a]) + Math.abs(normal[a + 1]) + Math.abs(normal[a + 2]);
          const pLength = Math.abs(normal[q]) + Math.abs(normal[q + 1]) + Math.abs(normal[q + 2]);
          if (dz > depthGap || (Math.abs(dz) <= depthGap && p < z && aLength && pLength && dot < creaseCosine)) hasCrease = true;
        }
      }
      const r = source[q], g = source[q + 1], b = source[q + 2];
      let color = (r << 16) | (g << 8) | b;
      const emit = Math.max(emission[q], emission[q + 1], emission[q + 2]);
      const signal = signals?.[p] > settings.fogThreshold ? 'fog' : null;
      const emitting = emit >= settings.emissionThreshold && emit > 0;
      const reserved = (emitting && ramps.get('emission')) || ramps.get(signal || style.palette);
      if (reserved) {
        const index = closest(reserved, r, g, b);
        color = reserved[index];
        if (inspect?.pixel === p) inspect.ink(reserved,index,[r,g,b],emitting && ramps.has('emission') ? 'emission' : signal ?? style.palette,1);
        mask[p] = 4;
      } else {
        const distance = depth[p]-depthOffset;
        const silhouette = hasSilhouette && opacity(style.silhouette,style.distance,distance);
        const boundary = !silhouette && hasBoundary && opacity(style.boundary,style.distance,distance);
        const crease = !silhouette && !boundary && hasCrease && opacity(style.crease,style.distance,distance);
        const type = silhouette ? 'silhouette' : boundary ? 'boundary' : crease ? 'crease' : null;
        if (type) {
          const rule = style[type];
          const lit = (normal[q] || normal[q + 1] || normal[q + 2]) ?
            normal[q] * light[0] + normal[q + 1] * light[1] + normal[q + 2] * light[2] >= litAt : luma(r, g, b) > 160;
          const explicit = (lit ? rule.highlight : rule.shadow) ?? rule.color;
          const steps = lit ? rule.litSteps : rule.steps;
          if (explicit !== undefined) color = explicit;
          else if (steps) {
            const ramp = style.ramp;
            if (ramp) color = ramp[clamp(closest(ramp, r, g, b) - steps, 0, ramp.length - 1)];
            else {
              const gain = Math.pow(.73, steps);
              color = palette[closest(palette, r * gain, g * gain, b * gain)];
            }
          }
          const weight = silhouette || boundary || crease;
          if (inspect?.pixel === p && (explicit !== undefined || steps)) inspect.ink([color],0,[r,g,b],type,weight);
          if (weight < 1) color = Math.round(r+((color>>16)-r)*weight)*65536 +
            Math.round(g+((color>>8&255)-g)*weight)*256 + Math.round(b+((color&255)-b)*weight);
          if (color !== ((r << 16) | (g << 8) | b)) mask[p] = type === 'silhouette' ? 1 : type === 'crease' ? 2 : 3;
        }
      }
      rgb[q] = color >> 16;
      rgb[q + 1] = (color >> 8) & 255;
      rgb[q + 2] = color & 255;
      let index = known.get(color);
      if (index === undefined) {
        index = outputPalette.length;
        known.set(color, index);
        outputPalette.push(color);
        additions.push(0);
      }
      if (index < counts.length) counts[index]++;
      else additions[index - counts.length]++;
    }
    const use = new Uint32Array(outputPalette.length);
    use.set(counts);
    use.set(additions, counts.length);
    return { ...frame, palette: outputPalette, use, inkMask: mask };
  }

  const channels = Object.freeze(['depth', 'normal', 'objectId', 'materialId', 'emission', 'splatId']);
  return Object.freeze({ prepare, apply, channels });
})();
if (typeof module !== 'undefined') module.exports = ArtInk;
