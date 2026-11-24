/* Checkpoint-backed simulation transport and editable timeline takes. */
(function (K) {
  const W = K.world, R = W.runtime, { check, copy, id, record, read, selector, vector } = W.data;
  const { freeze, isImmutable } = K.procedural.data, { M, V } = K;
  const takeFormat = 'ink-studio/simulation-take';
  const tickOK = tick => Number.isSafeInteger(tick) && tick >= 0 && tick <= R.maxTick;

  function motionTracks(entity, part = entity) {
    check(id(entity) && typeof part === 'string' && part.length > 0, 'Entity motion needs an entity ID and destination part');
    return ['translation', 'orientation'].map(channel => ({ entity, channel, target: ['poses', part, channel] }));
  }

  function captureTrack(raw) {
    check(record(raw), 'Invalid capture track');
    const target = selector(raw.target).map(String);
    const { entity, channel, socket, reference, field, at, args, path, mode } = raw;
    const allowed = field === undefined ? ['target', 'entity', 'channel', 'socket', 'reference'] :
      ['target', 'field', 'at', 'args', 'path', 'mode'];
    check(Object.keys(raw).every(key => allowed.includes(key)), 'Invalid capture track fields on ' + target.join('/'));
    if (field !== undefined) {
      check(typeof field === 'string' && field.length > 0, 'Capture needs a queryable field');
      const member = path === undefined ? null : selector(path);
      return { target, mode, read(query) {
        const result = query.probe(field, at, args);
        if (result.status !== 'ok') throw Error(field + ' is ' + result.status + (result.reason ? ' (' + result.reason + ')' : ''));
        return member ? read(result.value, member) : result.value;
      } };
    }
    const poseSelector = row => record(row) && id(row.entity) && (row.socket === undefined || id(row.socket));
    check(poseSelector(raw) && ['translation', 'orientation'].includes(channel) &&
      (reference === undefined || poseSelector(reference) && Object.keys(reference).every(key => ['entity', 'socket'].includes(key))),
    'Capture needs an entity pose channel and an optional reference entity');
    let origin;
    function frame(query, target) {
      const pose = query.frame(target);
      check(vector(pose?.point), 'Missing pose for ' + target.entity + (target.socket ? '/' + target.socket : ''));
      return { point: pose.point, orientation: pose.rotation ?? M.id() };
    }
    return { target, mode: channel === 'orientation' ? 'orientation' : undefined, read(query) {
      const pose = frame(query, { entity, socket }), basis = reference && frame(query, reference);
      const turn = basis && M.tr(basis.orientation);
      const value = channel === 'translation' ?
        (basis ? M.app(turn, V.sub(pose.point, basis.point)) : pose.point) :
        (basis ? M.mul(turn, pose.orientation) : pose.orientation);
      if (channel === 'orientation') check(K.anim.keyframeTrack.orientation(value), 'Pose needs a rigid orientation');
      if (!origin) {
        origin = value.slice();
        return channel === 'orientation' ? M.id() : [0, 0, 0];
      }
      return channel === 'orientation' ? M.mul(value, M.tr(origin)) : V.sub(value, origin);
    } };
  }

  function openTake(take) {
    check(record(take) && take.format === takeFormat && take.version === 1, 'Expected an Ink Studio simulation take');
    return K.timeline.compile(take.sequence);
  }

  function create(source, { checkpointEvery = 60, checkpointCache = 16, commands = [], runtime = {} } = {}) {
    check(Number.isSafeInteger(checkpointEvery) && checkpointEvery >= 1 && checkpointEvery <= R.maxTick &&
      Number.isSafeInteger(checkpointCache) && checkpointCache >= 0 && checkpointCache <= 128, 'Invalid scrub checkpoint policy');
    check(Array.isArray(commands), 'Expected a list of scrub commands');
    const recording = source?.format === R.runFormat ? (isImmutable(source) ? source : freeze(copy(source))) : null;
    const checkpoint = recording?.origin ?? (source?.format === R.checkpointFormat ? source : undefined);
    let end;
    if (recording) {
      check(recording.version === 1 && checkpoint?.format === R.checkpointFormat &&
        recording.end?.format === R.checkpointFormat && tickOK(recording.end.tick) &&
        recording.end.tick >= checkpoint.tick && Array.isArray(recording.commands), 'Invalid simulation recording range');
      check(!commands.length, 'Use a world or checkpoint to schedule new scrub commands');
      end = isImmutable(recording.end) ? recording.end : freeze(copy(recording.end));
    }
    const options = { implementations: runtime.implementations, workerPool: runtime.workerPool };
    const restore = saved => recording ? R.openRecording(recording, { ...options, checkpoint: saved }) :
      R.create(saved.world, { ...options, checkpoint: saved });
    let current = recording ? R.openRecording(recording, options) : checkpoint ? restore(checkpoint) : R.create(source, options);
    if (!recording) current.schedule(commands);
    const origin = current.checkpoint(), dt = origin.world.dt, toTick = end?.tick ?? R.maxTick;
    let cached = new Map(), last = { checkpointTick: origin.tick, replayedTicks: 0 };

    function checkEnd(run) {
      if (end && run.view().tick === toTick)
        check(R.checkpointsEqual(run.checkpoint(), end, options), 'Replay diverged at tick ' + toTick);
    }
    checkEnd(current);

    function checkTick(tick) {
      check(tickOK(tick) && tick >= origin.tick && tick <= toTick,
        'Scrub tick must be in [' + origin.tick + ', ' + toTick + ']');
    }
    function start(tick) {
      let best = origin;
      for (const entry of cached.values())
        if (entry.tick <= tick && entry.tick > best.tick) best = entry;
      const now = current.view().tick;
      return now <= tick && now >= best.tick ?
        { run: current.fork(), tick: now } : { run: restore(best), tick: best.tick };
    }
    function remember(cache, snapshot) {
      if (!checkpointCache || snapshot.tick === origin.tick) return;
      cache.delete(snapshot.tick);
      cache.set(snapshot.tick, snapshot);
      if (cache.size > checkpointCache) cache.delete(cache.keys().next().value);
    }
    function seek(tick) {
      checkTick(tick);
      if (tick === current.view().tick) {
        last = { checkpointTick: tick, replayedTicks: 0 };
        return current.view();
      }
      const base = start(tick), { run } = base, next = new Map(cached);
      if (next.has(base.tick)) remember(next, next.get(base.tick));
      if (checkpointCache > 1) {
        const first = Math.floor((base.tick - origin.tick) / checkpointEvery) + 1;
        const end = Math.floor((tick - 1 - origin.tick) / checkpointEvery) + 1;
        const skip = Math.max(1, Math.ceil((end - first) / (checkpointCache - 1)));
        for (let i = first; i < end; i += skip) {
          run.advance(origin.tick + i * checkpointEvery);
          remember(next, run.checkpoint());
        }
      }
      run.advance(tick);
      checkEnd(run);
      remember(next, run.checkpoint());
      current = run;
      cached = next;
      last = { checkpointTick: base.tick, replayedTicks: tick - base.tick };
      return run.view();
    }
    function seekTime(seconds) {
      check(Number.isFinite(seconds) && seconds >= 0, 'Scrub time must be finite and nonnegative');
      const ticks = seconds / dt, nearest = Math.round(ticks);
      return seek(Math.abs(ticks - nearest) <= Number.EPSILON * Math.max(1, ticks) ? nearest : Math.floor(ticks));
    }
    function recordTake({ from = current.view().tick, to, every = 1, tracks } = {}) {
      checkTick(from);
      checkTick(to);
      check(from <= to && Number.isSafeInteger(every) && every >= 1 && every <= R.maxTick &&
        Array.isArray(tracks) && tracks.length > 0, 'A take needs an ordered tick range, positive stride and capture tracks');
      const samples = Math.ceil((to - from) / every) + 1;
      check((samples + 1) * tracks.length + 1 <= K.timeline.maxItems, 'Simulation take exceeds the timeline key budget');
      const readers = copy(tracks).map(captureTrack);
      check(new Set(readers.map(row => JSON.stringify(row.target))).size === readers.length, 'Duplicate take track target');
      const { run } = start(from);
      const keyed = readers.map(({ target, mode }) => ({ target, ...(mode !== undefined && { mode }), keys: [] }));

      function capture(view, query) {
        const time = (view.tick - from) * dt;
        readers.forEach((reader, i) => {
          try {
            const value = copy(reader.read(query));
            const continuous = Number.isFinite(value) || Array.isArray(value) && value.length && value.every(Number.isFinite);
            const ease = reader.mode === 'step' || !continuous ? 'step' : 'linear';
            keyed[i].keys.push({ time, value, ease });
          } catch (error) {
            throw Error('Take track ' + reader.target.join('/') + ' at tick ' + view.tick + ': ' + error.message);
          }
        });
      }
      capture(run.advance(from), run.query());
      for (let at = from; at < to;) {
        at = Math.min(to, at + every);
        capture(run.advance(at), run.query());
      }
      checkEnd(run);
      const take = { format: takeFormat, version: 1,
        source: { id: origin.world.id, seed: origin.world.seed, dt, fromTick: from, toTick: to, every },
        sequence: { duration: (to - from) * dt, tracks: keyed } };
      openTake(take);
      return freeze(take);
    }
    return Object.freeze({
      seek, seekTime, recordTake,
      view: () => current.view(), query: () => current.query(),
      checkpoint: () => current.checkpoint(), events: () => current.events,
      status: () => ({ tick: current.view().tick, fromTick: origin.tick, toTick, checkpointEvery, checkpointCache,
        cachedTicks: [origin.tick, ...cached.keys()].sort((a, b) => a - b), ...last })
    });
  }

  W.scrub = Object.freeze({ create, openTake, motionTracks, takeFormat });
})(KIT);
