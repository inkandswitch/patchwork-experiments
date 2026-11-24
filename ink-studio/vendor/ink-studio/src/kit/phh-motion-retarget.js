/* Retarget native clip channels through author-defined rest frames. */
(function (K) {
  const { anim: A, V, M, deform: D, clamp } = K;
  const supported = new Set(['pos', 'rot', 'turn', 'scale', 'show']);
  const own = (value, key) => Object.hasOwn(value, key);
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const name = value => typeof value === 'string' && !!value.trim() && !(value in Object.prototype);
  const vector = (value, size = 3) => Array.isArray(value) && value.length === size && Array.from(value).every(Number.isFinite);
  const extent = value => vector(value) && V.len(value) > 1e-8;

  function validateProfile(definition) {
    const { id = 'custom', root, roles, scaleChains = [] } = definition || {};
    if (!name(id) || !name(root) || !record(roles) || !own(roles, root) || roles[root]?.marker ||
        !Array.isArray(scaleChains)) throw new TypeError('A retarget profile needs roles and a transform root');
    const result = Object.fromEntries(Object.entries(roles).map(([id, spec]) => {
      const { required = false, marker = false, aim } = spec ?? {};
      if (!name(id) || !record(spec) || typeof required !== 'boolean' || typeof marker !== 'boolean' ||
          (aim !== undefined && (!name(aim) || !own(roles, aim) || aim === id)))
        throw new TypeError('Invalid retarget role: ' + id);
      return [id, Object.freeze({ required: required || id === root, marker, ...(aim !== undefined && { aim }) })];
    }));
    const chains = Array.from(scaleChains, chain => {
      if (!Array.isArray(chain) || chain.length < 2 || new Set(chain).size !== chain.length ||
          Array.from(chain).some(role => !name(role) || !own(result, role)))
        throw new TypeError('A scale chain needs two or more distinct profile roles');
      return Object.freeze(chain.slice());
    });
    return Object.freeze({ id, root, roles: Object.freeze(result), scaleChains: Object.freeze(chains) });
  }

  function builtin(id, root, body, limbs, supports) {
    const roles = { [root]: {}, ...body }, scaleChains = [];
    for (const side of ['left', 'right']) for (const [limb, suffixes] of Object.entries(limbs)) {
      const chain = suffixes.map(suffix => side + suffix);
      chain.forEach((role, i) => { roles[role] = {
        required: i < 2 && supports.includes(limb), marker: i === chain.length - 1,
        ...(chain[i + 1] && { aim: chain[i + 1] })
      }; });
      if (supports.includes(limb)) scaleChains.push(chain);
    }
    return validateProfile({ id, root, roles, scaleChains });
  }

  const leg = ['Thigh', 'Shin', 'Foot', 'Sole'], wing = ['Wing', 'WingFore', 'WingTip'];
  const profiles = Object.freeze({
    biped: builtin('biped', 'hips', { spine: { aim: 'head' }, head: {} },
      { leg, arm: ['UpperArm', 'Forearm', 'Wrist', 'Palm'] }, ['leg']),
    quadruped: builtin('quadruped', 'hips', {
      chest: { aim: 'neck' }, neck: { aim: 'head' }, head: {}, tail: { aim: 'tailTip' }, tailTip: { marker: true }
    }, { fore: ['ForeUpper', 'ForeLower', 'ForePaw', 'ForePad'], hind: ['HindUpper', 'HindLower', 'HindPaw', 'HindPad'] },
    ['fore', 'hind']),
    avian: builtin('avian', 'body', { neck: { aim: 'head' }, head: {}, tail: {} }, { leg, wing }, ['leg']),
    serpentine: validateProfile({ id: 'serpentine', root: 'body', roles: {
      body: {}, neck: { aim: 'head' }, head: { required: true },
      spine: { aim: 'tail' }, tail: { required: true, aim: 'tailTip' }, tailTip: { marker: true }
    }, scaleChains: [['head', 'body', 'spine', 'tail', 'tailTip']] })
  });

  function frame(forward, hints) {
    const z = V.norm(forward);
    const hint = hints.find(axis => Math.abs(V.dot(z, V.norm(axis))) < 0.99);
    const x = V.norm(V.cross(hint, z));
    return M.cols(x, V.cross(z, x), z);
  }

  function readRig(spec, profile) {
    const { puppet, roles, forward = [0, 0, 1], up = [0, 1, 0], unit } = spec ?? {};
    if (!record(puppet?.parts) || (roles !== undefined && !record(roles)) ||
        !extent(forward) || !extent(up) || Math.abs(V.dot(V.norm(forward), V.norm(up))) >= 0.99 ||
        (unit !== undefined && (!Number.isFinite(unit) || unit <= 0)))
      throw new TypeError('A retarget rig needs puppet parts, independent forward/up axes, and an optional positive unit');
    for (const role of Object.keys(roles ?? {}))
      if (!own(profile.roles, role)) throw new TypeError('Unknown role in ' + profile.id + ': ' + role);
    const basis = frame(forward, [up]), bindings = new Map(), missing = [];
    const claimed = new Set();
    const axes = [M.app(basis, [0, 0, 1]), M.app(basis, [0, 1, 0]), M.app(basis, [1, 0, 0])];
    for (const [role, rule] of Object.entries(profile.roles)) {
      const entry = roles === undefined ? (own(puppet.parts, role) ? role : null) : roles[role];
      if (entry == null) {
        missing.push({ role, required: rule.required, reason: 'unmapped' });
        continue;
      }
      const { part, point, axis, up, marker = rule.marker } = typeof entry === 'string' ? { part: entry } : entry;
      if (!name(part) || (point !== undefined && !vector(point)) || (axis !== undefined && !extent(axis)) ||
          (up !== undefined && !extent(up)) || typeof marker !== 'boolean' || (rule.required && marker !== rule.marker))
        throw new TypeError('Invalid retarget binding for ' + role);
      const rest = own(puppet.parts, part) && puppet.parts[part];
      if (!rest) {
        missing.push({ role, part, required: rule.required, reason: 'unknown-part' });
        continue;
      }
      if (!vector(rest.pivot)) throw new TypeError('Invalid puppet rest pivot for ' + part);
      if (!marker && claimed.has(part)) throw new TypeError('Two transform roles bind the same part: ' + part);
      if (!marker) claimed.add(part);
      bindings.set(role, { part, point: (point ?? rest.pivot).slice(), marker, axis: axis?.slice(), up: up?.slice() });
    }
    for (const [role, binding] of bindings) {
      const visited = new Set([role]);
      let next = profile.roles[role].aim;
      while (next !== undefined && !visited.has(next) && !bindings.has(next)) {
        visited.add(next);
        next = profile.roles[next].aim;
      }
      const aim = !visited.has(next) && bindings.get(next);
      const segment = aim && V.sub(aim.point, binding.point);
      binding.length = segment ? V.len(segment) : 0;
      const axis = binding.axis ?? segment;
      binding.frame = role !== profile.root && extent(axis)
        ? frame(axis, binding.up ? [binding.up, ...axes] : axes)
        : basis;
    }
    return { puppet, basis, axes, bindings, missing, unit };
  }

  function travelScale(profile, from, to) {
    if (from.unit !== undefined || to.unit !== undefined) {
      if (from.unit === undefined || to.unit === undefined) throw new TypeError('Supply a unit for both retarget rigs');
      return to.unit / from.unit;
    }
    let a = 0, b = 0;
    for (const chain of profile.scaleChains) {
      const roles = chain.filter(role => from.bindings.has(role) && to.bindings.has(role));
      for (let i = 1; i < roles.length; i++) {
        const [start, end] = roles.slice(i - 1, i + 1);
        const length = rig => V.dist(rig.bindings.get(start).point, rig.bindings.get(end).point);
        const f = length(from), t = length(to);
        if (f > 1e-8 && t > 1e-8) {
          a += f;
          b += t;
        }
      }
    }
    return a > 0 ? b / a : 1;
  }

  function create({ clip, source, target, profile: definition = 'biped', travel = 'scaled' } = {}) {
    if (typeof definition === 'string' && !own(profiles, definition)) throw new TypeError('Unknown retarget profile: ' + definition);
    const profile = typeof definition === 'string' ? profiles[definition] : validateProfile(definition);
    if (typeof clip?.sample !== 'function' || !Array.isArray(clip.tracks) || !Number.isFinite(clip.dur) || clip.dur <= 0 ||
        !['scaled', 'unscaled', 'in-place'].includes(travel))
      throw new TypeError('Retargeting needs a native Ink clip and a valid travel mode');
    const from = readRig(source, profile), to = readRig(target, profile), duration = clip.dur;
    const rootScale = travelScale(profile, from, to), alignment = M.mul(to.basis, M.tr(from.basis));
    if (!Number.isFinite(rootScale) || rootScale <= 0) throw new RangeError('Invalid retarget rig scale');
    const pairs = [], mapped = new Map(), conflicts = [];
    for (const [role, a] of from.bindings) {
      const b = to.bindings.get(role);
      if (!b) continue;
      if (a.marker !== b.marker) conflicts.push({ role, reason: 'marker-transform-mismatch' });
      if (a.marker || b.marker) continue;
      const transform = M.mul(b.frame, M.tr(a.frame));
      const scale = a.length > 1e-8 && b.length > 1e-8 ? b.length / a.length : rootScale;
      pairs.push({ role, source: a.part, target: b.part, transform, inverse: M.tr(transform), scale });
      mapped.set(a.part, role);
    }
    const skippedTracks = clip.tracks.filter(track => !mapped.has(track.part) || !supported.has(track.ch))
      .map(track => ({ part: track.part, channel: track.ch,
        reason: mapped.has(track.part) ? 'unsupported-channel' : 'unmapped-part' }));
    const incomplete = rig => rig.missing.some(item => item.required || item.reason === 'unknown-part');
    const status = !pairs.some(pair => pair.role === profile.root) ? 'unsupported' :
      incomplete(from) || incomplete(to) || skippedTracks.length || conflicts.length ? 'partial' : 'ready';
    const report = () => ({ profile: profile.id, status, duration, travel, travelScale: travel === 'unscaled' ? 1 : rootScale,
      source: { missing: from.missing.map(item => ({ ...item })) }, target: { missing: to.missing.map(item => ({ ...item })) },
      roles: [...from.bindings].flatMap(([role, a]) => {
        const b = to.bindings.get(role);
        if (!b) return [];
        const pair = pairs.find(value => value.role === role);
        return [{ role, source: a.part, target: b.part, driven: !!pair,
          ...(pair && { scale: role === profile.root ? rootScale : pair.scale }) }];
      }), skippedTracks: skippedTracks.map(item => ({ ...item })), conflicts: conflicts.map(item => ({ ...item })) });

    function sample(time, near) {
      if (status === 'unsupported') throw new Error('Retargeting needs a mapped root on both puppets');
      if (!Number.isFinite(time)) throw new TypeError('Retarget sample time must be finite');
      const pose = clip.sample(clamp(time, 0, duration), {}, { sourceTime: true }), result = {};
      for (const pair of pairs) {
        const value = pose[pair.source];
        if (!value) continue;
        const out = {};
        const { pos, rot, turn, scale, show } = value;
        if (pos !== undefined) {
          if (!vector(pos)) throw new TypeError('Invalid position on ' + pair.source);
          const root = pair.role === profile.root;
          const displacement = M.app(root ? alignment : pair.transform, pos);
          const up = to.axes[1];
          out.pos = root && travel === 'in-place' ? V.mul(up, V.dot(up, displacement) * rootScale)
            : V.mul(displacement, root ? (travel === 'scaled' ? rootScale : 1) : pair.scale);
        }
        if (rot !== undefined || turn !== undefined) {
          if ((rot !== undefined && !vector(rot)) ||
              (turn !== undefined && (!vector(turn, 9) || M.det(turn) <= 1e-8)))
            throw new TypeError('Invalid local rotation on ' + pair.source);
          const local = turn ? M.mul(M.polar(turn), rot ? D.euler(rot) : M.id()) : D.euler(rot);
          out.rot = D.angles(M.mul(pair.transform, M.mul(local, pair.inverse)), near?.[pair.target]);
        }
        if (scale !== undefined) {
          if (Number.isFinite(scale)) out.scale = scale;
          else if (vector(scale)) out.scale = [0, 3, 6].map(i => scale.reduce((sum, s, j) =>
            sum + s * pair.transform[i+j] ** 2, 0));
          else throw new TypeError('Invalid scale on ' + pair.source);
        }
        if (show !== undefined) {
          if (!Number.isFinite(show)) throw new TypeError('Invalid visibility on ' + pair.source);
          out.show = show;
        }
        if (Object.keys(out).length) result[pair.target] = out;
      }
      return result;
    }

    function landmarks(time) {
      const targetPose = sample(time), t = clamp(time, 0, duration);
      function measure(rig, pose) {
        if (typeof rig.puppet.solve !== 'function' || typeof rig.puppet.point !== 'function')
          throw new TypeError('Landmark measurement needs native puppets');
        return D.inspectPoses(rig.puppet, solve => {
          const actor = solve(pose);
          return Object.fromEntries([...rig.bindings].map(([role, binding]) =>
            [role, actor.point(binding.part, binding.point)]));
        });
      }
      return { time: t, source: measure(from, clip.sample(t, {}, { sourceTime: true })), target: measure(to, targetPose) };
    }

    function bake({ fps = clip.fps ?? 30, id = clip.id, name = clip.name } = {}) {
      if (!Number.isFinite(fps) || fps < 1 || fps > 240 || Math.ceil(duration * fps) > 7200)
        throw new RangeError('Retarget bake needs 1–240 fps and at most 7200 frame intervals');
      const count = Math.ceil(duration * fps);
      const times = new Set(Array.from({ length: count + 1 }, (_, i) => i === count ? duration : i / fps));
      const jumps = new Set();
      for (const track of clip.tracks) {
        if (!mapped.has(track.part) || !supported.has(track.ch)) continue;
        for (const [i, key] of (track.keys ?? []).entries()) {
          const t = key.t ?? key.time, prev = track.keys[i - 1];
          if (!Number.isFinite(t) || t < 0 || t > duration) continue;
          times.add(t);
          if (!prev) continue;
          const from = prev.t ?? prev.time, step = (prev.ease ?? prev.easing) === 'step';
          if (from < t && step) {
            const edge = t - Math.min(1e-7, (t - from) / 2);
            if (edge < t) { times.add(edge); jumps.add(edge); }
          } else if (from >= 0 && from < t && track.ch === 'rot') {
            const start = prev.v ?? prev.value, stop = key.v ?? key.value;
            if (!vector(start) || !vector(stop)) continue;
            const segments = Math.ceil(Math.max(...V.sub(start, stop).map(Math.abs)) / 60);
            if (segments > 7200) throw new RangeError('Retarget bake exceeds the rotation sample budget');
            for (let k = 1; k < segments; k++) times.add(from + (t - from) * k / segments);
          }
          if (times.size > 8192) throw new RangeError('Retarget bake exceeds the frame budget');
        }
      }
      if (times.size > 8192 || times.size * pairs.length > 320_000) throw new RangeError('Retarget bake exceeds the key budget');
      const frames = [...times].sort((a, b) => a - b), prior = {}, tracks = [];
      const channels = new Map();
      for (const time of frames) {
        for (const [part, values] of Object.entries(sample(time, prior))) {
          if (values.rot) prior[part] = values.rot;
          if (!channels.has(part)) channels.set(part, new Map());
          const byChannel = channels.get(part);
          for (const [ch, value] of Object.entries(values)) {
            if (!byChannel.has(ch)) byChannel.set(ch, []);
            byChannel.get(ch).push([time, value, ch === 'show' || jumps.has(time) ? 'step' : 'linear']);
          }
        }
      }
      for (const [part, entries] of channels) for (const [ch, keys] of entries) {
        const initial = keys[0][1], same = value => Array.isArray(initial)
          ? Array.isArray(value) && value.length === initial.length && value.every((v, i) => v === initial[i])
          : value === initial;
        tracks.push({ part, ch, keys: keys.every(key => same(key[1])) ? [keys[0]] : keys });
      }
      const definition = { ...(id !== undefined && { id }), ...(name !== undefined && { name }),
        dur: duration, fps, loop: !!clip.loop, tracks, cues: structuredClone(clip.cues ?? []),
        ...(clip.animationEvents?.length && { events: structuredClone(clip.animationEvents) }) };
      return { definition, clip: A.clip(definition), frames: frames.length };
    }
    return Object.freeze({ duration, status, report, sample: time => sample(time), landmarks, bake });
  }

  A.retarget = Object.freeze({ profiles, create });
})(KIT);
