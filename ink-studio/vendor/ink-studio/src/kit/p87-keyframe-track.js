/* Validated, renderer-independent keyframe tracks on a seconds-based clock. */
(function (K) {
  const modes = ['number', 'vector', 'radians', 'positive', 'orientation', 'quaternion'];
  const eases = Object.freeze(['linear', 'smooth', 'step', 'in-sine', 'out-sine', 'in-out-sine']);
  const turn = 2 * Math.PI;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
  const blend = (a, b, t) => (1 - t) * a + t * b;
  const orientation = value => Array.isArray(value) && value.length === 9 &&
    Array.from(value).every(Number.isFinite) && Math.abs(K.M.det(value) - 1) < 1e-4 &&
    K.M.mul(K.M.tr(value), value).every((n, i) => Math.abs(n - (i % 4 === 0 ? 1 : 0)) < 1e-4);

  function create(schema, input = []) {
    if (!record(schema) || !Array.isArray(input)) throw Error('Expected channel modes and a keyframe array');
    const entries = Object.entries(schema);
    if (!entries.length || entries.some(([name, mode]) => !name || !modes.includes(mode)))
      throw Error('Invalid keyframe channel schema');
    const lengths = new Map();
    const keys = Array.from(input, key => {
      if (!record(key) || !Number.isFinite(key.time) || key.time < 0 || !record(key.value) ||
          Object.keys(key.value).length !== entries.length)
        throw Error('Each keyframe needs a nonnegative time and every channel');
      const ease = key.ease ?? 'smooth';
      if (!eases.includes(ease)) throw Error('Unknown keyframe easing');
      const pairs = entries.map(([name, mode]) => {
        const value = Object.hasOwn(key.value, name) ? key.value[name] : undefined;
        if (mode === 'quaternion') return [name, Object.freeze(K.Q.normalize(value))];
        if (mode === 'vector' || mode === 'orientation') {
          if (mode === 'orientation' && !orientation(value)) throw Error('Invalid orientation channel: ' + name);
          if (!Array.isArray(value) || !value.length || !Array.from(value).every(Number.isFinite) ||
              (lengths.has(name) && lengths.get(name) !== value.length))
            throw Error('Invalid vector channel: ' + name);
          lengths.set(name, value.length);
          return [name, Object.freeze(value.slice())];
        }
        if (!Number.isFinite(value) || (mode === 'positive' && value <= 0))
          throw Error('Invalid keyframe channel: ' + name);
        return [name, value];
      });
      return Object.freeze({ time: key.time, value: Object.freeze(Object.fromEntries(pairs)), ease });
    }).sort((a, b) => a.time - b.time);
    if (keys.some((key, i) => i > 0 && keys[i - 1].time === key.time))
      throw Error('Keyframe times must be unique');

    const columns = entries.map(([name, mode]) => {
      let unwrapped = 0;
      const values = keys.map(key => {
        const value = key.value[name];
        if (mode !== 'radians') return value;
        const next = angle(value);
        const offset = next - unwrapped % turn;
        unwrapped += angle(offset);
        return unwrapped;
      });
      return { name, mode, values };
    });

    const duration = keys.at(-1)?.time ?? 0;
    function sample(time) {
      if (!Number.isFinite(time)) throw Error('Sample time must be finite');
      if (!keys.length) return null;
      const t = Math.max(keys[0].time, Math.min(duration, time));
      let low = 0, high = keys.length - 1;
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (keys[mid].time <= t) low = mid;
        else high = mid;
      }
      const a = keys[low], b = keys[high];
      const u = t === a.time ? 0 : t === b.time ? 1 : K.anim.ease((t - a.time) / (b.time - a.time), a.ease);
      return Object.fromEntries(columns.map(({ name, mode, values }) => {
        const start = values[low], end = values[high];
        if (mode === 'quaternion') return [name, K.Q.slerp(start, end, u)];
        if (mode === 'vector') return [name, start.map((v, i) => blend(v, end[i], u))];
        if (mode === 'orientation') {
          if (u === 0 || u === 1) return [name, (u === 0 ? start : end).slice()];
          const { axis, angle } = K.M.axisAngle(K.M.mul(end, K.M.tr(start)));
          return [name, K.M.mul(K.M.rot(axis, angle * u), start)];
        }
        if (u === 0 || u === 1) return [name, u === 0 ? start : end];
        if (mode === 'positive') return [name, Math.exp(blend(Math.log(start), Math.log(end), u))];
        return [name, blend(start, end, u)];
      }));
    }
    return Object.freeze({ keys: Object.freeze(keys), duration, sample });
  }

  K.anim.keyframeTrack = Object.freeze({ create, eases, orientation });
})(KIT);
