/* Timed, masked overrides using the native pose layer evaluator. */
(function (K) {
  const { anim: A, M, deform: D, clamp, mix: lerp } = K;
  const name = value => typeof value === 'string' && !!value.trim() && !(value in Object.prototype);
  const within = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi;
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const copy = value => Array.isArray(value) ? value.slice() : value;
  const scalar3 = value => Array.isArray(value) ? value : [value, value, value];
  const orientation = pose => {
    if (pose.turn && M.det(pose.turn) <= 1e-8) throw new RangeError('A blended turn must be invertible and orientation-preserving');
    return M.mul(pose.turn ? M.polar(pose.turn) : M.id(), pose.rot ? D.euler(pose.rot) : M.id());
  };

  function sourceTime(layer, time, duration) {
    const { source, start = 0, end = duration, in: from = 0, out = source.dur, loop = false } = layer;
    const span = out - from;
    if (time === end && layer.speed === undefined) return loop ? from : out;
    const age = (time - start) * (layer.speed ?? span / (end - start));
    return from + (loop ? age % span : clamp(age, 0, span));
  }

  function mix(pose, layer, time, weight, duration) {
    const values = layer.source ? layer.source.sample(sourceTime(layer, time, duration), {}, { sourceTime: true }) : layer.values;
    if (!values) return;
    for (const part of layer.parts ?? Object.keys(values)) {
      if (!name(part) || !Object.hasOwn(values, part)) continue;
      const src = values[part];
      if (src.rot === undefined && src.turn === undefined && src.pos === undefined &&
          src.scale === undefined && src.show === undefined) continue;
      const dst = Object.hasOwn(pose, part) ? pose[part] : (pose[part] = {});
      if (src.pos !== undefined) {
        if (!xyz(src.pos)) throw new TypeError('An override position must be XYZ on ' + part);
        dst.pos = weight === 1 ? src.pos.slice() : K.V.lerp(dst.pos ?? [0, 0, 0], src.pos, weight);
      }
      if (src.rot !== undefined || src.turn !== undefined) {
        if ((src.rot !== undefined && !xyz(src.rot)) || (src.turn !== undefined &&
            (!Array.isArray(src.turn) || src.turn.length !== 9 || !Array.from(src.turn).every(Number.isFinite))))
          throw new TypeError('Invalid override rotation on ' + part);
        if (weight === 1) {
          delete dst.rot;
          delete dst.turn;
          if (src.rot !== undefined) dst.rot = copy(src.rot);
          if (src.turn !== undefined) dst.turn = copy(src.turn);
        } else {
          const from = orientation(dst), to = orientation(src);
          const { axis, angle } = M.axisAngle(M.mul(to, M.tr(from)));
          dst.rot = D.angles(M.mul(M.rot(axis, angle * weight), from), dst.rot ?? src.rot);
          delete dst.turn;
        }
      }
      if (src.scale !== undefined) {
        if (!Number.isFinite(src.scale) && !xyz(src.scale)) throw new TypeError('Invalid override scale on ' + part);
        const prior = dst.scale ?? 1;
        dst.scale = weight === 1 ? copy(src.scale) : Array.isArray(prior) || Array.isArray(src.scale)
          ? K.V.lerp(scalar3(prior), scalar3(src.scale), weight) : lerp(prior, src.scale, weight);
      }
      if (src.show !== undefined && weight >= 0.5) {
        if (!Number.isFinite(src.show)) throw new TypeError('Invalid override visibility on ' + part);
        dst.show = src.show;
      }
    }
  }

  function curve(input, start, end) {
    if (within(input, 0, 1)) return input;
    if (!Array.isArray(input) || !input.length || input.length > 512)
      throw new TypeError('Layer weight needs a number or up to 512 curve keys');
    const keys = Array.from(input, row => {
      const [time, amount, ease = 'smooth', handles] = Array.isArray(row) ? row : [];
      if (!within(time, start, end) || !within(amount, 0, 1) || !A.EASES.includes(ease) ||
          (handles !== undefined && (ease !== 'bezier' || !Array.isArray(handles) || handles.length !== 4 ||
            Array.from(handles).some(value => !within(value, 0, 1)))))
        throw new TypeError('A weight key needs shot time, weight, and valid easing handles');
      return Object.freeze(handles ? [time, amount, ease, Object.freeze(handles.slice())] : [time, amount, ease]);
    }).sort((a, b) => a[0] - b[0]);
    if (keys.some((key, i) => i && key[0] === keys[i - 1][0])) throw new RangeError('Layer weight times must be unique');
    return Object.freeze(keys);
  }

  function create({ duration, sources = {}, layers = [], parts } = {}) {
    if (!(Number.isFinite(duration) && duration > 0) || !sources || typeof sources !== 'object' ||
        !Array.isArray(layers) || layers.length > 64 ||
        (parts !== undefined && (!Array.isArray(parts) || Array.from(parts).some(part => !name(part)))))
      throw new TypeError('Motion layers need a positive duration, native source clips, and up to 64 layers');
    const library = Object.freeze({ ...sources });
    const allowed = parts && Object.freeze([...new Set(parts)]);
    const allowedParts = new Set(allowed);
    const ids = new Set();
    const specs = Object.freeze(Array.from(layers, entry => {
      const { id, label = id, clip, parts, start = 0, end = duration, in: from = 0, out,
        speed, loop = false, enabled = true, weight = 1 } = entry ?? {};
      const source = Object.hasOwn(library, clip) && library[clip], last = out ?? source?.dur;
      if (!name(id) || ids.has(id) || typeof label !== 'string' || !label.trim() ||
          !name(clip) || typeof source?.sample !== 'function' || !Number.isFinite(source.dur) || source.dur <= 0 ||
          !within(start, 0, duration) || !within(end, 0, duration) || end <= start ||
          !within(from, 0, source.dur) || !within(last, 0, source.dur) || last <= from ||
          (speed !== undefined && (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite((end - start) * speed))) ||
          typeof loop !== 'boolean' || typeof enabled !== 'boolean' ||
          (parts !== undefined && (!Array.isArray(parts) ||
            Array.from(parts).some(part => !name(part) || (allowed && !allowedParts.has(part))))))
        throw new TypeError('Invalid motion layer or part mask: ' + id);
      ids.add(id);
      return Object.freeze({ id, label, clip, start, end, in: from, out: last,
        ...(speed !== undefined && { speed }), loop, enabled, weight: curve(weight, start, end),
        ...(parts !== undefined && { parts: Object.freeze([...new Set(parts)]) }) });
    }));
    const native = Object.freeze(specs.map(spec => Object.freeze({ ...spec, parts: spec.parts ?? allowed,
      source: library[spec.clip], mode: 'override' })));
    const rebuild = next => create({ duration, sources: library, layers: next, parts: allowed });
    function finiteTime(time) {
      if (!Number.isFinite(time)) throw new TypeError('Motion layer time must be finite');
    }
    function at(time, { enabled = true } = {}) {
      finiteTime(time);
      return native.map((layer, order) => {
        const active = enabled && layer.enabled && time >= layer.start && time <= layer.end;
        return { id: layer.id, order, weight: active ? A.influence(layer, time, duration) : 0,
          sourceTime: active ? sourceTime(layer, time, duration) : null };
      });
    }
    return Object.freeze({
      duration, layers: specs, native, at,
      apply(pose, time) {
        finiteTime(time);
        return A.layers(pose, native, time, duration, 'base');
      },
      edit(id, patch) {
        if (!ids.has(id)) throw new RangeError('Unknown motion layer: ' + id);
        return rebuild(specs.map(layer => layer.id === id ? { ...layer, ...patch, id } : layer));
      },
      arrange(order) {
        if (!Array.isArray(order) || order.length !== ids.size || new Set(order).size !== ids.size ||
            Array.from(order).some(id => !ids.has(id))) throw new RangeError('Supply every layer ID exactly once');
        const indexed = new Map(specs.map(layer => [layer.id, layer]));
        return rebuild(order.map(id => indexed.get(id)));
      }
    });
  }

  A.motionLayers = Object.freeze({ create, mix });
})(KIT);
