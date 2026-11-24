/* Time-sampled directional camera motion. No renderer, DOM, random state or external dependency. */
const CameraImpulses = (() => {
  const finite = Number.isFinite,
    tau = 2 * Math.PI,
    zero = () => [0, 0, 0],
    defaultPose = { eye: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1] };
  const check = (ok, message) => {
    if (!ok) throw new TypeError('Camera impulses: ' + message);
  };
  const record = v =>
    v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const fields = (v, allowed) => record(v) && Object.keys(v).every(k => allowed.includes(k));
  const id = v =>
    typeof v === 'string' &&
    /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,95}$/.test(v) &&
    !['__proto__', 'prototype', 'constructor'].includes(v);
  const vector = v => Array.isArray(v) && v.length === 3 && v.every(n => finite(n) && Math.abs(n) <= 1e6);
  const range = (n, a, b) => finite(n) && n >= a && n <= b;
  const length = v => Math.hypot(...v),
    mul = (v, s) => v.map(n => n * s),
    dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0),
    cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    sub = (a, b) => a.map((n, i) => n - b[i]);
  const unit = (v, fallback = [0, 0, 1]) => (length(v) > 1e-10 ? mul(v, 1 / length(v)) : fallback.slice());
  const smooth = t => {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  };
  const freeze = v => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  function clone(v, depth = 0) {
    check(depth <= 32, 'data nesting budget exceeded');
    if (Array.isArray(v)) return v.map(x => clone(x, depth + 1));
    if (record(v))
      return Object.fromEntries(
        Object.entries(v)
          .filter(([, x]) => x !== undefined)
          .map(([k, x]) => [k, clone(x, depth + 1)])
      );
    check(v === null || typeof v === 'string' || typeof v === 'boolean' || finite(v), 'expected finite JSON data');
    return v;
  }
  function seedFor(seed, key) {
    let h = seed >>> 0;
    for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h;
  }
  function hash(n, seed) {
    let x = (Math.imul(n | 0, 374761393) ^ seed) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return (((x ^ (x >>> 16)) >>> 0) / 4294967295) * 2 - 1;
  }
  function noise(t, seed) {
    const n = Math.floor(t),
      u = smooth(t - n);
    return hash(n, seed) * (1 - u) + hash(n + 1, seed) * u;
  }
  function basis(pose = defaultPose) {
    check(
      record(pose) && [pose.eye, pose.right, pose.up, pose.back].every(vector),
      'expected an unshaken eye and orthonormal camera basis'
    );
    const axes = [pose.right, pose.up, pose.back];
    check(
      axes.every(v => Math.abs(length(v) - 1) < 1e-4) &&
        Math.abs(dot(axes[0], axes[1])) < 1e-4 &&
        Math.abs(dot(axes[0], axes[2])) < 1e-4 &&
        Math.abs(dot(axes[1], axes[2])) < 1e-4 &&
        dot(cross(axes[0], axes[1]), axes[2]) > 0.9999,
      'camera basis must be right-handed and orthonormal'
    );
    return pose;
  }
  function transform(v, b) {
    return [0, 1, 2].map(i => v[0] * b.right[i] + v[1] * b.up[i] + v[2] * b.back[i]);
  }
  function falloff(raw) {
    if (raw === undefined || raw === false) return null;
    check(fields(raw, ['inner', 'outer', 'power']), 'invalid distance falloff');
    const { inner = 0, outer = 20, power = 2 } = raw;
    check(
      range(inner, 0, 1e6) && range(outer, 0, 1e6) && outer > inner && range(power, 0.05, 16),
      'falloff needs increasing radii and a positive power'
    );
    return { inner, outer, power };
  }
  function impulse(raw, defaultId, clock, seed) {
    check(
      fields(raw, [
        'id',
        'time',
        'duration',
        'translation',
        'rotation',
        'space',
        'direction',
        'source',
        'falloff',
        'propagationSpeed',
        'frequency',
        'damping',
        'attack',
        'release',
        'profile',
        'weight',
        'seed',
        'lever',
        'angularGain',
        'enabled'
      ]),
      'unknown impulse field'
    );
    const {
      id: key = defaultId,
      time = clock,
      duration = 0.7,
      translation = [0, 0, 0],
      rotation = [0, 0, 0],
      space = 'camera',
      direction,
      source,
      propagationSpeed = 0,
      frequency = 12,
      damping = 7,
      attack = 0.015,
      release = duration * 0.2,
      profile = 'spring',
      weight = 1,
      seed: s = seed,
      lever,
      angularGain = 0,
      enabled = true
    } = raw;
    check(
      id(key) &&
        range(time, 0, 1e12) &&
        range(duration, 1e-4, 3600) &&
        vector(translation) &&
        vector(rotation) &&
        ['camera', 'world', 'impact'].includes(space) &&
        ['spring', 'shake', 'pulse'].includes(profile) &&
        range(frequency, 0.01, 240) &&
        range(damping, 0, 1000) &&
        range(attack, 0, duration) &&
        range(release, 1e-6, duration) &&
        range(weight, 0, 16) &&
        Number.isSafeInteger(s) &&
        range(s, 0, 0xffffffff) &&
        typeof enabled === 'boolean',
      'invalid impulse settings'
    );
    check(
      (direction === undefined || (vector(direction) && length(direction) > 1e-8)) &&
        (source === undefined || vector(source)) &&
        (space !== 'impact' || source !== undefined || direction !== undefined) &&
        (direction === undefined || space === 'impact'),
      'impact space needs a source or nonzero world direction'
    );
    check(
      range(propagationSpeed, 0, 1e6) &&
        (!propagationSpeed || source !== undefined) &&
        (lever === undefined || vector(lever)) &&
        range(angularGain, 0, 100),
      'invalid propagation or angular leverage'
    );
    const attenuation = falloff(raw.falloff);
    check(!attenuation || source !== undefined, 'distance falloff needs a source');
    return {
      id: key,
      time,
      duration,
      translation: translation.slice(),
      rotation: rotation.slice(),
      space,
      direction: direction ? unit(direction) : null,
      source: source?.slice() ?? null,
      falloff: attenuation,
      propagationSpeed,
      frequency,
      damping,
      attack,
      release,
      profile,
      weight,
      seed: s,
      lever: lever?.slice() ?? null,
      angularGain,
      enabled
    };
  }
  function layer(raw, seed) {
    check(
      fields(raw, [
        'id',
        'translation',
        'rotation',
        'space',
        'frequency',
        'octaves',
        'persistence',
        'weight',
        'seed',
        'time',
        'fadeIn',
        'enabled'
      ]),
      'unknown handheld field'
    );
    const {
      id: key,
      translation = [0.006, 0.009, 0.002],
      rotation = [0.001, 0.0012, 0.0008],
      space = 'camera',
      frequency = 0.65,
      octaves = 3,
      persistence = 0.45,
      weight = 1,
      seed: s = seed,
      time = 0,
      fadeIn = 0.5,
      enabled = true
    } = raw;
    check(
      id(key) &&
        vector(translation) &&
        vector(rotation) &&
        ['camera', 'world'].includes(space) &&
        range(frequency, 0.01, 120) &&
        Number.isSafeInteger(octaves) &&
        range(octaves, 1, 5) &&
        range(persistence, 0, 1) &&
        range(weight, 0, 16) &&
        Number.isSafeInteger(s) &&
        range(s, 0, 0xffffffff) &&
        range(time, 0, 1e12) &&
        range(fadeIn, 0, 60) &&
        typeof enabled === 'boolean',
      'invalid handheld layer'
    );
    return {
      id: key,
      translation: translation.slice(),
      rotation: rotation.slice(),
      space,
      frequency,
      octaves,
      persistence,
      weight,
      seed: s,
      time,
      fadeIn,
      enabled
    };
  }
  function external(e) {
    const v = clone(e);
    for (const key of ['direction', 'source', 'falloff', 'lever']) if (v[key] === null) delete v[key];
    return v;
  }
  function create(definition = {}) {
    check(
      fields(definition, ['impulses', 'handheld', 'seed', 'translationLimit', 'rotationLimit', 'maxImpulses']),
      'unknown configuration field'
    );
    const {
      impulses: initial = [],
      handheld: initialLayers = [],
      seed = 1,
      translationLimit = 1,
      rotationLimit = 0.35,
      maxImpulses = 256
    } = definition;
    check(
      Number.isSafeInteger(seed) &&
        range(seed, 0, 0xffffffff) &&
        range(translationLimit, 0, 100) &&
        range(rotationLimit, 0, Math.PI) &&
        Number.isSafeInteger(maxImpulses) &&
        range(maxImpulses, 1, 2048) &&
        Array.isArray(initial) &&
        initial.length <= maxImpulses &&
        Array.isArray(initialLayers) &&
        initialLayers.length <= 32,
      'invalid limits, seed or history budget'
    );
    let events = initial.map((e, i) =>
        impulse(e, 'impulse.' + (i + 1), 0, seedFor(seed, e.id ?? 'impulse.' + (i + 1)))
      ),
      layers = initialLayers.map(l => layer(l, seedFor(seed, l.id))),
      clock = 0,
      compensation = 0,
      serial = initial.length;
    check(
      new Set(events.map(e => e.id)).size === events.length && new Set(layers.map(l => l.id)).size === layers.length,
      'duplicate impulse or handheld ID'
    );
    let sortedEvents = null,
      sortedLayers = null;
    const order = rows => rows.slice().sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    function sample(time = clock, { pose = defaultPose } = {}) {
      check(range(time, 0, 1e12), 'sample time must be nonnegative and finite');
      basis(pose);
      const translation = zero(),
        rotation = zero(),
        contributions = [],
        pending = [];
      function add(id, type, linear, angular, meta) {
        for (let i = 0; i < 3; i++) {
          translation[i] += linear[i];
          rotation[i] += angular[i];
        }
        contributions.push({ id, type, ...meta, translation: linear, rotation: angular });
      }
      for (const e of (sortedEvents ??= order(events))) {
        if (!e.enabled) continue;
        const distance = e.source ? length(sub(pose.eye, e.source)) : 0,
          delay = e.propagationSpeed ? distance / e.propagationSpeed : 0,
          age = time - e.time - delay;
        const gain =
          e.weight *
          (e.falloff
            ? Math.pow(
                Math.max(0, Math.min(1, (e.falloff.outer - distance) / (e.falloff.outer - e.falloff.inner))),
                e.falloff.power
              )
            : 1);
        if (!gain || age >= e.duration) continue;
        if (age < 0) {
          pending.push({ id: e.id, arrival: e.time + delay, delay, distance, gain });
          continue;
        }
        const tail = 1 - smooth((age - (e.duration - e.release)) / e.release),
          attack = e.attack ? smooth(age / e.attack) : 1,
          envelope = tail * Math.exp(-age * e.damping),
          wave =
            e.profile === 'spring'
              ? Math.sin(tau * e.frequency * age) * envelope * attack
              : e.profile === 'pulse'
                ? attack * (1 - age / e.duration) ** 2 * tail
                : attack * envelope;
        let b = pose;
        if (e.space === 'world') b = defaultPose;
        if (e.space === 'impact') {
          const back = e.direction ?? unit(sub(pose.eye, e.source), pose.back),
            reference = Math.abs(back[1]) > 0.97 ? [1, 0, 0] : [0, 1, 0],
            right = unit(cross(reference, back));
          b = { right, up: cross(back, right), back };
        }
        const modulation = (n, i, shift) =>
          n *
          wave *
          gain *
          (e.profile === 'shake' ? noise(age * e.frequency * (1 + i * 0.13), e.seed + shift + i * 231) : 1);
        const linear = transform(
            e.translation.map((n, i) => modulation(n, i, 11)),
            b
          ),
          angular = transform(
            e.rotation.map((n, i) => modulation(n, i, 397)),
            b
          );
        if (e.lever && e.angularGain) {
          const torque = mul(cross(transform(e.lever, pose), linear), e.angularGain);
          for (let i = 0; i < 3; i++) angular[i] += torque[i];
        }
        add(e.id, 'impulse', linear, angular, {
          age,
          arrival: e.time + delay,
          delay,
          distance,
          gain,
          envelope: wave,
          profile: e.profile,
          space: e.space
        });
      }
      for (const l of (sortedLayers ??= order(layers))) {
        if (!l.enabled || time < l.time) continue;
        const age = time - l.time,
          gain = l.weight * (l.fadeIn ? smooth(age / l.fadeIn) : 1),
          b = l.space === 'camera' ? pose : defaultPose;
        if (!gain) continue;
        function channel(axis, shift) {
          let sum = 0,
            norm = 0,
            weight = 1;
          for (let o = 0; o < l.octaves; o++) {
            sum +=
              noise(age * l.frequency * (1 + axis * 0.17) * 2 ** o, l.seed + shift + axis * 307 + o * 647) * weight;
            norm += weight;
            weight *= l.persistence;
          }
          return (sum / norm) * gain;
        }
        add(
          l.id,
          'handheld',
          transform(
            l.translation.map((n, i) => n * channel(i, 0)),
            b
          ),
          transform(
            l.rotation.map((n, i) => n * channel(i, 991)),
            b
          ),
          { age, gain, frequency: l.frequency, space: l.space }
        );
      }
      const linearLength = length(translation),
        angularLength = length(rotation),
        linearScale = linearLength ? Math.min(1, translationLimit / linearLength) : 1,
        angularScale = angularLength ? Math.min(1, rotationLimit / angularLength) : 1;
      return freeze({
        time,
        translation: mul(translation, linearScale),
        rotation: mul(rotation, angularScale),
        contributions,
        pending,
        limits: { translationScale: linearScale, rotationScale: angularScale },
        activeCount: contributions.length
      });
    }
    function emit(raw) {
      check(events.length < maxImpulses, 'impulse history budget reached; cancel, prune or clear history');
      let next = serial + 1;
      check(Number.isSafeInteger(next), 'serial budget exceeded');
      while (events.some(e => e.id === 'impulse.' + next)) {
        next++;
        check(Number.isSafeInteger(next), 'serial budget exceeded');
      }
      const e = impulse(raw, 'impulse.' + next, clock, seedFor(seed, raw?.id ?? 'impulse.' + next));
      check(!events.some(row => row.id === e.id), 'duplicate impulse ID');
      events.push(e);
      sortedEvents = null;
      serial = next;
      return e.id;
    }
    function snapshot() {
      return {
        format: 'ink-studio/camera-impulses',
        version: 1,
        time: clock,
        compensation,
        serial,
        settings: { seed, translationLimit, rotationLimit, maxImpulses },
        impulses: events.map(external),
        handheld: clone(layers)
      };
    }
    const baseline = snapshot();
    function restore(saved) {
      check(
        record(saved) &&
          saved.format === 'ink-studio/camera-impulses' &&
          saved.version === 1 &&
          range(saved.time, 0, 1e12) &&
          finite(saved.compensation ?? 0) &&
          Math.abs(saved.compensation ?? 0) <= Number.EPSILON * Math.max(1, saved.time) * 4 &&
          Array.isArray(saved.impulses) &&
          Array.isArray(saved.handheld) &&
          Number.isSafeInteger(saved.serial) &&
          saved.serial >= 0 &&
          fields(saved.settings, ['seed', 'translationLimit', 'rotationLimit', 'maxImpulses']) &&
          Object.entries({ seed, translationLimit, rotationLimit, maxImpulses }).every(
            ([key, value]) => saved.settings[key] === value
          ),
        'incompatible checkpoint'
      );
      const next = create({ ...saved.settings, impulses: saved.impulses, handheld: saved.handheld }).snapshot();
      events = next.impulses.map((e, i) => impulse(e, e.id, 0, (seed + i * 101) >>> 0));
      layers = next.handheld.map((l, i) => layer(l, (seed + i * 139) >>> 0));
      sortedEvents = sortedLayers = null;
      clock = saved.time;
      compensation = saved.compensation ?? 0;
      serial = saved.serial;
      return api;
    }
    const api = Object.freeze({
      sample,
      emit,
      impulse: emit,
      get time() {
        return clock;
      },
      advance(dt, context) {
        check(range(dt, 0, 1e6) && range(clock + dt, 0, 1e12), 'advance needs bounded nonnegative seconds');
        const delta = dt - compensation,
          next = clock + delta;
        compensation = next - clock - delta;
        clock = next;
        return sample(clock, context);
      },
      seek(time, context) {
        check(range(time, 0, 1e12), 'seek needs nonnegative seconds');
        clock = time;
        compensation = 0;
        return sample(clock, context);
      },
      setLayer(raw) {
        check(record(raw) && id(raw.id), 'handheld edits need an ID');
        const i = layers.findIndex(row => row.id === raw.id),
          l = layer({ ...layers[i], ...raw }, layers[i]?.seed ?? seedFor(seed, raw.id));
        check(i >= 0 || layers.length < 32, 'handheld layer budget reached');
        sortedLayers = null;
        if (i >= 0) layers[i] = l;
        else layers.push(l);
        return api;
      },
      removeLayer: id => {
        layers = layers.filter(l => l.id !== id);
        sortedLayers = null;
        return api;
      },
      cancel: id => {
        events = events.filter(e => e.id !== id);
        sortedEvents = null;
        return api;
      },
      clear() {
        events = [];
        sortedEvents = null;
        return api;
      },
      prune(before) {
        check(range(before, 0, 1e12), 'prune needs nonnegative seconds');
        sortedEvents = null;
        events = events.filter(
          e =>
            e.time +
              e.duration +
              (e.falloff && e.propagationSpeed
                ? e.falloff.outer / e.propagationSpeed
                : e.propagationSpeed
                  ? Infinity
                  : 0) >
            before
        );
        return api;
      },
      snapshot,
      restore,
      reset: () => restore(baseline),
      bind(world) {
        check(record(world), 'bind needs a mutable world');
        const previous = world.cameraImpulses;
        world.cameraImpulses = api;
        check(world.cameraImpulses === api, 'world must allow a live camera binding');
        return () => {
          if (world.cameraImpulses === api) {
            if (previous === undefined) delete world.cameraImpulses;
            else world.cameraImpulses = previous;
          }
        };
      }
    });
    return api;
  }
  const cache = new WeakMap();
  function prepare(raw) {
    if (raw === undefined || raw === false) return null;
    if (typeof raw?.sample === 'function') return raw;
    check(record(raw), 'expected a motion definition or live impulse sampler');
    if (!cache.has(raw)) cache.set(raw, create(raw));
    return cache.get(raw);
  }
  function frame(world = {}, options = {}, pose) {
    if (options.lockCamera) return null;
    const source = options.cameraImpulses ?? world.cameraImpulses ?? world.look?.cameraImpulses,
      engine = prepare(source);
    if (!engine) return null;
    const time =
      options.cameraImpulseTime ??
      options.cameraTime ??
      world.timeDomains?.read('camera').sampleTime ??
      options.time ??
      options.t ??
      world.lookSnapshot?.time ??
      engine.time ??
      0;
    return engine.sample(time, { pose });
  }
  const presets = {
    recoil: {
      profile: 'spring',
      space: 'camera',
      duration: 0.42,
      frequency: 17,
      damping: 17,
      translation: [0, 0, 0.12],
      rotation: [0.045, 0, 0.002]
    },
    crash: {
      profile: 'spring',
      space: 'impact',
      duration: 1.7,
      frequency: 5,
      damping: 3.5,
      translation: [0, 0, 0.42],
      rotation: [0.012, 0.018, 0.018],
      lever: [0, 0.5, 0],
      angularGain: 0.5,
      falloff: { inner: 2, outer: 24, power: 1.5 }
    },
    thunder: {
      profile: 'shake',
      space: 'impact',
      duration: 3.4,
      frequency: 1.8,
      damping: 0.7,
      attack: 0.12,
      translation: [0, 0.065, 0.035],
      rotation: [0.004, 0.005, 0.003],
      falloff: { inner: 0, outer: 220, power: 1.2 },
      propagationSpeed: 80
    }
  };
  function preset(name, overrides = {}) {
    check(Object.hasOwn(presets, name) && record(overrides), 'unknown preset');
    const out = { ...clone(presets[name]), ...clone(overrides) };
    if (out.space === 'impact' && out.source === undefined && out.direction === undefined) out.direction = [0, 0, 1];
    if (out.source === undefined) {
      delete out.falloff;
      delete out.propagationSpeed;
    }
    impulse(out, 'preset', 0, 1);
    return freeze(out);
  }
  return Object.freeze({ create, prepare, frame, preset, restore: saved => create(saved.settings).restore(saved) });
})();
if (typeof module !== 'undefined') module.exports = CameraImpulses;
else globalThis[Symbol.for('ink-studio.camera-impulses')] = CameraImpulses;
