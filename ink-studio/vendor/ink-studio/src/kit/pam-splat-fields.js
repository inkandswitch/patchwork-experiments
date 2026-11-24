/* Seekable world-space fields of translucent Gaussian splats. */
(function (K) {
  const { V } = K, P = K.procedural;
  const presets = {
    aurora: {
      shape: { type: 'ribbon', points: [[-6, 2, 0], [-2, 2.7, -1], [2, 2.1, -2], [6, 2.9, -1]], height: 2.8, depth: 0.25 },
      motion: { velocity: [0.04, 0.07, 0], wave: [0.12, 0.42, 0.65], frequency: 0.33 },
      life: { rate: 100, lifetime: [2, 4], fadeIn: 0.3, fadeOut: 0.5 },
      style: { color: 0x63f8bd, endColor: 0x7868ee, size: 0.078, stretch: 7, axis: [0, 1, 0], opacity: 0.23, emissive: true }
    },
    embers: {
      shape: { type: 'box', size: [2, 0.6, 1.4] },
      motion: { velocity: [0.2, 0.85, 0.12], spread: [0.56, 0.64, 0.54], wind: 0.48 },
      life: { rate: 45, lifetime: [0.7, 2.4] },
      style: { color: 0xffd58e, endColor: 0xe04318, size: 0.035, endScale: 0.35, stretch: 1.7, emissive: true }
    },
    'dust-wall': {
      shape: { type: 'ribbon', points: [[-5, 0, 0], [-2, 0, -1.2], [2, 0, -1], [5, 0, 0]], height: 1.5, depth: 2.2 },
      motion: { velocity: [0.45, 0.17, 0.22], spread: [0.25, 0.16, 0.25], wind: 0.8 },
      life: { rate: 72, lifetime: [0.8, 2.5], fadeIn: 0.25, fadeOut: 0.55 },
      style: { color: 0xcf9a6d, endColor: 0x967e71, size: 0.23, endScale: 2.4, stretch: 1.65, opacity: 0.12 }
    },
    wake: {
      shape: { type: 'path', points: [[-4, 0, 0], [0, 0.6, -2], [4, 0.1, 0], [0, 0.2, 2]], duration: 4, loop: true },
      motion: { velocity: [0, 0.19, 0], spread: [0.36, 0.22, 0.36] },
      life: { rate: 110, lifetime: [0.45, 1.75], fadeIn: 0.07 },
      style: { color: 0xbafdf2, endColor: 0x4c67ff, size: 0.075, endScale: 0.5, stretch: 2, opacity: 0.65, emissive: true }
    }
  };
  const known = Object.keys(presets);
  const brand = Symbol.for('ink-studio.splat-fields');
  const zero = [0, 0, 0], up = [0, 1, 0], forward = [0, 0, 1], tau = 2 * Math.PI;
  function number(value, min, max, label) {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(label + ' is out of range');
    return value;
  }
  function vector(value, min, max, label) {
    if (!Array.isArray(value) || value.length !== 3) throw new TypeError(label + ' needs three coordinates');
    return Array.from(value, n => number(n, min, max, label));
  }
  function flag(value, label) {
    if (typeof value !== 'boolean') throw new TypeError(label + ' needs true or false');
    return value;
  }
  function rgb(value) {
    if (!Number.isInteger(value)) throw new TypeError('Splat color needs an RGB integer');
    number(value, 0, 0xffffff, 'Splat color');
    return [value >> 16, (value >> 8) & 255, value & 255];
  }
  function mixColor(from, to, phase) {
    return from.reduce((packed, channel, i) => packed + Math.round(K.mix(channel, to[i], phase)) * 256 ** i, 0);
  }
  function ease(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  }
  function group(base, patch, name) {
    if (patch !== undefined && (!patch || typeof patch !== 'object' || Array.isArray(patch)))
      throw new TypeError('Splat ' + name + ' needs an object');
    return { ...base, ...patch };
  }

  function shapeOf({ type, at = zero, size = [1, 1, 1], points, height = 0.35, depth = 0.4, duration = 3, loop = false }) {
    const origin = vector(at, -1e5, 1e5, 'Splat field position');
    if (type === 'box') {
      const extent = vector(size, 0, 1e4, 'Splat box size');
      return (_time, random) => ({
        p: origin.map((value, i) => value + extent[i] * (random() - 0.5)), u: random(), tangent: forward
      });
    }
    if (type !== 'ribbon' && type !== 'path') throw new TypeError('Splat field shape needs box, ribbon or path');
    const vertical = number(height, 0, 1e4, 'Splat field height');
    const thickness = number(depth, 0, 1e4, 'Splat field depth');
    const span = number(duration, 1e-3, 1e6, 'Splat path duration');
    flag(loop, 'Splat path loop');
    if (!Array.isArray(points) || points.length < 2 || points.length > 4096) throw new TypeError('Splat route needs 2 to 4096 points');
    const routePoints = Array.from(points, p => vector(p, -1e5, 1e5, 'Splat route point'));
    if (type === 'path' && loop && V.dist(routePoints[0], routePoints.at(-1)) > 1e-8) routePoints.push(routePoints[0]);
    const route = P.routes.polyline(routePoints);
    return (time, random) => {
      if (type === 'path' && !loop && time > span) return null;
      const u = type === 'ribbon' ? random() : loop ? (time % span) / span : time / span;
      const { point, side, normal, tangent } = route.sample(u);
      const elevation = (random() - (type === 'ribbon' ? 0 : 0.5)) * vertical;
      const p = V.mad(V.mad(V.add(point, origin), side, (random() - 0.5) * thickness), normal, elevation);
      return { p, u, tangent };
    };
  }

  function field(raw) {
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) throw new TypeError('Splat fields need an id');
    const preset = raw.preset === undefined ? {} : Object.hasOwn(presets, raw.preset) && presets[raw.preset];
    if (!preset) throw new TypeError('Unknown splat field preset ' + raw.preset);
    const sampleShape = shapeOf(group(preset.shape ?? { type: 'box' }, raw.shape, 'shape'));
    const { start = 0, end = Infinity, rate = 32, lifetime = [1, 2], fadeIn = 0.12, fadeOut = 0.48 } =
      group(preset.life, raw.life, 'life');
    number(start, -1e6, 1e6, 'Splat start');
    if (end !== Infinity) number(end, start, 1e6, 'Splat end');
    if (!(end > start)) throw new RangeError('Splat end must follow its start');
    number(rate, 0.1, 4096, 'Splat birth rate');
    number(fadeIn, 0, 1, 'Splat fade in');
    number(fadeOut, 0, 1, 'Splat fade out');
    if (!Array.isArray(lifetime) || lifetime.length !== 2) throw new TypeError('Splat lifetime needs a min and a max');
    const shortest = number(lifetime[0], 1e-3, 3600, 'Splat lifetime');
    const longest = number(lifetime[1], shortest, 3600, 'Splat lifetime');
    const capacity = Math.ceil(rate * longest) + 1;
    if (capacity > 4096) throw new RangeError('Splat field exceeds its live particle budget');
    const seed = raw.seed ?? P.data.hash(raw.id);
    if (!Number.isSafeInteger(seed)) throw new TypeError('Splat field seed needs an integer');
    const clock = { start, end, rate, lifetime: [shortest, longest], seed };

    const motion = group(preset.motion, raw.motion, 'motion');
    const velocity = vector(motion.velocity ?? zero, -1e3, 1e3, 'Splat velocity');
    const gravity = vector(motion.gravity ?? zero, -1e3, 1e3, 'Splat acceleration');
    const spread = vector(motion.spread ?? zero, 0, 1e3, 'Splat velocity spread');
    const wave = vector(motion.wave ?? zero, -1e3, 1e3, 'Splat wave');
    const frequency = number(motion.frequency ?? 0.5, 0, 100, 'Splat wave frequency');
    const wind = number(motion.wind ?? 0, 0, 8, 'Splat wind influence');

    const style = group(preset.style, raw.style, 'style');
    const from = rgb(style.color ?? 0xffffff), to = rgb(style.endColor ?? style.color ?? 0xffffff);
    const size = number(style.size ?? 0.06, 1e-4, 100, 'Splat size');
    const stretch = number(style.stretch ?? 1, 1, 32, 'Splat stretch');
    const endScale = number(style.endScale ?? 1, 0.01, 32, 'Splat end scale');
    const opacity = number(style.opacity ?? 0.7, 0, 0.99, 'Splat opacity');
    const emissive = flag(style.emissive ?? false, 'Splat emissive flag');
    const axis = style.axis === undefined ? null : vector(style.axis, -1e3, 1e3, 'Splat stretch axis');
    if (axis && V.len(axis) < 1e-8) throw new RangeError('Splat stretch axis must be nonzero');
    const fixedAxis = axis && V.norm(axis);
    function write(out, first, time, travel, birthIds) {
      for (const { serial, birth, age, phase, random } of K.splatEffects.births(clock, time)) {
        const alpha = opacity * (fadeIn ? ease(phase / fadeIn) : 1) * (fadeOut ? ease((1 - phase) / fadeOut) : 1);
        if (alpha <= 0) continue;
        const source = sampleShape(birth - start, random);
        if (!source) continue;
        const v = velocity.map((value, i) => value + spread[i] * (random() * 2 - 1));
        const bend = Math.sin(tau * ((time - start) * frequency + source.u));
        const p = source.p.map((value, i) => value + v[i] * age + gravity[i] * age ** 2 / 2 + wave[i] * bend);
        if (wind && travel) {
          const [dx, dz] = travel(source.p, birth, time);
          p[0] += wind * dx;
          p[2] += wind * dz;
        }
        const tangent = V.mad(v, gravity, age);
        const [x, y, z] = fixedAxis ?? (V.len(tangent) > 1e-8 ? V.norm(tangent) : source.tangent);
        const variance = (size * (0.7 + 0.6 * random()) * K.mix(1, endScale, phase)) ** 2;
        const along = (stretch ** 2 - 1) * variance;
        const slot = first + serial % capacity;
        if (birthIds) birthIds[slot] = serial;
        out.set([p[0], p[1], p[2], alpha, variance + along*x*x, along*x*y, along*x*z,
          mixColor(from, to, phase), variance + along*y*y, along*y*z, variance + along*z*z,
          16 + (emissive ? 32 : 0)], slot * 16);
      }
    }
    return { capacity, write };
  }

  function compile(source) {
    if (source?.[brand]) return source;
    if (!Array.isArray(source?.fields) || source.fields.length > 64)
      throw new TypeError('Splat fields need a fields array with at most 64 entries');
    const fields = Array.from(source.fields, field);
    if (new Set(source.fields.map(f => f.id)).size !== fields.length) throw new TypeError('Splat field ids must be unique');
    const count = fields.reduce((sum, f) => sum + f.capacity, 0);
    if (count > 16384) throw new RangeError('Splat fields exceed the scene particle budget');
    function write(out, first, time, { travel, birthIds } = {}) {
      if (!Number.isFinite(time) || Math.abs(time) > 1e9) throw new RangeError('Splat frame time is out of range');
      if (!(out instanceof Float32Array) || !Number.isSafeInteger(first) || first < 0 || out.length < (first + count) * 16)
        throw new RangeError('Splat frame needs a packed buffer large enough for all fields');
      if (birthIds !== undefined && (!(birthIds instanceof Float64Array) || birthIds.length < first + count))
        throw new RangeError('Splat frame needs space for all birth IDs');
      out.fill(0, first * 16, (first + count) * 16);
      birthIds?.fill(NaN, first, first + count);
      for (const f of fields) {
        f.write(out, first, time, travel, birthIds);
        first += f.capacity;
      }
      return out;
    }
    return Object.freeze({
      [brand]: true, count, write,
      frame: (time, options) => write(new Float32Array(count * 16), 0, time, options)
    });
  }

  function settings(authored, override) {
    const source = override === true ? authored : override ?? authored;
    return source == null || source === false ? null : compile(source);
  }
  K.splatFields = Object.freeze({ presets: Object.freeze(known), compile, settings });
})(KIT);
