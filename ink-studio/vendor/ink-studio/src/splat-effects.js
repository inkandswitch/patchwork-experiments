/* Projected surface effects shared by the software renderer and browser hosts. */
const SplatEffects = (() => {
  let curves, luts, stacks, paletteFields;
  try {
    curves = ColorCurves;
    luts = ColorLUT;
    stacks = ColorStack;
    paletteFields = PaletteFields;
  } catch {
    curves = require('./color-curves.js');
    luts = require('./color-lut.js');
    stacks = require('./color-stack.js');
    paletteFields = require('./palette-fields.js');
  }
  const contribution = typeof ContributionRules === 'undefined' ? require('./contribution-rules.js') : ContributionRules;
  const fieldBands = typeof FieldBands === 'undefined' ? require('./field-bands.js') : FieldBands;
  const clamp = x => Math.min(1, Math.max(0, x));
  const fract = x => x - Math.floor(x);
  const vector = (value, n) => Array.isArray(value) && value.length === n && Array.from(value).every(Number.isFinite);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const subtract = (a, b) => a.map((value, i) => value - b[i]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function unit(v) {
    const length = Math.hypot(...v);
    if (!(length > 1e-8 && Number.isFinite(length))) throw new RangeError('Projection axes need distinct, nonzero directions');
    return v.map(x => x / length);
  }
  function smooth(lo, hi, value) {
    const x = clamp((value - lo) / (hi - lo));
    return x * x * (3 - 2 * x);
  }

  function project({ type = 'plane', origin = [0, 0, 0], along = [1, 0, 0], across = [0, 0, 1],
    up = [0, 1, 0], points, radius = 1 } = {}) {
    if (!vector(origin, 3) || !vector(along, 3) || !vector(across, 3) || !vector(up, 3))
      throw new TypeError('Projections need finite XYZ axes and origin');
    if (type === 'ribbon') {
      if (!Array.isArray(points) || points.length < 2 || points.length > 64 ||
          !Array.from(points).every(point => vector(point, 3)))
        throw new TypeError('Ribbon projection needs 2–64 world-space points');
      let length = 0;
      const segments = points.slice(1).map((end, i) => {
        const start = points[i].slice();
        const delta = subtract(end, start);
        const axis = unit(delta);
        const segment = {
          start, axis, cross: unit(cross(axis, up)), size: Math.hypot(...delta), at: length,
          first: i === 0, last: i === points.length - 2
        };
        length += segment.size;
        return segment;
      });
      return position => {
        let best = Infinity, u = 0, v = 0;
        for (const segment of segments) {
          const dx = position[0] - segment.start[0], dy = position[1] - segment.start[1], dz = position[2] - segment.start[2];
          const along = dx * segment.axis[0] + dy * segment.axis[1] + dz * segment.axis[2];
          const t = Math.max(0, Math.min(segment.size, along));
          const distance = (dx - t * segment.axis[0]) ** 2 + (dy - t * segment.axis[1]) ** 2 + (dz - t * segment.axis[2]) ** 2;
          if (distance >= best) continue;
          best = distance;
          u = segment.at + ((segment.first && along < 0) || (segment.last && along > segment.size) ? along : t);
          v = dx * segment.cross[0] + dy * segment.cross[1] + dz * segment.cross[2];
        }
        return [u, v];
      };
    }
    const x = unit(along);
    if (type === 'plane') {
      const {z} = contribution.plane({along:x,across});
      return position => {
        const q = subtract(position, origin);
        return [dot(q, x), dot(q, z)];
      };
    }
    if (type === 'cylinder') {
      if (!(Number.isFinite(radius) && radius > 0)) throw new RangeError('Cylinder projection needs a positive radius');
      const y = unit(up), z = unit(cross(y, x)), radial = cross(z, y);
      return position => {
        const q = subtract(position, origin);
        return [fract(Math.atan2(dot(q, z), dot(q, radial)) / (Math.PI * 2) + 1) * Math.PI * 2 * radius, dot(q, y)];
      };
    }
    throw new RangeError('Unknown projection: ' + type);
  }

  // Each motif produces a distance in one repeat, so the same footprint can
  // antialias a thin hatch and a broad contour without softening raster art.
  const line = x => Math.abs(fract(x + 0.5) - 0.5);
  const motifs = {
    stripes: (u, v) => line(v),
    hatch: (u, v) => Math.min(line(u + v), line(u - v)),
    chevrons: (u, v) => line(v + line(u)),
    rings: (u, v) => Math.abs(Math.hypot(fract(u) - 0.5, fract(v) - 0.5) - 0.27),
    dots: (u, v) => Math.hypot(fract(u) - 0.5, fract(v) - 0.5),
    checker: (u, v) => (Math.floor(u * 2) + Math.floor(v * 2)) & 1
  };

  function raster(spec = {}) {
    const { width, height, frames, fps = 1, channels = 4, repeat = false, wrap = false } = spec;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        ![3, 4].includes(channels) || !Array.isArray(frames) || !frames.length ||
        width * height * frames.length > 2 ** 20 || !Number.isFinite(fps) || fps <= 0 ||
        typeof repeat !== 'boolean' || typeof wrap !== 'boolean')
      throw new TypeError('Raster effects need bounded RGB or RGBA frames and a positive frame rate');
    const pixels = Array.from(frames, frame => {
      if (!(Array.isArray(frame) || ArrayBuffer.isView(frame)) || frame.length !== width * height * channels ||
          !Array.from(frame).every(n => Number.isInteger(n) && n >= 0 && n <= 255))
        throw new TypeError('Raster frames need one RGB or RGBA byte tuple per pixel');
      return Uint8Array.from(frame);
    });
    return (u, v, time, result) => {
      if (!wrap && (u < 0 || v < 0 || u >= 1 || v >= 1)) return 0;
      const frame = Math.max(0, Math.floor(time * fps));
      const data = pixels[repeat ? frame % pixels.length : Math.min(frame, pixels.length - 1)];
      const q = (Math.floor(fract(v) * height) * width + Math.floor(fract(u) * width)) * channels;
      for (let k = 0; k < 3; k++) result[k] = data[q + k] / 255;
      return channels === 4 ? data[q + 3] / 255 : 1;
    };
  }

  function indexedRaster(spec = {}, cycles = {}, resolveColor, roles) {
    const { width, height, slots, size = [1, 1], wrap = false, palette, origin = 'bottom-left' } = spec;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width * height > 2 ** 20 || !Array.isArray(slots) || slots.length !== width * height ||
        !vector(size, 2) || size.some(value => value <= 0) || typeof wrap !== 'boolean' ||
        !['top-left','bottom-left'].includes(origin))
      throw new TypeError('Indexed rasters need bounded dimensions, one slot per texel, a valid origin and a positive size');
    if (!cycles || Object.getPrototypeOf(cycles) !== Object.prototype)
      throw new TypeError('Palette cycles must be named in an object');
    const local = outputColors(palette,resolveColor), swatches = new Map();
    const add = slot => {
      if (!Number.isInteger(slot) || slot < 0 || slot >= (local?.length ?? 0xffffffff))
        throw new RangeError('Indexed raster slots must be valid palette indices');
      if (!swatches.has(slot)) swatches.set(slot, local ? local[slot] : resolveColor(slot));
      return slot;
    };
    // Null paint leaves the underlying surface visible. Zero is a palette slot.
    const texels = Uint32Array.from(slots, slot => slot === null ? 0 : add(slot) + 1);
    const claimed = new Set();
    const groups = Object.entries(cycles).map(([name, cycle]) => {
      if (!name.trim() || !cycle || Object.getPrototypeOf(cycle) !== Object.prototype ||
          Object.keys(cycle).some(key => !['role', 'slots', 'period', 'direction', 'phase'].includes(key)))
        throw new TypeError('Each palette cycle needs a name and cycle settings');
      const { role, slots, period, direction = 'forward', phase = 0 } = cycle;
      if (role !== undefined && local) throw new TypeError('Palette cycles with a local palette need explicit slots');
      if ((role === undefined) === (slots === undefined))
        throw new TypeError('Palette cycle ' + name + ' needs either a role or a list of slots');
      const order = role === undefined ? slots :
        typeof role === 'string' && Object.hasOwn(roles, role) && roles[role];
      if (!Array.isArray(order) || order.length < 2 || !Number.isFinite(period) || period <= 0 ||
          !['forward', 'reverse'].includes(direction) || !Number.isFinite(phase))
        throw new RangeError('Palette cycle ' + name + ' needs two or more slots, a positive period and valid direction and phase');
      const indices = Array.from(order, add);
      for (const slot of indices) {
        if (claimed.has(slot)) throw new RangeError('Palette cycles cannot share a slot within one raster');
        claimed.add(slot);
      }
      return { indices, period, direction: direction === 'forward' ? 1 : -1, phase: fract(phase) };
    });
    const active = new Map(swatches);
    const [spanU, spanV] = size;
    let lastTime;
    return {
      palette: Array.from(swatches.values()),
      sample(u, v, time, result) {
        u /= spanU;
        v /= spanV;
        if (!Number.isFinite(u) || !Number.isFinite(v) || (!wrap && (u < 0 || v < 0 || u >= 1 || v >= 1))) return 0;
        const x = Math.min(width - 1, Math.floor(fract(u) * width));
        const y = Math.min(height - 1, Math.floor(fract(v) * height));
        const row = origin === 'top-left' ? height-1-y : y;
        const slot = texels[row * width + x] - 1;
        if (slot === -1) return 0;
        if (!Number.isFinite(time)) time = 0;
        if (lastTime !== time) {
          for (const { indices, period, direction, phase } of groups) {
            const length = indices.length;
            const position = fract((time % period) / period + phase) * length;
            // A decimal period can land just below the step when sampled on its loop boundary.
            const step = Math.floor(position + 4 * Number.EPSILON * length);
            const offset = length + direction * step;
            indices.forEach((index, i) => active.set(index, swatches.get(indices[(i + offset) % length])));
          }
          lastTime = time;
        }
        const rgb = active.get(slot);
        for (let k = 0; k < 3; k++) result[k] = rgb[k];
        return 1;
      }
    };
  }

  function coordinates({ projection = {}, space = 'rest', field }, channels, context) {
    if (space !== 'rest' && space !== 'world') throw new TypeError('Projection space must be rest or world');
    const source = Object.hasOwn(context?.fields || {}, field) ? context.fields[field] : undefined;
    if ((field !== undefined || channels.length) && (!source || typeof source.frame !== 'function' || !Array.isArray(source.channels)))
      throw new RangeError('Unknown projected field: ' + field);
    for (const name of channels)
      if (!source.channels.includes(name)) throw new RangeError('Unknown field channel: ' + name);
    const mapping = typeof projection === 'function' ? projection : project(projection);
    let frame, frameTime, revision;
    return sample => {
      const point = pointFor(sample, space);
      const uv = mapping(point, sample);
      if (!uv || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) return null;
      const time = sample.time || 0;
      if (source && (frameTime !== time || revision !== source.revision)) {
        frame = source.frame(time);
        frameTime = time;
        revision = source.revision;
      }
      const [u, v] = uv;
      return { u, v, at: name => (source?.dimensions === 3 ?
        frame?.sample(name, ...point) : frame?.sample(name, u, v)) ?? 0 };
    };
  }

  function fieldMask(definition, context) {
    const { channel, range = [0, 1], invert = false } = definition;
    if (typeof channel !== 'string' || !vector(range, 2) || !(range[1] > range[0]))
      throw new TypeError('Field masks need a channel and increasing range');
    const lookup = coordinates(definition, [channel], context);
    return sample => {
      const loc = lookup(sample);
      const coverage = loc ? smooth(...range, loc.at(channel)) : 0;
      return invert ? 1 - coverage : coverage;
    };
  }

  const pointFor = (sample, space) => space === 'world' ? sample.worldPosition ?? sample.position : sample.position;
  function queried(source, context) {
    const { field, path = [], args, fallback, space = 'world' } = source;
    if (typeof field !== 'string' || !field.trim() || !['rest', 'world'].includes(space) ||
        (fallback !== undefined && !Number.isFinite(fallback)))
      throw new TypeError('A query sample needs a field, valid space and optional finite fallback');
    if (!Array.isArray(path) || path.length > 64 || !Array.from(path).every(key =>
      typeof key === 'string' && key.length || Number.isSafeInteger(key) && key >= 0))
      throw new TypeError('Query paths need property names or array indices');
    if (args !== undefined && (!args || Object.getPrototypeOf(args) !== Object.prototype))
      throw new TypeError('Query arguments need a settings object');
    return sample => {
      const point = pointFor(sample, space);
      const result = point && context?.query?.probe(field, point, args);
      let value = result?.status === 'ok' ? result.value : undefined;
      for (const key of path) value = value != null && Object.hasOwn(value, key) ? value[key] : undefined;
      return Number.isFinite(value) ? value : fallback;
    };
  }

  function prepareMask(definition, context, { validateOnly = false } = {}) {
    if (definition === undefined || definition === false) return null;
    if (!definition || Object.getPrototypeOf(definition) !== Object.prototype)
      throw new TypeError('Expected spatial mask settings or false');
    const { type, range = [0, 1], invert = false, interpolation = 'smooth' } = definition;
    const space = definition.space ?? (type === 'query' ? 'world' : 'rest');
    if (!vector(range, 2) || !(range[1] > range[0]) || !Number.isFinite(range[1] - range[0]) ||
        typeof invert !== 'boolean' || !['linear', 'smooth', 'step'].includes(interpolation) ||
        !['world', 'rest'].includes(space))
      throw new RangeError('A mask needs increasing finite bounds, a space, interpolation and a boolean invert');
    let read;
    switch (type) {
      case 'axis': {
        const {direction,offset} = contribution.axis(definition);
        read = sample => {
          const point = pointFor(sample, space);
          return point && dot(point, direction) + offset;
        };
        break;
      }
      case 'field': {
        const { channel, field } = definition;
        if (typeof channel !== 'string' || !channel || typeof field !== 'string' || !field)
          throw new TypeError('A projected field mask needs a field and channel');
        const lookup = coordinates({ ...definition, space }, [channel],
          validateOnly && !context?.fields?.[field] ? { fields: { [field]: { channels: [channel], frame: () => null } } } : context);
        read = sample => pointFor(sample, space) ? lookup(sample)?.at(channel) : undefined;
        break;
      }
      case 'query':
        read = queried({ ...definition, space }, context);
        break;
      case 'texture': {
        const { channel = 'alpha', scale = [1, 1], offset = [0, 0], raster: texture } = definition;
        const channels = ['red', 'green', 'blue', 'luminance', 'alpha'];
        if (!channels.includes(channel) || !vector(scale, 2) || scale.some(n => n <= 0) || !vector(offset, 2))
          throw new TypeError('A texture mask needs a channel, positive XY scale and finite offset');
        const lookup = coordinates({ projection: definition.projection, space }, [], context);
        const pixels = raster(texture), color = [0, 0, 0], slot = channels.indexOf(channel);
        read = sample => {
          const loc = pointFor(sample, space) && lookup(sample);
          if (!loc) return undefined;
          const alpha = pixels((loc.u - offset[0]) / scale[0], (loc.v - offset[1]) / scale[1], sample.time ?? 0, color);
          return slot === 4 || !alpha ? alpha : alpha * (slot === 3 ? dot(color, [.30, .55, .15]) : color[slot]);
        };
        break;
      }
      default: throw new RangeError('Unknown spatial mask: ' + type);
    }
    return sample => {
      const value = read(sample);
      if (!Number.isFinite(value)) return 0;
      const x = clamp((value - range[0]) / (range[1] - range[0]));
      const amount = interpolation === 'smooth' ? x * x * (3 - 2 * x) : interpolation === 'step' ? Number(x === 1) : x;
      return invert ? 1 - amount : amount;
    };
  }

  function outputColors(values, resolveColor) {
    if (values === undefined) return undefined;
    if (!Array.isArray(values) || !values.length || values.length > 48 || !Array.from(values).every(value => value !== undefined))
      throw new TypeError('Surface output palettes need 1–48 colors');
    return values.map(resolveColor);
  }

  function curveSource(source, context) {
    if (source === 'luminance') return null;
    if (source === 'height') return sample => (sample.worldPosition ?? sample.position)[1];
    if (source === 'depth') return sample => sample.depth;
    if (typeof source === 'function') return source;
    if (!source || Object.getPrototypeOf(source) !== Object.prototype || typeof source.field !== 'string' || !source.field.trim())
      throw new TypeError('Color ramps need luminance, height, depth, a sampler or a named field');
    if (source.fallback !== undefined && !Number.isFinite(source.fallback))
      throw new TypeError('Color ramp fallback must be finite');
    if (source.channel !== undefined) {
      if (typeof source.channel !== 'string' || !source.channel)
        throw new TypeError('Projected color ramps need a named channel');
      const lookup = coordinates(source, [source.channel], context);
      return sample => lookup(sample)?.at(source.channel) ?? source.fallback;
    }
    if (typeof context?.query?.probe !== 'function')
      throw new TypeError('A world field ramp needs a scene query snapshot');
    return queried(source, context);
  }

  function colorCurve({ ramp, paletteRamp, channels, color, source = 'luminance', outputPalette }, context, resolveColor) {
    if (paletteRamp !== undefined && (ramp !== undefined || channels !== undefined || color !== undefined))
      throw new TypeError('A palette ramp uses its own color and ramp controls');
    const paletteTransfer = paletteRamp === undefined ? null : paletteFields.ramp(paletteRamp,resolveColor);
    if (ramp === undefined && !paletteTransfer && source !== 'luminance')
      throw new TypeError('A color curve source requires a ramp');
    const rampAt = time => paletteTransfer.frame?.(time) ?? paletteTransfer;
    const transfer = paletteTransfer ? (base,out,value = curves.luminance(base),time) => rampAt(time).sample(value,out) :
      curves.prepare({ ramp, channels, color }, resolveColor);
    const lookup = ramp === undefined && !paletteTransfer ? null : curveSource(source, context);
    const result = [0, 0, 0, 0, 1, 0];
    const explicit = outputColors(outputPalette, resolveColor);
    return {
      palette: explicit ?? paletteTransfer?.outputPalette,
      ...(!explicit && paletteTransfer?.frame && { paletteAt:time=>rampAt(time).outputPalette }),
      depth: source === 'depth',
      sample(sample, base) {
        const value = lookup?.(sample, base);
        result[3] = lookup && !Number.isFinite(value) ? 0 : 1;
        if (result[3]) transfer(base, result, value, sample.time ?? 0);
        return result;
      }
    };
  }

  function rgbEffect(transfer, outputPalette, resolveColor) {
    const result = [0, 0, 0, 1, 1, 0];
    return {
      palette: outputColors(outputPalette, resolveColor),
      sample(sample, base) { return transfer(base, result); }
    };
  }

  function colorLut({ lut, outputPalette }, resolveColor) {
    return rgbEffect(luts.prepare(lut).apply, outputPalette, resolveColor);
  }

  function colorStack({ stack, outputPalette }, resolveColor) {
    const plan = stacks.prepare(stack, { resolveColor });
    if (!plan) throw new TypeError('A colorStack layer needs a stack definition');
    return rgbEffect(plan.sample, outputPalette, resolveColor);
  }

  function paletteAxes(definition, label, signals) {
    if (definition === undefined) return [];
    if (!definition || Object.getPrototypeOf(definition) !== Object.prototype)
      throw new TypeError('Palette axes must name axis bindings');
    const allowed = label === 'hueBrightness' || label === 'polar'
      ? ['u','v','hue','brightness','saturation'] : ['u','v'];
    return Object.entries(definition).map(([axis,binding])=>{
      if (!allowed.includes(axis) || !binding || Object.getPrototypeOf(binding) !== Object.prototype ||
          Object.keys(binding).some(key=>!['signal','range'].includes(key)))
        throw new TypeError('Invalid palette axis binding for ' + axis);
      const { signal:id, range = [0,1] } = binding, signal = signals?.get(id);
      if (!signal) throw new TypeError('Palette axis ' + axis + ' needs a named surface signal');
      if (!vector(range,2) || !Number.isFinite(range[1]-range[0]) ||
          (axis !== 'hue' && range.some(value=>value<0 || value>1)))
        throw new RangeError('Palette axis ' + axis + ' needs a finite output range' + (axis === 'hue' ? ' in turns' : ' in [0, 1]'));
      return {axis,signal,low:range[0],span:range[1]-range[0]};
    });
  }

  function paletteFieldLayer(value, resolveColor, label, bindings) {
    const polar = label === 'polar';
    if (!value || Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError('Projected palette field needs a ' + label + ' definition');
    const { size = [1, 1], wrap = false, ...definition } = value;
    const isRamp = label === 'ramp', axis = isRamp ? definition.axis ?? 'along' : undefined;
    if (isRamp) {
      if (!['along','across'].includes(axis)) throw new RangeError('Projected ramp axis must be along or across');
      delete definition.axis;
    }
    if (!vector(size, 2) || size.some(n => n <= 0) || typeof wrap !== 'boolean')
      throw new RangeError('Projected palette fields need a positive size and optional wrap');
    const field = paletteFields[label](definition, resolveColor);
    const fieldAt = time => field.frame?.(time) ?? field;
    const [spanU, spanV] = size;
    const diameter = Math.min(spanU, spanV);
    const fitU = spanU / diameter, fitV = spanV / diameter;
    if (polar && (!Number.isFinite(fitU) || !Number.isFinite(fitV)))
      throw new RangeError('Projected polar field aspect ratio must be finite');
    const axes = bindings.length ? Object.create(null) : undefined;
    return {
      palette: field.outputPalette ?? field.palette,
      ...(field.frame && { paletteAt(time) {
        const current = fieldAt(time);
        return current.outputPalette ?? current.palette;
      } }),
      boundAxes: Boolean(axes),
      weather: bindings.some(binding=>binding.signal.weather),
      sample(u, v, time, out, readSignal) {
        u /= spanU;
        v /= spanV;
        if (!Number.isFinite(u) || !Number.isFinite(v) || (!wrap && (u < 0 || v < 0 || u > 1 || v > 1))) return 0;
        if (axes) for (const {axis,signal,low,span} of bindings) axes[axis] = low+span*(readSignal?.(signal) ?? 0);
        const x = axes?.u ?? (wrap ? fract(u) : u), y = axes?.v ?? (wrap ? fract(v) : v);
        const current = fieldAt(time);
        if (isRamp) { current.sample(axis === 'across' ? y : x,out); return 1; }
        return Number(Boolean(polar ? current.sample(.5 + (x - .5) * fitU, .5 + (y - .5) * fitV, out, axes) :
          current.sample(x, y, out, axes)));
      }
    };
  }

  function layer(definition, context, resolveColor, roles = {}, signals) {
    const { projection = {}, space = 'rest', field, maskChannel, revealChannel, contourChannel,
      warpChannels, warp = 1, range = [0, 1], scroll = [0, 0], scale = 1, width = 0.16,
      pattern = 'solid', color, colors, outputPalette, ink = false, bandChannel, bands } = definition;
    if (!['rest', 'world'].includes(space) || !vector(scroll, 2) || !vector(range, 2) || !(range[1] > range[0]) ||
        !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(width) || width <= 0 ||
        !Number.isFinite(warp) || (warpChannels && (!Array.isArray(warpChannels) || warpChannels.length !== 2)))
      throw new TypeError('Projected layers need a valid space, scale, range and scroll');
    if (pattern === 'bands' ? typeof bandChannel !== 'string' || colors !== undefined :
        bands !== undefined || bandChannel !== undefined)
      throw new TypeError('Projected bands need a bandChannel and their own color stops');
    const stepped = pattern === 'bands' ? fieldBands.bind(fieldBands.settings(bands), resolveColor) : null;
    const channels = [maskChannel, revealChannel, contourChannel, bandChannel, ...(warpChannels || [])].filter(name => name !== undefined);
    const lookup = coordinates({ projection, space, field }, channels, context);
    if (pattern === 'contour' && !contourChannel) throw new TypeError('Contours need a contourChannel');
    const indexed = pattern === 'indexed' ? indexedRaster(definition.raster, definition.cycles, resolveColor, roles) : null;
    const paletteKey = pattern === 'hue-brightness' ? 'hueBrightness' :
      pattern === 'polar-colour' ? 'polar' : pattern === 'chroma-field' ? 'chromaField' :
      pattern === 'palette-coverage' ? 'coverage' : pattern === 'palette-ramp' ? 'ramp' : undefined;
    const paletteField = paletteKey && paletteFieldLayer(
      definition[paletteKey === 'ramp' ? 'paletteRamp' : paletteKey],resolveColor,paletteKey,
      paletteAxes(definition.axes,paletteKey,signals));
    const pixels = indexed?.sample ?? paletteField?.sample ?? (pattern === 'raster' ? raster(definition.raster) : null);
    const custom = typeof pattern === 'function' ? pattern :
      Object.hasOwn(context?.shaders || {}, pattern) ? context.shaders[pattern] : null;
    if (custom !== null && typeof custom !== 'function') throw new TypeError('A projected shader must be a function');
    if (!stepped && !pixels && !custom && !['solid', 'contour'].includes(pattern) && !Object.hasOwn(motifs, pattern))
      throw new RangeError('Unknown projected pattern: ' + pattern);
    if (colors !== undefined && (!Array.isArray(colors) || colors.length < 2 || !Array.from(colors).every(value => value !== undefined)))
      throw new TypeError('Projected color ramps need at least two colors');
    const explicit = outputColors(outputPalette, resolveColor);
    const palette = explicit ?? indexed?.palette ?? stepped?.palette ?? paletteField?.palette;
    const ramp = colors?.map(resolveColor);
    const tint = resolveColor(color);
    const result = new Float64Array(6); // RGB, amount, coverage, glint
    const detailSize = Object.hasOwn(motifs,pattern) ? scale * (pattern === 'checker' ? .5 : width) : 0;
    return {
      palette, ...(!explicit && paletteField?.paletteAt && { paletteAt:paletteField.paletteAt }),
      detailSize, boundAxes: paletteField?.boundAxes, weather: paletteField?.weather,
      reveals: revealChannel !== undefined || Boolean(custom),
      sample(sample, base, _layer, readSignal) {
        result[0] = tint[0]; result[1] = tint[1]; result[2] = tint[2];
        result[3] = 0; result[4] = 1; result[5] = 0;
        const time = sample.time || 0;
        const coord = lookup(sample);
        if (!coord) {
          if (revealChannel) result[4] = 0;
          return result;
        }
        const { u, v, at } = coord;
        const x = (u + time * scroll[0] + (warpChannels ? at(warpChannels[0]) * warp : 0)) / scale;
        const y = (v + time * scroll[1] + (warpChannels ? at(warpChannels[1]) * warp : 0)) / scale;
        const mask = maskChannel ? smooth(...range, at(maskChannel)) : 1;
        const footprint = (sample.footprint || 0) / scale;
        result[4] = revealChannel ? smooth(...range, at(revealChannel)) : 1;
        let amount = 1;
        if (ramp) {
          const value = clamp(at(contourChannel || maskChannel || revealChannel));
          const t = value * (ramp.length - 1), low = Math.min(ramp.length - 2, Math.floor(t));
          for (let k = 0; k < 3; k++) result[k] = ramp[low][k] + (ramp[low + 1][k] - ramp[low][k]) * (t - low);
        }
        if (stepped) {
          const band = stepped.sample(at(bandChannel));
          amount = Number(Boolean(band));
          if (band) result.set(band.rgb, 0);
        } else if (pixels) amount = pixels(x, y, time, result, readSignal);
        else if (custom) {
          // Custom JS effects can set RGB, amount, coverage and glint in their sample.
          result[3] = 1;
          const returned = custom({ u, v, x, y, time, sample, base, field: at, settings: definition }, result);
          if (returned && typeof returned.then === 'function') throw new TypeError('Projected shaders must be synchronous');
          if (!result.every(Number.isFinite)) throw new TypeError('Projected shader outputs must be finite');
          amount = result[3];
        } else if (pattern !== 'solid') {
          const distance = pattern === 'contour' ? line(at(contourChannel) / scale) : motifs[pattern](x, y);
          amount = 1 - smooth(width * 0.5, width * 0.5 + Math.max(0.002, footprint * 0.5), distance);
        }
        result[3] = clamp(amount) * mask;
        if (ink) result[5] = Math.max(result[5], result[3]);
        return result;
      }
    };
  }

  return { project, layer, colorCurve, colorLut, colorStack, fieldMask, prepareMask, clamp, vector };
})();
if (typeof module !== 'undefined') module.exports = SplatEffects;
