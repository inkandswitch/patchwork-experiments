/* Generic layered frame data and procedural material outputs for graph inputs. */
(function (K) {
  const P = K.procedural;
  const rasterBrand = Symbol.for('ink-studio.layered-raster');
  const axis = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
  const clamp = value => Math.max(0, Math.min(1, value));
  const coordinate = (x, y) => Number.isFinite(x) && Number.isFinite(y);

  function raster(source = {}) {
    if (source?.[rasterBrand]) return source;
    const { width, height, layers, tags = {}, fps = 12, pivot } = source;
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 4096) ||
        !layers || typeof layers !== 'object' || !Object.keys(layers).length ||
        !Number.isFinite(fps) || fps <= 0 || fps > 240)
      throw new RangeError('Raster assets need finite dimensions, named layers and a positive frame rate');
    function copyPivot(value) {
      if (value === undefined) return;
      if (!axis(value, 2) || !Array.from(value).every(Number.isFinite))
        throw new TypeError('Raster pivot needs two finite pixel coordinates');
      return value.slice();
    }
    const origin = copyPivot(pivot), size = width * height * 4, planes = new Map();
    let frameCount = 0, written = 0;
    for (const [name, definition] of Object.entries(layers)) {
      const { frames, opacity = 1, parent, material, pivot } = definition || {};
      if (!name || !Number.isFinite(opacity) || opacity < 0 || opacity > 1 ||
          !Array.isArray(frames) || !frames.length || frames.length > 512 || (written += size * frames.length) > 64e6)
        throw new RangeError('Invalid raster layer or pixel budget exceeded: ' + name);
      if ([parent, material].some(value => value !== undefined && (typeof value !== 'string' || !value)))
        throw new TypeError('Raster parent and material references need names: ' + name);
      const images = frames.map(frame => {
        const raw = frame?.data || frame;
        if ((!Array.isArray(raw) && !ArrayBuffer.isView(raw)) || raw.length !== size)
          throw new RangeError('Raster layer frames need matching RGBA data');
        if (!(raw instanceof Uint8Array || raw instanceof Uint8ClampedArray) &&
            !Array.from(raw).every(value => Number.isSafeInteger(value) && value >= 0 && value <= 255))
          throw new RangeError('Raster RGBA channels must be bytes');
        return { data: Uint8Array.from(raw), pivot: copyPivot(frame?.pivot) };
      });
      frameCount = Math.max(frameCount, images.length);
      planes.set(name, { opacity, images, parent, material, pivot: copyPivot(pivot) });
    }
    const visited = new Set();
    for (const name of planes.keys()) {
      const chain = new Set();
      for (let current = name; current !== undefined && !visited.has(current); current = planes.get(current).parent) {
        if (!planes.has(current) || chain.has(current)) throw new RangeError('Invalid raster layer hierarchy: ' + name);
        chain.add(current);
      }
      for (const current of chain) visited.add(current);
    }
    const clips = new Map([['all', { start: 0, end: frameCount, fps, loop: true }]]);
    for (const [name, item] of Object.entries(tags)) {
      const { start, end, fps: rate = fps, loop = true } = item || {};
      if (!name || name === 'all' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
          start < 0 || end <= start || end > frameCount || !Number.isFinite(rate) || rate <= 0 || typeof loop !== 'boolean')
        throw new RangeError('Raster tag requires an in-range half-open frame range: ' + name);
      clips.set(name, { start, end, fps: rate, loop });
    }
    function getClip(tag) {
      const clip = clips.get(tag);
      if (!clip) throw new RangeError('Unknown raster tag ' + tag);
      return clip;
    }
    function clipInfo(tag = 'all') { return { ...getClip(tag) }; }
    function frameAt(time, tag = 'all') {
      if (!Number.isFinite(time)) throw new RangeError('Raster time must be finite');
      const clip = getClip(tag);
      const i = Math.max(0, Math.floor(time * clip.fps + 1e-8)), length = clip.end - clip.start;
      return clip.start + (clip.loop ? i % length : Math.min(length - 1, i));
    }
    function layer(name, time = 0, tag = 'all') {
      if (!planes.has(name)) throw new RangeError('Unknown raster layer ' + name);
      const { opacity, images, parent, material, pivot } = planes.get(name), frame = frameAt(time, tag);
      const image = images[Math.min(frame, images.length - 1)], data = image.data.slice(), at = image.pivot ?? pivot ?? origin;
      if (opacity < 1) for (let i = 3; i < size; i += 4) data[i] = Math.round(data[i] * opacity);
      return { width, height, frame, data, ...(at && { pivot: at.slice() }),
        ...(parent !== undefined && { parent }), ...(material !== undefined && { material }) };
    }
    function composite(time = 0, { tag = 'all', layers: names = [...planes.keys()] } = {}) {
      const frame = frameAt(time, tag), data = new Uint8Array(size), accum = new Float32Array(size);
      for (const name of names) {
        const image = layer(name, time, tag).data;
        for (let i = 0; i < size; i += 4) {
          const a = image[i + 3] / 255, keep = 1 - a;
          for (let c = 0; c < 3; c++) accum[i + c] = image[i + c] * a + accum[i + c] * keep;
          accum[i + 3] = a + accum[i + 3] * keep;
        }
      }
      for (let i = 0; i < size; i += 4) {
        const a = accum[i + 3];
        if (a <= 0) continue;
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(accum[i + c] / a);
        data[i + 3] = Math.round(a * 255);
      }
      return { width, height, frame, data };
    }
    function snapshot() {
      return {
        width, height, fps, ...(origin && { pivot: origin.slice() }),
        tags: Object.fromEntries([...clips].slice(1).map(([name, clip]) => [name, { ...clip }])),
        layers: Object.fromEntries([...planes].map(([name, { opacity, parent, material, pivot, images }]) => [name, {
          opacity, ...(parent !== undefined && { parent }), ...(material !== undefined && { material }),
          ...(pivot && { pivot: pivot.slice() }),
          frames: images.map(image => ({ data: image.data.slice(), ...(image.pivot && { pivot: image.pivot.slice() }) }))
        }]))
      };
    }
    return Object.freeze({ [rasterBrand]: true, width, height, frameCount, layers: [...planes.keys()], tags: [...clips.keys()],
      clipInfo, frameAt, layer, composite, snapshot });
  }

  function material({ height = 0, wetness = 0, ink = 0, palette = 'stone', spacing = .005, normalStrength = 1 } = {}) {
    const sources = { height, wetness, ink, palette };
    if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(normalStrength) || normalStrength < 0)
      throw new RangeError('Material spacing must be positive and normal strength nonnegative');
    for (const [name, value] of Object.entries(sources))
      if (typeof value !== 'function' && (name === 'palette' ? typeof value !== 'string' : !Number.isFinite(value)))
        throw new TypeError('Invalid material output ' + name);
    const call = (value, u, v, time, context) => typeof value === 'function' ? value(u, v, time, context) : value;
    const evaluate = (u, v, time = 0, context = {}) => {
      if (!coordinate(u, v) || !Number.isFinite(time)) throw new RangeError('Material coordinates and time must be finite');
      const h = call(height, u, v, time, context),
        du = (call(height, u + spacing, v, time, context) - call(height, u - spacing, v, time, context)) / (2 * spacing),
        dv = (call(height, u, v + spacing, time, context) - call(height, u, v - spacing, time, context)) / (2 * spacing),
        wet = call(wetness, u, v, time, context), mask = call(ink, u, v, time, context),
        role = call(palette, u, v, time, context);
      if (![h, du, dv, wet, mask].every(Number.isFinite) || typeof role !== 'string') throw new TypeError('Invalid material sample');
      return { height: h, normal: K.V.norm([-du * normalStrength, 1, -dv * normalStrength]), wetness: clamp(wet), ink: clamp(mask), palette: role };
    };
    return Object.freeze({ sample: evaluate,
      ...Object.fromEntries(['height', 'normal', 'wetness', 'ink', 'palette'].map(name => [name,
        (...args) => evaluate(...args)[name]])) });
  }

  function tiles({ bounds, cell = [1, 1], seed = 0, mask = () => 1, vector = () => [0, 0], scale = 1,
    jitter = .25, limit = 65536, time = 0 } = {}) {
    const { min, max } = bounds || {};
    if (!axis(min, 2) || !axis(max, 2) || min.some((v, i) => v >= max[i]) || !axis(cell, 2) || cell.some(v => v <= 0) ||
        !Number.isSafeInteger(seed) || typeof mask !== 'function' || typeof vector !== 'function' || !Number.isFinite(time) ||
        !Number.isFinite(jitter) || jitter < 0 || jitter > 1 ||
        (typeof scale !== 'function' && !(Number.isFinite(scale) && scale > 0)))
      throw new RangeError('Invalid mask- and vector-driven tile settings');
    const lo = min.map((value, i) => Math.floor(value / cell[i])), hi = max.map((value, i) => Math.ceil(value / cell[i]));
    if ((hi[0] - lo[0]) * (hi[1] - lo[1]) > limit || !Number.isSafeInteger(limit) || limit < 1 || limit > 250000)
      throw new RangeError('Material tile work budget exceeded');
    const output = [];
    for (let iy = lo[1]; iy < hi[1]; iy++) for (let ix = lo[0]; ix < hi[0]; ix++) {
      const id = ix + '/' + iy, dice = K.grow.dice(P.data.hash(id, seed));
      const u = (ix + .5 + (dice() - .5) * jitter) * cell[0], v = (iy + .5 + (dice() - .5) * jitter) * cell[1];
      if (u < min[0] || v < min[1] || u >= max[0] || v >= max[1]) continue;
      const gate = mask(u, v, time);
      if (!Number.isFinite(gate)) throw new TypeError('Tile masks must return finite weights');
      if (dice() >= clamp(gate)) continue;
      const flow = vector(u, v, time), size = typeof scale === 'function' ? scale(u, v, time, gate) : scale;
      if (!axis(flow, 2) || !Number.isFinite(size) || size <= 0) throw new TypeError('Tile flow and size must be finite');
      output.push({ id, point: [u, 0, v], uv: [u, v], rotation: Math.atan2(flow[1], flow[0]), scale: size, mask: gate });
    }
    return output;
  }

  P.graph.raster = raster;
  P.graph.material = material;
  P.graph.tiles = tiles;
  P.graph.operations = Object.freeze({
    ...P.graph.arrays.operations,
    ...P.raster.operations,
    ...P.drawing2d.operations,
    ...P.rasterColor.operations,
    ...P.pixelEffects.operations,
    ...P.rasterWarp.operations,
    ...P.generator.operations,
    ...P.sceneGraph.operations,
    ...P.animationGraph.operations,
    ...P.rasterSimulation.operations,
    ...P.mediaGraph.operations,
    meshPaths: {
      inputs: { mesh: 'geometry', sources: 'points', targets: { type: 'points', default: [] }, options: { type: 'any', default: {} } },
      outputs: { value: 'any', curves: 'points', distance: 'field' },
      run({ mesh, sources, targets, options }) {
        const value = P.geometry.meshPaths(mesh, { ...options, sources });
        return { value, curves: value.curves(targets), distance: point => value.distanceAt(point) };
      }
    },
    attributeTransfer: {
      inputs: { source: 'field', domain: 'string', entities: 'points', options: { type: 'any', default: {} } },
      outputs: { value: 'points' },
      run({ source, domain, entities, options }) {
        return { value: P.attributes.transfer(source, domain, entities, options) };
      }
    },
    densityMesh: {
      inputs: { source: 'field', options: { type: 'any', default: {} } },
      outputs: { value: 'geometry' },
      run({ source, options }) { return { value: P.density.toMesh(source, options) }; }
    },
    densityPoints: {
      inputs: { source: 'field', options: { type: 'any', default: {} } },
      outputs: { value: 'points' },
      run({ source, options }, { seed }) { return { value: P.density.scatter(source, { seed, ...options }).samples }; }
    },
    rasterLayer: {
      inputs: { source: 'any', layer: 'string', tag: { type: 'string', default: 'all' } },
      outputs: { value: 'image' },
      time: true,
      run({ source, layer, tag }, { time }) { return { value: source.layer(layer, time, tag) }; }
    },
    materialSample: {
      inputs: { source: 'field', uv: 'vec2' },
      outputs: { height: 'number', normal: 'vec3', wetness: 'number', ink: 'number', palette: 'string' },
      time: true,
      run({ source, uv }, { time }) { return source.sample(...uv, time); }
    },
    tiles: {
      inputs: { settings: 'any' }, outputs: { value: 'points' }, time: true,
      run({ settings }, { seed, time }) { return { value: tiles({ seed, time, ...settings }) }; }
    }
  });
})(KIT);
