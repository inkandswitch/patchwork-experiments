/* Named pose assets and story landmarks for K.anim.clip. */
(function (K) {
  const A = K.anim;
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const nameOf = value => typeof value === 'string' && value.trim() && !(value in Object.prototype);
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const axisSigns = [-1, 1, 1];
  const rotationSigns = [1, -1, -1];
  const matrixSigns = [1, -1, -1, -1, 1, 1, -1, 1, 1];
  const mirrorSigns = { pos: axisSigns, rot: rotationSigns, turn: matrixSigns, twist: -1 };

  function freezePose(pose) {
    if (!record(pose)) throw new TypeError('A pose must contain named parts');
    return Object.freeze(Object.fromEntries(Object.entries(pose).map(([part, channels]) => {
      if (!nameOf(part) || !record(channels)) throw new TypeError('Invalid pose part: ' + part);
      const entries = Object.entries(channels).map(([channel, value]) => {
        const size = channel === 'turn' ? 9 : ['pos', 'rot', 'scale'].includes(channel) ? 3 : null;
        const vector = Array.isArray(value);
        if (!nameOf(channel) || (vector
          ? !value.length || (size && value.length !== size) || !Array.from(value).every(Number.isFinite)
          : !Number.isFinite(value) || (size && channel !== 'scale')))
          throw new TypeError('Invalid pose channel: ' + part + '.' + channel);
        return [channel, vector ? Object.freeze(value.slice()) : value];
      });
      return [part, Object.freeze(Object.fromEntries(entries))];
    })));
  }

  function copyPose(pose) {
    return Object.fromEntries(Object.entries(pose).map(([part, channels]) =>
      [part, Object.fromEntries(Object.entries(channels).map(([channel, value]) =>
        [channel, Array.isArray(value) ? value.slice() : value]))]));
  }

  function channelValues(channel, values) {
    const vector = values.find(Array.isArray);
    if (vector && values.some(value => value !== undefined &&
        (Array.isArray(value) ? value.length !== vector.length : channel !== 'scale')))
      throw new TypeError('Inconsistent pose channel: ' + channel);
    const neutral = A.multiplies(channel) || channel === 'show' ? 1 : 0;
    if (!vector) return values.map(value => value ?? neutral);
    const rest = channel === 'turn' ? K.M.id() : vector.map(() => neutral);
    return values.map(value => value === undefined ? rest : Array.isArray(value) ? value : rest.map(() => value));
  }

  function eachChannel(poses, fn) {
    const parts = new Set(poses.flatMap(Object.keys));
    for (const part of parts) {
      const channels = new Set(poses.flatMap(pose => Object.keys(pose[part] || {})));
      for (const channel of channels)
        fn(part, channel, channelValues(channel, poses.map(pose => pose[part]?.[channel])));
    }
  }

  function between(a, b, weight) {
    const result = {};
    eachChannel([a, b], (part, channel, [from, to]) => {
      const delta = (x, y) => channel === 'rot' ? A.shortAngle(x, y) : y - x;
      A.put(result, part, channel, Array.isArray(from)
        ? from.map((x, i) => x + delta(x, to[i]) * weight)
        : from + delta(from, to) * weight);
    });
    return result;
  }

  function shelf({ poses = [], pairs = [] } = {}) {
    const opposite = new Map(), assets = new Map();
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(nameOf) ||
          pair[0] === pair[1] || pair.some(part => opposite.has(part)))
        throw new TypeError('Mirror pairs must contain two distinct parts used once');
      opposite.set(pair[0], pair[1]);
      opposite.set(pair[1], pair[0]);
    }
    function save(id, pose, { name = id } = {}) {
      if (!nameOf(id) || typeof name !== 'string' || !name.trim()) throw new TypeError('A saved pose needs an ID and name');
      const asset = Object.freeze({ id, name, pose: freezePose(pose) });
      assets.set(id, asset);
      return asset;
    }
    for (const asset of poses) {
      if (assets.has(asset.id)) throw new Error('Duplicate saved pose: ' + asset.id);
      save(asset.id, asset.pose, asset);
    }
    function get(id) {
      if (!assets.has(id)) throw new Error('Unknown saved pose: ' + id);
      return assets.get(id);
    }
    function apply(id, { base = {}, parts, weight = 1, mirror = false } = {}) {
      if (!unit(weight)) throw new RangeError('Pose weight must be between zero and one');
      base = freezePose(base);
      const saved = get(id).pose;
      const target = mirror ? Object.fromEntries(Object.entries(saved).map(([part, channels]) =>
        [opposite.get(part) ?? part, Object.fromEntries(Object.entries(channels).map(([channel, value]) => {
          const signs = mirrorSigns[channel];
          const reflected = Array.isArray(value)
            ? value.map((v, i) => v * (signs?.[i] ?? signs ?? 1))
            : value * (signs ?? 1);
          return [channel, reflected];
        }))])) : saved;
      if (parts !== undefined && (!Array.isArray(parts) || !parts.length ||
          parts.some(part => !nameOf(part) || (!Object.hasOwn(base, part) && !Object.hasOwn(target, part)))))
        throw new TypeError('Pose scope must name one or more destination parts');
      if (weight === 0) return copyPose(base);
      if (!parts) return weight === 1 ? copyPose(target) : between(base, target, weight);
      const scope = pose => Object.fromEntries(parts.filter(part => Object.hasOwn(pose, part)).map(part => [part, pose[part]]));
      const result = copyPose(base);
      for (const part of parts) delete result[part];
      return Object.assign(result, weight === 1 ? copyPose(scope(target)) : between(scope(base), scope(target), weight));
    }
    return Object.freeze({ save, get, apply, list: () => [...assets.values()], remove: id => assets.delete(id) });
  }

  function blocking(store, { keys, duration, fps = 30 } = {}) {
    if (!Array.isArray(keys) || !keys.length || !Number.isFinite(fps) || fps <= 0)
      throw new TypeError('Pose blocking needs keys and a valid playback rate');
    const frames = Array.from(keys, key => {
      if (!record(key) || !Number.isFinite(key.time) || key.time < 0 ||
          (key.name !== undefined && (typeof key.name !== 'string' || !key.name.trim())) ||
          (key.ease !== undefined && !A.EASES.includes(key.ease)))
        throw new TypeError('Invalid pose landmark');
      const { time, name, ease = 'smooth' } = key;
      if (key.pose !== undefined) {
        if (key.bias !== undefined) throw new TypeError('Only a breakdown can have a pose bias');
        const asset = store.get(key.pose);
        return { time, name: name ?? asset.name, kind: 'pose', id: asset.id, pose: asset.pose, ease };
      }
      if (!unit(key.bias)) throw new RangeError('Breakdown bias must be between zero and one');
      return { time, name: name ?? 'Breakdown', kind: 'breakdown', bias: key.bias, ease };
    }).sort((a, b) => a.time - b.time);
    if (!frames[0].pose || !frames.at(-1).pose || frames.some((frame, i) => i && frame.time === frames[i - 1].time))
      throw new Error('Pose landmarks need unique times and breakdowns must be between story poses');
    const end = frames.at(-1).time;
    const dur = duration ?? (end || 1);
    if (!Number.isFinite(dur) || dur <= 0 || dur < end) throw new RangeError('Duration must include every pose landmark');

    let previous, next = 0;
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (frame.kind === 'pose') {
        previous = frame;
      } else {
        if (next <= i) {
          next = i + 1;
          while (frames[next].kind !== 'pose') next++;
        }
        frame.pose = between(previous.pose, frames[next].pose, frame.bias);
      }
    }
    const tracks = [];
    eachChannel(frames.map(frame => frame.pose), (part, channel, values) => {
      let last;
      const keys = frames.map(({ time, ease }, i) => {
        let value = values[i];
        if (channel === 'rot' && last) value = value.map((v, axis) => last[axis] + A.shortAngle(last[axis], v));
        last = value;
        return [time, value, ease];
      });
      tracks.push({ part, ch: channel, keys });
    });
    const clip = A.clip({ dur, fps, tracks });
    const held = A.clip({ dur, fps, tracks: tracks.map(track => ({
      ...track, keys: track.keys.map(([time, value]) => [time, value, 'step'])
    })) });
    const markers = frames.map(({ time, name, kind, id, bias }) =>
      Object.freeze({ time, name, kind, ...(kind === 'pose' ? { id } : { bias }) }));
    return Object.freeze({ clip, held, markers: Object.freeze(markers) });
  }

  function heldClip(clip) {
    const times = [...new Set((clip.tracks ?? []).flatMap(track =>
      (track.keys ?? []).map(key => key.t ?? key.time)))].sort((a, b) => a - b);
    return Object.freeze({ sample(time, out) {
      let lo = 0, hi = times.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= time) lo = mid + 1;
        else hi = mid;
      }
      return clip.sample(times[lo - 1] ?? 0, out, { sourceTime: true });
    } });
  }

  A.poseShelf = Object.freeze({ create: shelf });
  A.poseBlocking = Object.freeze({ create: blocking, heldClip });
})(KIT);
