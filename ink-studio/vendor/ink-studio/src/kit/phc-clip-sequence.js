/* Non-destructive sequencing and retiming of native clips. */
(function (K) {
  const { anim: A, clamp, V } = K;
  const eases = ['linear', 'in-sine', 'out-sine', 'in-out-sine'];
  const alignments = ['source', 'root', 'foot'];
  const modes = ['once', 'loop', 'travel-loop'];
  const zero = [0, 0, 0];
  const point = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const idOf = value => typeof value === 'string' && !!value.trim() && !(value in Object.prototype);
  const xz = (a, b) => [a[0] - b[0], 0, a[2] - b[2]];
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const clamp01 = t => clamp(t, 0, 1);

  function stepSource(step, elapsed) {
    if (elapsed <= 0) return step.in;
    if (elapsed >= step.duration) return step.out;
    return step.in + (step.out - step.in) * A.ease(elapsed / step.duration, step.ease);
  }

  function stepTime(step, time) {
    if (time <= step.in) return step.start;
    if (time >= step.out) return step.end;
    const u = (time - step.in) / (step.out - step.in);
    if (step.ease === 'linear') return step.start + u * step.duration;
    let low = 0, high = 1;
    for (let i = 0; i < 52; i++) {
      const mid = (low + high) / 2;
      if (A.ease(mid, step.ease) < u) low = mid;
      else high = mid;
    }
    return step.start + high * step.duration;
  }

  function clipPose(clip, step, elapsed) {
    return clip.sample(stepSource(step, elapsed), {}, { sourceTime: true });
  }

  function channelGaps(left, right, root, height) {
    let poseSum = 0, velocitySum = 0, maximumPose = 0, count = 0;
    for (const part of new Set([...Object.keys(left.pose), ...Object.keys(right.pose)])) {
      for (const channel of ['pos', 'rot', 'scale', 'stretch']) {
        const poses = [left.pose, left.near, right.pose, right.near].map(pose => pose[part]?.[channel]);
        const exemplar = poses.find(value => value !== undefined);
        if (exemplar === undefined) continue;
        const size = poses.find(Array.isArray)?.length ?? 1;
        const neutral = A.multiplies(channel) ? 1 : 0;
        const units = channel === 'pos' ? height : channel === 'rot' ? 180 : 1;
        const values = poses.map(value => Array.isArray(value) ? value : Array(size).fill(value ?? neutral));
        const [a, before, b, after] = values;
        if (values.some(v => v.length !== size || !v.every(Number.isFinite))) continue;
        const delta = channel === 'rot' ? A.shortAngle : (a, b) => b - a;
        let pg = 0, vg = 0;
        for (let axis = 0; axis < size; axis++) {
          if (part !== root || channel !== 'pos' || axis === 1) pg += (delta(a[axis], b[axis]) / units) ** 2;
          const incoming = delta(before[axis], a[axis]) / left.dt;
          const outgoing = delta(b[axis], after[axis]) / right.dt;
          vg += ((outgoing - incoming) / units) ** 2;
        }
        if (pg < 1e-12 && vg < 1e-12) continue;
        maximumPose = Math.max(maximumPose, Math.sqrt(pg));
        poseSum += pg;
        velocitySum += vg;
        count++;
      }
    }
    return {
      poseGap: count ? Math.max(Math.sqrt(poseSum / count), maximumPose * 0.65) : 0,
      velocityGap: count ? Math.sqrt(velocitySum / count) : 0
    };
  }

  function planted(points, offset, ground, height) {
    const anchor = V.add(points[0], offset);
    return points.every(p => {
      const q = V.add(p, offset), y = ground(q[0], q[2]);
      return Number.isFinite(y) && Math.abs(q[1] - y) <= height * 0.018 && distance(q, anchor) <= height * 0.014;
    }) ? anchor : null;
  }

  function matchingFoot(left, right, offsetA, offsetB, ground, height) {
    for (const [id, samples] of left.feet) {
      const a = planted(samples, offsetA, ground, height);
      const b = planted(right.feet.get(id), offsetB, ground, height);
      if (!a || !b || Math.abs(a[1] - b[1]) > height * 0.018 || distance(a, b) > height * 0.22) continue;
      const offset = V.add(offsetB, xz(a, b));
      if (planted(right.feet.get(id), offset, ground, height)) return { id, offset };
    }
    return null;
  }

  function changedRange(start, end, duration, focus, delta = 0) {
    const lo = Math.max(0, start - 0.18), hi = Math.min(duration, end + 0.18);
    return Object.freeze({ start: lo, end: hi, duration: hi - lo, focus, delta, timeAt(elapsed) {
      if (!Number.isFinite(elapsed)) throw new TypeError('Changed-section time must be finite');
      const span = hi - lo, phase = elapsed % span;
      return lo + (phase < 0 ? phase + span : phase);
    } });
  }

  function create({ clips, steps, root, alignment = 'source', puppet, feet = [], height = 1, fps = 24, ground = () => 0 } = {}) {
    if (!clips || typeof clips !== 'object' || !alignments.includes(alignment) ||
        !Number.isFinite(height) || height <= 0 || !Number.isInteger(fps) || fps < 6 || fps > 120 ||
        !Array.isArray(feet) || feet.length > 8 || typeof ground !== 'function')
      throw new TypeError('A sequence needs native clips, a valid sample rate and reference height');
    if ((root !== undefined && !idOf(root)) || ((alignment !== 'source' || feet.length) && !root) ||
        (puppet && root && (!Object.hasOwn(puppet.parts, root) || puppet.parts[root].parent)))
      throw new TypeError('Root placement needs a top-level position part');
    const library = new Map(Object.entries(clips)), holds = new Map();
    const soleIds = new Set();
    const soles = Array.from(feet, foot => {
      let part = puppet?.parts?.[foot?.part];
      while (part?.parent && part.name !== root) part = puppet.parts[part.parent];
      if (typeof puppet?.solve !== 'function' || typeof puppet.point !== 'function' ||
          !idOf(foot?.id) || soleIds.has(foot.id) || part?.name !== root || !point(foot.point))
        throw new TypeError('A sole needs a unique ID, a rest point, and a part under the root');
      soleIds.add(foot.id);
      return { ...foot, point: foot.point.slice() };
    });
    function getClip(id) {
      const source = library.get(id), clip = source?.clip ?? source;
      if (typeof clip?.sample !== 'function' || !Array.isArray(clip.tracks) || !Array.isArray(clip.cues) ||
          !Number.isFinite(clip.dur) || clip.dur <= 0 ||
          (source !== clip && (typeof source.held?.sample !== 'function' || !Array.isArray(source.markers))))
        throw new TypeError('Unknown or invalid clip: ' + id);
      return clip;
    }
    function getHeld(id) {
      if (!holds.has(id)) holds.set(id, library.get(id).held ?? A.poseBlocking.heldClip(getClip(id)));
      return holds.get(id);
    }
    function normalize(spec) {
      if (!idOf(spec?.id) || !idOf(spec.clip)) throw new TypeError('A clip instance needs an ID and source clip');
      const clip = getClip(spec.clip), from = spec.in ?? 0, to = spec.out ?? clip.dur;
      const duration = spec.duration ?? to - from, ease = spec.ease ?? 'linear';
      if (![from, to, duration].every(Number.isFinite) || from < 0 || to > clip.dur || to <= from ||
          duration < 1e-6 || !eases.includes(ease))
        throw new RangeError('Invalid trim, duration, or timing curve for ' + spec.id);
      return { id: spec.id, clip: spec.clip, in: from, out: to, duration, ease };
    }
    function trim(step, patch) {
      const from = patch.in ?? step.in, to = patch.out ?? step.out;
      return normalize({ ...step, ...patch, id: step.id, clip: step.clip, in: from, out: to,
        duration: patch.duration ?? step.duration * (to - from) / (step.out - step.in) });
    }
    function rootAt(pose) {
      const value = root ? pose[root]?.pos : undefined;
      if (value !== undefined && !point(value)) throw new TypeError('Root position needs a finite XYZ vector');
      return value ?? zero;
    }
    function edge(step, outgoing, takeFeet) {
      const clip = getClip(step.clip), dt = Math.min(1 / fps, step.duration / 2);
      const at = outgoing ? step.duration : 0, sign = outgoing ? -1 : 1;
      const pose = clipPose(clip, step, at), near = clipPose(clip, step, at + sign * dt);
      const feet = new Map();
      if (takeFeet && soles.length && step.duration >= 0.10) {
        const span = Math.min(0.1, step.duration / 2);
        const samples = Math.max(2, Math.ceil(span * fps));
        for (const sole of soles) feet.set(sole.id, []);
        K.deform.inspectPoses(puppet, solve => {
          for (let i = 0; i <= samples; i++) {
            const seconds = i * span / samples;
            const solved = solve(seconds ? clipPose(clip, step, at + sign * seconds) : pose);
            for (const sole of soles) feet.get(sole.id).push(solved.point(sole.part, sole.point));
          }
        });
      }
      return { pose, near, feet, dt, root: rootAt(pose) };
    }
    function handoff(a, b, offsetA, alignment) {
      const rootA = V.add(a.root, offsetA);
      let offset = alignment === 'source' ? zero : xz(rootA, b.root);
      const contact = alignment === 'foot' && a.feet.size && b.feet.size
        ? matchingFoot(a, b, offsetA, offset, ground, height) : null;
      if (contact) offset = contact.offset;
      const rootGap = distance(rootA, V.add(b.root, offset));
      const { poseGap, velocityGap } = channelGaps(a, b, root, height);
      const error = 0.62 * clamp01(poseGap * 3) + 0.28 * clamp01(velocityGap * 0.45) + 0.1 * clamp01(rootGap / height * 2);
      const score = Math.round((1 - error) * 100);
      return { score, quality: score >= 80 ? 'clean' : score >= 54 ? 'workable' : 'wide',
        poseGap, velocityGap, rootGap, sourceRootGap: distance(rootA, b.root), offset,
        alignment: contact ? 'foot' : alignment === 'source' ? 'source' : 'root', foot: contact?.id ?? null };
    }

    function compile(specs, placement, changeSpec) {
      if (!Array.isArray(specs) || !specs.length || specs.length > 64)
        throw new RangeError('A sequence needs one to 64 clip instances');
      if (!alignments.includes(placement) || (placement !== 'source' && !root)) throw new TypeError('Invalid sequence alignment');
      const instances = [], handoffs = [], keys = [], cues = [], markers = [], ids = new Set();
      const exactTimes = new Map();
      let duration = 0;
      for (const raw of specs) {
        const step = normalize(raw);
        if (ids.has(step.id)) throw new Error('Duplicate clip instance: ' + step.id);
        ids.add(step.id);
        const start = duration;
        duration += step.duration;
        if (!Number.isFinite(duration) || duration <= start) throw new RangeError('Sequence duration exceeds timing precision');
        const clip = getClip(step.clip), previous = instances.at(-1);
        let offset = zero;
        if (previous) {
          const report = handoff(edge(previous, true, placement === 'foot'), edge(step, false, placement === 'foot'),
            previous.offset, placement);
          offset = report.offset;
          handoffs.push(Object.freeze({ ...report, offset: Object.freeze(offset.slice()),
            time: start, from: previous.id, to: step.id }));
        }
        const instance = Object.freeze({ ...step, start, end: duration, offset: Object.freeze(offset.slice()) });
        instances.push(instance);
        const mapped = new Map();
        exactTimes.set(step.id, mapped);
        function authoredTime(sourceTime) {
          const time = stepTime(instance, sourceTime);
          mapped.set(time, sourceTime);
          return time;
        }
        for (const marker of library.get(step.clip).markers ?? []) {
          if (marker.time < step.in || marker.time > step.out) continue;
          markers.push(Object.freeze({ ...marker, step: step.id, clip: step.clip,
            sourceTime: marker.time, time: authoredTime(marker.time) }));
        }
        for (const track of clip.tracks) for (const key of track.keys ?? []) {
          const sourceTime = key.t ?? key.time;
          if (sourceTime >= step.in && sourceTime <= step.out) keys.push(Object.freeze({
            step: step.id, clip: step.clip, part: track.part, channel: track.ch, sourceTime, time: authoredTime(sourceTime)
          }));
        }
        for (const cue of [...clip.cues, ...(clip.animationEvents ?? [])]) {
          const event = Array.isArray(cue) ? { time: cue[0], id: cue[1] } : cue;
          if (event?.enabled === false || !(event?.time >= step.in && event.time <= step.out)) continue;
          const sourceTime = event.time, time = stepTime(instance, sourceTime);
          const span = Number.isFinite(event.duration) && event.duration >= 0
            ? { duration: stepTime(instance, Math.min(step.out, sourceTime + event.duration)) - time } : {};
          cues.push(Object.freeze({ ...event, ...span, sourceTime, time, step: step.id, clip: step.clip }));
        }
      }
      keys.sort((a, b) => a.time - b.time);
      cues.sort((a, b) => a.time - b.time);
      const startRoot = rootAt(clipPose(getClip(instances[0].clip), instances[0], 0));
      const last = instances.at(-1);
      const endRoot = V.add(rootAt(clipPose(getClip(last.clip), last, last.duration)), last.offset);
      const travel = Object.freeze(xz(endRoot, startRoot));
      const indexOf = id => {
        const index = instances.findIndex(instance => instance.id === id);
        if (index < 0) throw new Error('Unknown clip instance: ' + id);
        return index;
      };
      function playback(mode) {
        if (!modes.includes(mode) || (mode === 'travel-loop' && !root)) throw new TypeError('Invalid sequence playback mode');
      }
      function at(time, { mode = 'once' } = {}) {
        playback(mode);
        if (!Number.isFinite(time)) throw new TypeError('Sequence time must be finite');
        const elapsed = Math.max(0, time);
        let cycle = mode === 'once' ? 0 : Math.floor(elapsed / duration);
        let phase = mode === 'once' ? Math.min(duration, elapsed) : Math.max(0, elapsed - cycle * duration);
        // Keep exact cycle boundaries at the beginning, including decimal clip durations.
        if (mode !== 'once' && phase >= duration - Math.min(duration * 1e-9, 1e-10)) {
          cycle++;
          phase = 0;
        }
        if (!Number.isSafeInteger(cycle)) throw new RangeError('Sequence cycle exceeds timing precision');
        const step = instances.find(instance => phase < instance.end) ?? last;
        const sourceTime = exactTimes.get(step.id).get(phase) ?? stepSource(step, phase - step.start);
        return { time: phase, cycle, step, sourceTime, finished: mode === 'once' && phase === duration };
      }
      function sample(time, out, options) {
        const { step, sourceTime, cycle } = at(time, options);
        const clip = options?.held ? getHeld(step.clip) : getClip(step.clip);
        const pose = clip.sample(sourceTime, {}, { sourceTime: true });
        const mode = options?.mode ?? 'once';
        if (root) {
          const base = rootAt(pose), offset = mode === 'travel-loop' ? V.mad(step.offset, travel, cycle) : step.offset;
          const position = mode === 'loop' ? [startRoot[0], base[1], startRoot[2]] : V.add(base, offset);
          if (pose[root]?.pos || position.some(v => v !== 0)) A.put(pose, root, 'pos', position);
        }
        if (!out) return pose;
        for (const part of Object.keys(out)) delete out[part];
        return Object.assign(out, pose);
      }
      function eventsBetween(from, to, { mode = 'once' } = {}) {
        playback(mode);
        if (![from, to].every(Number.isFinite) || to < from) throw new RangeError('Cue range must be finite and ordered');
        if (!cues.length || to < 0) return [];
        const first = mode === 'once' ? 0 : Math.max(0, Math.floor(from / duration) - 1);
        const end = mode === 'once' ? 0 : Math.floor(to / duration) + 1;
        if (!Number.isSafeInteger(end) || end - first > 2048) throw new RangeError('Cue range spans too many sequence cycles');
        const events = [];
        for (let cycle = first; cycle <= end; cycle++) for (const cue of cues) {
          const time = cue.time + cycle * duration;
          if (time > from && time <= to) events.push({ ...cue, time, cycle });
        }
        return events;
      }
      function suggestCut(index, { radiusFrames = 8 } = {}) {
        if (!Number.isInteger(index) || !handoffs[index] || !Number.isInteger(radiusFrames) || radiusFrames < 1 || radiusFrames > 12)
          throw new RangeError('A cut suggestion needs a valid handoff and frame radius');
        const left = instances[index], right = instances[index + 1], current = handoffs[index];
        const prior = placement === 'foot' && index > 0 ? instances[index - 1] : null;
        const priorEdge = prior ? edge(prior, true, true) : null;
        const offsets = Array.from({ length: 2 * radiusFrames + 1 }, (_, i) => i - radiusFrames);
        function candidates(step, field) {
          const source = getClip(step.clip), sampleRate = source.fps > 0 && Number.isFinite(source.fps) ? source.fps : fps;
          const minimum = Math.min(step.out - step.in, 2 / sampleRate);
          return offsets.flatMap(frames => {
            const time = step[field] + frames / sampleRate;
            const from = field === 'in' ? time : step.in, to = field === 'out' ? time : step.out;
            if (from < 0 || to > source.dur || to - from < minimum - 1e-9) return [];
            const candidate = trim(step, { [field]: time });
            const offset = prior && field === 'out'
              ? handoff(priorEdge, edge(candidate, false, true), prior.offset, placement).offset : step.offset;
            return [{ step: candidate, frames, offset, edge: edge(candidate, field === 'out', placement === 'foot') }];
          });
        }
        const from = candidates(left, 'out'), to = candidates(right, 'in');
        let best;
        for (const a of from) for (const b of to) {
          const cost = Math.abs(a.frames) + Math.abs(b.frames);
          if (!cost) continue;
          const result = handoff(a.edge, b.edge, a.offset, placement);
          const improvement = result.score - current.score, gain = improvement - 0.4 * cost;
          if (improvement < 6 || gain < 3 || (best && (gain < best.gain || (gain === best.gain && cost >= best.cost)))) continue;
          best = { index, from: left.id, to: right.id, out: a.step.out, in: b.step.in,
            sourceFrames: a.frames, targetFrames: b.frames, score: result.score, currentScore: current.score, improvement, cost, gain };
        }
        return best ? Object.freeze(best) : null;
      }
      let change = null;
      if (changeSpec?.ids) {
        const selected = changeSpec.ids.map(id => instances[indexOf(id)]);
        change = changedRange(selected[0].start, selected.at(-1).end, duration, changeSpec.ids[0], duration - changeSpec.previous);
      } else if (changeSpec && handoffs.length) {
        const weakest = handoffs.reduce((a, b) => a.score <= b.score ? a : b);
        change = changedRange(weakest.time, weakest.time, duration, weakest.to);
      }
      const plan = Object.freeze({ steps: Object.freeze(instances), duration, fps, alignment: placement, travel, markers: Object.freeze(markers),
        handoffs: Object.freeze(handoffs), keys: Object.freeze(keys), cues: Object.freeze(cues), change, at, sample, eventsBetween,
        suggestCut,
        edit(id, patch) {
          const index = indexOf(id);
          const changed = trim(instances[index], patch);
          if (['in', 'out', 'duration', 'ease'].every(key => changed[key] === instances[index][key])) return plan;
          return compile(instances.map((step, i) => i === index ? changed : step), placement, { ids: [id], previous: duration });
        },
        align(mode) {
          return mode === placement ? plan : compile(instances, mode, {});
        },
        arrange(steps) {
          if (!Array.isArray(steps) || !steps.length) return compile(steps, placement);
          const next = Array.from(steps, normalize);
          const same = (a, b) => !!a && !!b &&
            ['id', 'clip', 'in', 'out', 'duration', 'ease'].every(key => a[key] === b[key]);
          let start = 0, tail = 0;
          while (start < next.length && same(next[start], instances[start])) start++;
          if (start === next.length && next.length === instances.length) return plan;
          while (tail < Math.min(next.length, instances.length) - start &&
              same(next[next.length - 1 - tail], instances[instances.length - 1 - tail])) tail++;
          const first = Math.min(start, next.length - 1);
          const ids = next.slice(first, Math.max(first + 1, next.length - tail)).map(step => step.id);
          return compile(next, placement, { ids, previous: duration });
        },
        applyCut(index, options) {
          const cut = suggestCut(index, options);
          if (!cut) return plan;
          const next = instances.map((step, i) => i === index ? trim(step, { out: cut.out }) :
            i === index + 1 ? trim(step, { in: cut.in }) : step);
          return compile(next, placement, { ids: [cut.from, cut.to], previous: duration });
        }
      });
      return plan;
    }
    return compile(steps, alignment);
  }

  A.sequence = Object.freeze({ create, eases: Object.freeze(eases), modes: Object.freeze(modes) });
})(KIT);
