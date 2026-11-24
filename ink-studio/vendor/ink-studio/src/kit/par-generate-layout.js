/* Tile placement, curve construction and layered scrolling artwork. */
(function (K) {
  const P = K.procedural, G = P.generator, R = P.raster, W = P.rasterWarp;
  const { integer, range, vector, validRaster, dimensions, clock, raster, wrap } = P.generatorSupport;

  function shifted(source, { width, height, offset, scale = [1, 1], repeat, filter = 'nearest' }) {
    const matrix = [[width / (source.width * scale[0]), 0, offset[0] / (source.width * scale[0])],
      [0, height / (source.height * scale[1]), offset[1] / (source.height * scale[1])]];
    return W.sample(source, W.field({ width, height, matrix }), {
      filter, edgeU: repeat.includes('x') ? 'wrap' : 'transparent', edgeV: repeat.includes('y') ? 'wrap' : 'transparent'
    });
  }

  function repeat(source, { width = source?.width, height = source?.height, offset = [0, 0], scale = [1, 1] } = {}) {
    dimensions({ width, height });
    if (!validRaster(source) || !vector(offset, 2) || !vector(scale, 2) || scale.some(n => !range(n, .0001, 1e4)))
      throw new TypeError('Repeating pixels needs a raster, finite pixel offset and positive scale');
    // Preserve scalar rasters, masks and index maps as well as RGBA.
    const channels = source.channels ?? source.data.length / (source.width * source.height);
    const data = Array.isArray(source.data) ? new Array(width * height * channels) :
      new source.data.constructor(width * height * channels);
    for (let y = 0, i = 0; y < height; y++) {
      const sy = wrap(Math.floor((y + .5 + offset[1]) / scale[1]), source.height);
      for (let x = 0; x < width; x++) {
        const sx = wrap(Math.floor((x + .5 + offset[0]) / scale[0]), source.width);
        const start = (sy * source.width + sx) * channels;
        for (let c = 0; c < channels; c++) data[i++] = source.data[start + c];
      }
    }
    return raster(width, height, data, channels);
  }

  function tiles(definitions, { mode = 'solve', seed = 0, ...options } = {}) {
    if (!['solve', 'wang'].includes(mode)) throw new RangeError('Tile mode needs solve or wang');
    const model = P.tiles.compile(definitions);
    const { at, ...result } = P.tiles[mode](model, { width: 8, height: 8, ...options, seed });
    return result;
  }

  function tileImage(layout, images) {
    const { status, width: columns, height: rows, tiles: cells } = layout ?? {};
    if (status !== 'ok' || !integer(columns, 1, 65536) || !integer(rows, 1, 65536) ||
        !Array.isArray(cells) || cells.length !== columns * rows || !images || typeof images !== 'object')
      throw new TypeError('Tile rendering needs a successful socket layout and named images');
    const art = new Map();
    for (const name of new Set(cells)) {
      if (name === null) continue;
      if (typeof name !== 'string' || !Object.hasOwn(images, name) || !validRaster(images[name]))
        throw new TypeError('Missing tile raster ' + name);
      art.set(name, images[name]);
    }
    // When every cell is masked, take the canvas size from the supplied library.
    const first = art.values().next().value ?? Object.values(images)[0];
    if (!validRaster(first)) throw new TypeError('Tile rendering needs a raster to establish cell size');
    const { width: tw, height: th } = first, width = columns * tw, height = rows * th;
    dimensions({ width, height });
    if ([...art.values()].some(image => image.width !== tw || image.height !== th))
      throw new RangeError('All tiles in a layout need the same pixel dimensions');
    for (const [name, image] of art) art.set(name, R.rgba(image));
    const data = new Uint8Array(width * height * 4);
    for (let cell = 0; cell < cells.length; cell++) {
      const image = art.get(cells[cell]);
      if (!image) continue;
      const x = cell % columns * tw, y = Math.floor(cell / columns) * th;
      for (let row = 0; row < th; row++)
        data.set(image.data.subarray(row * tw * 4, (row + 1) * tw * 4), ((y + row) * width + x) * 4);
    }
    return raster(width, height, data, 4);
  }

  function path(points, { mode = 'spline', closed = false, steps = 8, samples } = {}) {
    const count = points?.length, axes = points?.[0]?.length;
    if (!Array.isArray(points) || !integer(count, closed ? 3 : 2, 4096) || ![2, 3].includes(axes) ||
        !Array.from(points).every(point => vector(point, axes)) || !['linear', 'spline'].includes(mode) ||
        typeof closed !== 'boolean' || !integer(steps, 1, 128) || count * steps > 100000 ||
        (samples !== undefined && !integer(samples, closed ? 3 : 2, 16384)))
      throw new RangeError('Path needs a bounded list of consistently planar or spatial points');
    const xyz = points.map(point => axes === 2 ? [...point, 0] : point.slice());
    let points3 = closed ? [...xyz, xyz[0]] : xyz;
    if (mode === 'spline' && count > 2) {
      points3 = closed ? K.curve.spline([xyz[count - 1], ...xyz, xyz[0], xyz[1]], steps).slice(steps, (count + 1) * steps + 1) :
        K.curve.spline(xyz, steps);
    }
    const length = K.curve.length(points3);
    if (!Number.isFinite(length) || length === 0) throw new RangeError('Path must have finite nonzero length');
    if (samples !== undefined) {
      if (samples * points3.length > 12e6) throw new RangeError('Path resampling exceeds its work budget');
      points3 = K.curve.resample(points3, closed ? samples : samples - 1);
    }
    if (closed) points3.pop();
    const vertices = points3.map(point => point.slice(0, axes));
    return { value: { points: vertices, closed }, points: vertices, length };
  }

  function parallax(layers, { camera = [0, 0], time = 0, ...size } = {}) {
    const { width, height } = dimensions(size);
    clock(time, 0);
    if (!Array.isArray(layers) || layers.length > 32 || width * height * layers.length > 16e6 || !vector(camera, 2))
      throw new RangeError('Parallax needs a finite camera offset and a bounded list of layers');
    const shiftedLayers = Array.from(layers, ({ source, factor = 1, offset = [0, 0], velocity = [0, 0],
      repeat = 'none', filter = 'nearest', opacity = 1 }) => {
      const gain = typeof factor === 'number' ? [factor, factor] : factor;
      if (!validRaster(source) || ![gain, offset, velocity].every(p => vector(p, 2)) ||
          !['none', 'x', 'y', 'xy'].includes(repeat) || !range(opacity, 0, 1))
        throw new RangeError('Invalid parallax layer');
      const translation = offset.map((n, i) => n + gain[i] * camera[i] - velocity[i] * time);
      return { source: shifted(source, { width, height, offset: translation, repeat, filter }), opacity };
    });
    return R.stack({ width, height, layers: shiftedLayers }).value;
  }

  function horizon(bands, { origin = [0, 0, 0], camera = { yaw: [0, 360], pitch: [-90, 90] } } = {}) {
    if (!Array.isArray(bands) || !integer(bands.length, 1, 16)) throw new RangeError('Horizon needs 1 to 16 bands');
    let pixels = 0;
    const recipe = { origin, camera, bands: Array.from(bands, ({ source, ...band }) => {
      if (!validRaster(source) || source.width * source.height > 4194304 ||
          (pixels += source.width * source.height) > 8388608) throw new RangeError('Horizon art exceeds its pixel budget');
      const { width, height, data } = R.rgba(source);
      return { ...band, image: { width, height, pixels: Array.from(data) } };
    }) };
    K.horizonBands.compile(recipe);
    return recipe;
  }

  Object.assign(G, { repeat, tiles, tileImage, path, parallax, horizon });
})(KIT);
