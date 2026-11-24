/* Keyframed, part-masked puppet deformations and geometric motion history. */
(function (K) {
  const { anim: A, deform: D, V, M, clamp } = K;
  const kinds = ['stretch', 'smear', 'trail', 'sweep'];
  const idOf = id => typeof id === 'string' && !!id.trim() && !(id in Object.prototype);
  const xyz = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const inRange = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;

  function create(builder, { duration, effects = [], capacity = 4096, trailLimit = 512 } = {}) {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isSafeInteger(capacity) || capacity < 1 ||
        capacity > 65536 || !Number.isInteger(trailLimit) || trailLimit < 1 || trailLimit > 2048)
      throw new TypeError('Motion FX needs a duration and bounded splat budget');
    const paletteLength = builder.P.length;
    let puppet, source, stage, layers, status = [], emitted = 0, applied = [], muted = false;
    let models = new Map(), geometry = new Map();

    function normalize(def) {
      const { id, kind, parts, keys, enabled = true, intensity = 1, axis, base, tip, color,
        lookback = kind === 'smear' || kind === 'stretch' ? 0.075 : 0.28,
        threshold = 0.02, strength = 0.65, preserveVolume = true,
        length = 0.6, gain = 0.1, copies = 3, opacity = 0.42,
        width = 0.07, spacing = 0.055, samples = 8 } = def || {};
      if (!idOf(id) || !kinds.includes(kind) || typeof enabled !== 'boolean' || !inRange(intensity, 0, 1) ||
          !Array.isArray(keys) || !keys.length ||
          (parts !== undefined && (!Array.isArray(parts) || !parts.length || !parts.every(idOf))) ||
          (axis !== undefined && (!xyz(axis) || V.len(axis) < 1e-8)) ||
          (base === undefined) !== (tip === undefined) || (base !== undefined && (!xyz(base) || !xyz(tip) || V.dist(base, tip) < 1e-8)) ||
          (color !== undefined && (!Number.isInteger(color) || color < 0 || color >= paletteLength)) ||
          !inRange(lookback, 0.001, 4) || !inRange(threshold, 0, 10000))
        throw new TypeError('Invalid Motion FX timing, targets, or settings: ' + id);
      if ((kind === 'stretch' && (!inRange(strength, -0.9, 4) || typeof preserveVolume !== 'boolean')) ||
          (kind === 'smear' && (!inRange(length, 0, 20) || !inRange(gain, 0, 4))) ||
          (kind === 'trail' && (!Number.isInteger(copies) || !inRange(copies, 1, 12) || !inRange(opacity, 0, 1))) ||
          (kind === 'sweep' && (!inRange(width, 0.001, 5) || !inRange(spacing, 0.005, 2) ||
            !Number.isInteger(samples) || !inRange(samples, 2, 25))))
        throw new RangeError('Motion FX parameters exceed their supported range: ' + id);
      const timed = Array.from(keys, key => {
        const [t, amount, ease = 'smooth'] = Array.isArray(key) ? key : [];
        if (!inRange(t, 0, duration) || !inRange(amount, 0, 1) || !A.EASES.includes(ease))
          throw new TypeError('An effect key needs a time, intensity, and easing: ' + id);
        return Object.freeze([t, amount, ease]);
      }).sort((a, b) => a[0] - b[0]);
      if (timed.some((key, i) => i && key[0] === timed[i - 1][0])) throw new Error('Effect key times must be unique: ' + id);
      const mask = parts && Object.freeze([...new Set(parts)]);
      if (puppet && mask?.some(part => !geometry.has(part))) throw new Error('Unknown Motion FX part in ' + id);
      return Object.freeze({ id, kind, parts: mask, keys: Object.freeze(timed), enabled, intensity, lookback, threshold,
        ...(axis && { axis: Object.freeze(V.norm(axis)) }),
        ...(base && { base: Object.freeze(base.slice()), tip: Object.freeze(tip.slice()) }),
        ...(color !== undefined && { color }),
        ...(kind === 'stretch' && { strength, preserveVolume }),
        ...(kind === 'smear' && { length, gain }),
        ...(kind === 'trail' && { opacity, copies }),
        ...(kind === 'sweep' && { width, spacing, samples }) });
    }
    function publish(effects) {
      if (!Array.isArray(effects) || effects.length > 32) throw new RangeError('Motion FX supports up to 32 layers');
      const next = Array.from(effects, normalize);
      if (new Set(next.map(effect => effect.id)).size !== next.length) throw new Error('Motion FX IDs must be unique');
      layers = Object.freeze(next);
      return layers;
    }
    publish(effects);
    function amount(layer, time) {
      if (!layer.enabled || time < layer.keys[0][0] || time > layer.keys.at(-1)[0]) return 0;
      return clamp(A.keys(layer.keys, time, 0), 0, 1) * layer.intensity;
    }
    function at(time) {
      if (!Number.isFinite(time)) throw new TypeError('Motion FX time must be finite');
      return layers.map(layer => ({ id: layer.id, kind: layer.kind, parts: layer.parts, amount: amount(layer, time) }));
    }
    const sprites = K.frameSplats(builder, capacity, (draw, dt, time) => {
      status = at(time).map(state => ({ ...state, amount: muted ? 0 : state.amount, deformed: 0, splats: 0, budgetSkipped: 0 }));
      if (!status.some(state => state.amount > 0)) {
        emitted = 0;
        return;
      }
      const maps = [];
      D.inspectPoses(puppet, solve => {
        let previous = NaN;
        function read(t) {
          if (t === previous) return;
          for (const part of Object.values(puppet.parts)) part.frame.length = 0;
          puppet.pose = {};
          source(t, puppet);
          solve(puppet.pose);
          previous = t;
        }
        for (const [index, state] of status.entries()) {
          const effect = layers[index];
          if (!state.amount) continue;
          for (const name of effect.parts ?? geometry.keys()) {
            const p = puppet.parts[name], shape = geometry.get(name);
            const start = Math.max(0, time - effect.lookback);
            const span = time - start;
            const base = effect.base ?? shape.base, tip = effect.tip ?? shape.tip;
            read(time);
            if (puppet.pose[name]?.show === 0) continue;
            if (effect.kind === 'stretch' || effect.kind === 'smear') {
              const center = p.D ? p.D(shape.center) : shape.center;
              const current = puppet.point(name, shape.center);
              const matrix = p.A;
              read(start);
              const worldVelocity = span ? V.mul(V.sub(current, puppet.point(name, shape.center)), 1 / span) : [0, 0, 0];
              const speed = V.len(worldVelocity);
              const axis = effect.axis ?? (speed > 1e-8 && Math.abs(M.det(matrix)) > 1e-10
                ? V.norm(M.app(M.inv(matrix), worldVelocity)) : null);
              if (!axis || (!effect.axis && speed <= effect.threshold)) continue;
              if (effect.kind === 'stretch') {
                if (!effect.strength) continue;
                maps.push([name, D.squash(center, axis, 1 + effect.strength * state.amount, effect.preserveVolume)]);
              } else {
                const length = Math.min(effect.length, Math.max(0, speed - effect.threshold) * effect.gain) * state.amount;
                if (!length) continue;
                const extent = Math.max(0.001, shape.size.reduce((d, w, i) => d + Math.abs(axis[i]) * w, 0));
                maps.push([name, D.smear({ dir: axis, length, extent, front: V.mad(center, axis, extent * 0.5) })]);
              }
              state.deformed++;
              continue;
            }
            if (!span) continue;
            const frame = () => ({ base: puppet.point(name, base), tip: puppet.point(name, tip) });
            const now = frame();
            read(start);
            const old = frame();
            const motion = Math.max(V.dist(now.base, old.base), V.dist(now.tip, old.tip));
            const initial = draw.count;
            if (effect.kind === 'trail') {
              if (motion <= Math.max(1e-7, effect.threshold * span)) continue;
              const model = models.get(name);
              if (!model.count) continue;
              for (let age = effect.copies; age >= 1; age--) {
                read(time - span * age / effect.copies);
                if (puppet.pose[name]?.show === 0) continue;
                const opacity = state.amount * effect.opacity * (1 - 0.65 * (age-1) / effect.copies);
                if (!draw.model(model, p.t, { matrix: p.A, deform: p.D ?? undefined, opacity, color: effect.color })) state.budgetSkipped++;
              }
            } else {
              const sections = [];
              let distance = 0;
              for (let step = 0; step < effect.samples; step++) {
                read(K.mix(start, time, step / (effect.samples - 1)));
                const section = frame(), prior = sections.at(-1);
                if (prior) distance += Math.max(V.dist(prior.base, section.base), V.dist(prior.tip, section.tip));
                sections.push(section);
              }
              if (distance <= Math.max(1e-7, effect.threshold * span)) continue;
              if (!draw.sweep(sections, { width: effect.width * state.amount, spacing: effect.spacing,
                color: effect.color ?? 1 })) state.budgetSkipped++;
            }
            state.splats += draw.count - initial;
          }
        }
      });
      for (const [part, map] of maps) puppet.deformVisual(part, map);
      applied = maps;
      emitted = draw.count;
    });
    function bind(world, actor, sample) {
      if (stage || !world?.anim?.rows || actor?.anim !== world.anim || !actor.parts ||
          typeof actor.deformVisual !== 'function' || typeof sample !== 'function')
        throw new TypeError('Bind Motion FX once with a finished puppet world and source pose callback');
      const nextModels = new Map(), nextGeometry = new Map();
      for (const [name, part] of Object.entries(actor.parts)) {
        if (!part.ids.length) continue;
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const id of part.ids) for (let axis = 0; axis < 3; axis++) {
          const n = world.data[id * 16 + axis];
          lo[axis] = Math.min(lo[axis], n);
          hi[axis] = Math.max(hi[axis], n);
        }
        const count = Math.min(part.ids.length, trailLimit);
        const ids = Array.from({ length: count }, (_, i) => part.ids[Math.floor(i * part.ids.length / count)]);
        nextModels.set(name, K.frameSplats.capture(world, undefined, { indices: ids }));
        nextGeometry.set(name, { center: V.lerp(lo, hi, 0.5), size: V.sub(hi, lo), base: part.base.slice(),
          tip: V.mad(part.base, part.axis, part.height) });
      }
      for (const effect of layers)
        if (effect.parts?.some(part => !nextGeometry.has(part))) throw new Error('Unknown Motion FX part in ' + effect.id);
      const { rows } = world.anim;
      const adapter = { D: world.data, N: world.count, rows, touch(i) { rows[i >> 9] = 1; } };
      sprites.bind(adapter);
      stage = adapter;
      puppet = actor;
      source = sample;
      models = nextModels;
      geometry = nextGeometry;
    }
    function apply(time, { before = false } = {}) {
      if (!stage || !Number.isFinite(time) || typeof before !== 'boolean')
        throw new TypeError('Bind Motion FX before applying a finite time');
      for (const [part, map] of applied) {
        const list = puppet.parts[part].visual, i = list.indexOf(map);
        if (i !== -1) list.splice(i, 1);
      }
      applied = [];
      muted = before;
      try { sprites.update(0, time, stage); }
      finally { muted = false; }
      return { time, layers: status, emitted };
    }
    return Object.freeze({ duration, first: sprites.first, capacity, bind, at, apply,
      effects: () => layers, setEffects: publish,
      edit(id, patch) {
        if (!layers.some(layer => layer.id === id)) throw new Error('Unknown Motion FX layer: ' + id);
        return publish(layers.map(layer => layer.id === id ? { ...layer, ...patch, id } : layer));
      } });
  }
  A.motionFx = Object.freeze({ create, kinds: Object.freeze(kinds) });
})(KIT);
