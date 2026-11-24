/* Seekable stamps and deterministic emitters for projected splat effects. */
(function (K) {
  const { vector, clamp } = SplatEffects;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const number = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
  const scalar = (lo, hi, label, value) => {
    if (!number(value, lo, hi)) throw new RangeError(label + ' is out of range');
    return value;
  };

  function field({ channels, stamps = [], strokes = [], ...grid } = {}) {
    if (!record(channels) || !Object.keys(channels).length || Object.keys(channels).length > 12)
      throw new TypeError('An effect field needs 1–12 named channels');
    const names = Object.keys(channels);
    const settings = names.map(name => {
      if (!record(channels[name])) throw new TypeError('Channel settings must be an object');
      const { decay = 0, combine = 'max' } = channels[name];
      if (!/^[\w-]+$/.test(name) || !['max', 'sum'].includes(combine))
        throw new TypeError('Channels need a name and max or sum blending');
      return { decay: scalar(0, 1000, 'Channel decay', decay), combine };
    });
    const domain = K.procedural.motion.gridDomain(grid);
    const events = [];
    const indices = new Map(names.map((name, i) => [name, i]));
    let revision = 0, previous;
    function prepare({ at, time = 0, radius = 0.1, values, lifetime = Infinity, shape = 'disk',
      speed = 0, width = radius, velocity = [0, 0] } = {}) {
      if (!vector(at, 2) || !vector(velocity, 2) || !record(values) || !Object.keys(values).length ||
          !['disk', 'ring'].includes(shape)) throw new TypeError('A field stamp needs UV, velocity, a shape and channel values');
      if (lifetime !== Infinity) scalar(1e-6, 1e6, 'Stamp lifetime', lifetime);
      scalar(-1e6, 1e6, 'Stamp time', time);
      scalar(1e-6, 1e5, 'Stamp radius', radius);
      scalar(1e-6, 1e5, 'Stamp width', width);
      scalar(0, 1e5, 'Stamp spread speed', speed);
      const writes = Object.entries(values).map(([name, amount]) => {
        const index = indices.get(name);
        if (index === undefined) throw new RangeError('Unknown field channel: ' + name);
        return [index, scalar(-1e4, 1e4, 'Stamp amount', amount)];
      });
      return { at: at.slice(), time, radius, lifetime, shape, speed, width, velocity: velocity.slice(), writes };
    }
    function append(items) {
      if (events.length + items.length > 4096) throw new RangeError('Effect field exceeds its stamp budget');
      events.push(...items);
      revision++;
      previous = undefined;
    }
    function stamp(options) {
      append([prepare(options)]);
    }
    function stroke({ keys, spacing = 0.05, ...options } = {}) {
      scalar(0.001, 1e5, 'Stroke time spacing', spacing);
      if (!Array.isArray(keys) || keys.length < 2 || keys.length > 1024 ||
          !Array.from(keys).every((key, i) => vector(key, 3) && (!i || key[0] > keys[i - 1][0])))
        throw new TypeError('Field stroke keys need increasing [time, u, v] rows');
      const pending = [];
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1], b = keys[i];
        const count = Math.ceil((b[0] - a[0]) / spacing);
        if (count + pending.length + events.length >= 4096) throw new RangeError('Effect stroke exceeds its stamp budget');
        for (let j = 0; j < count; j++) {
          const f = j / count;
          pending.push(prepare({
            ...options, time: K.mix(a[0], b[0], f),
            at: [K.mix(a[1], b[1], f), K.mix(a[2], b[2], f)]
          }));
        }
      }
      const [time, u, v] = keys.at(-1);
      pending.push(prepare({ ...options, time, at: [u, v] }));
      append(pending);
    }
    if (!Array.isArray(stamps) || stamps.length > 4096 || !Array.isArray(strokes) || strokes.length > 4096)
      throw new TypeError('Effect fields need bounded stamp and stroke lists');
    if (stamps.length) append(Array.from(stamps, prepare));
    strokes.forEach(stroke);

    function frame(time) {
      scalar(-1e6, 1e6, 'Effect field time', time);
      if (previous?.time === time) return previous;
      const { width, height, dx, dz, ox, oz, size, open, bounds } = domain;
      const buffers = names.map(() => new Float32Array(size));
      let work = 0;
      for (const event of events) {
        const age = time - event.time;
        if (age < 0 || age >= event.lifetime) continue;
        const [u, v] = event.at.map((p, i) => p + event.velocity[i] * age);
        const radius = event.radius + event.speed * age;
        const limit = radius + (event.shape === 'ring' ? event.width : 0);
        const left = Math.max(0, Math.floor((u - limit - ox) / dx));
        const right = Math.min(width - 1, Math.floor((u + limit - ox) / dx));
        const low = Math.max(0, Math.floor((v - limit - oz) / dz));
        const high = Math.min(height - 1, Math.floor((v + limit - oz) / dz));
        if (right < left || high < low) continue;
        work += (right - left + 1) * (high - low + 1) * event.writes.length;
        if (work > 16000000) throw new RangeError('Effect frame exceeds its sampling budget');
        const writes = event.writes.map(([index, value]) => ({
          buffer: buffers[index], sum: settings[index].combine === 'sum',
          amount: value * Math.exp(-settings[index].decay * age)
        }));
        for (let j = low; j <= high; j++) {
          const y = oz + (j + 0.5) * dz - v;
          for (let i = left; i <= right; i++) {
            const cell = j * width + i;
            if (!open[cell]) continue;
            const distance = Math.hypot(ox + (i + 0.5) * dx - u, y);
            const q = event.shape === 'ring' ? Math.abs(distance - radius) / event.width : distance / radius;
            if (q >= 1) continue;
            const weight = (1 - q * q) ** 2;
            for (const { buffer, amount, sum } of writes) {
              const value = amount * weight;
              buffer[cell] = sum ? buffer[cell] + value : Math.max(buffer[cell], value);
            }
          }
        }
      }
      previous = Object.freeze({
        time, width, height, bounds,
        sample(name, u, v) {
          const index = indices.get(name);
          return index === undefined ? 0 : domain.sample(buffers[index], u, v);
        },
        // A copy keeps the deterministic snapshot independent of host uploads.
        data(name) {
          const index = indices.get(name);
          return index === undefined ? undefined : buffers[index].slice();
        }
      });
      return previous;
    }
    return Object.freeze({
      channels: Object.freeze(names), frame, stamp, stroke,
      get revision() { return revision; },
      clear() {
        events.length = 0;
        revision++;
        previous = undefined;
      }
    });
  }

  function prepareField(value) {
    if (typeof value?.frame === 'function') return value;
    if (value?.type === 'deposition') {
      const { type, ...settings } = value;
      return K.deposition.create(settings);
    }
    return field(value);
  }

  function context({ fields = {}, shaders = {}, query } = {}) {
    if (!record(fields) || !record(shaders) || Object.keys(fields).length > 24 ||
        !Object.values(shaders).every(shader => typeof shader === 'function') ||
        (query !== undefined && typeof query?.probe !== 'function'))
      throw new TypeError('Surface effects need named fields and shader functions');
    return {
      fields: Object.fromEntries(Object.entries(fields).map(([name, value]) =>
        [name, prepareField(value)])),
      shaders,
      ...(query && { query })
    };
  }

  function surfaceSource(world, { material, indices, eye, grazing = 1, minLuma = 0,
    lit = false, weight, attempts = 12 } = {}) {
    if (!world?.surfaceData || !world.surfaces ||
        (indices !== undefined && !Array.isArray(indices) && !ArrayBuffer.isView(indices)) ||
        (eye !== undefined && !vector(eye, 3) && typeof eye !== 'function') ||
        (weight !== undefined && typeof weight !== 'function') || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 128)
      throw new TypeError('A surface emitter needs baked surface normals and a bounded selector');
    scalar(0, 1, 'Grazing threshold', grazing);
    scalar(0, 1, 'Luminance threshold', minLuma);
    const { STRIDE } = SurfaceLook;
    const candidates = [];
    const requested = indices ?? Array.from({ length: world.count }, (_, i) => i);
    for (const i of requested) {
      if (!Number.isSafeInteger(i) || i < 0 || i >= world.count)
        throw new RangeError('Surface source indices must belong to the world');
      const binding = world.surfaceData[i * STRIDE];
      if (binding && (material === undefined || material === binding || material === world.surfaces[binding - 1].settings.name))
        candidates.push(i);
    }
    if (!candidates.length) throw new RangeError('Surface emitter selected no splats');
    let prepared, lastTime;
    return (time, index, random) => {
      const camera = typeof eye === 'function' ? eye(time) : eye;
      if (lit && lastTime !== time) {
        const direction = world.surfaceLight && SurfaceLook.prepareLightTrack(world.surfaceLight)(time);
        prepared = world.surfaces.map(({ settings, light }) =>
          SurfaceLook.prepare(settings, world.pal, direction || light, world.surfaceEffects, { paletteRoles: world.paletteRoles }));
        lastTime = time;
      }
      for (let tryIndex = 0; tryIndex < attempts; tryIndex++) {
        const i = candidates[Math.floor(random() * candidates.length)], q = i * 16, s = i * STRIDE;
        const data = world.data;
        if (data[q + 3] <= 0) continue;
        let position = Array.from(data.subarray(q, q + 3));
        let normal = Array.from(world.surfaceData.subarray(s + 1, s + 4));
        const kind = Math.round(data[q + 11]) % 16;
        if (kind === 5) {
          const matrix = K.M.rot([0, 1, 0], time * data[q + 13]);
          position = K.M.app(matrix, position);
          normal = K.M.app(matrix, normal);
        }
        const view = camera ? K.V.norm(K.V.sub(camera, position)) : normal;
        if (camera && (K.V.dot(view, normal) < 0 || K.V.dot(view, normal) > grazing)) continue;
        const packed = data[q + 7];
        let rgb = [(packed & 255) / 255, ((packed >> 8) & 255) / 255, (packed >> 16) / 255];
        if (lit) {
          const surface = prepared[world.surfaceData[s] - 1], albedo = surface.paintsBase && world.materialAlbedo?.[i];
          const shade = SurfaceLook.shade(surface, {
            albedo: albedo ? RenderStages.unpack(albedo-1) : undefined,
            position: Array.from(data.subarray(q, q + 3)), worldPosition: position,
            normal: Array.from(world.surfaceData.subarray(s + 1, s + 4)), view, time,
            visibility: world.surfaceData[s + 4]
          }, rgb);
          if (shade[3] <= 0) continue;
          rgb = shade.slice(0, 3);
        }
        const luma = rgb[0] * 0.3 + rgb[1] * 0.55 + rgb[2] * 0.15;
        const hit = { position, normal, rgb, index: i, time, luma };
        if (luma < minLuma) continue;
        if (!weight) return hit;
        const probability = weight(hit);
        if (!Number.isFinite(probability)) throw new TypeError('Surface source weights must be finite');
        if (random() < clamp(probability)) return hit;
      }
      return null;
    };
  }

  function* births({ rate, start, end, lifetime, seed }, time) {
    const first = Math.max(0, Math.ceil((time - start - lifetime[1]) * rate));
    const last = Math.floor((Math.min(end, time) - start) * rate);
    for (let serial = first; serial <= last; serial++) {
      const random = K.grow.dice(K.procedural.data.hash('splat-emitter:' + serial, seed));
      const birth = start + serial / rate;
      const life = K.mix(lifetime[0], lifetime[1], random());
      const age = time - birth;
      if (age >= 0 && age < life) yield { serial, birth, age, phase: age / life, random };
    }
  }

  function emitter(builder, { source, rate = 36, start = 0, end = Infinity, lifetime = [0.25, 0.55], size = 0.006,
    speed = 0.18, spread = 0.12, drift = [0, 0, 0], gravity = [0, 0, 0], density = 0.9,
    color, seed = 1 } = {}) {
    if (typeof source !== 'function' || !vector(drift, 3) || !vector(gravity, 3) ||
        !Number.isSafeInteger(seed) || !number(start, -1e6, 1e6) ||
        (!(number(end, -1e6, 1e6) || end === Infinity) || !(end > start)) ||
        !vector(lifetime, 2) || lifetime[0] <= 0 || lifetime[1] < lifetime[0])
      throw new TypeError('An emitter needs a source, lifetime, time range and finite motion');
    scalar(0.1, 4096, 'Emission rate', rate);
    scalar(1e-6, 100, 'Particle size', size);
    scalar(0, 1e3, 'Particle speed', speed);
    scalar(0, 1e3, 'Particle spread', spread);
    scalar(0, 8, 'Particle density', density);
    const capacity = Math.ceil(rate * lifetime[1]) + 1;
    if (capacity > 4096) throw new RangeError('Emitter exceeds its live particle budget');
    const system = K.frameSplats(builder, capacity, (draw, dt, time) => {
      for (const { serial, birth, age, phase, random } of births({ rate, start, end, lifetime, seed }, time)) {
        const hit = source(birth, serial, random);
        if (hit == null) continue;
        if (!vector(hit.position, 3) || (hit.normal !== undefined && !vector(hit.normal, 3)))
          throw new TypeError('Emitter sources return a finite position and optional normal');
        const normal = hit.normal || [0, 1, 0];
        const velocity = drift.map((v, i) => v + normal[i] * speed + (random() * 2 - 1) * spread);
        const position = hit.position.map((value, i) => value + velocity[i] * age + 0.5 * gravity[i] * age * age);
        const alpha = density * Math.min(1, phase * 12) * (1 - phase ** 2);
        const chosen = typeof color === 'function' ? color(hit, random) : color;
        draw.point(position, { width: size * (0.75 + 0.5 * random()), density: alpha,
          ...(chosen === undefined && hit.rgb ? { rgb: hit.rgb } : { color: chosen ?? 1 }) });
      }
    });
    const bind = system.bind;
    system.bind = stage => {
      bind(stage);
      (stage.W.effectParticles ||= []).push({ first: system.first, count: system.count });
    };
    return system;
  }

  K.splatEffects = Object.freeze({ project: SplatEffects.project, prepareMask: SplatEffects.prepareMask, field, context, surfaceSource, emitter, births });
})(KIT);
