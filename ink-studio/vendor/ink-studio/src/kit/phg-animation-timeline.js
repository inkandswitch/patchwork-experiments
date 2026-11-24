/* One shot clock and one native evaluation path for blocking, timing, and polish. */
(function (K) {
  const { anim: A, clamp, deform } = K;
  const stages = Object.freeze(['block', 'spline', 'polish']);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function create({ world, puppet, clip, blocking, sequence, motionLayers, contacts, fx, cloth = [], review, sprite = {} } = {}) {
    const source = blocking?.clip ?? clip;
    const duration = sequence?.duration ?? source?.dur;
    if ([clip, blocking, sequence].filter(value => value !== undefined).length !== 1 ||
        typeof (sequence ?? source)?.sample !== 'function' || !Number.isFinite(duration) || duration <= 0 ||
        !world?.anim || puppet?.anim !== world.anim || typeof puppet.setPoseSampler !== 'function')
      throw new TypeError('Animation timeline needs a world, its puppet, and one native clip, blocking plan, or sequence');
    if (motionLayers !== undefined && (motionLayers?.duration !== duration || typeof motionLayers.apply !== 'function' ||
        typeof motionLayers.at !== 'function' || !Array.isArray(motionLayers.layers) ||
        motionLayers.layers.some(layer => layer.parts?.some(part => !Object.hasOwn(puppet.parts, part)))))
      throw new TypeError('Motion layers must use this shot duration and its puppet part names');
    const spriteSpec = {
      width: 96, height: 96, directions: 8, fps: sequence?.fps ?? source?.fps ?? 12,
      yaw: world.cam?.yaw, pivot: world.cam?.target, ...sprite
    };
    const { width, height, directions, fps, yaw, pivot } = spriteSpec;
    if (![width, height, directions].every(Number.isSafeInteger) || width < 1 || width > 2048 ||
        height < 1 || height > 2048 || directions < 1 || directions > 64 ||
        !Number.isFinite(fps) || fps <= 0 || fps > 240 || !Number.isFinite(yaw) ||
        !Array.isArray(pivot) || pivot.length !== 3 || !Array.from(pivot).every(Number.isFinite))
      throw new TypeError('Invalid timeline sprite dimensions, directions, frame rate, or camera');
    const framing = Object.freeze({ width, height, directions, fps, yaw, pivot: Object.freeze(pivot.slice()) });
    const inShot = time => Number.isFinite(time) && time >= 0 && time <= duration;
    const mod = (value, span) => {
      const time = value % span;
      return time < 0 ? time + span : time;
    };
    const copyLoop = loop => loop && { ...loop };
    const windowLength = loop => loop.wraps ? duration - loop.start + loop.end : loop.end - loop.start;

    let cursor = { stage: 'block', time: 0, part: null, loop: null, direction: 0 }, focused = null;
    function range(value) {
      if (value === null) return null;
      if (!record(value)) throw new TypeError('Timeline loop must be null or a range');
      const { start, end, wraps = false } = value;
      if (!inShot(start) || !inShot(end) || typeof wraps !== 'boolean' ||
          (wraps ? duration - start + end <= 0 : start >= end))
        throw new RangeError('Invalid timeline loop range');
      return { start, end, wraps };
    }
    function context(draft) {
      const { stage, time, part, loop, direction } = draft;
      if (!stages.includes(stage)) throw new RangeError('Stage must be block, spline, or polish');
      if (!inShot(time)) throw new RangeError('Playhead must be within the shot');
      if (part !== null && (typeof part !== 'string' || !Object.hasOwn(puppet.parts, part)))
        throw new RangeError('Unknown timeline part: ' + part);
      if (!Number.isSafeInteger(direction) || direction < 0 || direction >= directions)
        throw new RangeError('Direction must be a zero-based sprite direction');
      return { stage, time, part, loop: range(loop), direction };
    }
    function snapshot() {
      return { version: 1, ...cursor, loop: copyLoop(cursor.loop),
        focus: focused && { id: focused.id, previous: { ...focused.previous, loop: copyLoop(focused.previous.loop) } } };
    }
    function set(patch) {
      if (!record(patch) || Object.keys(patch).some(key => !Object.hasOwn(cursor, key)))
        throw new TypeError('Unknown timeline context field');
      cursor = context({ ...cursor, ...patch });
      return snapshot();
    }
    function restore(state) {
      if (!record(state) || state.version !== 1) throw new TypeError('Invalid timeline context version');
      const next = context(state);
      let focus = null;
      if (state.focus) {
        const { id, previous } = state.focus;
        if (!record(previous) || !motionReview()?.findings.some(item => item.id === id))
          throw new RangeError('Saved timeline finding no longer exists');
        const { time, part, loop } = context({ ...next, time: previous.time, part: previous.part, loop: previous.loop });
        focus = { id, previous: { time, part, loop } };
      }
      cursor = next;
      focused = focus;
      return snapshot();
    }

    const held = sequence ? null : blocking?.held ?? A.poseBlocking.heldClip(source);
    function basePose(time, stage) {
      const block = stage === 'block';
      const pose = sequence ? sequence.sample(time, {}, { held: block })
        : (block ? held : source).sample(time, {}, { sourceTime: true });
      return block || !motionLayers ? pose : motionLayers.apply(pose, time);
    }
    const contactPlans = new Map();
    const contactSpec = contacts === undefined ? null : structuredClone(contacts);
    let contactTiming = contactSpec;
    function plan(stage, layers) {
      const key = stage === 'block' ? 'block' : layers.length ? 'corrected' : 'spline';
      const prior = contactPlans.get(key);
      if (prior && prior.layers.length === layers.length &&
          layers.every((layer, i) => layer.source === prior.layers[i].source)) return prior.plan;
      const compiled = A.contacts.create({ ...contactTiming, duration, puppet,
        sample: t => A.layers(basePose(t, stage), layers, t, duration, 'corrective') });
      contactPlans.set(key, { layers, plan: compiled });
      return compiled;
    }
    function evaluate(time, stage, layers = []) {
      if (!contactSpec)
        return { pose: A.layers(basePose(time, stage), layers, time, duration, 'corrective'), contacts: null };
      const native = plan(stage, layers);
      return deform.inspectPoses(puppet, () => {
        const constraints = native.pose(time);
        return { pose: puppet.pose, contacts: constraints };
      });
    }
    if (contactSpec) {
      const authored = plan('spline', []);
      if (contactSpec.prop) {
        const timing = new Map(authored.handoffs.map(key => [key.id, key]));
        const keys = contactSpec.prop.keys.map(key => {
          const { reachStart, settleEnd } = timing.get(key.id);
          return { ...key, ...(key.reach && { reach: { ...key.reach, lead: key.time - reachStart } }),
            ...(settleEnd > key.time && { settle: settleEnd - key.time }) };
        });
        contactTiming = { ...contactSpec, prop: { ...contactSpec.prop, keys } };
      }
    }
    let analysis;
    function copyInto(pose, out) {
      if (!out) return pose;
      for (const part of Object.keys(out)) delete out[part];
      return Object.assign(out, pose);
    }
    function motionReview() {
      if (review === undefined) return null;
      if (!analysis) analysis = A.motionReview.create({ ...review, puppet,
        clip: { dur: duration, loop: source?.loop ?? false, time: t => clamp(t, 0, duration),
          sample: (t, out) => copyInto(evaluate(t, 'spline').pose, out) },
        loopSource: time => basePose(time, 'spline'),
        applyFixes: (time, layers, out) => copyInto(evaluate(time, 'polish', layers).pose, out)
      });
      return analysis;
    }
    const layersFor = (stage, before) => stage === 'polish' && !before && analysis
      ? analysis.layers().filter(layer => layer.enabled) : [];
    function finding(value) {
      const findings = motionReview()?.findings ?? [];
      const exact = findings.find(item => item.id === value);
      if (exact) return exact;
      const matches = findings.filter(item => item.kind === value);
      if (matches.length === 1) return matches[0];
      throw new RangeError(matches.length ? 'Multiple motion findings match ' + value + '; use an ID' : 'Unknown motion finding: ' + value);
    }
    function focus(value) {
      const item = finding(value), { start, end, wraps } = motionReview().focus(item.id);
      const { time, part, loop } = cursor;
      const next = { id: item.id, previous: focused?.previous ?? { time, part, loop } };
      set({ time: item.time, part: item.part, loop: { start, end, wraps } });
      focused = next;
      return snapshot();
    }
    function clearFocus() {
      if (focused) set(focused.previous);
      focused = null;
      return snapshot();
    }
    function timeAt(elapsed) {
      if (!Number.isFinite(elapsed)) throw new TypeError('Playback offset must be finite');
      const { loop } = cursor;
      if (!loop) return clamp(cursor.time + elapsed, 0, duration);
      const at = loop.start + mod(elapsed, windowLength(loop));
      return loop.wraps && at >= duration ? at - duration : at;
    }

    const panels = new Map(), takes = [], takeIds = new Set();
    if (!Array.isArray(cloth)) throw new TypeError('Cloth takes must be an array');
    for (const placement of cloth) {
      const { id, panel, before } = placement;
      const take = typeof placement.take?.sample === 'function' ? placement.take : K.cloth.review.clip(placement.take);
      const start = placement.start ?? take.sourceTime, end = Math.min(duration, start + take.duration);
      if (typeof id !== 'string' || !id.trim() || takeIds.has(id) || !inShot(start) || start === duration ||
          typeof panel?.drawPose !== 'function' || panel.nu !== take.nu || panel.nv !== take.nv ||
          !Number.isInteger(panel.first) || panel.first < 0 || panel.first + panel.count > world.count ||
          !Number.isFinite(take.duration) || take.duration <= 0 ||
          (before !== undefined && typeof before !== 'function'))
        throw new TypeError('A cloth take needs a unique ID, matching allocated panel, and start within the shot');
      takeIds.add(id);
      const entry = { id, panel, before, take, start, end };
      takes.push(entry);
      if (!panels.has(panel)) panels.set(panel, []);
      panels.get(panel).push(entry);
    }
    takes.sort((a, b) => a.start - b.start);
    for (const entries of panels.values()) {
      entries.sort((a, b) => a.start - b.start);
      if (entries.some((entry, i) => i && entries[i - 1].end > entry.start))
        throw new RangeError('Cloth takes on the same panel overlap');
    }
    const clothStage = { D: world.data, base: world.data, rows: world.anim.rows };
    function drawCloth(time, polish) {
      const applied = [], direction = ArtDirection.prepare(world.look?.artDirection,frameOptions?.artDirection);
      for (const [panel, entries] of panels) {
        const current = entries.findLast(entry => entry.start <= time);
        const placement = current ?? entries[0];
        const local = time - placement.start;
        const elapsed = polish && current ? local >= placement.take.duration ? placement.take.duration :
          ArtDirection.time(direction,local,'cloth') : 0;
        const points = polish && current ? placement.take.sample(elapsed)
          : placement.before?.(time, puppet) ?? placement.take.sample(0);
        panel.drawPose(clothStage, points);
        applied.push({ id: placement.id, time: elapsed, baked: !!(polish && current) });
      }
      return applied;
    }

    let frameOptions, current, activeStage = 'block', activeLayers = [];
    if (fx !== undefined) {
      if (fx.duration !== duration || typeof fx.bind !== 'function')
        throw new TypeError('Motion FX must use the timeline duration');
      fx.bind(world, puppet, (time, actor) => {
        actor.pose = evaluate(time, activeStage, activeLayers).pose;
      });
    }
    puppet.setPoseSampler((time, dt, actor) => {
      const t = clamp(time, 0, duration);
      const { stage = cursor.stage, before = false } = frameOptions ?? {};
      activeStage = stage;
      activeLayers = layersFor(stage, before);
      const { pose, contacts } = evaluate(t, stage, activeLayers);
      actor.pose = pose;
      actor.solve();
      const polish = stage === 'polish' && !before;
      const effects = fx?.apply(t, { before: !polish }) ?? null;
      current = { time: t, stage, contacts, effects, cloth: drawCloth(t, polish),
        ...(motionLayers && { motionLayers: motionLayers.at(t, { enabled: stage !== 'block' }) }) };
    });
    function sample(time = cursor.time, out, { stage = cursor.stage, before = false } = {}) {
      if (!inShot(time) || !stages.includes(stage)) throw new RangeError('Invalid timeline sample time or stage');
      return copyInto(evaluate(time, stage, layersFor(stage, before)).pose, out);
    }
    function frame(time = cursor.time, { stage = cursor.stage, before = false, artDirection } = {}) {
      if (!inShot(time) || !stages.includes(stage)) throw new RangeError('Invalid timeline frame time or stage');
      current = undefined;
      frameOptions = { stage, before, artDirection };
      try { world.anim.update(0, time); }
      finally { frameOptions = undefined; }
      if (!current) throw new Error('The timeline no longer owns this puppet pose sampler');
      return current;
    }
    const cues = () => sequence?.cues.slice() ?? [...(source?.cues ?? []), ...(source?.animationEvents ?? [])];
    function report({ before = false } = {}) {
      const motion = motionReview(), authored = contactSpec && plan('spline', []);
      return { duration, state: snapshot(), sprite: framing,
        lanes: {
          poses: sequence?.markers?.slice() ?? blocking?.markers.slice() ?? [],
          clips: sequence?.steps.slice() ?? [],
          handoffs: sequence?.handoffs.slice() ?? [],
          motionLayers: motionLayers?.layers.map((layer, order) => ({ ...layer, order })) ?? [],
          keys: sequence?.keys.slice() ?? (source?.tracks ?? []).flatMap(track =>
            (track.keys ?? []).map(key => ({ part: track.part, channel: track.ch, time: key.t ?? key.time }))).sort((a, b) => a.time - b.time),
          cues: cues(),
          contacts: authored?.contacts.slice() ?? [],
          transfers: authored?.handoffs.map(item => ({ ...item, part: contactSpec.prop.part })) ?? [],
          fx: fx?.effects().map(item => ({ ...item, start: item.keys[0][0], end: item.keys.at(-1)[0] })) ?? [],
          cloth: takes.map(({ id, take, start, end }) => ({ id, start, end, sourceTime: take.sourceTime, duration: take.duration })),
          findings: motion?.findings.slice() ?? [],
          corrections: motion?.layers().map(({ source, ...layer }) => layer) ?? []
        },
        changedSection: sequence?.change ?? null,
        focus: focused ? { ...motion.focus(focused.id, { before: before || cursor.stage !== 'polish' }), id: focused.id } : null };
    }

    return Object.freeze({ duration, sprite: framing, snapshot, set, restore, timeAt,
      focus, clearFocus, sample, frame, report, cues, motionReview });
  }
  A.timeline = Object.freeze({ create, stages });
})(KIT);
