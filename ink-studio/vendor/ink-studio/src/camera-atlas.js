/* Named camera captures with a shared clock, resolution budget, and composition adapters. */
const CameraAtlas = (() => {
  const composite = typeof FrameComposite === 'undefined' ? require('./frame-composite.js') : FrameComposite;
  const surfaces = typeof SpriteSurface === 'undefined' ? require('./sprite-surface.js') : SpriteSurface;
  const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
  const frameOptions = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const maxPixels = 4096 * 4096;

  function prepare({ width, height, views, maxViewsPerFrame = 4, maxPixelsPerFrame = width * height } = {}) {
    if (!integer(width, 1, 4096) || !integer(height, 1, 4096) ||
      !integer(maxViewsPerFrame, 1, 64) || !integer(maxPixelsPerFrame, 1, maxPixels) ||
      !Array.isArray(views) || !integer(views.length, 1, 64))
      throw new RangeError('A camera atlas needs bounded dimensions, views and budgets');
    const used = new Set(), tiles = [];
    const definitions = Array.from(views, (view, index) => {
      const { id, rect, fps = 12, frame } = view ?? {};
      if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || used.has(id) ||
        !Array.isArray(rect) || rect.length !== 4 || !Array.from(rect).every(n => integer(n, 0, 4096)) ||
        !Number.isFinite(fps) || fps <= 0 || fps > 240 || frame !== undefined &&
        typeof frame !== 'function' && !frameOptions(frame))
        throw new TypeError('Invalid camera atlas view at index ' + index);
      const [x, y, w, h] = rect;
      if (!w || !h || x + w > width || y + h > height || w * h > maxPixelsPerFrame)
        throw new RangeError('Camera atlas tile cannot fit its atlas or frame budget: ' + id);
      if (tiles.some(other => x < other.x + other.width && x + w > other.x &&
        y < other.y + other.height && y + h > other.y))
        throw new RangeError('Camera atlas tiles must not overlap: ' + id);
      const tile = Object.freeze({ id, x, y, width: w, height: h, fps,
        uv: Object.freeze([x / width, y / height, (x + w) / width, (y + h) / height]) });
      used.add(id);
      tiles.push(tile);
      return Object.freeze({ tile, frame, index });
    });
    return Object.freeze({ width, height, maxViewsPerFrame, maxPixelsPerFrame,
      tiles: Object.freeze(tiles), definitions: Object.freeze(definitions) });
  }

  function create(plan, backend) {
    const { width, height, definitions, tiles, maxViewsPerFrame, maxPixelsPerFrame } = plan;
    const byId = new Map(definitions.map(({ tile, index }) => [tile.id, index]));
    const times = new Array(tiles.length), versions = tiles.map(() => 0), cache = new Map();
    let currentTime, next = 0, disposed = false, busy = false;

    function alive() {
      if (disposed) throw new Error('The camera atlas has been disposed');
    }

    function indexOf(id) {
      const index = byId.get(id);
      if (index === undefined) throw new RangeError('Unknown camera atlas view: ' + id);
      return index;
    }

    function reset() {
      alive();
      if (busy) throw new Error('Cannot reset a camera atlas during capture');
      backend.clear();
      currentTime = undefined;
      next = 0;
      times.fill(undefined);
      cache.clear();
      for (let i = 0; i < versions.length; i++) versions[i]++;
    }

    function capture(world, { time = world?.lookSnapshot?.time ?? 0, frame = {} } = {}) {
      alive();
      if (busy) throw new Error('Cannot capture a camera atlas recursively');
      if (!world || !Number.isFinite(time) || !frameOptions(frame))
        throw new TypeError('Camera capture needs a world, finite time and frame options');
      const rewound = currentTime !== undefined && time < currentTime;
      if (rewound) reset();
      currentTime = time;
      const start = next, updated = [], deferred = [];
      let pixels = 0;
      busy = true;
      try {
        for (let offset = 0; offset < definitions.length; offset++) {
          const index = (start + offset) % definitions.length;
          const { tile, frame: settings } = definitions[index];
          if (times[index] !== undefined && time - times[index] + 1e-10 < 1 / tile.fps) continue;
          const area = tile.width * tile.height;
          if (deferred.length || updated.length >= maxViewsPerFrame || pixels + area > maxPixelsPerFrame) {
            if (!deferred.length) next = index;
            deferred.push(tile.id);
            continue;
          }
          next = index;
          const view = typeof settings === 'function' ? settings({ world, time, tile }) : settings;
          if (view !== undefined && !frameOptions(view)) throw new TypeError('Camera view options must be an object');
          backend.capture(world, {
            composite: false, renderGraph: false, inspection: false, afterimages: false, ...frame, ...view,
            damp: false, resetTransparency: true, resetRenderHistory: true, changedRows: undefined,
            ...((frame.camera || view?.camera) && { camera: { ...frame.camera, ...view?.camera } }),
            width: tile.width, height: tile.height, time
          }, tile);
          times[index] = time;
          versions[index]++;
          cache.delete(tile);
          cache.delete(null);
          pixels += area;
          updated.push(tile.id);
          next = (index + 1) % definitions.length;
        }
      } finally {
        busy = false;
      }
      return { updated, deferred, pixels, rewound };
    }

    function readCached(tile) {
      alive();
      if (!cache.has(tile)) cache.set(tile, backend.read(tile ?? { x: 0, y: 0, width, height }));
      return cache.get(tile);
    }

    function read(id) {
      const image = readCached(id === undefined ? null : tiles[indexOf(id)]);
      return { ...image, rgba: image.rgba.slice() };
    }

    function layer(id, settings = {}) {
      alive();
      const tile = id === undefined ? null : tiles[indexOf(id)];
      const source = () => readCached(tile);
      if (backend.texture) source[composite.textureSource] = gl => {
        alive();
        return backend.texture(gl, tile ?? { x: 0, y: 0, width, height });
      };
      return { ...settings, resolution: tile ? [tile.width, tile.height] : [width, height], source };
    }

    function bindSurface(atlas, id, region) {
      alive();
      const index = indexOf(id), tile = tiles[index];
      if (region?.width !== tile.width || region?.height !== tile.height)
        throw new RangeError('Camera feed and sprite surface region must have matching dimensions');
      let version;
      return () => {
        alive();
        if (version === versions[index]) return false;
        surfaces.update(atlas, region, readCached(tile));
        version = versions[index];
        return true;
      };
    }

    return Object.freeze({ width, height, tiles, capture, read, layer, bindSurface, reset,
      lastCapture(id) { alive(); return times[indexOf(id)]; },
      dispose() {
        if (disposed) return;
        if (busy) throw new Error('Cannot dispose a camera atlas during capture');
        disposed = true;
        cache.clear();
        backend.dispose?.();
      }
    });
  }

  function raster(options, render) {
    const plan = prepare(options), { width, height } = plan;
    const pixels = new Uint8Array(width * height * 4);
    return create(plan, {
      clear() { pixels.fill(0); },
      capture(world, frame, tile) {
        const { w, h, rgb, rgba, alpha } = composite.image(render(world, frame));
        if (w !== tile.width || h !== tile.height) throw new RangeError('Camera capture dimensions must match the tile');
        for (let y = 0; y < h; y++) {
          const start = ((tile.y + y) * width + tile.x) * 4;
          if (rgba) pixels.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), start);
          else for (let x = 0; x < w; x++) {
            const i = y * w + x, j = start + x * 4;
            pixels[j] = rgb[i * 3];
            pixels[j + 1] = rgb[i * 3 + 1];
            pixels[j + 2] = rgb[i * 3 + 2];
            pixels[j + 3] = alpha?.[i] ?? 255;
          }
        }
      },
      read({ x, y, width: w, height: h }) {
        const rgba = new Uint8Array(w * h * 4);
        for (let row = 0; row < h; row++) {
          const start = ((y + row) * width + x) * 4;
          rgba.set(pixels.subarray(start, start + w * 4), row * w * 4);
        }
        return { w, h, rgba };
      }
    });
  }

  return Object.freeze({ prepare, create, raster });
})();
if (typeof module !== 'undefined') module.exports = CameraAtlas;
