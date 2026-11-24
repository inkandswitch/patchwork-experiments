/* Review solved puppet trajectories and bake local, additive correction clips. */
(function (K) {
  const { anim: A, V, M, clamp } = K;
  const labels = { 'loop-pop': 'Loop pop', 'spacing-spike': 'Spacing spike',
    'arc-kink': 'Arc kink', 'foot-drift': 'Foot drift' };
  const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const smooth = u => u * u * (3 - 2 * u);
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);

  function footprint(points, times, ground, height, emit) {
    const grounded = points.map(p => {
      const floor = ground(p[0], p[2]);
      return Number.isFinite(floor) && Math.abs(p[1] - floor) <= height * 0.018;
    });
    let start = 0;
    function inspect(end) {
      if (times[end] - times[start] < 0.16) return;
      const drift = Math.max(...points.slice(start, end + 1).map(point => horizontal(point, points[start])));
      if (drift >= height * 0.014 && drift <= height * 0.18)
        emit('foot-drift', start, end, Math.floor((start + end) / 2), { distance: drift });
    }
    for (let i = 1; i < points.length; i++) {
      const dt = times[i] - times[i - 1];
      if (grounded[i] && grounded[i - 1] && horizontal(points[i], points[i - 1]) <= height * dt * 0.65 &&
          Math.abs(points[i][1] - points[i - 1][1]) <= height * dt * 0.15) continue;
      if (grounded[i - 1]) inspect(i - 1);
      start = i;
    }
    if (grounded.at(-1)) inspect(points.length - 1);
  }

  function trajectories(points, height, emit) {
    const segments = points.slice(1).map((p, i) => V.sub(p, points[i]));
    const lengths = segments.map(V.len);
    const spikes = new Set();
    for (let i = 2; i < lengths.length - 2; i++) {
      const neighbors = [lengths[i-2], lengths[i-1], lengths[i+1], lengths[i+2]];
      if (lengths[i] >= height * 0.025 && Math.max(...neighbors) >= height * 0.002 &&
          lengths[i] >= 3.2 * Math.max(...neighbors)) {
        spikes.add(i);
        emit('spacing-spike', i - 2, i + 3, i + 1, { distance: lengths[i] });
      }
    }
    const angles = points.map((_, i) => {
      if (!lengths[i-1] || !lengths[i] || Math.min(lengths[i-1], lengths[i]) < height * 0.0025) return 0;
      return Math.acos(clamp(V.dot(segments[i-1], segments[i]) / (lengths[i-1] * lengths[i]), -1, 1)) * 180 / Math.PI;
    });
    for (let i = 2; i < points.length - 2; i++) {
      const angle = angles[i];
      if (angle < 52 || angle > 145 || angle - Math.max(angles[i-1], angles[i+1]) < 18 ||
          spikes.has(i-1) || spikes.has(i)) continue;
      const from = points[i-1], chord = V.sub(points[i+1], from);
      const u = clamp(V.dot(V.sub(points[i], from), chord) / V.dot(chord, chord), 0, 1);
      const distance = V.dist(points[i], V.mad(from, chord, u));
      if (distance >= height * 0.0025)
        emit('arc-kink', Math.max(0, i-3), Math.min(points.length-1, i+3), i, { distance, angle });
    }
  }

  function collect(puppet, probes, sample, times) {
    const tracks = new Map(probes.map(probe => [probe.id, { probe, points: [], parents: [] }]));
    return K.deform.inspectPoses(puppet, solve => {
      for (const time of times) {
        solve(sample(time));
        for (const { probe, points, parents } of tracks.values()) {
          const point = puppet.point(probe.part, probe.point);
          if (!xyz(point)) throw new Error('Non-finite probe position: ' + probe.id);
          points.push(point);
          parents.push(puppet.parts[probe.part].P.slice());
        }
      }
      return tracks;
    });
  }

  function spacingTargets(points) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i-1] + V.dist(points[i-1], points[i]));
    let segment = 1;
    return points.map((point, i) => {
      if (!i || i === points.length-1) return point;
      const distance = lengths.at(-1) * i / (points.length-1);
      while (lengths[segment] < distance) segment++;
      const span = lengths[segment] - lengths[segment-1];
      return V.lerp(points[segment-1], points[segment], span ? (distance-lengths[segment-1]) / span : 0);
    });
  }

  function positionFix(finding, track, times, release) {
    const { kind, first, last } = finding;
    const { probe, points, parents } = track;
    const end = kind === 'foot-drift' ? Math.min(times.length - 1, last + release) : last;
    const matrices = parents.slice(first, end + 1);
    if (matrices.some(matrix => Math.abs(M.det(matrix)) < 1e-10)) return null;
    const section = points.slice(first, end + 1);
    let targets;
    if (kind === 'spacing-spike') targets = spacingTargets(section);
    else if (kind === 'arc-kink') targets = section.map((point, i) => {
      const u = i / (section.length - 1);
      return V.lerp(point, V.lerp(section[0], section.at(-1), u), 0.85 * Math.sin(Math.PI * u) ** 2);
    });
    else targets = section.map((point, i) => {
      const frame = first + i;
      const hold = frame <= last ? 1 : 1 - smooth((frame - last) / (end - last));
      return V.lerp(point, [section[0][0], point[1], section[0][2]], hold);
    });
    const keys = targets.map((target, i) => {
      const index = first + i;
      return [times[index], M.app(M.inv(matrices[i]), V.sub(target, points[index])), 'linear'];
    });
    return { start: times[first], end: times[end], tracks: [{ part: probe.part, ch: 'pos', keys }] };
  }

  /* Close the endpoint on native pose channels and ease the delta in along the tail. */
  function loopFix(sample, times, first) {
    const startPose = sample(0);
    const lastPose = sample(times.at(-1));
    const start = times[first], end = times.at(-1), tracks = [];
    const parts = new Set([...Object.keys(startPose), ...Object.keys(lastPose)]);
    for (const part of parts) {
      const a = startPose[part] ?? {}, b = lastPose[part] ?? {};
      for (const ch of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (ch === 'show') continue;
        const shape = b[ch] ?? a[ch], mul = A.multiplies(ch);
        const identity = ch === 'turn' ? M.id() : Array.isArray(shape) ?
          shape.map(() => mul ? 1 : 0) : (mul ? 1 : 0);
        // A matrix layer cannot safely be added to a part with no authored turn at one end.
        if (ch === 'turn' && (!a[ch] || !b[ch])) continue;
        const from = b[ch] ?? identity, to = a[ch] ?? identity;
        const delta = (x, y) => mul ? (x > 0 && y > 0 ? Math.max(0.01, y/x) : 1)
          : ch === 'rot' ? A.shortAngle(x, y) : y - x;
        const value = Array.isArray(from) && Array.isArray(to) && from.length === to.length
          ? from.map((v, axis) => delta(v, to[axis])) : Number.isFinite(from) && Number.isFinite(to)
            ? delta(from, to) : null;
        if (value === null || (Array.isArray(value) ? value.every(v => v === +mul) : value === +mul)) continue;
        const neutral = Array.isArray(value) ? value.map(() => +mul) : +mul;
        tracks.push({ part, ch, keys: [[start, neutral, 'smooth'], [end, value]] });
      }
    }
    return { start, end, tracks };
  }

  function create({ clip, puppet, probes, height, fps = 24, loop = clip?.loop, ground = () => 0,
    loopSource, applyFixes } = {}) {
    const duration = clip?.dur, count = Math.ceil(duration * fps);
    if (typeof clip?.sample !== 'function' || typeof clip.time !== 'function' ||
        typeof puppet?.solve !== 'function' || typeof puppet.point !== 'function' ||
        !Array.isArray(probes) || !probes.length || probes.length > 32 ||
        !Number.isFinite(height) || height <= 0 || !Number.isFinite(duration) || duration <= 0 || typeof loop !== 'boolean' ||
        !Number.isFinite(fps) || fps < 6 || fps > 120 || count > 3600 || typeof ground !== 'function' ||
        (loopSource !== undefined && typeof loopSource !== 'function') ||
        (applyFixes !== undefined && typeof applyFixes !== 'function'))
      throw new TypeError('Motion review needs a clip, puppet, reference height and valid sample rate');
    const ids = new Set();
    probes = Array.from(probes, probe => {
      if (typeof probe?.id !== 'string' || !probe.id || ids.has(probe.id) || !Object.hasOwn(puppet.parts, probe.part) ||
          !xyz(probe.point) || (probe.foot !== undefined && typeof probe.foot !== 'boolean'))
        throw new TypeError('Each probe needs a unique ID, puppet part and rest-space XYZ point');
      ids.add(probe.id);
      return { ...probe, point: probe.point.slice() };
    });
    const times = Array.from({ length: count+1 }, (_, i) => i * duration / count);
    const tracks = collect(puppet, probes, time => clip.sample(time, {}, { sourceTime: true }), times);
    const band = Math.max(2, Math.round(count/duration * 0.14));
    const layers = new Map(), findings = [];
    let seam;
    for (const { probe, points } of tracks.values()) {
      const gap = V.dist(points.at(-1), points[0]);
      if (loop && gap >= height * 0.025 && (!seam || gap > seam.distance)) seam = { probe, distance: gap };
      function emit(kind, first, last, frame, metric) {
        findings.push(Object.freeze({ id: kind + '/' + probe.id + '/' + frame, kind, label: labels[kind],
          probe: probe.id, part: probe.part, name: probe.label ?? probe.id, first, last, frame,
          time: times[frame], start: times[first], end: times[last], ...metric }));
      }
      if (probe.foot) footprint(points, times, ground, height, emit);
      else trajectories(points, height, emit);
    }
    if (seam) {
      const first = Math.max(0, count - Math.max(band, Math.ceil(fps * 0.24)));
      findings.push(Object.freeze({ id: 'loop-pop', kind: 'loop-pop', label: labels['loop-pop'],
        probe: seam.probe.id, part: seam.probe.part, name: seam.probe.label ?? seam.probe.id,
        distance: seam.distance, first, last: count, frame: count, time: duration, start: times[first], end: duration }));
    }
    findings.sort((a, b) => a.time - b.time || b.distance - a.distance);
    const byId = new Map(findings.map(finding => [finding.id, finding]));
    function get(id) {
      if (!byId.has(id)) throw new Error('Unknown motion finding: ' + id);
      return byId.get(id);
    }
    function focus(id, { before = true } = {}) {
      const finding = get(id), { kind, first, last, frame, probe } = finding;
      const isLoop = kind === 'loop-pop';
      const seamBand = Math.min(band, Math.max(1, Math.floor(count/2)));
      const start = times[isLoop ? count-seamBand : Math.max(0, first-band)];
      const end = times[isLoop ? seamBand : Math.min(count, last+band)];
      const length = isLoop ? duration-start+end : end-start;
      let evidence;
      if (isLoop) evidence = { type: 'ghosts', times: [duration, 0] };
      else {
        const track = tracks.get(probe), section = times.slice(first, last+1);
        const points = before || !layers.size ? track.points.slice(first, last+1) :
          collect(puppet, [track.probe], t => sample(t, {}, { sourceTime: true }), section).get(probe).points;
        evidence = { type: 'path', points: points.map((point, i) =>
          ({ time: section[i], point: point.slice(), current: first+i === frame })) };
      }
      return { start, end, duration: length, wraps: isLoop, evidence, timeAt(elapsed) {
        if (!Number.isFinite(elapsed)) throw new TypeError('Focus time must be finite');
        const t = start + ((elapsed % length + length) % length);
        return isLoop && t >= duration ? t-duration : t;
      } };
    }
    function accept(id) {
      if (layers.has(id)) return { ...layers.get(id) };
      const finding = get(id);
      const fix = finding.kind === 'loop-pop' ? loopFix(loopSource ?? (t => clip.sample(t, {}, { sourceTime: true })), times, finding.first)
        : positionFix(finding, tracks.get(finding.probe), times, band);
      if (!fix?.tracks.length) return null;
      const layer = { id, name: finding.label + ' · ' + finding.name, enabled: true, phase: 'corrective',
        start: fix.start, end: fix.end, offset: fix.start, loop: false,
        source: A.clip({ dur: duration, fps, tracks: fix.tracks }) };
      layers.set(id, layer);
      return { ...layer };
    }
    function setEnabled(id, enabled) {
      if (!layers.has(id)) get(id);
      const layer = layers.get(id);
      if (!layer) return false;
      layer.enabled = !!enabled;
      return true;
    }
    function sample(time, out, { sourceTime = false, before = false } = {}) {
      if (!Number.isFinite(time)) throw new TypeError('Sample time must be finite');
      const t = sourceTime ? clamp(time, 0, duration) : clip.time(time);
      if (!before && layers.size && applyFixes)
        return applyFixes(t, [...layers.values()].filter(layer => layer.enabled), out);
      const pose = clip.sample(t, out, { sourceTime: true });
      return before || !layers.size ? pose : A.layers(pose, [...layers.values()], t, duration, 'corrective');
    }
    return Object.freeze({ duration, findings: Object.freeze(findings), focus, accept, setEnabled, sample,
      layers: () => [...layers.values()].map(layer => ({ ...layer })),
      remove: id => layers.delete(id) });
  }

  A.motionReview = Object.freeze({ create });
})(KIT);
