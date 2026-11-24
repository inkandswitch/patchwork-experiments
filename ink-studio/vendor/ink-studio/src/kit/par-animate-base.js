/* Fixed-clock raster simulation recipes, portable state, and bounded rewind. */
(function (K) {
  const P = K.procedural, formats = { recipe: 'ink-studio/raster-simulation', checkpoint: 'ink-studio/raster-checkpoint' };
  const record = P.graphTypes.validator('record');
  const int = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const vector = (v, n) => Array.isArray(v) && v.length === n && Array.from(v).every(k => range(k, -1e6, 1e6));
  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  const wrap = (n, span) => n - span * Math.floor(n / span);
  const kinds = Object.create(null);
  const A = P.rasterSimulation = {};
  const names = ['particles', 'cloth', 'strand', 'smoke', 'grain', 'rigid', 'flip', 'feedback'];

  function portable(value) {
    if (Object.is(value, -0)) return 0;
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value)) return value;
    if (Array.isArray(value) || ArrayBuffer.isView(value) && Number.isSafeInteger(value.length))
      return Array.from(value, portable);
    if (!record(value) || Object.keys(value).some(k => ['__proto__', 'constructor', 'prototype'].includes(k)))
      throw new TypeError('Raster simulation needs finite JSON settings or numeric buffers');
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, portable(value[key])]));
  }

  function define(kind, settings = {}, { seed = 0, dt = 1 / 48, maxTicks = 2400 } = {}) {
    if (!names.includes(kind) || !record(settings) || !Number.isSafeInteger(seed) || !range(dt, .001, .1) || !int(maxTicks, 1, 12000))
      throw new RangeError('Invalid raster simulation, seed or fixed clock');
    return P.data.freeze({ format: formats.recipe, version: 1, kind, seed, dt, maxTicks, settings: portable(settings) });
  }

  function session(source, { checkpoint, every = 16, cache = 12 } = {}) {
    const raw = source ?? checkpoint?.recipe;
    if (raw?.format !== formats.recipe || raw.version !== 1 || !int(every, 1, 12000) || !int(cache, 1, 64))
      throw new TypeError('Expected a version 1 raster simulation recipe and bounded cache settings');
    const recipe = define(raw.kind, raw.settings, raw);
    const engine = kinds[recipe.kind](recipe.settings, recipe);
    const at = new Map();
    let tick = 0, savedTick = 0;
    const capture = () => P.data.freeze(portable(engine.capture()));
    const initial = capture();
    at.set(0, initial);
    if (checkpoint) {
      if (checkpoint.format !== formats.checkpoint || checkpoint.version !== 1 ||
          !int(checkpoint.tick, 0, recipe.maxTicks) ||
          !checkpoint.recipe || JSON.stringify(recipe) !== JSON.stringify(define(
            checkpoint.recipe.kind, checkpoint.recipe.settings, checkpoint.recipe)))
        throw new RangeError('Checkpoint does not match this raster simulation recipe');
      engine.restore(checkpoint.state, checkpoint.tick);
      tick = savedTick = checkpoint.tick;
      at.set(tick, capture());
    }

    function seek(time) {
      const target = Math.floor(time / recipe.dt + 1e-8);
      if (!Number.isFinite(time) || time < 0 || !int(target, 0, recipe.maxTicks))
        throw new RangeError('Raster simulation time is outside its fixed-tick range');
      let start = tick <= target ? tick : 0;
      for (const cached of at.keys()) if (cached <= target && cached > start) start = cached;
      if ((target - start) * (engine.work ?? 1) > 260e6)
        throw new RangeError('Raster replay exceeds its per-seek work budget');
      const prior = tick, backup = capture(), newlySaved = new Map();
      try {
        if (tick !== start) {
          engine.restore(at.get(start), start);
          tick = start;
        }
        while (tick < target) {
          engine.step(tick + 1, recipe.dt);
          tick++;
          if (tick % every === 0) {
            newlySaved.set(tick, capture());
            if (newlySaved.size > cache) newlySaved.delete(newlySaved.keys().next().value);
          }
        }
        const frame = engine.frame(tick), state = newlySaved.get(tick) ?? capture();
        for (const [key, value] of newlySaved) at.set(key, value);
        while (at.size > cache + (savedTick ? 2 : 1)) at.delete([...at.keys()].find(n => n !== 0 && n !== savedTick));
        const { value, field = coverage(value), points = [], ...metrics } = frame;
        return { value, field, points, checkpoint: { format: formats.checkpoint, version: 1, recipe, tick, state },
          report: { kind: recipe.kind, time: tick * recipe.dt, tick, from: start, replayed: tick - start,
            cached: [...at.keys()].sort((a, b) => a - b), ...metrics } };
      } catch (error) {
        engine.restore(backup, prior);
        tick = prior;
        throw error;
      }
    }
    return Object.freeze({ recipe, seek });
  }

  function size({ width = 96, height = 64 } = {}, limit = 65536) {
    if (!int(width, 1, 1024) || !int(height, 1, 1024) || width * height > limit)
      throw new RangeError('Raster simulation exceeds its grid budget');
    return { width, height };
  }
  const raster = ({ width, height }, data, channels = 1) => ({ width, height, channels, data });
  const coverage = image => raster(image, Float32Array.from({ length: image.width * image.height }, (_, p) => image.data[p * 4 + 3] / 255));
  const draw = (size, commands) => P.drawing2d.render({ ...size, commands, edges: 'hard' });
  const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
  const rect = (rect, fill) => ({ type: 'rect', rect, fill });
  const dot = ([x, y], r, fill) => ({ type: 'ellipse', rect: [x - r, y - r, 2 * r, 2 * r], fill });
  const color = hex => {
    if (typeof hex !== 'string' || !/^#[a-f0-9]{6}$/i.test(hex)) throw new TypeError('Simulation colors need #rrggbb');
    const c = parseInt(hex.slice(1), 16);
    return [c >> 16, c >> 8 & 255, c & 255];
  };
  const opacity = (hex, a) => hex + Math.round(clamp(a) * 255).toString(16).padStart(2, '0');

  function obstacles(options, { width, height }) {
    const { walls = [], mask } = options, closed = new Uint8Array(width * height);
    if (!Array.isArray(walls) || walls.length > 128 || !Array.from(walls).every(r => vector(r, 4) && r[2] > 0 && r[3] > 0))
      throw new RangeError('Walls need bounded [x,y,width,height] rectangles');
    if (mask !== undefined) {
      if (!range(options.maskThreshold ?? 128, 0, 255)) throw new RangeError('Invalid obstacle mask threshold');
      if (mask.width !== width || mask.height !== height) throw new RangeError('Obstacle mask must match simulation dimensions');
      const channel = options.maskChannel ?? 'alpha';
      const { data } = P.raster.channel(mask, { channel });
      for (let i = 0; i < closed.length; i++) closed[i] = Number(data[i] >= (options.maskThreshold ?? 128));
    }
    for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      if (walls.some(([u, v, w, h]) => x + .5 >= u && y + .5 >= v && x + .5 < u + w && y + .5 < v + h)) closed[i] = 1;
    }
    const open = (x, y) => x >= 0 && x < width && y >= 0 && y < height && !closed[Math.floor(y) * width + Math.floor(x)];
    return { closed, open };
  }

  // Transit through masked cells by checking each sub-pixel increment separately.
  function move(row, dt, open, bounce = 0) {
    const count = Math.ceil(Math.max(Math.abs(row[2]), Math.abs(row[3])) * dt * 2) || 1, h = dt / count;
    for (let i = 0; i < count; i++) {
      const x = row[0] + row[2] * h, y = row[1] + row[3] * h;
      if (open(x, row[1])) row[0] = x;
      else row[2] *= -bounce;
      if (open(row[0], y)) row[1] = y;
      else row[3] *= -bounce;
    }
  }

  function buffer(value, length, min = -1e9, max = 1e9) {
    if (!Array.isArray(value) || value.length !== length || !Array.from(value).every(n => range(n, min, max)))
      throw new TypeError('Invalid raster simulation checkpoint buffer');
    return value;
  }

  function disc(spec, x, y) {
    return clamp(1 - Math.hypot(x - spec.at[0], y - spec.at[1]) / spec.radius);
  }

  Object.assign(A, { define, session });
  P.rasterSimSupport = { kinds, formats, portable, int, range, vector, record, clamp, wrap, size, raster, draw, rect, dot, line,
    color, opacity, obstacles, move, buffer, disc };
})(KIT);
