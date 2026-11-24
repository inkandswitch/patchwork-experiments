/* Shared dimensions, sampling and drawing for procedural graph recipes. */
(function (K) {
  const P = K.procedural;
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const range = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  const vector = (value, size) => Array.isArray(value) && value.length === size && Array.from(value).every(Number.isFinite);
  const wrap = (value, period) => ((value % period) + period) % period;
  const unit = value => Math.max(0, Math.min(1, value));
  const raster = (width, height, data, channels = 1) => ({ width, height, channels, data });
  const validRaster = P.graphTypes.validator('raster');

  function dimensions({ width = 128, height = 96 } = {}) {
    if (!integer(width, 1, 8192) || !integer(height, 1, 8192) || width * height > 4e6)
      throw new RangeError('Generator dimensions exceed the four-million-pixel budget');
    return { width, height };
  }

  function clock(time, seed) {
    if (!range(time, -1e9, 1e9) || !Number.isSafeInteger(seed))
      throw new RangeError('Generators need a bounded time and an integer seed');
  }

  function sampleField(source, x, y, z, time) {
    const result = typeof source === 'function' ? source(x, y, z, time) : source.sample(x, y, z, time);
    const value = typeof result === 'number' ? result : result?.value;
    if (!Number.isFinite(value)) throw new TypeError('Expected a finite scalar field sample');
    return value;
  }

  function maskReader(source, channel) {
    if (!validRaster(source)) throw new TypeError('Generator mask needs a typed raster');
    const { width, height, data } = source, channels = source.channels ?? data.length / (width * height);
    const index = channel ?? (channels === 4 ? 3 : 0);
    if (!integer(index, 0, channels - 1)) throw new RangeError('Mask channel is outside the raster');
    return (x, y) => data[(y * width + x) * channels + index];
  }

  function draw(size, commands, edges = 'hard') {
    return P.drawing2d.render({ ...size, edges, commands });
  }

  function line(a, b, color, width) {
    return { type: 'path', points: [a, b], color, width };
  }

  function ellipse(x, y, rx, ry, fill) {
    return { type: 'ellipse', rect: [x - rx, y - ry, 2 * rx, 2 * ry], fill };
  }

  function color(value) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
      throw new TypeError('Recipe colors need #rrggbb');
    return value;
  }

  function alpha(fill, opacity) {
    return fill + Math.round(unit(opacity) * 255).toString(16).padStart(2, '0');
  }

  function projection(size, { origin = [size.width * .5, size.height * .88], pixelsPerUnit = 20 } = {}) {
    if (!vector(origin, 2) || !range(pixelsPerUnit, .0001, 1e6))
      throw new RangeError('Recipe projection needs a pixel origin and positive scale');
    return { origin, scale: pixelsPerUnit, pixel: ([x, y]) => [origin[0] + x * pixelsPerUnit, origin[1] - y * pixelsPerUnit] };
  }

  P.generator = {};
  P.generatorSupport = { integer, range, vector, wrap, unit, raster, validRaster, dimensions, clock,
    sampleField, maskReader, draw, line, ellipse, color, alpha, projection };
})(KIT);
