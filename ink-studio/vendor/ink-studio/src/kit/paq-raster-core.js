/* Straight-alpha color rasters and finite numeric channels for headless graphs. */
(function (P) {
  const validRaster = P.graphTypes.validator('raster');
  const maxPixels = 16 * 1024 * 1024;
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const byte = value => Math.round(clamp(value, 0, 255));
  const unit = value => clamp(value, 0, 1);
  const pair = (value, valid = Number.isFinite) => Array.isArray(value) && value.length === 2 &&
    valid(value[0]) && valid(value[1]);

  function dimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > 8192 || height > 8192 || width * height > maxPixels)
      throw new RangeError('Raster dimensions exceed the canvas budget');
  }

  function view(source) {
    dimensions(source?.width, source?.height);
    if (!validRaster(source)) throw new TypeError('Expected a raster with one to four finite channels');
    const { width, height, data, channels = data.length / (width * height), pivot } = source;
    if (pivot !== undefined && !pair(pivot)) throw new TypeError('Raster pivot needs two finite coordinates');
    return { width, height, data, channels, pivot };
  }

  function image(width, height, channels, data, pivot) {
    return { width, height, channels, data, ...(pivot && { pivot }) };
  }

  const isByte = data => data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  const allocate = (source, size) => isByte(source.data) ? new Uint8Array(size) : new Float64Array(size);
  const alphaIndex = channels => channels === 2 || channels === 4 ? channels - 1 : -1;
  const colorIndex = (channels, component) => channels < 3 ? 0 : component;
  const readColor = (source, at, component) => clamp(source.data[at + colorIndex(source.channels, component)], 0, 255);
  const readAlpha = (source, at) => {
    const i = alphaIndex(source.channels);
    return i < 0 ? 1 : unit(source.data[at + i] / 255);
  };

  function rgba(source) {
    const raster = view(source);
    const {width, height, channels, data, pivot} = raster;
    if (channels === 4 && isByte(data)) return image(width, height, 4, Uint8Array.from(data), pivot?.slice());
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const src = i * channels, dst = i * 4;
      for (let c = 0; c < 3; c++) out[dst + c] = byte(readColor(raster, src, c));
      out[dst + 3] = byte(255 * readAlpha(raster, src));
    }
    return image(width, height, 4, out, pivot?.slice());
  }

  function canvas({width, height, color = [0, 0, 0, 0]} = {}) {
    dimensions(width, height);
    if (!Array.isArray(color) || ![3, 4].includes(color.length) ||
        !Array.from(color).every(n => Number.isFinite(n) && n >= 0 && n <= 255))
      throw new TypeError('Canvas color needs three or four values from 0 to 255');
    const pixel = Array.from({length: 4}, (_, i) => byte(color[i] ?? 255));
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set(pixel, i);
    return image(width, height, 4, data);
  }

  function sampler(source, channel) {
    const {data, channels} = source;
    if (Number.isInteger(channel) && channel >= 0 && channel < channels) return i => data[i * channels + channel];
    if (channel === 'alpha') {
      const index = alphaIndex(channels);
      return index < 0 ? () => 255 : i => data[i * channels + index];
    }
    if (channel === 'luma') return channels < 3 ? i => data[i * channels] : i => {
      const at = i * channels;
      return .2126 * data[at] + .7152 * data[at + 1] + .0722 * data[at + 2];
    };
    const color = ['r', 'g', 'b'].indexOf(channel);
    if (color >= 0) return i => data[i * channels + colorIndex(channels, color)];
    throw new RangeError('Unknown or unavailable raster channel ' + channel);
  }

  function channel(source, {channel: key = 0} = {}) {
    const raster = view(source), {width, height, pivot} = raster, read = sampler(raster, key);
    return image(width, height, 1, Float64Array.from({length: width * height}, (_, i) => read(i)), pivot?.slice());
  }

  function aligned(source, width, height, one = false) {
    const raster = view(source);
    if (raster.width !== width || raster.height !== height || one && raster.channels !== 1)
      throw new RangeError('Raster channels must have matching dimensions' + (one ? ' and one channel each' : ''));
    return raster;
  }

  function channels(planes) {
    if (!Array.isArray(planes) || planes.length < 1 || planes.length > 4)
      throw new RangeError('Provide one to four raster channels or constants');
    const source = planes.find(value => !Number.isFinite(value));
    const {width, height, pivot} = view(source);
    const read = Array.from(planes, plane => Number.isFinite(plane) ? () => plane :
      sampler(aligned(plane, width, height, true), 0));
    const data = new Float64Array(width * height * planes.length);
    for (let i = 0; i < width * height; i++) for (let c = 0; c < planes.length; c++) data[i * planes.length + c] = read[c](i);
    return image(width, height, planes.length, data, pivot?.slice());
  }

  const mathOps = {
    add: (a, b) => a + b,
    subtract: (a, b) => a - b,
    multiply: (a, b) => a * b,
    divide: (a, b) => a / b,
    min: Math.min,
    max: Math.max,
    difference: (a, b) => Math.abs(a - b),
    power: (a, b) => a ** b,
    greater: (a, b) => +(a > b),
    less: (a, b) => +(a < b),
    equal: (a, b) => +(a === b)
  };

  function math(a, b, op) {
    const left = view(a), {width, height, channels: count, pivot} = left;
    if (!Object.hasOwn(mathOps, op)) throw new RangeError('Unknown raster math operation ' + op);
    const scalar = Number.isFinite(b), right = scalar ? null : aligned(b, width, height);
    if (right && right.channels !== count && right.channels !== 1)
      throw new RangeError('Raster math needs matching channel counts or a single-channel right operand');
    const out = new Float64Array(left.data.length), apply = mathOps[op];
    for (let i = 0; i < out.length; i++) {
      const value = apply(left.data[i], scalar ? b : right.data[right.channels === 1 ? Math.floor(i / count) : i]);
      if (!Number.isFinite(value)) throw new RangeError('Raster math returned a nonfinite sample at index ' + i);
      out[i] = value;
    }
    return image(width, height, count, out, pivot?.slice());
  }

  function coverage(mask, width, height, {channel = 'luma', scale = 255, invert = false} = {}) {
    if (!Number.isFinite(scale) || scale <= 0 || typeof invert !== 'boolean')
      throw new RangeError('Raster mask needs a positive scale and a boolean invert flag');
    const read = sampler(aligned(mask, width, height), channel);
    return i => {
      const a = unit(read(i) / scale);
      return invert ? 1 - a : a;
    };
  }

  function mask(source, gate, options) {
    const {width, height, data, pivot} = rgba(source), read = coverage(gate, width, height, options);
    for (let i = 0; i < width * height; i++) data[i * 4 + 3] = byte(data[i * 4 + 3] * read(i));
    return image(width, height, 4, data, pivot);
  }

  function crop(source, {x, y, width, height} = {}) {
    const input = view(source), {data, channels, pivot} = input;
    dimensions(width, height);
    if (![x, y].every(Number.isSafeInteger) || x < 0 || y < 0 || x + width > input.width || y + height > input.height)
      throw new RangeError('Crop rectangle must lie inside the raster');
    const out = allocate(input, width * height * channels);
    for (let row = 0; row < height; row++) {
      const at = ((y + row) * input.width + x) * channels;
      out.set(data.slice(at, at + width * channels), row * width * channels);
    }
    return image(width, height, channels, out, pivot && [pivot[0] - x, pivot[1] - y]);
  }

  function remap(source, width, height, locate, pivot) {
    const {channels, data} = source, out = allocate(source, width * height * channels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const src = locate(x, y) * channels, dst = (y * width + x) * channels;
      if (src >= 0) for (let i = 0; i < channels; i++) out[dst + i] = data[src + i];
    }
    return image(width, height, channels, out, pivot);
  }

  const nearest = (i, from, to) => Math.min(from - 1, Math.floor((i + .5) * from / to));

  function resize(source, {width, height, filter = 'nearest', premultiply = true} = {}) {
    const input = view(source), {channels, data, pivot} = input;
    dimensions(width, height);
    const scaledPivot = pivot && [pivot[0] * width / input.width, pivot[1] * height / input.height];
    if (filter === 'nearest') return remap(input, width, height,
      (x, y) => nearest(y, input.height, height) * input.width + nearest(x, input.width, width), scaledPivot);
    if (filter !== 'bilinear' || typeof premultiply !== 'boolean') throw new RangeError('Invalid raster resize filter');
    const out = allocate(input, width * height * channels), alpha = premultiply ? alphaIndex(channels) : -1;
    const parts = (i, from, to) => {
      const p = clamp((i + .5) * from / to - .5, 0, from - 1), first = Math.floor(p);
      return [first, Math.min(first + 1, from - 1), p - first];
    };
    const columns = Array.from({length: width}, (_, x) => parts(x, input.width, width));
    const rows = Array.from({length: height}, (_, y) => parts(y, input.height, height));
    const indices = new Array(4), weights = new Array(4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const [x0, x1, fx] = columns[x], [y0, y1, fy] = rows[y];
      indices[0] = (y0 * input.width + x0) * channels;
      indices[1] = (y0 * input.width + x1) * channels;
      indices[2] = (y1 * input.width + x0) * channels;
      indices[3] = (y1 * input.width + x1) * channels;
      weights[0] = (1 - fx) * (1 - fy); weights[1] = fx * (1 - fy);
      weights[2] = (1 - fx) * fy; weights[3] = fx * fy;
      let sumAlpha = 1;
      if (alpha >= 0) {
        sumAlpha = 0;
        for (let k = 0; k < 4; k++) sumAlpha += (weights[k] *= readAlpha(input, indices[k]));
      }
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        if (c === alpha) sum = sumAlpha * 255;
        else if (sumAlpha) for (let k = 0; k < 4; k++) sum += data[indices[k] + c] * (weights[k] / sumAlpha);
        out[(y * width + x) * channels + c] = isByte(data) ? byte(sum) : sum;
      }
    }
    return image(width, height, channels, out, scaledPivot);
  }

  function nineSlice(source, {width, height, insets, fill = 'stretch'} = {}) {
    const input = view(source);
    dimensions(width, height);
    if (!Array.isArray(insets) || insets.length !== 4 || !Array.from(insets).every(n => Number.isSafeInteger(n) && n >= 0) ||
        !['stretch', 'repeat'].includes(fill)) throw new TypeError('Nine-slice needs four nonnegative insets and stretch or repeat fill');
    const [left, top, right, bottom] = insets;
    function axis(from, to, start, end) {
      const src = from - start - end, dst = to - start - end;
      if (src < 0 || dst < 0 || !src && dst) throw new RangeError('Nine-slice insets do not fit source or target');
      return Array.from({length: to}, (_, i) => {
        if (i < start) return i;
        if (i >= to - end) return from - (to - i);
        return start + (fill === 'repeat' ? (i - start) % src : nearest(i - start, src, dst));
      });
    }
    const xs = axis(input.width, width, left, right), ys = axis(input.height, height, top, bottom);
    const place = (p, from, to, a, b) => p <= a ? p : p >= from - b ? p + to - from :
      a + (p - a) * (to - a - b) / (from - a - b);
    const pivot = input.pivot && [place(input.pivot[0], input.width, width, left, right),
      place(input.pivot[1], input.height, height, top, bottom)];
    return remap(input, width, height, (x, y) => ys[y] * input.width + xs[x], pivot);
  }

  P.raster = {canvas, rgba, channel, channels, math, mask, crop, resize, nineSlice};
  P.rasterSupport = {dimensions, view, image, pair, byte, unit, clamp, aligned, readColor, readAlpha, coverage, remap};
})(KIT.procedural);
