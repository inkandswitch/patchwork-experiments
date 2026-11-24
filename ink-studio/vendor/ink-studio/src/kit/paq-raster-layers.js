/* Pixel-local layer ordering and straight-alpha compositing. */
(function (P) {
  const R = P.raster;
  const {dimensions, view, image, pair, byte, unit, aligned, readColor, readAlpha, coverage, remap} = P.rasterSupport;
  const white = [1, 1, 1], maxLayers = 512, maxVisits = 64e6;
  const multiply = (a, b) => a * b;
  const screen = (a, b) => a + b - a * b;
  const overlay = (a, b) => a < .5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
  const blends = {
    normal: (_, b) => b,
    multiply,
    screen,
    overlay,
    hardLight: (a, b) => overlay(b, a),
    softLight: (a, b) => b <= .5 ? a - (1 - 2 * b) * a * (1 - a) :
      a + (2 * b - 1) * ((a <= .25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a)) - a),
    add: (a, b) => Math.min(1, a + b),
    subtract: (a, b) => Math.max(0, a - b),
    darken: Math.min,
    lighten: Math.max,
    difference: (a, b) => Math.abs(a - b),
    exclusion: (a, b) => a + b - 2 * a * b
  };

  function mapValue(value, width, height) {
    if (Number.isFinite(value)) return () => value;
    const {data} = aligned(value, width, height, true);
    return i => data[i];
  }

  function tintValues(tint) {
    if (!Array.isArray(tint) || tint.length !== 3 || !Array.from(tint).every(n => Number.isFinite(n) && n >= 0 && n <= 1))
      throw new TypeError('Raster tint needs three RGB multipliers from 0 to 1');
    return tint;
  }

  function prepareLayer(layer, ordering, index) {
    const {source, x = 0, y = 0, mode = 'normal', opacity = 1, mask, maskOptions, tint = white} = layer ?? {};
    if (![x, y].every(Number.isSafeInteger) || !Object.hasOwn(blends, mode) || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw new RangeError('Raster layer needs integer offsets, a known blend and opacity from 0 to 1');
    const raster = view(source), {width, height} = raster;
    const level = ordering === 'stack' ? null : mapValue(layer[ordering] ?? 0, width, height);
    return {raster, x, y, index, blend: blends[mode], opacity, level, tint: tintValues(tint),
      mask: mask === undefined ? null : coverage(mask, width, height, maskOptions)};
  }

  function composite(state, {layer, at, alpha}, front) {
    const oldAlpha = state[3], retained = 1 - alpha * front;
    for (let c = 0; c < 3; c++) {
      const source = readColor(layer.raster, at, c) * layer.tint[c] / 255;
      const blended = oldAlpha ? layer.blend(state[c] / oldAlpha, source) : source;
      state[c] = state[c] * retained + alpha * ((1 - oldAlpha) * source + oldAlpha * front * blended);
    }
    state[3] = oldAlpha + alpha * (1 - oldAlpha);
  }

  function stack({width, height, layers, ordering = 'stack', softness = 0, bias = 0} = {}) {
    dimensions(width, height);
    if (!['stack', 'depth', 'height'].includes(ordering) || !Array.isArray(layers) || layers.length > maxLayers ||
        !Number.isFinite(softness) || softness < 0 || !Number.isFinite(bias))
      throw new RangeError('Invalid raster stack layers, ordering or height blend options');
    const pixels = width * height;
    if (pixels * layers.length > maxVisits) throw new RangeError('Raster stack exceeds its layer visit budget');
    const ordered = Array.from(layers, (layer, i) => prepareLayer(layer, ordering, i));
    const color = new Uint8Array(pixels * 4), scalar = ordering === 'stack' ? null : new Float64Array(pixels);
    const hits = [], entries = ordered.map(layer => ({layer, at: 0, alpha: 0, level: 0}));
    const state = new Float64Array(4);
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      hits.length = 0;
      state.fill(0);
      let level = 0;
      for (const entry of entries) {
        const {layer} = entry, u = x - layer.x, v = y - layer.y;
        const raster = layer.raster;
        if (!layer.opacity || u < 0 || v < 0 || u >= raster.width || v >= raster.height) continue;
        const pixel = v * raster.width + u, at = pixel * raster.channels;
        const alpha = readAlpha(raster, at) * layer.opacity * (layer.mask ? layer.mask(pixel) : 1);
        if (!alpha) continue;
        entry.at = at;
        entry.alpha = alpha;
        entry.level = layer.level ? layer.level(pixel) : 0;
        hits.push(entry);
      }
      if (ordering === 'depth') hits.sort((a, b) => b.level - a.level || a.layer.index - b.layer.index);
      for (const hit of hits) {
        const oldAlpha = state[3];
        let front = 1;
        if (ordering === 'height' && oldAlpha) {
          const difference = hit.level - level + bias;
          const t = softness ? unit(.5 + .5 * difference / softness) : +(difference >= 0);
          front = t * t * (3 - 2 * t);
        }
        composite(state, hit, front);
        if (ordering === 'height') {
          const visible = hit.alpha * (1 - oldAlpha + oldAlpha * front) / state[3];
          level = level * (1 - visible) + hit.level * visible;
        }
        if (ordering === 'depth') level = hit.level;
      }
      const alpha = state[3], offset = i * 4;
      color[offset + 3] = byte(alpha * 255);
      if (color[offset + 3]) {
        for (let c = 0; c < 3; c++) color[offset + c] = byte(255 * state[c] / alpha);
        if (scalar) scalar[i] = level;
      }
    }
    return {value: image(width, height, 4, color), ...(scalar && {[ordering]: image(width, height, 1, scalar)})};
  }

  function blend(background, foreground, options = {}) {
    const {width, height, pivot} = view(background);
    const {value} = stack({width, height, layers: [{source: background}, {...options, source: foreground}]});
    return pivot ? {...value, pivot: pivot.slice()} : value;
  }

  function rotated(source, angle) {
    const input = view(R.rgba(source)), {width, height} = input;
    const pivot = input.pivot ?? [width / 2, height / 2];
    if (!angle) return {...input, pivot};
    const clean = n => Math.abs(n) < 1e-12 ? 0 : n;
    const c = clean(Math.cos(angle)), s = clean(Math.sin(angle));
    const w = Math.max(1, Math.ceil(Math.abs(c) * width + Math.abs(s) * height - 1e-10));
    const h = Math.max(1, Math.ceil(Math.abs(s) * width + Math.abs(c) * height - 1e-10));
    dimensions(w, h);
    const dx = pivot[0] - width / 2, dy = pivot[1] - height / 2;
    return remap(input, w, h, (x, y) => {
      const dx = x + .5 - w / 2, dy = y + .5 - h / 2;
      const u = Math.floor(c * dx + s * dy + width / 2), v = Math.floor(-s * dx + c * dy + height / 2);
      return u >= 0 && v >= 0 && u < width && v < height ? v * width + u : -1;
    }, [c * dx - s * dy + w / 2, s * dx + c * dy + h / 2]);
  }

  function spriteStack(source, {count = 1, shift = [0, -1], angle = 0, size, position, anchor = 'first',
    tint = white, endOpacity = 1} = {}) {
    const input = Array.isArray(source) ? source : [source];
    if (!input.length || input.length > maxLayers || !Number.isSafeInteger(count) || count < 1 || input.length * count > maxLayers ||
        !pair(shift) || !Number.isFinite(angle) || size !== undefined && !pair(size, Number.isSafeInteger) ||
        position !== undefined && (!size || !pair(position)) || !['first', 'last'].includes(anchor) ||
        !Number.isFinite(endOpacity) || endOpacity < 0 || endOpacity > 1)
      throw new RangeError('Invalid sprite stack count, placement, anchor or opacity');
    tintValues(tint);
    const unique = new Map();
    let slicePixels = 0;
    const images = Array.from(input, source => {
      if (!unique.has(source)) {
        const raster = view(source);
        slicePixels += raster.width * raster.height;
        if (slicePixels > 4e6) throw new RangeError('Sprite stack exceeds its source pixel budget');
        const slice = rotated(source, angle);
        slicePixels += slice.width * slice.height;
        if (slicePixels > 8e6) throw new RangeError('Sprite stack exceeds its rotated pixel budget');
        unique.set(source, slice);
      }
      return unique.get(source);
    });
    const [ox, oy] = position ?? (size ? [size[0] / 2, size[1] / 2] : [0, 0]);
    const length = images.length * count, center = anchor === 'last' ? length - 1 : 0;
    const layers = Array.from({length}, (_, i) => {
      const source = images[i % images.length], t = length === 1 ? 0 : i / (length - 1);
      return {source, x: Math.round(ox + (i - center) * shift[0] - source.pivot[0]),
        y: Math.round(oy + (i - center) * shift[1] - source.pivot[1]),
        tint: tint.map(n => n + (1 - n) * t), opacity: 1 + (endOpacity - 1) * t};
    });
    if (size) return {...stack({width: size[0], height: size[1], layers}).value, pivot: [ox, oy]};
    const x = Math.min(...layers.map(layer => layer.x)), y = Math.min(...layers.map(layer => layer.y));
    const width = Math.max(...layers.map(layer => layer.x + layer.source.width)) - x;
    const height = Math.max(...layers.map(layer => layer.y + layer.source.height)) - y;
    const {value} = stack({width, height, layers: layers.map(layer => ({...layer, x: layer.x - x, y: layer.y - y}))});
    return {...value, pivot: [-x, -y]};
  }

  Object.assign(R, {blend, stack, spriteStack});
})(KIT.procedural);
